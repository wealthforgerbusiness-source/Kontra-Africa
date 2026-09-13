import { auth, db } from "./firebase-config.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { requireAppAccess } from "./auth-guard.js";
import { getCurrencySymbol, formatAmount } from "./currency.js";
import {
  addPendingAction,
  getPendingActions,
  syncPendingActions,
} from "./offline-queue.js";
import { renderAppNav } from "./app-nav.js";

renderAppNav("stock"); // sidebar desktop + bottom nav mobile

const API_BASE = "/api/stock";
const FINANCES_PAGE_URL = "finances.html"; // ⚠️ à ajuster si le nom de route diffère

// ============================================================
// DOM refs
// ============================================================

const offlineBanner = document.getElementById("offline-banner");

// Onglets
const stockTabs = document.querySelectorAll(".stock-tab");
const stockPanels = document.querySelectorAll(".stock-panel[data-tab-panel]");

// Dashboard
const stockBalanceValue = document.getElementById("stock-balance-value");
const btnConvertBalance = document.getElementById("btn-convert-balance");
const dailyProfitValue = document.getElementById("daily-profit-value");
const btnConvertProfit = document.getElementById("btn-convert-profit");
const topProductName = document.getElementById("top-product-name");
const topProductQty = document.getElementById("top-product-qty");
const lowProductName = document.getElementById("low-product-name");
const lowProductQty = document.getElementById("low-product-qty");
const lowStockSection = document.getElementById("low-stock-section");
const lowStockBadges = document.getElementById("low-stock-badges");
const btnQuickAddStock = document.getElementById("btn-quick-add-stock");
const btnCloseDay = document.getElementById("btn-close-day");

// Produits
const btnAddProduct = document.getElementById("btn-add-product");
const productSearch = document.getElementById("product-search");
const productsList = document.getElementById("products-list");
const modalProduct = document.getElementById("modal-product");
const formProduct = document.getElementById("form-product");
const productPurchaseCurrency = document.getElementById("product-purchase-currency");
const productSellingCurrency = document.getElementById("product-selling-currency");

// Ventes
const saleProductSearch = document.getElementById("sale-product-search");
const saleProductOptions = document.getElementById("sale-product-options");
const saleQuantity = document.getElementById("sale-quantity");
const saleStockHint = document.getElementById("sale-stock-hint");
const saleFormError = document.getElementById("sale-form-error");
const saleSavedMsg = document.getElementById("sale-saved-msg");
const btnConfirmSale = document.getElementById("btn-confirm-sale");
const salesTodayList = document.getElementById("sales-today-list");
const dailySummary = document.getElementById("daily-summary");

// ============================================================
// State
// ============================================================

let currentUser = null;
let currentUserData = { currencySymbol: "", exchangeRate: 0, displayCurrency: "local", balance: 0 };
let products = new Map(); // id -> product
let salesToday = [];
let totalExpensesToday = 0; // vient de GET /reports/daily (pas d'UI de dépenses ici)

// Toggles indépendants des deux cartes du dashboard (🔄 USD)
let balanceViewCurrency = "local";
let profitViewCurrency = "local";

// ============================================================
// Toasts (remplace window.alert)
// ============================================================

let toastContainerEl = null;

function getToastContainer() {
  if (toastContainerEl) return toastContainerEl;
  toastContainerEl = document.createElement("div");
  toastContainerEl.className = "toast-container";
  toastContainerEl.setAttribute("aria-live", "polite");
  document.body.appendChild(toastContainerEl);
  return toastContainerEl;
}

/**
 * Affiche un toast.
 * @param {string} message
 * @param {{type?: 'info'|'success'|'error'|'warning', duration?: number, actionLabel?: string, onAction?: () => void}} [options]
 * @returns {() => void} fonction pour fermer le toast manuellement
 */
function showToast(message, options = {}) {
  const { type = "info", duration = 4000, actionLabel, onAction } = options;
  const container = getToastContainer();

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", "status");

  const text = document.createElement("span");
  text.className = "toast__text";
  text.textContent = message;
  toast.appendChild(text);

  let timeoutId = null;

  function removeToast() {
    if (timeoutId) clearTimeout(timeoutId);
    toast.classList.add("toast--closing");
    setTimeout(() => toast.remove(), 180);
  }

  if (actionLabel && onAction) {
    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "toast__action";
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener("click", () => {
      onAction();
      removeToast();
    });
    toast.appendChild(actionBtn);
  }

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "toast__close";
  closeBtn.setAttribute("aria-label", "Fermer");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", removeToast);
  toast.appendChild(closeBtn);

  container.appendChild(toast);

  if (duration > 0) {
    timeoutId = setTimeout(removeToast, duration);
  }

  return removeToast;
}

function showInfoToast(message, options) {
  return showToast(message, { ...options, type: "info" });
}

function showSuccessToast(message, options) {
  return showToast(message, { ...options, type: "success" });
}

function showErrorToast(message, options) {
  return showToast(message, { duration: 6000, ...options, type: "error" });
}

