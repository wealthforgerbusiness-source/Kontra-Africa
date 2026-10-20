import { auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import * as store from "./store.js";
import * as ui from "./ui.js";

const LOGIN_URL = "/login.html";
const PAY_URL = "/profil.html";            // ⚠️ page où l'utilisateur paie : à adapter
const SUB_RECHECK_MS = 60_000;             // revérifie l'abonnement au retour sur l'app

const ROUTES = {
  home:     { title: "Accueil",  fab: true,  load: () => import("./views/home.js") },
  stock:    { title: "Stock",    fab: true,  load: () => import("./views/stock.js") },
  ventes:   { title: "Ventes",   fab: true,  load: () => import("./views/sales.js") },
  finances: { title: "Finances", fab: false, load: () => import("./views/finances.js") },
  plus:     { title: "Plus",     fab: false, load: () => import("./views/more.js") }
};

const $ = (s, r = document) => r.querySelector(s);
const bus = new EventTarget();

/* ---------- Contexte partagé avec tous les écrans ---------- */
const ctx = {
  store, ui,
  user: null,
  profile: {},
  sub: { active: false, until: 0, daysLeft: 0, isAdmin: false },
  canWrite: false,
  route: { name: "home", param: null },
  PAY_URL,
  on(name, fn) { const h = (e) => fn(e.detail); bus.addEventListener(name, h); return () => bus.removeEventListener(name, h); },
  emit(name, detail) { bus.dispatchEvent(new CustomEvent(name, { detail })); },
  go(name, param) { location.hash = `#/${name}${param ? "/" + encodeURIComponent(param) : ""}`; },
  async refreshProfile() { ctx.profile = (await store.getProfile()) || {}; applyProfile(); ctx.emit("profile", ctx.profile); },
  async refreshSub(force = true) { await loadSub(force); },
  newSale: openSale,
  logout
};

let booted = false;
let unsubProducts = null;
let unmountView = null;
let renderToken = 0;
let lastSubCheck = Date.now();

/* ============================================================
   Connexion
   ============================================================ */
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.replace(LOGIN_URL); return; }
  if (booted) { if (ctx.user && ctx.user.uid !== user.uid) location.reload(); return; }
  booted = true;
  ctx.user = user;
  try {
    ctx.profile = (await store.ensureProfile()) || {};
    await loadSub(true);
    applyProfile();
    startProducts();
    bindShell();
    await navigate();
    hideLoader();
  } catch (e) {
    console.error("Démarrage :", e);
    hideLoader();
    $("#view").innerHTML = errorState("Impossible de démarrer l'application",
      e?.message || "Vérifiez votre connexion puis réessayez.", true);
    $("#view").querySelector("[data-reload]")?.addEventListener("click", () => location.reload());
  }
});

function hideLoader() {
  const l = $("#loader");
  if (!l) return;
  l.classList.add("is-done");
  setTimeout(() => l.remove(), 400);
}

async function logout() {
  try { if (unsubProducts) unsubProducts(); await signOut(auth); }
  finally { location.replace(LOGIN_URL); }
}

/* ============================================================
   Profil et abonnement
   ============================================================ */
function applyProfile() {
  ui.setCurrency(ctx.profile.currency || "USD");
  const name = ctx.profile.businessName || "Mon commerce";
  $("#sbBusiness").textContent = name;            // textContent : pas d'HTML
}

async function loadSub(force) {
  try {
    ctx.sub = await store.getSubscriptionStatus(force);
  } catch {
    /* hors ligne : on garde le dernier statut connu */
  }
  lastSubCheck = Date.now();
  ctx.canWrite = ctx.sub.active;
  renderBanner();
  renderSubLabel();
  updateFab();
  ctx.emit("sub", ctx.sub);
}

function renderSubLabel() {
  const el = $("#sbSub");
  el.textContent = ctx.sub.active
    ? `Actif · ${ctx.sub.daysLeft} jour${ctx.sub.daysLeft > 1 ? "s" : ""} restant${ctx.sub.daysLeft > 1 ? "s" : ""}`
    : "Abonnement expiré";
}

function renderBanner() {
  const host = $("#banner");
  const s = ctx.sub;
  if (!s.active) {
    host.innerHTML = `
      <div class="banner is-error" role="alert">
        <div class="banner-text"><strong>Votre abonnement a expiré.</strong>
          Vos données sont conservées, mais vous ne pouvez plus enregistrer de ventes ni modifier le stock.</div>
        <a class="btn btn-primary btn-sm" href="${ui.esc(PAY_URL)}">Renouveler</a>
      </div>`;
  } else if (s.daysLeft <= 3) {
    host.innerHTML = `
      <div class="banner is-warning">
        <div class="banner-text">Votre accès se termine dans <strong>${s.daysLeft} jour${s.daysLeft > 1 ? "s" : ""}</strong>.</div>
        <a class="btn btn-primary btn-sm" href="${ui.esc(PAY_URL)}">S'abonner</a>
      </div>`;
  } else {
    host.innerHTML = "";
  }
}

