import { db, auth } from "./firebase.js";
import {
  collection, doc, query, where, orderBy, limit, startAfter, documentId,
  getDoc, getDocs, onSnapshot, setDoc, updateDoc, writeBatch,
  increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/* ============================================================
   Utilitaires
   ============================================================ */
const LIMITS = { products: 500, sales: 50, customers: 200, tx: 50, stats: 40 };
const MAX_MONEY = 1e12;

export class StoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function uid() {
  const u = auth.currentUser;
  if (!u) throw new StoreError("auth", "Veuillez vous reconnecter.");
  return u.uid;
}
const col = (name) => collection(db, "users", uid(), name);
const ref = (name, id) => doc(db, "users", uid(), name, id);
const userRef = () => doc(db, "users", uid());

const pad = (n) => String(n).padStart(2, "0");
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localMonth = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

function money(v, field = "Montant") {
  const n = Math.round(Number(v) * 100) / 100;
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) throw new StoreError("invalid", `${field} invalide.`);
  return n;
}
function quantity(v, field = "Quantité") {
  const n = Math.round(Number(v) * 1000) / 1000;
  if (!Number.isFinite(n) || n <= 0 || n > 1e8) throw new StoreError("invalid", `${field} invalide.`);
  return n;
}
function text(v, max, field, required = true) {
  const s = String(v ?? "").trim().slice(0, max);
  if (required && !s) throw new StoreError("invalid", `${field} obligatoire.`);
  return s;
}
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));

function friendly(e) {
  if (e instanceof StoreError) return e;
  const c = e?.code || "";
  if (c.includes("permission-denied"))
    return new StoreError("denied", "Action refusée. Votre abonnement a peut-être expiré.");
  if (c.includes("unavailable") || c.includes("network"))
    return new StoreError("offline", "Pas de connexion. Réessayez dans un instant.");
  if (c.includes("not-found")) return new StoreError("not-found", "Élément introuvable.");
  return new StoreError("unknown", "Une erreur est survenue. Réessayez.");
}
async function run(fn) { try { return await fn(); } catch (e) { throw friendly(e); } }

/* ============================================================
   Abonnement (lecture du claim, gratuit : aucune lecture Firestore)
   ============================================================ */
export async function getSubscriptionStatus(forceRefresh = false) {
  const u = auth.currentUser;
  if (!u) return { active: false, until: 0, daysLeft: 0 };
  const t = await u.getIdTokenResult(forceRefresh);
  const until = Number(t.claims.subUntil) || 0;
  const ms = until - Date.now();
  return { active: ms > 0, until, daysLeft: ms > 0 ? Math.ceil(ms / 86400000) : 0, isAdmin: t.claims.admin === true };
}
async function requireActive() {
  const s = await getSubscriptionStatus();
  if (!s.active) throw new StoreError("sub", "Votre abonnement a expiré. Renouvelez pour continuer à enregistrer.");
}

/* ============================================================
   Profil
   ============================================================ */
const PROFILE_DEFAULTS = { businessName: "Mon commerce", currency: "USD", rate: 1 };

export const getProfile = () => run(async () => {
  const s = await getDoc(userRef());
  return s.exists() ? s.data() : null;
});

export const ensureProfile = (country = "") => run(async () => {
  const s = await getDoc(userRef());
  if (s.exists()) return s.data();
  const data = clean({ ...PROFILE_DEFAULTS, country: country.slice(0, 40) });
  await setDoc(userRef(), data);
  return data;
});

export const saveProfile = (p) => run(async () => {
  await requireActive();
  const d = {};
  if (p.businessName !== undefined) d.businessName = text(p.businessName, 80, "Nom du commerce");
  if (p.country !== undefined) d.country = text(p.country, 40, "Pays", false);
  if (p.currency !== undefined) d.currency = text(p.currency, 8, "Devise");
  if (p.rate !== undefined) d.rate = money(p.rate, "Taux");
  if (p.savingsGoal !== undefined) d.savingsGoal = money(p.savingsGoal, "Objectif");
  if (p.phone !== undefined) d.phone = text(p.phone, 24, "Téléphone", false);
  if (p.address !== undefined) d.address = text(p.address, 160, "Adresse", false);
  await setDoc(userRef(), clean(d), { merge: true });
});

/* ============================================================
   Produits : 1 listener, cache mémoire, 0 lecture inutile
   ============================================================ */
const productCache = new Map();
let productsUnsub = null;

