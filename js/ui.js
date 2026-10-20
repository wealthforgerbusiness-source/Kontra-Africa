// js/ui.js — utilitaires d'interface partagés par app.js et tous les écrans.

/* ---------- Sécurité : TOUJOURS échapper le contenu venant des utilisateurs ---------- */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/* ---------- Icônes (sprite défini dans app.html) ---------- */
export const icon = (name, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/* ---------- Montants et dates ---------- */
const NO_DECIMALS = new Set(["CDF", "XOF", "XAF", "GNF", "RWF", "UGX", "BIF", "KMF", "DJF", "MGA", "TZS"]);
let currencyCode = "USD";
export function setCurrency(code) { currencyCode = String(code || "USD").toUpperCase(); }
export const getCurrency = () => currencyCode;

export function money(n, code = currencyCode) {
  const v = Number(n) || 0;
  const d = NO_DECIMALS.has(code) ? 0 : 2;
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: code, minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  } catch {
    return `${v.toLocaleString("fr-FR", { maximumFractionDigits: d })} ${code}`;
  }
}
export const num = (n, d = 0) => (Number(n) || 0).toLocaleString("fr-FR", { maximumFractionDigits: d });

export function fmtDate(ts, withTime = true) {
  const d = ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : ts ? new Date(ts) : null;
  if (!d || isNaN(d)) return "À l'instant";   // serverTimestamp pas encore confirmé
  return d.toLocaleString("fr-FR", withTime
    ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" });
}

/* ---------- Divers ---------- */
export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function setBusy(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle("is-loading", on);
  if (on) { btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>'; }
  else if (btn.dataset.label) { btn.innerHTML = btn.dataset.label; delete btn.dataset.label; }
}

// Délégation de clics : <button data-action="nom"> → handlers.nom(element, event)
export function delegate(root, handlers) {
  const fn = (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || !root.contains(el)) return;
    const h = handlers[el.dataset.action];
    if (h) { e.preventDefault(); h(el, e); }
  };
  root.addEventListener("click", fn);
  return () => root.removeEventListener("click", fn);
}

/* Hors ligne, Firestore met l'écriture en file d'attente mais la promesse ne se
   résout qu'au retour du réseau. On n'attend donc pas indéfiniment l'utilisateur. */
const QUEUED = Symbol("queued");
export async function writeOrQueue(promise, ms = 1800) {
  let timer;
  const timeout = new Promise((r) => { timer = setTimeout(() => r(QUEUED), ms); });
  const res = await Promise.race([promise, timeout]);
  clearTimeout(timer);
  if (res !== QUEUED) return res;
  if (navigator.onLine) return promise;      // en ligne mais lent : on attend
  promise.catch(() => {});                   // hors ligne : sera envoyé plus tard
  return { queued: true };
}

/* ---------- Notifications ---------- */
export function toast(message, type = "info", ms) {
  const host = document.getElementById("toastHost");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast${type === "success" ? " is-success" : type === "error" ? " is-error" : ""}`;
  el.textContent = message;                  // textContent : jamais d'HTML
  host.appendChild(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  const life = ms ?? (type === "error" ? 5000 : 3000);
  setTimeout(() => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 260);
  }, life);
}

/* ---------- Fenêtres modales ---------- */
const stack = [];
document.addEventListener("keydown", (e) => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === "Escape" && top.dismissible) { e.preventDefault(); top.close(); }
  if (e.key === "Tab") {                      // piège le focus dans la fenêtre
    const f = [...top.el.querySelectorAll('button:not([disabled]),input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])')];
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

/**
 * @param {{title:string, content?:string|Node, dismissible?:boolean, onClose?:Function,
 *          actions?:{label:string, variant?:string, closes?:boolean, onClick?:(api)=>any}[]}} opts
 * Une action dont onClick retourne false (ou lève une erreur) garde la fenêtre ouverte.
 */
export function openModal({ title, content = "", actions = [], dismissible = true, onClose }) {
  const root = document.getElementById("modalRoot");
  const prevFocus = document.activeElement;
  const id = "m" + Math.random().toString(36).slice(2, 8);
  const el = document.createElement("div");
  el.className = "modal-backdrop";
  el.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${id}">
      <div class="modal-head">
        <h2 class="modal-title" id="${id}">${esc(title)}</h2>
        <button class="btn btn-ghost btn-icon btn-sm" type="button" data-close aria-label="Fermer">${icon("close")}</button>
      </div>
      <div class="modal-body"></div>
      ${actions.length ? '<div class="modal-foot"></div>' : ""}
    </div>`;
  const body = el.querySelector(".modal-body");
  if (typeof content === "string") body.innerHTML = content; else body.appendChild(content);

  let closed = false;
  const api = { el, body };
  function close() {
    if (closed) return;
    closed = true;
    el.classList.remove("is-open");
    const i = stack.indexOf(entry); if (i > -1) stack.splice(i, 1);
    if (!stack.length) document.documentElement.classList.remove("modal-open");
    setTimeout(() => el.remove(), 320);
    if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
    if (onClose) onClose();
  }
  api.close = close;
  const entry = { el, close, dismissible };

  const foot = el.querySelector(".modal-foot");
  actions.forEach((a) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn btn-${a.variant || "secondary"}`;
    b.textContent = a.label;
    b.addEventListener("click", async () => {
      if (!a.onClick) { if (a.closes !== false) close(); return; }
      setBusy(b, true);
      try {
        const r = await a.onClick(api);
        if (r !== false && a.closes !== false) close();
      } catch (err) {
        toast(err?.message || "Une erreur est survenue.", "error");
      } finally { if (!closed) setBusy(b, false); }
    });
    foot.appendChild(b);
  });

  el.addEventListener("click", (e) => {
    if ((e.target === el && dismissible) || e.target.closest("[data-close]")) close();
  });

  root.appendChild(el);
  stack.push(entry);
  document.documentElement.classList.add("modal-open");
  requestAnimationFrame(() => {
    el.classList.add("is-open");
    const f = el.querySelector("input,select,textarea") || el.querySelector(".modal");
    if (f) { f.setAttribute?.("tabindex", f.tabIndex < 0 ? "-1" : f.getAttribute("tabindex")); f.focus({ preventScroll: true }); }
  });
  return api;
}

export function confirmDialog({ title = "Confirmer", message = "", confirmLabel = "Confirmer", danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openModal({
      title,
      content: `<p class="text-sm text-muted">${esc(message)}</p>`,
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        { label: "Annuler", variant: "secondary" },
        { label: confirmLabel, variant: danger ? "danger" : "primary", onClick: () => { answered = true; resolve(true); } }
      ]
    });
  });
}