function showWarningToast(message, options) {
  return showToast(message, { duration: 6000, ...options, type: "warning" });
}

// Styles minimaux injectés une seule fois : aucun fichier CSS à toucher.
(function injectToastStyles() {
  if (document.getElementById("stock-toast-styles")) return;
  const style = document.createElement("style");
  style.id = "stock-toast-styles";
  style.textContent = `
    .toast-container {
      position: fixed;
      top: 16px;
      right: 16px;
      left: 16px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      max-width: 360px;
      padding: 12px 14px;
      border-radius: 10px;
      color: #fff;
      font-size: 14px;
      line-height: 1.4;
      box-shadow: 0 6px 16px rgba(0,0,0,0.18);
      animation: stock-toast-in 0.18s ease-out;
    }
    .toast--closing { animation: stock-toast-out 0.18s ease-in forwards; }
    .toast--info { background: #2563eb; }
    .toast--success { background: #16a34a; }
    .toast--error { background: #dc2626; }
    .toast--warning { background: #d97706; }
    .toast__text { flex: 1; }
    .toast__action {
      flex-shrink: 0;
      background: rgba(255,255,255,0.22);
      border: none;
      color: #fff;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .toast__action:hover { background: rgba(255,255,255,0.34); }
    .toast__close {
      flex-shrink: 0;
      background: transparent;
      border: none;
      color: #fff;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      padding: 0 2px;
      opacity: 0.85;
    }
    .toast__close:hover { opacity: 1; }
    @keyframes stock-toast-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes stock-toast-out {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(-6px); }
    }
  `;
  document.head.appendChild(style);
})();

// ============================================================
// Vérification "devise configurée"
// ============================================================

function isCurrencyConfigured() {
  return !!(currentUserData.currencySymbol && String(currentUserData.currencySymbol).trim());
}

function isExchangeRateConfigured() {
  return Number(currentUserData.exchangeRate) > 0;
}

function goToFinancesPage() {
  window.location.href = FINANCES_PAGE_URL;
}

/**
 * Bloque l'action et affiche un toast si la devise (et, si demandé, le taux
 * de change) n'est pas configurée. Retourne true si l'action peut continuer.
 * @param {{needsExchangeRate?: boolean}} [options]
 */
function requireCurrencyConfigured(options = {}) {
  const { needsExchangeRate = false } = options;

  if (!isCurrencyConfigured()) {
    showErrorToast(
      "Configure d'abord ta devise dans Finances avant de continuer.",
      { actionLabel: "Aller dans Finances", onAction: goToFinancesPage }
    );
    return false;
  }

  if (needsExchangeRate && !isExchangeRateConfigured()) {
    showErrorToast(
      "Configure d'abord le taux de change dans Finances pour convertir en USD.",
      { actionLabel: "Aller dans Finances", onAction: goToFinancesPage }
    );
    return false;
  }

  return true;
}

// ============================================================
// Auth + fetch helper (pattern à réconcilier avec finances.js)
// ============================================================

async function authFetch(path, options = {}) {
  const token = await auth.currentUser.getIdToken();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || `Erreur ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function isNetworkError(error) {
  // Un échec fetch (hors ligne, DNS, etc.) lève une erreur sans .status ;
  // une erreur HTTP renvoyée par authFetch a toujours .status défini.
  return error.status === undefined;
}

// ============================================================
// Utilisateur (devise, solde) — écoute temps réel du doc Firestore
// (dupliqué depuis finances.js, non exporté ailleurs)
// ============================================================

function listenToUserDoc(uid, onUpdate) {
  onSnapshot(doc(db, "users", uid), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    const userData = {
      balance: data.balance || 0,
      currencySymbol: data.currencySymbol || "",
      exchangeRate: data.exchangeRate || 0,
      exchangeRateUpdatedAt: data.exchangeRateUpdatedAt || null,
      displayCurrency: data.displayCurrency === "usd" ? "usd" : "local",
      savingsGoalAmount: data.savingsGoalAmount || 0,
      savingsCurrentAmount: data.savingsCurrentAmount || 0,
      timezone: data.timezone || "Africa/Kinshasa",
    };
    onUpdate(userData);
  });
}

// ============================================================
// Dates (fuseau horaire LOCAL du navigateur)
// ============================================================

function getTodayLocalISODate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSaleFromToday(saleDateValue) {
  const saleDate = new Date(saleDateValue);
  const year = saleDate.getFullYear();
  const month = String(saleDate.getMonth() + 1).padStart(2, "0");
  const day = String(saleDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}` === getTodayLocalISODate();
}

// ============================================================
// Utilitaire d'échappement HTML
// ============================================================

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ============================================================
// Onglets (Dashboard / Produits / Ventes)
// ============================================================

function switchTab(tabName) {
  stockTabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabName;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  stockPanels.forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== tabName;
  });
}

stockTabs.forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

// ============================================================
// Bandeau hors-ligne
// ============================================================

