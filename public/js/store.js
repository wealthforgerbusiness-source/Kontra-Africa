import {
  db,
  auth,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit as fsLimit,
  startAfter,
  writeBatch,
  serverTimestamp,
  increment
} from './firebase.js';
import { deleteField, documentId } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { setCustomSymbol } from './ui.js';

const MAX_MONEY = 1000000000000;
const MAX_LINES = 60;
const PRODUCT_PAGE = 500;
const CUSTOMER_PAGE = 200;
const SALES_PAGE = 20;
const TX_PAGE = 30;
const PROFILE_TEXT = { businessName: 80, country: 40, currency: 8, symbol: 8, phone: 24, address: 160 };

export class StoreError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = 'StoreError';
    this.code = code;
    this.detail = detail || '';
  }
}

const zeroStats = () => ({ revenue: 0, profit: 0, salesCount: 0, expenses: 0, income: 0, remindersCount: 0 });

const blank = () => ({
  uid: null,
  limits: null,
  canWrite: true,
  profile: null,
  products: [],
  productsLoaded: false,
  customers: [],
  customersLoaded: false,
  sales: [],
  salesCursor: null,
  salesDone: false,
  salesLoaded: false,
  txs: [],
  txsLoaded: false,
  stats: null
});

let state = blank();
const listeners = new Set();

function emit() {
  setCustomSymbol(state.profile && state.profile.symbol);
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (_err) {
      return;
    }
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function bind() {
  const user = auth.currentUser;
  if (!user) throw new StoreError('unauthorized');
  if (state.uid !== user.uid) {
    state = blank();
    state.uid = user.uid;
  }
  return user.uid;
}

function online() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new StoreError('offline');
}

function guardLite() {
  const id = bind();
  online();
  return id;
}

function guard() {
  const id = guardLite();
  if (!state.canWrite) throw new StoreError('subscription_expired');
  return id;
}

const userRef = () => doc(db, 'users', bind());
const colRef = (name) => collection(db, 'users', bind(), name);
const itemRef = (name, id) => doc(db, 'users', bind(), name, id);
const usageRef = () => itemRef('usage', 'counters');

export function configure(options) {
  bind();
  const o = options || {};
  if (o.limits) state.limits = o.limits;
  if (Object.prototype.hasOwnProperty.call(o, 'canWrite')) state.canWrite = Boolean(o.canWrite);
  emit();
}

export function reset() {
  state = blank();
  emit();
}

const pad = (n) => String(n).padStart(2, '0');