export function listenProducts(onChange, onError) {
  if (productsUnsub) productsUnsub();
  const q = query(col("products"), where("archived", "==", false), limit(LIMITS.products));
  productsUnsub = onSnapshot(q, { includeMetadataChanges: false }, (snap) => {
    snap.docChanges().forEach((c) => {
      if (c.type === "removed") productCache.delete(c.doc.id);
      else productCache.set(c.doc.id, { id: c.doc.id, ...c.doc.data() });
    });
    onChange(getProducts());
  }, (e) => onError && onError(friendly(e)));
  return () => { if (productsUnsub) productsUnsub(); productsUnsub = null; productCache.clear(); };
}
export const getProducts = () => [...productCache.values()].sort((a, b) => a.name.localeCompare(b.name));
export const getProduct = (id) => productCache.get(id) || null;
export const getLowStock = () => getProducts().filter((p) => p.isLow);
export function searchProducts(term) {
  const t = String(term || "").trim().toLowerCase();
  if (!t) return getProducts();
  return getProducts().filter((p) => p.name.toLowerCase().includes(t) || (p.sku || "").toLowerCase().includes(t));
}

const isLowStock = (qty, alertAt) => qty <= alertAt;

export const addProduct = (p) => run(async () => {
  await requireActive();
  const qty = Math.max(0, Math.round(Number(p.qty || 0) * 1000) / 1000);
  const alertAt = Math.max(0, Number(p.alertAt ?? 5));
  const data = clean({
    name: text(p.name, 80, "Nom du produit"),
    sku: text(p.sku, 40, "Référence", false),
    buyPrice: money(p.buyPrice, "Prix d'achat"),
    sellPrice: money(p.sellPrice, "Prix de vente"),
    qty, alertAt,
    isLow: isLowStock(qty, alertAt),
    soldQty: 0, archived: false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  const r = doc(col("products"));
  await setDoc(r, data);
  return r.id;
});

export const updateProduct = (id, patch) => run(async () => {
  await requireActive();
  const cur = getProduct(id);
  const d = {};
  if (patch.name !== undefined) d.name = text(patch.name, 80, "Nom du produit");
  if (patch.sku) d.sku = text(patch.sku, 40, "Référence", false);
  if (patch.buyPrice !== undefined) d.buyPrice = money(patch.buyPrice, "Prix d'achat");
  if (patch.sellPrice !== undefined) d.sellPrice = money(patch.sellPrice, "Prix de vente");
  if (patch.qty !== undefined) d.qty = Math.max(0, Math.round(Number(patch.qty) * 1000) / 1000);
  if (patch.alertAt !== undefined) d.alertAt = Math.max(0, Number(patch.alertAt));
  const qty = d.qty ?? cur?.qty ?? 0;
  const alertAt = d.alertAt ?? cur?.alertAt ?? 0;
  d.isLow = isLowStock(qty, alertAt);
  d.updatedAt = serverTimestamp();
  await updateDoc(ref("products", id), d);
});

// Réapprovisionnement : +delta sans écraser les ventes faites sur un autre appareil
export const restock = (id, delta) => run(async () => {
  await requireActive();
  const n = quantity(delta, "Quantité ajoutée");
  const p = getProduct(id);
  if (!p) throw new StoreError("not-found", "Produit introuvable.");
  await updateDoc(ref("products", id), {
    qty: increment(n),
    isLow: isLowStock(p.qty + n, p.alertAt),
    updatedAt: serverTimestamp()
  });
});

// On archive au lieu de supprimer : l'historique des ventes reste cohérent
export const archiveProduct = (id) => run(async () => {
  await requireActive();
  await updateDoc(ref("products", id), { archived: true, updatedAt: serverTimestamp() });
});

/* ============================================================
   Ventes : 1 batch atomique = vente + stock + clients + totaux
   ============================================================ */
function invoiceNumber() {
  const d = new Date();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `F${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${r}`;
}

function statsOps(batch, day, month, delta) {
  [day, month].forEach((id) => {
    const d = {};
    for (const [k, v] of Object.entries(delta)) d[k] = increment(v);
    batch.set(ref("stats", id), d, { merge: true });
  });
}

/**
 * @param {{items:{pid:string,qty:number}[], status?:'paid'|'credit', paid?:number,
 *          customer?:{id?:string,name?:string,phone?:string}, note?:string}} input
 * @returns {Promise<{id:string, invoiceNo:string, total:number, profit:number}>}
 */
export const recordSale = (input) => run(async () => {
  await requireActive();
  if (!Array.isArray(input.items) || !input.items.length) throw new StoreError("invalid", "Ajoutez au moins un produit.");

  // regrouper les lignes d'un même produit
  const agg = new Map();
  for (const it of input.items) agg.set(it.pid, (agg.get(it.pid) || 0) + quantity(it.qty));
  if (agg.size > 60) throw new StoreError("invalid", "Maximum 60 produits par vente.");

  const items = [];
  let total = 0, profit = 0;
  for (const [pid, qty] of agg) {
    const p = getProduct(pid);
    if (!p) throw new StoreError("not-found", "Un produit n'existe plus.");
    if (qty > p.qty) throw new StoreError("stock", `Stock insuffisant : ${p.name} (reste ${p.qty}).`);
    items.push({ pid, name: p.name, qty, price: p.sellPrice, cost: p.buyPrice });
    total += p.sellPrice * qty;
    profit += (p.sellPrice - p.buyPrice) * qty;
  }
  total = money(total); profit = Math.round(profit * 100) / 100;

  const status = input.status === "credit" ? "credit" : "paid";
  const paid = status === "paid" ? total : Math.min(money(input.paid ?? 0, "Acompte"), total);
  const owed = Math.round((total - paid) * 100) / 100;
  if (status === "credit" && owed <= 0) throw new StoreError("invalid", "Le montant à crédit est nul.");
  const c = input.customer || {};
  if (status === "credit" && !c.id && !c.name) throw new StoreError("invalid", "Indiquez le client pour une vente à crédit.");

  const now = new Date();
  const day = localDay(now), month = localMonth(now);
  const batch = writeBatch(db);
  const saleRef = doc(col("sales"));
  const invoiceNo = invoiceNumber();

  // client (dette)
  let customerId = c.id;
  if (status === "credit") {
    if (c.id) {
      batch.update(ref("customers", c.id), { debt: increment(owed), updatedAt: serverTimestamp() });
    } else {
      const cr = doc(col("customers"));
      customerId = cr.id;
      batch.set(cr, clean({ name: text(c.name, 80, "Client"), phone: text(c.phone, 24, "Téléphone", false), debt: owed, updatedAt: serverTimestamp() }));
    }
  }

  batch.set(saleRef, clean({
    items, total, profit, paid, status,
    customerId,
    customerName: text(c.name, 80, "Client", false),
    customerPhone: text(c.phone, 24, "Téléphone", false),
    note: text(input.note, 300, "Note", false),
    invoiceNo, day, month,
    createdAt: serverTimestamp()
  }));

  // stock
  for (const it of items) {
    const p = getProduct(it.pid);
    batch.update(ref("products", it.pid), {
      qty: increment(-it.qty),
      soldQty: increment(it.qty),
      isLow: isLowStock(p.qty - it.qty, p.alertAt),
      updatedAt: serverTimestamp()
    });
  }

  statsOps(batch, day, month, { revenue: total, profit, salesCount: 1 });
  await batch.commit();
  return { id: saleRef.id, invoiceNo, total, profit };
});

// Encaisser une dette (totalement ou en partie)
export const collectPayment = (sale, amount) => run(async () => {
  await requireActive();
  if (sale.status !== "credit") throw new StoreError("invalid", "Cette vente n'est pas à crédit.");
  const remaining = Math.round((sale.total - sale.paid) * 100) / 100;
  const pay = Math.min(money(amount), remaining);
  if (pay <= 0) throw new StoreError("invalid", "Montant invalide.");
  const newPaid = Math.round((sale.paid + pay) * 100) / 100;
  const done = newPaid >= sale.total;
  const batch = writeBatch(db);
  batch.update(ref("sales", sale.id), { paid: newPaid, status: done ? "paid" : "credit", updatedAt: serverTimestamp() });
  if (sale.customerId) batch.update(ref("customers", sale.customerId), { debt: increment(-pay), updatedAt: serverTimestamp() });
  await batch.commit();
  return { paid: newPaid, status: done ? "paid" : "credit" };
});

// Annuler une vente : stock rendu, totaux et dette corrigés
export const cancelSale = (sale) => run(async () => {
  await requireActive();
  if (sale.status === "cancelled") throw new StoreError("invalid", "Vente déjà annulée.");
  const batch = writeBatch(db);
  batch.update(ref("sales", sale.id), { status: "cancelled", updatedAt: serverTimestamp() });
  for (const it of sale.items) {
    const p = getProduct(it.pid);
    if (!p) continue; // produit archivé : on ne le touche pas
    batch.update(ref("products", it.pid), {
      qty: increment(it.qty), soldQty: increment(-it.qty),
      isLow: isLowStock(p.qty + it.qty, p.alertAt), updatedAt: serverTimestamp()
    });
  }
  if (sale.status === "credit" && sale.customerId) {
    const outstanding = Math.round((sale.total - sale.paid) * 100) / 100;
    if (outstanding > 0) batch.update(ref("customers", sale.customerId), { debt: increment(-outstanding), updatedAt: serverTimestamp() });
  }
  statsOps(batch, sale.day, sale.month, { revenue: -sale.total, profit: -sale.profit, salesCount: -1 });
  await batch.commit();
});

// Historique paginé (30 par page), jamais plus
export const listSales = ({ after = null, pageSize = 30 } = {}) => run(async () => {
  const size = Math.min(pageSize, LIMITS.sales);
  const q = after
    ? query(col("sales"), orderBy("createdAt", "desc"), startAfter(after), limit(size))
    : query(col("sales"), orderBy("createdAt", "desc"), limit(size));
  const snap = await getDocs(q);
  return {
    sales: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    cursor: snap.docs.length === size ? snap.docs[snap.docs.length - 1] : null
  };
});

export const getSale = (id) => run(async () => {
  const s = await getDoc(ref("sales", id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
});

/* ============================================================
   Clients
   ============================================================ */
export const listCustomers = () => run(async () => {
  const snap = await getDocs(query(col("customers"), limit(LIMITS.customers)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.debt - a.debt);
});

export const addCustomer = (c) => run(async () => {
  await requireActive();
  const r = doc(col("customers"));
  await setDoc(r, clean({
    name: text(c.name, 80, "Nom"), phone: text(c.phone, 24, "Téléphone", false),
    debt: 0, updatedAt: serverTimestamp()
  }));
  return r.id;
});

/* ============================================================
   Finances (entrées / sorties hors ventes)
   ============================================================ */
export const addTransaction = ({ type, amount, label }) => run(async () => {
  await requireActive();
  if (type !== "in" && type !== "out") throw new StoreError("invalid", "Type invalide.");
  const amt = money(amount);
  if (amt <= 0) throw new StoreError("invalid", "Montant invalide.");
  const day = localDay(), month = localMonth();
  const batch = writeBatch(db);
  const r = doc(col("transactions"));
  batch.set(r, { type, amount: amt, label: text(label, 100, "Libellé"), day, createdAt: serverTimestamp() });
  statsOps(batch, day, month, type === "in" ? { income: amt } : { expenses: amt });
  await batch.commit();
  return r.id;
});

export const deleteTransaction = (tx) => run(async () => {
  await requireActive();
  const batch = writeBatch(db);
  batch.delete(ref("transactions", tx.id));
  statsOps(batch, tx.day, tx.day.slice(0, 7), tx.type === "in" ? { income: -tx.amount } : { expenses: -tx.amount });
  await batch.commit();
});

export const listTransactions = ({ after = null, pageSize = 30 } = {}) => run(async () => {
  const size = Math.min(pageSize, LIMITS.tx);
  const q = after
    ? query(col("transactions"), orderBy("createdAt", "desc"), startAfter(after), limit(size))
    : query(col("transactions"), orderBy("createdAt", "desc"), limit(size));
  const snap = await getDocs(q);
  return {
    items: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    cursor: snap.docs.length === size ? snap.docs[snap.docs.length - 1] : null
  };
});

/* ============================================================
   Statistiques (Accueil et Finances) : 1 à 8 lectures au total
   ============================================================ */
const zeroStats = { revenue: 0, profit: 0, salesCount: 0, income: 0, expenses: 0 };

export const getMonthStats = (month = localMonth()) => run(async () => {
  const s = await getDoc(ref("stats", month));
  return { ...zeroStats, ...(s.exists() ? s.data() : {}) };
});

// n derniers jours (n ≤ 40) en UNE requête
export const getRecentDays = (n = 7) => run(async () => {
  const days = Math.min(n, LIMITS.stats);
  const end = new Date();
  const start = new Date(); start.setDate(end.getDate() - (days - 1));
  const snap = await getDocs(query(
    col("stats"),
    where(documentId(), ">=", localDay(start)),
    where(documentId(), "<=", localDay(end)),
    limit(LIMITS.stats)
  ));
  const byDay = new Map(snap.docs.map((d) => [d.id, { ...zeroStats, ...d.data() }]));
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = localDay(d);
    out.push({ day: k, ...(byDay.get(k) || zeroStats) });
  }
  return out;
});

// Tout l'écran Accueil en 2 requêtes
export const getHomeSummary = () => run(async () => {
  const [month, days] = await Promise.all([getMonthStats(), getRecentDays(7)]);
  const today = days[days.length - 1];
  return { month, today, days, lowStock: getLowStock() };
});