/* ============================================================
   Produits : un seul listener pour toute l'application
   ============================================================ */
function startProducts() {
  if (unsubProducts) unsubProducts();
  unsubProducts = store.listenProducts(
    (list) => { updateBadge(); ctx.emit("products", list); },
    (err) => ui.toast(err.message, "error")
  );
}

function updateBadge() {
  const n = store.getLowStock().length;
  document.querySelectorAll('[data-badge="stock"]').forEach((b) => {
    b.hidden = n === 0;
    b.textContent = n > 99 ? "99+" : String(n);
  });
}

/* ============================================================
   Routeur (#/home, #/stock, #/ventes, #/finances, #/plus)
   ============================================================ */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [name, ...rest] = h.split("/");
  let param = rest.join("/") || null;
  if (param) { try { param = decodeURIComponent(param); } catch { param = null; } }
  return { name: name || "home", param };
}

function skeleton() {
  return `<div class="stack" aria-hidden="true">
    <div class="skeleton" style="height:28px;width:40%"></div>
    <div class="grid grid-4">${'<div class="skeleton" style="height:84px"></div>'.repeat(4)}</div>
    <div class="skeleton" style="height:220px"></div></div>`;
}

function errorState(title, text, withReload = false) {
  return `<div class="empty">
    ${ui.icon("alert", 44)}
    <div class="empty-title">${ui.esc(title)}</div>
    <p>${ui.esc(text)}</p>
    ${withReload ? '<button class="btn btn-primary" type="button" data-reload>Réessayer</button>' : ""}
  </div>`;
}

function updateFab() {
  const r = ROUTES[ctx.route.name];
  $("#fabSale").hidden = !(r && r.fab && ctx.canWrite);
}

function setActiveNav(name) {
  document.querySelectorAll("[data-route]").forEach((a) => {
    if (a.dataset.route === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

let firstRender = true;
async function navigate() {
  const { name, param } = parseHash();
  const def = ROUTES[name];
  if (!def) { location.replace("#/home"); return; }

  const token = ++renderToken;
  if (unmountView) { try { unmountView(); } catch (e) { console.error(e); } unmountView = null; }

  ctx.route = { name, param };
  setActiveNav(name);
  $("#pageTitle").textContent = def.title;
  document.title = `${def.title} — Kontra-Africa`;
  updateFab();

  const view = $("#view");
  view.innerHTML = skeleton();

  try {
    const mod = await def.load();
    if (token !== renderToken) return;            // l'utilisateur a déjà changé d'écran
    const wrap = document.createElement("div");
    wrap.className = "view";
    view.replaceChildren(wrap);
    const cleanup = await mod.mount(wrap, ctx);
    if (token !== renderToken) { if (typeof cleanup === "function") cleanup(); return; }
    unmountView = typeof cleanup === "function" ? cleanup : null;
  } catch (e) {
    if (token !== renderToken) return;
    console.error(`Écran « ${name} » :`, e);
    view.innerHTML = errorState("Cet écran n'a pas pu s'afficher",
      "Il n'est peut-être pas encore installé, ou la connexion a été interrompue.", true);
    view.querySelector("[data-reload]")?.addEventListener("click", navigate);
  }

  if (!firstRender) { window.scrollTo({ top: 0 }); $("#main").focus({ preventScroll: true }); }
  firstRender = false;
}

/* ============================================================
   Nouvelle vente (fenêtre chargée à la demande)
   ============================================================ */
async function openSale() {
  if (!ctx.canWrite) { ui.toast("Abonnement expiré : renouvelez pour enregistrer une vente.", "error"); return; }
  try {
    const m = await import("./views/sale-modal.js");
    m.openSaleModal(ctx);
  } catch (e) {
    console.error(e);
    ui.toast("La fenêtre de vente n'est pas disponible.", "error");
  }
}

/* ============================================================
   Coque (menu, installation, réseau)
   ============================================================ */
function bindShell() {
  window.addEventListener("hashchange", navigate);

  ui.delegate(document, { "new-sale": openSale });

  // Réactualise l'abonnement quand l'utilisateur revient (ex. après un paiement)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastSubCheck > SUB_RECHECK_MS) loadSub(true);
  });

  window.addEventListener("offline", () =>
    ui.toast("Hors ligne : vos saisies seront envoyées au retour du réseau.", "info", 4500));
  window.addEventListener("online", () => ui.toast("Connexion rétablie.", "success"));

  // Installation de la PWA
  let deferred = null;
  const btn = $("#btnInstall");
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; btn.hidden = false; });
  btn.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null; btn.hidden = true;
  });
  window.addEventListener("appinstalled", () => { btn.hidden = true; });
}
