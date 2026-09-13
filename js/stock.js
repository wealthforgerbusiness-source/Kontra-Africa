// ============================================================
// js/stock.js
// Page Stock & Ventes — CRUD produits/ventes/dépenses,
// support hors-ligne via offline-queue.js.
//
// ⚠️ HYPOTHÈSES RESTANTES (hors périmètre de cette correction) :
// - Le pattern d'attache du token Bearer (authFetch ci-dessous) est
//   reconstitué en l'absence du code réel de finances.js/contracts.js.
//   Si un helper `apiFetch`/`authFetch` partagé existe déjà, remplace
//   authFetch par un import de ce module plutôt que de dupliquer la logique.
// - `syncPendingActions(type, syncFn)` est supposé retirer lui-même les
//   entrées de la queue au fur et à mesure de leur succès. Si ce n'est
//   pas le cas, il faut appeler removePendingAction(entry.localId)
//   explicitement dans chaque syncFn ci-dessous.
// ============================================================

import { auth, db } from "./firebase-config.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { requireAppAccess } from "./auth-guard.js";
import { getCurrencySymbol, formatAmount, convertFromLocal } from "./currency.js";
import {
  addPendingAction,
  getPendingActions,
  syncPendingActions,
} from "./offline-queue.js";
import { renderAppNav } from "./app-nav.js";

renderAppNav("stock"); // sidebar desktop + bottom nav mobile

const API_BASE = "/api/stock";

// ============================================================
// DOM refs
// ============================================================

const offlineBanner = document.getElementById("offline-banner");
const lowStockSection = document.getElementById("low-stock-section");
const lowStockBadges = document.getElementById("low-stock-badges");
const dailyProfitCurrency = document.getElementById("daily-profit-currency");
const dailyProfitValue = document.getElementById("daily-profit-value");
const productsList = document.getElementById("products-list");
const salesTodayList = document.getElementById("sales-today-list");
const dailySummary = document.getElementById("daily-summary");
const expensesTodayList = document.getElementById("expenses-today-list");

const btnAddProduct = document.getElementById("btn-add-product");
const btnAddExpense = document.getElementById("btn-add-expense");

const modalProduct = document.getElementById("modal-product");
const formProduct = document.getElementById("form-product");
const modalSell = document.getElementById("modal-sell");
const formSell = document.getElementById("form-sell");
const modalExpense = document.getElementById("modal-expense");
const formExpense = document.getElementById("form-expense");

// ============================================================
// State
// ============================================================

let currentUser = null;
let currentUserData = { currencySymbol: "", exchangeRate: 0, displayCurrency: "local" };
let products = new Map(); // id -> product
let salesToday = [];
let expensesToday = [];

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
// Dates (fuseau horaire LOCAL du navigateur, cf. exigence client)
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
// Bandeau hors-ligne (pattern finances.js + compteur ajouté)
// ============================================================

async function updateOnlineStatus() {
  const [pendingProducts, pendingSales, pendingExpenses] = await Promise.all([
    getPendingActions("product"),
    getPendingActions("sale"),
    getPendingActions("expense"),
  ]);
  const total = pendingProducts.length + pendingSales.length + pendingExpenses.length;

  if (total > 0) {
    offlineBanner.textContent = `Hors ligne — synchronisation en attente (${total})`;
    // Le bandeau reste visible tant qu'il reste des actions non synchronisées,
    // même si le navigateur se croit revenu en ligne (ex: sync interrompue).
    offlineBanner.hidden = false;
  } else {
    offlineBanner.textContent = "";
    offlineBanner.hidden = navigator.onLine;
  }
}

window.addEventListener("online", () => {
  updateOnlineStatus();
  if (currentUser) trySyncPending(currentUser.uid);
});
window.addEventListener("offline", updateOnlineStatus);

// ============================================================
// Synchro des actions en attente (produits -> ventes -> dépenses)
// ============================================================