// ⚠️ CORRECTIF : l'ancienne version affichait "Hors ligne — synchronisation
// en attente (N)" dès qu'il y avait des actions en attente, SANS vérifier
// navigator.onLine — donc le bandeau disait "Hors ligne" même connecté à
// internet, tant que la queue n'était pas vide (ce qui arrivait tout le
// temps à cause du bug de synchro corrigé plus haut). Le message reflète
// maintenant le VRAI statut réseau, et signale séparément s'il reste des
// éléments en attente de synchro.
async function updateOnlineStatus() {
  const [pendingProducts, pendingSales, pendingExpenses] = await Promise.all([
    getPendingActions("product"),
    getPendingActions("sale"),
    getPendingActions("expense"),
  ]);
  const total = pendingProducts.length + pendingSales.length + pendingExpenses.length;

  if (!navigator.onLine) {
    offlineBanner.textContent =
      total > 0
        ? `Hors ligne — ${total} en attente de synchronisation dès le retour du réseau`
        : "Hors ligne";
    offlineBanner.hidden = false;
  } else if (total > 0) {
    offlineBanner.textContent = `En ligne — synchronisation en cours (${total} en attente)`;
    offlineBanner.hidden = false;
  } else {
    offlineBanner.textContent = "";
    offlineBanner.hidden = true;
  }
}

window.addEventListener("online", () => {
  updateOnlineStatus();
  if (currentUser) trySyncPending();
});
window.addEventListener("offline", updateOnlineStatus);

// Bandeau cliquable : permet de forcer une resynchro immédiate sans recharger
// la page si des éléments restent en attente alors qu'on est en ligne.
offlineBanner.style.cursor = "pointer";
offlineBanner.title = "Cliquer pour forcer une nouvelle tentative de synchronisation";
offlineBanner.addEventListener("click", () => {
  if (!navigator.onLine) {
    showWarningToast("Toujours hors ligne — la synchro reprendra automatiquement dès que le réseau reviendra.");
    return;
  }
  showInfoToast("Nouvelle tentative de synchronisation…");
  trySyncPending();
});

// ============================================================
// Synchro des actions en attente (produits -> ventes -> dépenses)
// ============================================================