export function dayId(date) {
  const d = date || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function monthId(date) {
  return (date || new Date()).toISOString().slice(0, 7);
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

function text(value, max) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function num(value, label, min, max) {
  const raw =
    typeof value === 'number'
      ? value
      : Number(String(value === undefined || value === null ? '' : value).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(raw) || raw < min || raw > max) throw new StoreError('invalid_' + label);
  return round2(raw);
}

function ms(ts) {
  return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null;
}

function reached(kind, used) {
  const l = state.limits;
  return Boolean(l) && Number.isFinite(l[kind]) && used >= l[kind];
}

function mapProduct(id, d) {
  return {
    id,
    name: String(d.name || ''),
    sku: String(d.sku || ''),
    buyPrice: Number(d.buyPrice) || 0,
    sellPrice: Number(d.sellPrice) || 0,
    qty: Number(d.qty) || 0,
    alertAt: Number(d.alertAt) || 0,
    isLow: Boolean(d.isLow),
    soldQty: Number(d.soldQty) || 0
  };
}

function mapCustomer(id, d) {
  return { id, name: String(d.name || ''), phone: String(d.phone || ''), debt: Number(d.debt) || 0 };
}

function mapSale(id, d) {
  const total = Number(d.total) || 0;
  const paid = d.paid === undefined || d.paid === null ? (d.status === 'paid' ? total : 0) : Number(d.paid) || 0;
  return {
    id,
    items: Array.isArray(d.items) ? d.items : [],
    total,
    profit: Number(d.profit) || 0,
    paid,
    status: String(d.status || 'paid'),
    customerId: String(d.customerId || ''),
    customerName: String(d.customerName || ''),
    customerPhone: String(d.customerPhone || ''),
    note: String(d.note || ''),
    invoiceNo: String(d.invoiceNo || ''),
    day: String(d.day || ''),
    month: String(d.month || ''),
    createdAtMs: ms(d.createdAt) || Date.now()
  };
}

function mapTx(id, d) {
  return {
    id,
    type: d.type === 'out' ? 'out' : 'in',
    amount: Number(d.amount) || 0,
    label: String(d.label || ''),
    day: String(d.day || ''),
    createdAtMs: ms(d.createdAt) || Date.now()
  };
}

function mapStats(d) {
  const out = zeroStats();
  if (!d) return out;
  Object.keys(out).forEach((k) => {
    const n = Number(d[k]);
    out[k] = Number.isFinite(n) ? n : 0;
  });
  return out;
}

function applyStats(delta) {
  if (!state.stats) return;
  Object.keys(delta).forEach((k) => {
    state.stats.day[k] = round2((state.stats.day[k] || 0) + delta[k]);
    state.stats.month[k] = round2((state.stats.month[k] || 0) + delta[k]);
  });
}

async function loadAllByName(name, pageSize, mapper) {
  const out = [];
  let cursor = null;
  for (;;) {
    const q = cursor
      ? query(colRef(name), orderBy('name'), startAfter(cursor), fsLimit(pageSize))
      : query(colRef(name), orderBy('name'), fsLimit(pageSize));
    const snap = await getDocs(q);
    snap.docs.forEach((d) => out.push(mapper(d.id, d.data())));
    if (snap.size < pageSize || out.length >= 10000) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return out;
}

export async function loadProducts(force) {
  bind();
  if (state.productsLoaded && !force) return state.products;
  state.products = await loadAllByName('products', PRODUCT_PAGE, mapProduct);
  state.productsLoaded = true;
  emit();
  return state.products;
}

export async function loadCustomers(force) {
  bind();
  if (state.customersLoaded && !force) return state.customers;
  state.customers = await loadAllByName('customers', CUSTOMER_PAGE, mapCustomer);
  state.customersLoaded = true;
  emit();
  return state.customers;
}

export async function loadStats(force) {
  bind();
  const today = dayId();
  const month = monthId();
  if (state.stats && !force && state.stats.dayId === today && state.stats.monthId === month) return state.stats;
  const [daySnap, monthSnap] = await Promise.all([getDoc(itemRef('stats', today)), getDoc(itemRef('stats', month))]);
  state.stats = {
    dayId: today,
    monthId: month,
    day: mapStats(daySnap.exists() ? daySnap.data() : null),
    month: mapStats(monthSnap.exists() ? monthSnap.data() : null)
  };
  emit();
  return state.stats;
}

export async function loadSales(more, force) {
  bind();
  if (force) {
    state.salesLoaded = false;
    state.salesCursor = null;
    state.salesDone = false;
  }
  const next = Boolean(more) && state.salesLoaded;
  if (!next && state.salesLoaded) return { sales: state.sales, done: state.salesDone };
  if (next && state.salesDone) return { sales: state.sales, done: true };

  const base = [colRef('sales'), orderBy('createdAt', 'desc')];
  const q =
    next && state.salesCursor
      ? query(...base, startAfter(state.salesCursor), fsLimit(SALES_PAGE))
      : query(...base, fsLimit(SALES_PAGE));
  const snap = await getDocs(q);
  const rows = snap.docs.map((d) => mapSale(d.id, d.data()));
  state.sales = next ? state.sales.concat(rows) : rows;
  state.salesCursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : state.salesCursor;
  state.salesDone = snap.size < SALES_PAGE;
  state.salesLoaded = true;
  emit();
  return { sales: state.sales, done: state.salesDone };
}

export async function loadTransactions(force) {
  bind();
  if (state.txsLoaded && !force) return state.txs;
  const snap = await getDocs(query(colRef('transactions'), orderBy('createdAt', 'desc'), fsLimit(TX_PAGE)));
  state.txs = snap.docs.map((d) => mapTx(d.id, d.data()));
  state.txsLoaded = true;
  emit();
  return state.txs;
}

export async function loadProfile(force) {
  bind();
  if (state.profile && !force) return state.profile;
  const snap = await getDoc(userRef());
  state.profile = snap.exists() ? snap.data() : {};
  emit();
  return state.profile;
}

export async function saveProfile(changes) {
  guardLite();
  if (!state.profile) await loadProfile();
  const merged = Object.assign({}, state.profile || {}, changes || {});
  const out = {};
  Object.keys(PROFILE_TEXT).forEach((k) => {
    const v = text(merged[k], PROFILE_TEXT[k]);
    if (v) out[k] = v;
  });
  ['rate', 'savingsGoal'].forEach((k) => {
    const v = merged[k];
    if (v === undefined || v === null || v === '') return;
    out[k] = num(v, k, 0, k === 'rate' ? 1000000 : MAX_MONEY);
  });
  await setDoc(userRef(), out);
  state.profile = out;
  emit();
  return out;
}

/* ---------- Clôture de journée ---------- */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_PAGE = 50;
const DAY_MAX_ROWS = 1000;

function mapClosing(id, d) {
  const n = (v) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    day: id,
    revenue: n(d.revenue) || 0,
    profit: n(d.profit) || 0,
    salesCount: n(d.salesCount) || 0,
    expenses: n(d.expenses) || 0,
    income: n(d.income) || 0,
    cashSales: n(d.cashSales),
    debtCollected: n(d.debtCollected),
    otherIncome: n(d.otherIncome),
    creditDue: n(d.creditDue),
    expected: n(d.expected),
    counted: n(d.counted),
    gap: n(d.gap),
    note: String(d.note || ''),
    closedAtMs: ms(d.closedAt) || Date.now()
  };
}

async function loadByDay(name, day, mapper) {
  const rows = [];
  let cursor = null;
  let truncated = false;
  for (;;) {
    const parts = [colRef(name), where('day', '==', day)];
    if (cursor) parts.push(startAfter(cursor));
    parts.push(fsLimit(DAY_PAGE));
    const snap = await getDocs(query(...parts));
    snap.docs.forEach((d) => rows.push(mapper(d.id, d.data())));
    if (snap.size < DAY_PAGE) break;
    if (rows.length >= DAY_MAX_ROWS) {
      truncated = true;
      break;
    }
    cursor = snap.docs[snap.docs.length - 1];
  }
  return { rows, truncated };
}

/* La lecture des clôtures ne doit jamais empêcher d'afficher le bilan du jour
   (par exemple si les règles Firestore ne sont pas encore à jour). */
async function readClosingSafe(day) {
  try {
    const snap = await getDoc(itemRef('closings', day));
    return { closing: snap.exists() ? mapClosing(day, snap.data()) : null, available: true };
  } catch (_err) {
    return { closing: null, available: false };
  }
}

/* Toutes les données utiles au bilan d'un jour (format AAAA-MM-JJ). */
export async function loadDayReport(day) {
  bind();
  if (!DAY_RE.test(String(day))) throw new StoreError('invalid_day');
  const [statsSnap, sales, txs, closed] = await Promise.all([
    getDoc(itemRef('stats', day)),
    loadByDay('sales', day, (id, d) => Object.assign(mapSale(id, d), { touched: Boolean(d.updatedAt) })),
    loadByDay('transactions', day, mapTx),
    readClosingSafe(day)
  ]);
  return {
    day,
    stats: mapStats(statsSnap.exists() ? statsSnap.data() : null),
    sales: sales.rows,
    txs: txs.rows,
    truncated: sales.truncated || txs.truncated,
    closing: closed.closing,
    closingsAvailable: closed.available
  };
}

/* Bilan jour par jour d'un mois (format AAAA-MM), à partir des statistiques journalières. */
export async function loadMonthReport(month) {
  bind();
  if (!MONTH_RE.test(String(month))) throw new StoreError('invalid_day');
  const range = (coll) =>
    query(colRef(coll), where(documentId(), '>=', month + '-01'), where(documentId(), '<=', month + '-31'), fsLimit(40));
  const [statsSnap, closingsSnap] = await Promise.all([
    getDocs(range('stats')),
    getDocs(range('closings')).catch(() => null)
  ]);
  const days = statsSnap.docs
    .filter((d) => DAY_RE.test(d.id))
    .map((d) => Object.assign({ day: d.id }, mapStats(d.data())));
  const closings = closingsSnap ? closingsSnap.docs.map((d) => mapClosing(d.id, d.data())) : [];
  days.sort((a, b) => (a.day < b.day ? 1 : -1));
  return { month, days, closings };
}

/* Enregistre (ou met à jour) la clôture d'un jour. */
export async function saveClosing(day, input) {
  guard();
  if (!DAY_RE.test(String(day))) throw new StoreError('invalid_day');
  const i = input || {};
  const data = {
    day,
    month: day.slice(0, 7),
    revenue: num(i.revenue, 'revenue', -MAX_MONEY, MAX_MONEY),
    profit: num(i.profit, 'profit', -MAX_MONEY, MAX_MONEY),
    salesCount: Math.round(num(i.salesCount, 'salesCount', 0, 100000000)),
    expenses: num(i.expenses, 'expenses', 0, MAX_MONEY),
    income: num(i.income, 'income', 0, MAX_MONEY)
  };
  [
    ['cashSales', 0],
    ['debtCollected', 0],
    ['otherIncome', 0],
    ['creditDue', 0],
    ['expected', -MAX_MONEY],
    ['counted', 0],
    ['gap', -MAX_MONEY]
  ].forEach(([key, min]) => {
    const v = i[key];
    if (v === undefined || v === null || v === '') return;
    data[key] = num(v, key, min, MAX_MONEY);
  });
  const note = text(i.note, 300);
  if (note) data.note = note;
  data.closedAt = serverTimestamp();

  try {
    await setDoc(itemRef('closings', day), data);
  } catch (err) {
    if (err && err.code === 'permission-denied') throw new StoreError('closing_denied');
    throw err;
  }
  return mapClosing(day, Object.assign({}, data, { closedAt: null }));
}

export const getProducts = () => state.products;
export const getCustomers = () => state.customers;
export const getSales = () => state.sales;
export const getTransactions = () => state.txs;
export const getStats = () => state.stats;
export const getProfile = () => state.profile || {};
export const canWrite = () => state.canWrite;
export const findProduct = (id) => state.products.find((p) => p.id === id) || null;
export const findCustomer = (id) => state.customers.find((c) => c.id === id) || null;
export const lowStock = () => state.products.filter((p) => p.isLow).sort((a, b) => a.qty - b.qty);
export const debtors = () => state.customers.filter((c) => c.debt > 0).sort((a, b) => b.debt - a.debt);
export const totalDebt = () => round2(state.customers.reduce((sum, c) => sum + c.debt, 0));

export function usage() {
  const l = state.limits || {};
  const m = state.stats ? state.stats.month : zeroStats();
  return {
    products: { used: state.products.length, max: l.products || 0 },
    customers: { used: state.customers.length, max: l.customers || 0 },
    sales: { used: m.salesCount, max: l.salesPerMonth || 0 },
    reminders: { used: m.remindersCount, max: l.remindersPerMonth || 0 }
  };
}

function readProduct(input) {
  const i = input || {};
  const name = text(i.name, 80);
  if (!name) throw new StoreError('invalid_name');
  const sellPrice = num(i.sellPrice, 'sellPrice', 0, 1000000000);
  if (sellPrice <= 0) throw new StoreError('invalid_sellPrice');
  return {
    name,
    sku: text(i.sku, 40),
    buyPrice: num(i.buyPrice, 'buyPrice', 0, 1000000000),
    sellPrice,
    qty: num(i.qty, 'qty', 0, 100000000),
    alertAt: num(i.alertAt, 'alertAt', 0, 1000000)
  };
}

function sortByName(list) {
  list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

export async function addProduct(input) {
  guard();
  await loadProducts();
  if (reached('products', state.products.length)) throw new StoreError('limit_products');
  const d = readProduct(input);
  const ref = doc(colRef('products'));
  const data = {
    name: d.name,
    buyPrice: d.buyPrice,
    sellPrice: d.sellPrice,
    qty: d.qty,
    alertAt: d.alertAt,
    isLow: d.qty <= d.alertAt,
    soldQty: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  if (d.sku) data.sku = d.sku;

  const batch = writeBatch(db);
  batch.set(ref, data);
  batch.set(usageRef(), { products: increment(1), lastProduct: ref.id }, { merge: true });
  await batch.commit();

  const product = mapProduct(ref.id, data);
  state.products.push(product);
  sortByName(state.products);
  emit();
  return product;
}

export async function updateProduct(productId, input) {
  guard();
  await loadProducts();
  const p = findProduct(productId);
  if (!p) throw new StoreError('invalid_product');
  const d = readProduct(input);
  await updateDoc(itemRef('products', p.id), {
    name: d.name,
    sku: d.sku || deleteField(),
    buyPrice: d.buyPrice,
    sellPrice: d.sellPrice,
    qty: d.qty,
    alertAt: d.alertAt,
    isLow: d.qty <= d.alertAt,
    updatedAt: serverTimestamp()
  });
  Object.assign(p, { name: d.name, sku: d.sku, buyPrice: d.buyPrice, sellPrice: d.sellPrice, qty: d.qty, alertAt: d.alertAt, isLow: d.qty <= d.alertAt });
  sortByName(state.products);
  emit();
  return p;
}

export async function restock(productId, amount) {
  guard();
  await loadProducts();
  const p = findProduct(productId);
  if (!p) throw new StoreError('invalid_product');
  const add = num(amount, 'qty', 0.01, 100000000);
  const next = round2(p.qty + add);
  if (next > 100000000) throw new StoreError('invalid_qty');
  await updateDoc(itemRef('products', p.id), {
    qty: increment(add),
    isLow: next <= p.alertAt,
    updatedAt: serverTimestamp()
  });
  p.qty = next;
  p.isLow = next <= p.alertAt;
  emit();
  return p;
}

export async function removeProduct(productId) {
  guard();
  await loadProducts();
  const p = findProduct(productId);
  if (!p) throw new StoreError('invalid_product');
  const batch = writeBatch(db);
  batch.delete(itemRef('products', p.id));
  batch.set(usageRef(), { products: increment(-1), lastProduct: p.id }, { merge: true });
  await batch.commit();
  state.products = state.products.filter((x) => x.id !== p.id);
  emit();
}

export async function addCustomer(input) {
  guard();
  await loadCustomers();
  if (reached('customers', state.customers.length)) throw new StoreError('limit_customers');
  const name = text(input && input.name, 80);
  if (!name) throw new StoreError('invalid_name');
  const phone = text(input && input.phone, 24);
  const ref = doc(colRef('customers'));
  const data = { name, debt: 0, updatedAt: serverTimestamp() };
  if (phone) data.phone = phone;

  const batch = writeBatch(db);
  batch.set(ref, data);
  batch.set(usageRef(), { customers: increment(1), lastCustomer: ref.id }, { merge: true });
  await batch.commit();

  const customer = mapCustomer(ref.id, data);
  state.customers.push(customer);
  sortByName(state.customers);
  emit();
  return customer;
}

export async function updateCustomer(customerId, input) {
  guard();
  await loadCustomers();
  const c = findCustomer(customerId);
  if (!c) throw new StoreError('invalid_customer');
  const name = text(input && input.name, 80);
  if (!name) throw new StoreError('invalid_name');
  const phone = text(input && input.phone, 24);
  await updateDoc(itemRef('customers', c.id), {
    name,
    phone: phone || deleteField(),
    updatedAt: serverTimestamp()
  });
  c.name = name;
  c.phone = phone;
  sortByName(state.customers);
  emit();
  return c;
}

export async function removeCustomer(customerId) {
  guard();
  await loadCustomers();
  const c = findCustomer(customerId);
  if (!c) throw new StoreError('invalid_customer');
  const batch = writeBatch(db);
  batch.delete(itemRef('customers', c.id));
  batch.set(usageRef(), { customers: increment(-1), lastCustomer: c.id }, { merge: true });
  await batch.commit();
  state.customers = state.customers.filter((x) => x.id !== c.id);
  emit();
}

export async function createSale(input) {
  guard();
  await Promise.all([loadProducts(), loadStats()]);
  if (reached('salesPerMonth', state.stats.month.salesCount)) throw new StoreError('limit_sales');

  const lines = Array.isArray(input && input.lines) ? input.lines : [];
  const merged = new Map();
  lines.forEach((line) => {
    const p = findProduct(line && line.productId);
    if (!p) throw new StoreError('invalid_product');
    const qty = num(line.qty, 'qty', 0.01, 100000000);
    const price =
      line.price === undefined || line.price === null || line.price === '' ? p.sellPrice : num(line.price, 'price', 0, 1000000000);
    const prev = merged.get(p.id);
    if (prev) prev.qty = round2(prev.qty + qty);
    else merged.set(p.id, { p, qty, price });
  });
  if (!merged.size || merged.size > MAX_LINES) throw new StoreError('invalid_cart');

  let total = 0;
  let profit = 0;
  const items = [];
  merged.forEach(({ p, qty, price }) => {
    if (qty > p.qty) throw new StoreError('stock_insufficient', p.name);
    total += price * qty;
    profit += (price - p.buyPrice) * qty;
    items.push({ id: p.id, name: text(p.name, 80), qty, price, cost: p.buyPrice });
  });
  total = round2(total);
  profit = round2(profit);
  if (total <= 0 || total > MAX_MONEY) throw new StoreError('invalid_cart');

  const mode = input.mode === 'credit' ? 'credit' : 'paid';
  let customer = null;
  let paidNow = total;
  if (mode === 'credit') {
    await loadCustomers();
    customer = findCustomer(input.customerId);
    if (!customer) throw new StoreError('customer_required');
    const given = input.paidNow === undefined || input.paidNow === null || input.paidNow === '' ? 0 : num(input.paidNow, 'paid', 0, total);
    if (given >= total) throw new StoreError('invalid_paid');
    paidNow = given;
    if (customer.debt + (total - paidNow) > MAX_MONEY) throw new StoreError('invalid_paid');
  }

  const now = new Date();
  const saleRef = doc(colRef('sales'));
  const sale = {
    items,
    total,
    profit,
    paid: paidNow,
    status: mode,
    day: dayId(now),
    month: monthId(now),
    invoiceNo: saleRef.id.slice(0, 6).toUpperCase(),
    createdAt: serverTimestamp()
  };
  if (customer) {
    sale.customerId = customer.id;
    sale.customerName = customer.name;
    if (customer.phone) sale.customerPhone = customer.phone;
  }
  const note = text(input.note, 300);
  if (note) sale.note = note;

  const batch = writeBatch(db);
  batch.set(saleRef, sale);
  batch.set(
    itemRef('stats', sale.month),
    { revenue: increment(total), profit: increment(profit), salesCount: increment(1), lastSale: saleRef.id },
    { merge: true }
  );
  batch.set(
    itemRef('stats', sale.day),
    { revenue: increment(total), profit: increment(profit), salesCount: increment(1) },
    { merge: true }
  );
  merged.forEach(({ p, qty }) => {
    const left = round2(p.qty - qty);
    batch.update(itemRef('products', p.id), {
      qty: increment(-qty),
      soldQty: increment(qty),
      isLow: left <= p.alertAt,
      updatedAt: serverTimestamp()
    });
  });
  if (customer) {
    batch.update(itemRef('customers', customer.id), {
      debt: increment(round2(total - paidNow)),
      updatedAt: serverTimestamp()
    });
  }
  await batch.commit();

  merged.forEach(({ p, qty }) => {
    p.qty = round2(p.qty - qty);
    p.soldQty = round2(p.soldQty + qty);
    p.isLow = p.qty <= p.alertAt;
  });
  if (customer) customer.debt = round2(customer.debt + total - paidNow);
  applyStats({ revenue: total, profit, salesCount: 1 });

  const local = mapSale(saleRef.id, Object.assign({}, sale, { createdAt: null }));
  local.createdAtMs = now.getTime();
  if (state.salesLoaded) state.sales.unshift(local);
  emit();
  return local;
}

export async function collectDebt(customerId, amountInput) {
  guard();
  await Promise.all([loadCustomers(), loadStats()]);
  const customer = findCustomer(customerId);
  if (!customer) throw new StoreError('invalid_customer');
  if (customer.debt <= 0) throw new StoreError('no_debt');
  const amount = Math.min(num(amountInput, 'amount', 0.01, MAX_MONEY), customer.debt);

  const snap = await getDocs(
    query(colRef('sales'), where('customerId', '==', customerId), where('status', '==', 'credit'), fsLimit(50))
  );
  const rows = snap.docs.map((d) => mapSale(d.id, d.data())).sort((a, b) => a.createdAtMs - b.createdAtMs);

  const batch = writeBatch(db);
  const changes = new Map();
  let left = amount;
  rows.forEach((s) => {
    if (left <= 0) return;
    const due = round2(s.total - s.paid);
    const ref = itemRef('sales', s.id);
    if (due <= 0) {
      batch.update(ref, { status: 'paid', paid: s.total, updatedAt: serverTimestamp() });
      changes.set(s.id, { status: 'paid', paid: s.total });
    } else if (left >= due) {
      batch.update(ref, { status: 'paid', paid: s.total, updatedAt: serverTimestamp() });
      changes.set(s.id, { status: 'paid', paid: s.total });
      left = round2(left - due);
    } else {
      const paid = round2(s.paid + left);
      batch.update(ref, { paid, updatedAt: serverTimestamp() });
      changes.set(s.id, { status: 'credit', paid });
      left = 0;
    }
  });

  const now = new Date();
  const txRef = doc(colRef('transactions'));
  const label = text('Dette payée - ' + customer.name, 100);
  const day = dayId(now);
  batch.update(itemRef('customers', customer.id), { debt: increment(-amount), updatedAt: serverTimestamp() });
  batch.set(txRef, { type: 'in', amount, label, day, createdAt: serverTimestamp() });
  batch.set(itemRef('stats', day), { income: increment(amount) }, { merge: true });
  batch.set(itemRef('stats', monthId(now)), { income: increment(amount) }, { merge: true });
  await batch.commit();

  customer.debt = round2(Math.max(0, customer.debt - amount));
  state.sales.forEach((s) => {
    const c = changes.get(s.id);
    if (c) Object.assign(s, c);
  });
  if (state.txsLoaded) state.txs.unshift({ id: txRef.id, type: 'in', amount, label, day, createdAtMs: now.getTime() });
  applyStats({ income: amount });
  emit();
  return { amount, remaining: customer.debt };
}

export async function addTransaction(input) {
  guard();
  await loadStats();
  const type = input && input.type === 'out' ? 'out' : input && input.type === 'in' ? 'in' : '';
  if (!type) throw new StoreError('invalid_type');
  const amount = num(input.amount, 'amount', 0.01, MAX_MONEY);
  const label = text(input.label, 100);
  if (!label) throw new StoreError('invalid_label');

  const now = new Date();
  const day = dayId(now);
  const ref = doc(colRef('transactions'));
  const field = type === 'in' ? 'income' : 'expenses';

  const batch = writeBatch(db);
  batch.set(ref, { type, amount, label, day, createdAt: serverTimestamp() });
  batch.set(itemRef('stats', day), { [field]: increment(amount) }, { merge: true });
  batch.set(itemRef('stats', monthId(now)), { [field]: increment(amount) }, { merge: true });
  await batch.commit();

  const local = { id: ref.id, type, amount, label, day, createdAtMs: now.getTime() };
  if (state.txsLoaded) state.txs.unshift(local);
  applyStats({ [field]: amount });
  emit();
  return local;
}

export async function removeTransaction(txId) {
  guard();
  await loadTransactions();
  const tx = state.txs.find((t) => t.id === txId);
  if (!tx) throw new StoreError('invalid_transaction');
  const field = tx.type === 'in' ? 'income' : 'expenses';
  const batch = writeBatch(db);
  batch.delete(itemRef('transactions', tx.id));
  batch.set(itemRef('stats', tx.day), { [field]: increment(-tx.amount) }, { merge: true });
  batch.set(itemRef('stats', monthId(new Date(tx.createdAtMs))), { [field]: increment(-tx.amount) }, { merge: true });
  await batch.commit();
  state.txs = state.txs.filter((t) => t.id !== tx.id);
  if (state.stats) applyStats({ [field]: -tx.amount });
  emit();
}

export async function addReminder(customerId) {
  guard();
  await loadStats();
  if (reached('remindersPerMonth', state.stats.month.remindersCount)) throw new StoreError('limit_reminders');
  const month = monthId();
  const ref = doc(colRef('reminders'));
  const data = { month, createdAt: serverTimestamp() };
  const cid = text(customerId, 40);
  if (cid) data.customerId = cid;

  const batch = writeBatch(db);
  batch.set(ref, data);
  batch.set(itemRef('stats', month), { remindersCount: increment(1), lastReminder: ref.id }, { merge: true });
  await batch.commit();

  state.stats.month.remindersCount += 1;
  emit();
  return ref.id;
}

const MESSAGES = {
  limit_products: 'Limite de produits atteinte pour votre offre. Passez à une offre supérieure.',
  limit_customers: 'Limite de clients à crédit atteinte pour votre offre. Passez à une offre supérieure.',
  limit_sales: 'Limite de ventes du mois atteinte pour votre offre.',
  limit_reminders: 'Limite de relances du mois atteinte pour votre offre.',
  subscription_expired: 'Votre abonnement est terminé. Choisissez une offre pour continuer.',
  offline: 'Connexion internet nécessaire pour enregistrer.',
  unauthorized: 'Session expirée. Reconnectez-vous.',
  invalid_name: 'Le nom est obligatoire.',
  invalid_sellPrice: 'Le prix de vente doit être supérieur à 0.',
  invalid_buyPrice: 'Prix d’achat invalide.',
  invalid_qty: 'Quantité invalide.',
  invalid_alertAt: 'Seuil d’alerte invalide.',
  invalid_price: 'Prix invalide.',
  invalid_amount: 'Montant invalide.',
  invalid_paid: 'Le montant déjà payé doit être inférieur au total.',
  invalid_label: 'Ajoutez un libellé.',
  invalid_type: 'Type d’opération invalide.',
  invalid_cart: 'Le panier est vide ou invalide.',
  invalid_product: 'Produit introuvable. Actualisez la page.',
  invalid_customer: 'Client introuvable. Actualisez la page.',
  invalid_transaction: 'Opération introuvable.',
  customer_required: 'Choisissez le client pour une vente à crédit.',
  no_debt: 'Ce client ne doit rien.',
  invalid_day: 'Date invalide.',
  closing_denied: 'La clôture n’est pas encore disponible sur votre compte. Réessayez dans un moment.',
  invalid_counted: 'Le montant compté en caisse est invalide.',
  rate: 'Taux invalide.',
  savingsGoal: 'Objectif invalide.'
};

export function storeError(err) {
  if (err instanceof StoreError) {
    if (err.code === 'stock_insufficient') return 'Stock insuffisant pour : ' + err.detail + '.';
    return MESSAGES[err.code] || 'Données invalides.';
  }
  const code = err && err.code ? String(err.code) : '';
  if (code === 'permission-denied') return 'Action refusée. Vérifiez votre abonnement, le stock et les limites de votre offre, puis réessayez.';
  if (code === 'unavailable' || code === 'deadline-exceeded') return 'Connexion instable. Réessayez.';
  if (code === 'resource-exhausted') return 'Trop de demandes. Patientez un instant.';
  if (code === 'unauthenticated') return MESSAGES.unauthorized;
  return 'Une erreur est survenue. Réessayez.';
}