async function syncProductAction(entry) {
  const { payload } = entry;
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

async function syncSaleAction(entry) {
  await authFetch("/sales", { method: "POST", body: JSON.stringify(entry.payload) });
}

async function syncExpenseAction(entry) {
  await authFetch("/expenses", { method: "POST", body: JSON.stringify(entry.payload) });
}

async function trySyncPending() {
  if (!navigator.onLine) return;

  try {
    // Ordre imposé : les ventes dépendent des produits déjà synchronisés.
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
    await Promise.all([loadProducts(), loadSalesToday(), loadExpensesToday()]);
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
  // Pas de paramètre date : le backend calcule le jour par défaut dans le
  // fuseau horaire de l'utilisateur (users/{uid}.timezone), cohérent avec
  // DELETE /sales/:id et GET /reports/daily. Le résumé renvoyé par cette
  // route (summary) n'est pas consommé tel quel ici : renderDailySummary
  // recalcule à partir de `salesToday` pour rester exact même après une
  // vente ajoutée en local de façon optimiste (hors ligne notamment).
  const data = await authFetch("/sales");
  salesToday = data.sales;
  renderSalesToday();
}

async function loadExpensesToday() {
  const today = getTodayLocalISODate();
  const data = await authFetch(`/expenses?from=${today}&to=${today}`);
  expensesToday = data.expenses;
  renderExpensesToday();
}

// ============================================================
// Rendu — Produits
// ============================================================

function renderProducts() {
  if (products.size === 0) {
    productsList.innerHTML = '<div class="state-message">Aucun produit pour le moment.</div>';
  } else {
    productsList.innerHTML = "";
    for (const product of products.values()) {
      productsList.appendChild(renderProductCard(product));
    }
  }
  renderLowStockSection();
}

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
  if (!isOut) sellBtn.addEventListener("click", () => openSellModal(product));

  card.querySelector('[data-action="edit-product"]').addEventListener("click", () => {
    openEditProductModal(product);
  });

  return card;
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

function renderDailyProfitCard() {
  const salesProfit = salesToday.reduce((sum, s) => sum + (s.totalProfit || 0), 0);
  const expensesTotal = expensesToday.reduce((sum, e) => sum + (e.amount || 0), 0);
  const netProfit = salesProfit - expensesTotal;

  // dailyProfitCurrency et dailyProfitValue sont deux <span> distincts dans le
  // DOM (symbole / valeur) : on ne peut pas y injecter directement la chaîne
  // déjà formatée par formatAmount() (qui inclut le symbole), donc on
  // recompose manuellement la même conversion pour garder les deux champs.
  const viewCurrency = currentUserData.displayCurrency;
  const displayedProfit = convertFromLocal(netProfit, viewCurrency, currentUserData);

  dailyProfitCurrency.textContent = viewCurrency === "usd" ? "$" : getCurrencySymbol(currentUserData);
  dailyProfitValue.textContent = Number(displayedProfit || 0).toLocaleString("fr-FR", {
    maximumFractionDigits: 2,
  });
}

// ============================================================
// Rendu — Dépenses
// ============================================================

function renderExpensesToday() {
  if (expensesToday.length === 0) {
    expensesTodayList.innerHTML = '<div class="state-message">Aucune dépense aujourd\'hui.</div>';
  } else {
    expensesTodayList.innerHTML = "";
    for (const expense of expensesToday) {
      expensesTodayList.appendChild(renderExpenseRow(expense));
    }
  }
  renderDailyProfitCard();
}

function renderExpenseRow(expense) {
  const row = document.createElement("div");
  row.className = "expense-row";
  row.dataset.expenseId = expense.id;

  row.innerHTML = `
    <div>
      <div class="expense-row__label">${escapeHtml(expense.label)}</div>
      <div class="expense-row__category">${escapeHtml(expense.category || "")}${expense.pendingSync ? " · En attente de synchro" : ""}</div>
    </div>
    <span class="expense-row__amount">-${formatAmount(expense.amount, currentUserData, currentUserData.displayCurrency)}</span>
  `;

  return row;
}

// ============================================================
// Modals — ouverture / fermeture (dialog natif)
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
document.querySelectorAll('[data-action="close-sell-modal"]').forEach((btn) =>
  btn.addEventListener("click", () => closeModal(modalSell))
);
document.querySelectorAll('[data-action="close-expense-modal"]').forEach((btn) =>
  btn.addEventListener("click", () => closeModal(modalExpense))
);

// ============================================================
// Formulaire produit (ajout + modification)
// ============================================================

btnAddProduct.addEventListener("click", () => {
  formProduct.reset();
  document.getElementById("product-id").value = "";
  document.getElementById("modal-product-title").textContent = "Ajouter un produit";
  clearFormError(formProduct);
  openModal(modalProduct);
});

function openEditProductModal(product) {
  document.getElementById("product-id").value = product.id;
  document.getElementById("product-name").value = product.name;
  document.getElementById("product-purchase-price").value = product.purchasePrice;
  document.getElementById("product-selling-price").value = product.sellingPrice;
  document.getElementById("product-stock-quantity").value = product.stockQuantity;
  document.getElementById("product-low-stock-threshold").value = product.lowStockThreshold ?? "";
  document.getElementById("product-unit").value = product.unit || "piece";
  document.getElementById("modal-product-title").textContent = "Modifier le produit";
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
// Formulaire vente rapide
// ============================================================

function openSellModal(product) {
  formSell.reset();
  document.getElementById("sell-product-id").value = product.id;
  document.getElementById("modal-sell-product-name").textContent = product.name;
  document.getElementById("sell-stock-hint").textContent =
    `Stock disponible : ${product.stockQuantity} ${product.unit || ""}`;
  clearFormError(formSell);
  openModal(modalSell);
}

formSell.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFormError(formSell);

  const productId = document.getElementById("sell-product-id").value;
  const quantity = Number(document.getElementById("sell-quantity").value);
  const product = products.get(productId);

  if (!product) {
    showFormError(formSell, "Produit introuvable.");
    return;
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    showFormError(formSell, "La quantité doit être un nombre entier positif.");
    return;
  }
  if (quantity > product.stockQuantity) {
    showFormError(formSell, "Quantité supérieure au stock disponible.");
    return;
  }

  const localId = crypto.randomUUID();
  const saleDate = new Date().toISOString();
  const payload = { productId, quantity, saleDate, localId };
  const newStock = product.stockQuantity - quantity;

  // Optimistic UI : décrémente le stock local, ajoute la vente à la liste du jour
  products.set(productId, { ...product, stockQuantity: newStock });

  const optimisticSale = {
    id: localId,
    productId,
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

  if (!navigator.onLine) {
    await addPendingAction("sale", payload);
    await updateOnlineStatus();
    showSavedMsg(formSell);
    closeModal(modalSell);
    return;
  }

  try {
    const created = await authFetch("/sales", { method: "POST", body: JSON.stringify(payload) });
    salesToday = salesToday.filter((s) => s.id !== localId);
    salesToday.unshift({ ...created, pendingSync: false });
    renderProducts();
    renderSalesToday();
    showSavedMsg(formSell);
    closeModal(modalSell);
  } catch (error) {
    if (isNetworkError(error)) {
      await addPendingAction("sale", payload);
      await updateOnlineStatus();
      showSavedMsg(formSell);
      closeModal(modalSell);
    } else {
      // Rollback (ex: stock désynchronisé entre appareils, refusé par le serveur)
      products.set(productId, product);
      salesToday = salesToday.filter((s) => s.id !== localId);
      renderProducts();
      renderSalesToday();
      showFormError(formSell, error.message || "Erreur lors de l'enregistrement de la vente.");
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
    window.alert("Le retrait d'une vente nécessite une connexion internet.");
    return;
  }

  try {
    await authFetch(`/sales/${sale.id}`, { method: "DELETE" });
  } catch (error) {
    // Rollback
    salesToday.unshift(sale);
    if (product && previousStock !== null) products.set(sale.productId, { ...product, stockQuantity: previousStock });
    renderProducts();
    renderSalesToday();
    window.alert(error.message || "Erreur lors du retrait de la vente.");
  }
}

// ============================================================
// Formulaire dépense
// ============================================================

btnAddExpense.addEventListener("click", () => {
  formExpense.reset();
  clearFormError(formExpense);
  openModal(modalExpense);
});

formExpense.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFormError(formExpense);

  const label = document.getElementById("expense-label").value.trim();
  const amount = Number(document.getElementById("expense-amount").value);
  const category = document.getElementById("expense-category").value.trim();

  if (!label || !Number.isFinite(amount) || amount < 0) {
    showFormError(formExpense, "Merci de renseigner un libellé et un montant positif.");
    return;
  }

  const localId = crypto.randomUUID();
  const expenseDate = new Date().toISOString();
  const payload = { label, amount, category, expenseDate, localId };

  expensesToday.unshift({ id: localId, label, amount, category, expenseDate, pendingSync: !navigator.onLine });
  renderExpensesToday();

  const finish = () => {
    showSavedMsg(formExpense);
    closeModal(modalExpense);
    formExpense.reset();
  };

  if (!navigator.onLine) {
    await addPendingAction("expense", payload);
    await updateOnlineStatus();
    finish();
    return;
  }

  try {
    const created = await authFetch("/expenses", { method: "POST", body: JSON.stringify(payload) });
    expensesToday = expensesToday.filter((e) => e.id !== localId);
    expensesToday.unshift({ ...created, pendingSync: false });
    renderExpensesToday();
    finish();
  } catch (error) {
    if (isNetworkError(error)) {
      await addPendingAction("expense", payload);
      await updateOnlineStatus();
      finish();
    } else {
      expensesToday = expensesToday.filter((e) => e.id !== localId);
      renderExpensesToday();
      showFormError(formExpense, error.message || "Erreur lors de l'ajout de la dépense.");
    }
  }
});

// ============================================================
// Initialisation
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  // Affiche immédiatement le compteur si des actions étaient en attente
  // d'une session précédente, avant même que l'auth soit résolue.
  await updateOnlineStatus();

  const access = await requireAppAccess();

  // requireAppAccess() résout `null` quand l'accès est refusé (paywall,
  // document Firestore absent, erreur fatale) : dans ces cas, elle a déjà
  // remplacé document.body par l'écran correspondant. On arrête ici pour
  // ne pas continuer à manipuler des éléments qui n'existent plus.
  if (!access) return;

  const { user, userData: initialUserData } = access;
  currentUser = user;
  if (initialUserData) currentUserData = initialUserData;

  listenToUserDoc(user.uid, (userData) => {
    currentUserData = userData;
    renderDailyProfitCard();
    renderProducts();
    renderSalesToday();
    renderExpensesToday();
  });

  await refreshAllData();

  if (navigator.onLine) {
    trySyncPending(user.uid);
  }
});