// ⚠️ CORRECTIF : syncPendingActions() (offline-queue.js) appelle
// syncFn(entry.payload, entry) — le PREMIER argument est déjà le payload
// brut, pas l'objet wrapper {localId, type, payload, createdAtLocal}.
// (Vérifié dans js/finances.js qui l'utilise déjà correctement : la
// fonction de synchro y est `async (payload) => { ... payload.type ... }`,
// SANS `.payload`.)
// L'ancien code faisait `entry.payload` ici alors que `entry` ÉTAIT déjà
// le payload → `.payload` valait toujours undefined → JSON.stringify()
// renvoyait undefined → le fetch partait sans corps → 400 côté serveur →
// la vente restait coincée dans la queue IndexedDB pour toujours, sans
// jamais être écrite dans Firestore. C'est ce qui faisait "disparaître"
// les ventes notées pendant une coupure réseau, dès qu'on quittait puis
// revenait sur la page.
async function syncProductAction(payload) {
  if (payload._delete) {
    await authFetch(`/products/${payload.id}`, { method: "DELETE" });
  } else if (payload._update) {
    await authFetch(`/products/${payload.id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  } else {
    await authFetch("/products", { method: "POST", body: JSON.stringify(payload) });
  }
}

async function syncSaleAction(payload) {
  await authFetch("/sales", { method: "POST", body: JSON.stringify(payload) });
}

async function syncExpenseAction(payload) {
  // Pas d'UI de création de dépense sur cette page, mais on synchronise quand
  // même celles ajoutées ailleurs (ex. page Finances) via la même queue.
  await authFetch("/expenses", { method: "POST", body: JSON.stringify(payload) });
}

async function trySyncPending() {
  if (!navigator.onLine) return;

  try {
    await syncPendingActions("product", syncProductAction);
    await syncPendingActions("sale", syncSaleAction);
    await syncPendingActions("expense", syncExpenseAction);
  } catch (error) {
    console.error("Synchro interrompue, sera retentée au prochain retour en ligne :", error);
  } finally {
    await refreshAllData();
    await updateOnlineStatus();
  }
}

// ============================================================
// Chargement des données
// ============================================================

async function refreshAllData() {
  try {
    await Promise.all([loadProducts(), loadSalesToday(), loadDailyReport()]);
  } catch (error) {
    console.error("Erreur lors du chargement des données stock :", error);
  }
}

async function loadProducts() {
  const data = await authFetch("/products");
  products = new Map(data.products.map((p) => [p.id, p]));
  renderProducts();
}

async function loadSalesToday() {
  const data = await authFetch("/sales");
  salesToday = data.sales;
  renderSalesToday();
}

async function loadDailyReport() {
  const today = getTodayLocalISODate();
  try {
    const data = await authFetch(`/reports/daily?date=${today}`);
    totalExpensesToday = data.totalExpenses || 0;
  } catch (error) {
    console.error("Erreur lors du chargement du rapport du jour :", error);
    totalExpensesToday = 0;
  }
  renderDailyProfitCard();
}

// ============================================================
// Rendu — Dashboard (solde, bénéfice, top/low produit)
// ============================================================

function renderBalanceCard() {
  stockBalanceValue.textContent = formatAmount(currentUserData.balance || 0, currentUserData, balanceViewCurrency);
  btnConvertBalance.textContent =
    balanceViewCurrency === "local" ? "🔄 USD" : `🔄 ${getCurrencySymbol(currentUserData) || "Local"}`;
}

btnConvertBalance.addEventListener("click", () => {
  if (!requireCurrencyConfigured({ needsExchangeRate: true })) return;
  balanceViewCurrency = balanceViewCurrency === "local" ? "usd" : "local";
  renderBalanceCard();
});

function renderDailyProfitCard() {
  const salesProfit = salesToday.reduce((sum, s) => sum + (s.totalProfit || 0), 0);
  const netProfit = salesProfit - totalExpensesToday;

  dailyProfitValue.textContent = formatAmount(netProfit, currentUserData, profitViewCurrency);
  btnConvertProfit.textContent =
    profitViewCurrency === "local" ? "🔄 USD" : `🔄 ${getCurrencySymbol(currentUserData) || "Local"}`;
}

btnConvertProfit.addEventListener("click", () => {
  if (!requireCurrencyConfigured({ needsExchangeRate: true })) return;
  profitViewCurrency = profitViewCurrency === "local" ? "usd" : "local";
  renderDailyProfitCard();
});

function renderTopLowProducts() {
  if (salesToday.length === 0) {
    topProductName.textContent = "—";
    topProductQty.textContent = "";
    lowProductName.textContent = "—";
    lowProductQty.textContent = "";
    return;
  }

  const qtyByProduct = new Map();
  for (const sale of salesToday) {
    const entry = qtyByProduct.get(sale.productId) || { name: sale.productName, qty: 0 };
    entry.qty += sale.quantity;
    qtyByProduct.set(sale.productId, entry);
  }

  const entries = [...qtyByProduct.values()].sort((a, b) => b.qty - a.qty);
  const top = entries[0];
  const low = entries[entries.length - 1];

  topProductName.textContent = top.name;
  topProductQty.textContent = `${top.qty} vendu(s)`;
  lowProductName.textContent = low.name;
  lowProductQty.textContent = `${low.qty} vendu(s)`;
}

function renderLowStockSection() {
  const lowStockProducts = [...products.values()].filter(
    (p) => !p.archived && p.stockQuantity <= (p.lowStockThreshold ?? 5)
  );

  if (lowStockProducts.length === 0) {
    lowStockSection.hidden = true;
    return;
  }

  lowStockSection.hidden = false;
  lowStockBadges.innerHTML = "";
  for (const product of lowStockProducts) {
    const isOut = product.stockQuantity <= 0;
    const badge = document.createElement("span");
    badge.className = "low-stock-badge " + (isOut ? "low-stock-badge--error" : "low-stock-badge--warning");
    badge.innerHTML = `${escapeHtml(product.name)} — <span class="low-stock-badge__qty">${product.stockQuantity}</span>`;
    lowStockBadges.appendChild(badge);
  }
}

// ============================================================
// Modale "Ajouter du stock" (remplace les window.prompt())
// Construite dynamiquement, réutilise .modal / .modal-content
// pour hériter du style de la modale produit existante.
// ============================================================

let modalAddStock = null;

function ensureAddStockModal() {
  if (modalAddStock) return modalAddStock;

  const dialog = document.createElement("dialog");
  dialog.id = "modal-add-stock";
  dialog.className = "modal";
  dialog.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Ajouter du stock</h3>
        <button type="button" class="modal-close" data-action="close-add-stock-modal" aria-label="Fermer">×</button>
      </div>
      <form id="form-add-stock" novalidate>
        <div class="form-error" hidden></div>
        <div class="form-field">
          <label for="add-stock-product">Produit</label>
          <select id="add-stock-product" name="product" required></select>
        </div>
        <div class="form-field">
          <label for="add-stock-quantity">Quantité à ajouter</label>
          <input id="add-stock-quantity" name="quantity" type="number" min="1" step="1" required />
        </div>
        <div class="saved-msg" hidden>Stock mis à jour ✓</div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-action="close-add-stock-modal">Annuler</button>
          <button type="submit" class="btn btn-primary">Ajouter au stock</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(dialog);

  dialog.querySelectorAll('[data-action="close-add-stock-modal"]').forEach((btn) =>
    btn.addEventListener("click", () => closeModal(dialog))
  );
  dialog.addEventListener("click", (event) => {
    // Ferme si on clique sur le fond du <dialog> (hors .modal-content)
    if (event.target === dialog) closeModal(dialog);
  });

  const form = dialog.querySelector("#form-add-stock");
  const select = dialog.querySelector("#add-stock-product");
  const quantityInput = dialog.querySelector("#add-stock-quantity");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormError(form);

    const product = products.get(select.value);
    const quantity = Number(quantityInput.value);

    if (!product) {
      showFormError(form, "Sélectionne un produit.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      showFormError(form, "Quantité invalide.");
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      await handleUpdateProduct(product.id, {
        name: product.name,
        purchasePrice: product.purchasePrice,
        sellingPrice: product.sellingPrice,
        stockQuantity: product.stockQuantity + quantity,
        lowStockThreshold: product.lowStockThreshold,
        unit: product.unit,
      });
      showSavedMsg(form);
      closeModal(dialog);
      form.reset();
    } finally {
      submitBtn.disabled = false;
    }
  });

  modalAddStock = dialog;
  return dialog;
}

function openAddStockModal() {
  const activeProducts = [...products.values()].filter((p) => !p.archived);

  if (activeProducts.length === 0) {
    showWarningToast("Ajoute d'abord un produit avant de pouvoir réapprovisionner son stock.");
    return;
  }

  const dialog = ensureAddStockModal();
  const form = dialog.querySelector("#form-add-stock");
  const select = dialog.querySelector("#add-stock-product");
  const quantityInput = dialog.querySelector("#add-stock-quantity");

  form.reset();
  clearFormError(form);

  select.innerHTML = "";
  for (const product of activeProducts) {
    const option = document.createElement("option");
    option.value = product.id;
    option.textContent = `${product.name} (stock actuel : ${product.stockQuantity} ${product.unit || ""})`;
    select.appendChild(option);
  }
  quantityInput.value = "";

  openModal(dialog);
  select.focus();
}

btnQuickAddStock.addEventListener("click", openAddStockModal);

// ============================================================
// Clôture de journée (génère le PDF, puis vide les ventes du jour)
// ============================================================

btnCloseDay.addEventListener("click", async () => {
  if (
    !window.confirm(
      "Clôturer la journée ? Le PDF sera téléchargé puis les ventes du jour seront définitivement supprimées."
    )
  ) {
    return;
  }

  if (!navigator.onLine) {
    showErrorToast("La clôture de journée nécessite une connexion internet.");
    return;
  }

  const originalLabel = btnCloseDay.textContent;
  btnCloseDay.disabled = true;
  btnCloseDay.textContent = "Génération du rapport…";

  try {
    // /reports/close-day renvoie un PDF binaire, pas du JSON : on ne peut
    // pas réutiliser authFetch() ici (qui fait toujours response.json()).
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(`${API_BASE}/reports/close-day`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Erreur ${response.status}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rapport-${getTodayLocalISODate()}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    salesToday = [];
    renderSalesToday();
    showSuccessToast("Journée clôturée, rapport téléchargé.");
  } catch (error) {
    showErrorToast(error.message || "Erreur lors de la clôture de la journée.");
  } finally {
    btnCloseDay.disabled = false;
    btnCloseDay.textContent = originalLabel;
  }
});

// ============================================================
// Rendu — Produits
// ============================================================

function renderProducts() {
  const query = (productSearch.value || "").trim().toLowerCase();
  const filtered = [...products.values()].filter(
    (p) => !query || p.name.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    productsList.innerHTML = '<div class="state-message">Aucun produit trouvé.</div>';
  } else {
    productsList.innerHTML = "";
    for (const product of filtered) {
      productsList.appendChild(renderProductCard(product));
    }
  }

  renderLowStockSection();
  renderSaleProductOptions();
}

productSearch.addEventListener("input", renderProducts);

function renderProductCard(product) {
  const card = document.createElement("div");
  const threshold = product.lowStockThreshold ?? 5;
  const isOut = product.stockQuantity <= 0;
  const isLow = !isOut && product.stockQuantity <= threshold;

  card.className =
    "product-card" +
    (isOut ? " product-card--out-of-stock" : isLow ? " product-card--low-stock" : "");
  card.dataset.productId = product.id;

  card.innerHTML = `
    <div class="product-card__info">
      <span class="product-card__name">${escapeHtml(product.name)}</span>
      <span class="product-card__meta">
        Stock :
        <span class="product-card__stock ${isOut ? "product-card__stock--out" : isLow ? "product-card__stock--low" : ""}">${product.stockQuantity} ${escapeHtml(product.unit || "")}</span>
        · ${formatAmount(product.sellingPrice, currentUserData, currentUserData.displayCurrency)}
      </span>
      ${product.pendingSync ? '<span class="state-message">En attente de synchro</span>' : ""}
    </div>
    <div class="product-card__actions">
      <button class="btn btn-credit btn-sm" data-action="sell" ${isOut ? 'disabled title="Rupture de stock"' : ""}>Vendre</button>
      <button class="btn btn-secondary btn-sm" data-action="edit-product">Modifier</button>
    </div>
  `;

  const sellBtn = card.querySelector('[data-action="sell"]');
  if (!isOut) {
    sellBtn.addEventListener("click", () => {
      switchTab("ventes");
      saleProductSearch.value = product.name;
      updateSaleStockHint();
      saleQuantity.focus();
    });
  }

  card.querySelector('[data-action="edit-product"]').addEventListener("click", () => {
    openEditProductModal(product);
  });

  return card;
}

function findProductByName(name) {
  const normalized = (name || "").trim().toLowerCase();
  if (!normalized) return null;
  for (const product of products.values()) {
    if (product.name.toLowerCase() === normalized) return product;
  }
  return null;
}

function renderSaleProductOptions() {
  saleProductOptions.innerHTML = "";
  for (const product of products.values()) {
    if (product.archived) continue;
    const option = document.createElement("option");
    option.value = product.name;
    saleProductOptions.appendChild(option);
  }
}

// ============================================================
// Rendu — Ventes du jour
// ============================================================

function renderSalesToday() {
  if (salesToday.length === 0) {
    salesTodayList.innerHTML = '<div class="state-message">Aucune vente aujourd\'hui.</div>';
  } else {
    salesTodayList.innerHTML = "";
    for (const sale of salesToday) {
      salesTodayList.appendChild(renderSaleRow(sale));
    }
  }
  renderDailySummary();
  renderDailyProfitCard();
  renderTopLowProducts();
}

function renderSaleRow(sale) {
  const row = document.createElement("div");
  const isToday = isSaleFromToday(sale.saleDate);

  row.className = "sale-row" + (isToday ? "" : " sale-row--locked");
  row.dataset.saleId = sale.id;
  row.dataset.saleDate =
    typeof sale.saleDate === "string" ? sale.saleDate : new Date(sale.saleDate).toISOString();

  row.innerHTML = `
    <div class="sale-row__info">
      <span class="sale-row__product">${escapeHtml(sale.productName)} × ${sale.quantity}</span>
      <span class="sale-row__meta">
        ${formatAmount(sale.totalRevenue, currentUserData, currentUserData.displayCurrency)}
        · Bénéfice <span class="sale-row__profit">${formatAmount(sale.totalProfit, currentUserData, currentUserData.displayCurrency)}</span>
        ${sale.pendingSync ? ' · <span class="state-message">En attente de synchro</span>' : ""}
      </span>
    </div>
    <button class="btn btn-debit btn-sm" data-action="remove-sale" ${!isToday ? 'disabled title="Non modifiable après la journée"' : ""}>Retirer</button>
  `;

  if (isToday) {
    row.querySelector('[data-action="remove-sale"]').addEventListener("click", () => {
      handleRemoveSale(sale);
    });
  }

  return row;
}

function renderDailySummary() {
  const revenue = salesToday.reduce((sum, s) => sum + (s.totalRevenue || 0), 0);
  const profit = salesToday.reduce((sum, s) => sum + (s.totalProfit || 0), 0);

  dailySummary.innerHTML = `
    <div class="daily-summary__item">
      <span class="daily-summary__label">Chiffre d'affaires</span>
      <span class="daily-summary__value">${formatAmount(revenue, currentUserData, currentUserData.displayCurrency)}</span>
    </div>
    <div class="daily-summary__item">
      <span class="daily-summary__label">Bénéfice</span>
      <span class="daily-summary__value">${formatAmount(profit, currentUserData, currentUserData.displayCurrency)}</span>
    </div>
    <div class="daily-summary__item">
      <span class="daily-summary__label">Ventes</span>
      <span class="daily-summary__value">${salesToday.length}</span>
    </div>
  `;
}

// ============================================================
// Modal produit — ouverture / fermeture (dialog natif)
// ============================================================

function openModal(dialog) {
  dialog.showModal();
}

function closeModal(dialog) {
  dialog.close();
}

function showFormError(form, message) {
  const el = form.querySelector(".form-error");
  el.textContent = message;
  el.hidden = false;
}

function clearFormError(form) {
  const el = form.querySelector(".form-error");
  el.hidden = true;
  el.textContent = "";
}

function showSavedMsg(form) {
  const el = form.querySelector(".saved-msg");
  el.hidden = false;
  setTimeout(() => {
    el.hidden = true;
  }, 2000);
}

document.querySelectorAll('[data-action="close-product-modal"]').forEach((btn) =>
  btn.addEventListener("click", () => closeModal(modalProduct))
);

function setProductCurrencyLabels() {
  const symbol = getCurrencySymbol(currentUserData);
  productPurchaseCurrency.textContent = symbol;
  productSellingCurrency.textContent = symbol;
}

// ============================================================
// Formulaire produit (ajout + modification)
// ============================================================

btnAddProduct.addEventListener("click", () => {
  if (!requireCurrencyConfigured()) return;

  formProduct.reset();
  document.getElementById("product-id").value = "";
  document.getElementById("modal-product-title").textContent = "Ajouter un produit";
  setProductCurrencyLabels();
  clearFormError(formProduct);
  openModal(modalProduct);
});

function openEditProductModal(product) {
  if (!requireCurrencyConfigured()) return;

  document.getElementById("product-id").value = product.id;
  document.getElementById("product-name").value = product.name;
  document.getElementById("product-purchase-price").value = product.purchasePrice;
  document.getElementById("product-selling-price").value = product.sellingPrice;
  document.getElementById("product-stock-quantity").value = product.stockQuantity;
  document.getElementById("product-low-stock-threshold").value = product.lowStockThreshold ?? "";
  document.getElementById("product-unit").value = product.unit || "piece";
  document.getElementById("modal-product-title").textContent = "Modifier le produit";
  setProductCurrencyLabels();
  clearFormError(formProduct);
  openModal(modalProduct);
}

function finishProductForm() {
  showSavedMsg(formProduct);
  closeModal(modalProduct);
  formProduct.reset();
}

formProduct.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFormError(formProduct);

  const existingId = document.getElementById("product-id").value || null;
  const formData = new FormData(formProduct);

  const payload = {
    name: formData.get("name").trim(),
    purchasePrice: Number(formData.get("purchasePrice")),
    sellingPrice: Number(formData.get("sellingPrice")),
    stockQuantity: Number(formData.get("stockQuantity")),
    lowStockThreshold: formData.get("lowStockThreshold")
      ? Number(formData.get("lowStockThreshold"))
      : undefined,
    unit: formData.get("unit"),
  };

  if (
    !payload.name ||
    !Number.isFinite(payload.purchasePrice) ||
    payload.purchasePrice < 0 ||
    !Number.isFinite(payload.sellingPrice) ||
    payload.sellingPrice < 0 ||
    !Number.isInteger(payload.stockQuantity) ||
    payload.stockQuantity < 0
  ) {
    showFormError(formProduct, "Merci de renseigner des valeurs valides et positives.");
    return;
  }

  if (existingId) {
    await handleUpdateProduct(existingId, payload);
  } else {
    await handleCreateProduct(payload);
  }
});

async function handleCreateProduct(payload) {
  const localId = crypto.randomUUID();
  products.set(localId, { id: localId, ...payload, archived: false, pendingSync: !navigator.onLine });
  renderProducts();

  const queuedPayload = { ...payload, localId };

  if (!navigator.onLine) {
    await addPendingAction("product", queuedPayload);
    await updateOnlineStatus();
    finishProductForm();
    return;
  }

  try {
    const created = await authFetch("/products", { method: "POST", body: JSON.stringify(payload) });
    products.delete(localId);
    products.set(created.id, created);
    renderProducts();
    finishProductForm();
  } catch (error) {
    if (isNetworkError(error)) {
      await addPendingAction("product", queuedPayload);
      await updateOnlineStatus();
      finishProductForm();
    } else {
      products.delete(localId);
      renderProducts();
      showFormError(formProduct, error.message || "Erreur lors de la création du produit.");
    }
  }
}

async function handleUpdateProduct(id, payload) {
  const previous = products.get(id);
  products.set(id, { ...previous, ...payload, pendingSync: !navigator.onLine });
  renderProducts();

  const queuedPayload = { ...payload, id, _update: true, localId: crypto.randomUUID() };

  if (!navigator.onLine) {
    await addPendingAction("product", queuedPayload);
    await updateOnlineStatus();
    finishProductForm();
    return;
  }

  try {
    const updated = await authFetch(`/products/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    products.set(id, { ...updated, pendingSync: false });
    renderProducts();
    finishProductForm();
  } catch (error) {
    if (isNetworkError(error)) {
      await addPendingAction("product", queuedPayload);
      await updateOnlineStatus();
      finishProductForm();
    } else {
      products.set(id, previous);
      renderProducts();
      showFormError(formProduct, error.message || "Erreur lors de la modification du produit.");
    }
  }
}

// ============================================================
// Formulaire de vente (onglet Ventes — recherche + quantité)
// ============================================================

function clearSaleFormError() {
  saleFormError.hidden = true;
  saleFormError.textContent = "";
}

function showSaleFormError(message) {
  saleFormError.textContent = message;
  saleFormError.hidden = false;
}

function showSaleSavedMsg() {
  saleSavedMsg.hidden = false;
  setTimeout(() => {
    saleSavedMsg.hidden = true;
  }, 2000);
}

function updateSaleStockHint() {
  clearSaleFormError();
  const product = findProductByName(saleProductSearch.value);
  saleStockHint.textContent = product
    ? `Stock disponible : ${product.stockQuantity} ${product.unit || ""}`
    : "";
}

saleProductSearch.addEventListener("input", updateSaleStockHint);

btnConfirmSale.addEventListener("click", async () => {
  clearSaleFormError();

  if (!requireCurrencyConfigured()) return;

  const product = findProductByName(saleProductSearch.value);
  const quantity = Number(saleQuantity.value);

  if (!product) {
    showSaleFormError("Sélectionne un produit valide dans la liste.");
    return;
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    showSaleFormError("La quantité doit être un nombre entier positif.");
    return;
  }
  if (quantity > product.stockQuantity) {
    showSaleFormError("Quantité supérieure au stock disponible.");
    return;
  }

  const localId = crypto.randomUUID();
  const saleDate = new Date().toISOString();
  const payload = { productId: product.id, quantity, saleDate, localId };
  const newStock = product.stockQuantity - quantity;

  // Optimistic UI
  products.set(product.id, { ...product, stockQuantity: newStock });

  const optimisticSale = {
    id: localId,
    productId: product.id,
    productName: product.name,
    quantity,
    unitSellingPrice: product.sellingPrice,
    unitPurchasePrice: product.purchasePrice,
    totalRevenue: quantity * product.sellingPrice,
    totalProfit: quantity * (product.sellingPrice - product.purchasePrice),
    saleDate,
    pendingSync: !navigator.onLine,
  };
  salesToday.unshift(optimisticSale);

  renderProducts();
  renderSalesToday();

  // ⚠️ CORRECTIF : avant, resetForm() affichait TOUJOURS le même message
  // "Vente enregistrée ✓", que la vente ait vraiment été confirmée par le
  // serveur OU simplement mise en attente localement (hors ligne, ou après
  // un échec réseau furtif). Résultat : tu voyais "enregistrée" et tu avais
  // confiance, alors que la vente n'existait pas encore côté Firestore —
  // et si elle restait coincée (comme avec le bug de synchro corrigé plus
  // haut), elle "disparaissait" au rechargement sans que rien ne t'ait
  // prévenu. Le message distingue maintenant clairement les deux cas.
  const resetForm = ({ synced } = { synced: true }) => {
    saleProductSearch.value = "";
    saleQuantity.value = "";
    saleStockHint.textContent = "";
    showSaleSavedMsg();
    if (synced) {
      showSuccessToast("Vente enregistrée et confirmée sur le serveur ✓");
    } else {
      showWarningToast(
        "Vente enregistrée localement — pas encore confirmée par le serveur (réseau instable). Elle se synchronisera automatiquement.",
        { duration: 8000 }
      );
    }
  };

  if (!navigator.onLine) {
    await addPendingAction("sale", payload);
    await updateOnlineStatus();
    resetForm({ synced: false });
    return;
  }

  try {
    const created = await authFetch("/sales", { method: "POST", body: JSON.stringify(payload) });
    salesToday = salesToday.filter((s) => s.id !== localId);
    salesToday.unshift({ ...created, pendingSync: false });
    renderProducts();
    renderSalesToday();
    resetForm({ synced: true });
  } catch (error) {
    if (isNetworkError(error)) {
      await addPendingAction("sale", payload);
      await updateOnlineStatus();
      resetForm({ synced: false });
    } else {
      // Rollback (ex: stock désynchronisé entre appareils, refusé par le serveur)
      products.set(product.id, product);
      salesToday = salesToday.filter((s) => s.id !== localId);
      renderProducts();
      renderSalesToday();
      showSaleFormError(error.message || "Erreur lors de l'enregistrement de la vente.");
    }
  }
});

// ============================================================
// Retrait d'une vente
// ============================================================

async function handleRemoveSale(sale) {
  if (!isSaleFromToday(sale.saleDate)) return; // garde-fou, le bouton est déjà désactivé sinon

  if (!window.confirm("Retirer cette vente et réintégrer le stock ?")) return;

  const product = products.get(sale.productId);
  const previousStock = product ? product.stockQuantity : null;

  // Optimistic UI
  salesToday = salesToday.filter((s) => s.id !== sale.id);
  if (product) {
    products.set(sale.productId, { ...product, stockQuantity: product.stockQuantity + sale.quantity });
  }
  renderProducts();
  renderSalesToday();

  if (!navigator.onLine) {
    // La queue offline-queue.js ne gère que les créations (product/sale/expense),
    // pas de type "delete-sale" prévu : on bloque le retrait hors ligne plutôt
    // que de risquer un état incohérent au retour en ligne.
    salesToday.unshift(sale);
    if (product && previousStock !== null) products.set(sale.productId, { ...product, stockQuantity: previousStock });
    renderProducts();
    renderSalesToday();
    showErrorToast("Le retrait d'une vente nécessite une connexion internet.");
    return;
  }

  try {
    await authFetch(`/sales/${sale.id}`, { method: "DELETE" });
    showSuccessToast("Vente retirée, stock réintégré.");
  } catch (error) {
    // Rollback
    salesToday.unshift(sale);
    if (product && previousStock !== null) products.set(sale.productId, { ...product, stockQuantity: previousStock });
    renderProducts();
    renderSalesToday();
    showErrorToast(error.message || "Erreur lors du retrait de la vente.");
  }
}

// ============================================================
// Initialisation
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  await updateOnlineStatus();

  const access = await requireAppAccess();

  // requireAppAccess() résout `null` quand l'accès est refusé (paywall,
  // document Firestore absent, erreur fatale) : dans ces cas, elle a déjà
  // remplacé document.body par l'écran correspondant.
  if (!access) return;

  const { user, userData: initialUserData } = access;
  currentUser = user;
  if (initialUserData) currentUserData = initialUserData;

  listenToUserDoc(user.uid, (userData) => {
    currentUserData = userData;
    renderBalanceCard();
    renderDailyProfitCard();
    renderProducts();
    renderSalesToday();
  });

  await refreshAllData();
  renderBalanceCard();

  if (navigator.onLine) {
    trySyncPending();
  }
});
