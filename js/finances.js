// js/finances.js
// Module Finances (protégé par auth-guard.js)
//
// Hypothèses sur firebase-config.js : exporte `auth` et `db` via
// `export { auth, db }`. Adapte les imports si tes noms diffèrent.

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  doc,
  onSnapshot,
  updateDoc,
  runTransaction,
  serverTimestamp,
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { addPendingAction, getPendingActions, syncPendingActions } from './offline-queue.js';

const PAGE_SIZE = 20;

// ---------- État ----------
let currentUser = null;
let userData = {
  balance: 0,
  currencySymbol: '',
  exchangeRate: 0,
  exchangeRateUpdatedAt: null,
  savingsGoalAmount: 0,
  savingsCurrentAmount: 0,
};
let pendingTransactionType = 'credit';
let lastVisibleDoc = null;
let loadedTransactions = [];
let hasMoreTransactions = true;

// ---------- Éléments DOM ----------
const balanceAmountEl = document.getElementById('balance-amount');
const offlineBanner = document.getElementById('offline-banner');

const modalTransaction = document.getElementById('modal-transaction');
const modalTransactionTitle = document.getElementById('modal-transaction-title');
const formTransaction = document.getElementById('form-transaction');
const transactionError = document.getElementById('transaction-error');
const btnConfirmTransaction = document.getElementById('btn-confirm-transaction');

const formSavings = document.getElementById('form-savings');
const inputSavingsGoal = document.getElementById('input-savings-goal');
const inputSavingsCurrent = document.getElementById('input-savings-current');
const savingsProgressFill = document.getElementById('savings-progress-fill');
const savingsProgressLabel = document.getElementById('savings-progress-label');
const savingsSavedMsg = document.getElementById('savings-saved-msg');

const formCurrency = document.getElementById('form-currency');
const inputCurrencySymbol = document.getElementById('input-currency-symbol');
const inputExchangeRate = document.getElementById('input-exchange-rate');
const exchangeRateUpdatedEl = document.getElementById('exchange-rate-updated');
const currencySavedMsg = document.getElementById('currency-saved-msg');

const transactionsListEl = document.getElementById('transactions-list');
const transactionsLoadingEl = document.getElementById('transactions-loading');
const transactionsEmptyEl = document.getElementById('transactions-empty');
const btnLoadMore = document.getElementById('btn-load-more');

// ---------- Auth ----------
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    listenToUserDoc(user.uid);
    loadTransactionsFirstPage(user.uid);
    trySyncPending(user.uid);
  }
});

// ---------- Hors ligne ----------
function updateOnlineStatus() {
  offlineBanner.hidden = navigator.onLine;
}
window.addEventListener('online', () => {
  updateOnlineStatus();
  if (currentUser) trySyncPending(currentUser.uid);
});
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

async function trySyncPending(uid) {
  if (!navigator.onLine) return;
  await syncPendingActions('transaction', async (payload) => {
    await applyTransactionInFirestore(uid, payload.type, payload.amount, payload.description);
  });
  // Une fois la synchro terminée, on recharge la première page pour
  // remplacer les entrées "en attente" par les vraies entrées Firestore.
  loadTransactionsFirstPage(uid);
}

// ---------- Document utilisateur (solde, devise, épargne) ----------
function listenToUserDoc(uid) {
  onSnapshot(doc(db, 'users', uid), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    userData = {
      balance: data.balance || 0,
      currencySymbol: data.currencySymbol || '',
      exchangeRate: data.exchangeRate || 0,
      exchangeRateUpdatedAt: data.exchangeRateUpdatedAt || null,
      savingsGoalAmount: data.savingsGoalAmount || 0,
      savingsCurrentAmount: data.savingsCurrentAmount || 0,
    };
    renderBalance();
    renderSavings();
    renderCurrencyForm();
    renderTransactionsList(); // pour rafraîchir le symbole de devise affiché
  });
}

function formatAmount(amount) {
  const symbol = userData.currencySymbol || '';
  const formatted = Number(amount || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  return symbol ? `${formatted} ${symbol}` : formatted;
}

function renderBalance() {
  balanceAmountEl.textContent = formatAmount(userData.balance);
}

function renderSavings() {
  if (document.activeElement !== inputSavingsGoal) {
    inputSavingsGoal.value = userData.savingsGoalAmount || '';
  }
  if (document.activeElement !== inputSavingsCurrent) {
    inputSavingsCurrent.value = userData.savingsCurrentAmount || '';
  }

  const goal = Number(userData.savingsGoalAmount) || 0;
  const current = Number(userData.savingsCurrentAmount) || 0;
  const percent = goal > 0 ? Math.min(100, Math.round((current / goal) * 100)) : 0;
  savingsProgressFill.style.width = `${percent}%`;
  savingsProgressLabel.textContent = `${percent}% — ${formatAmount(current)} / ${formatAmount(goal)}`;
}

function renderCurrencyForm() {
  if (document.activeElement !== inputCurrencySymbol) {
    inputCurrencySymbol.value = userData.currencySymbol || '';
  }
  if (document.activeElement !== inputExchangeRate) {
    inputExchangeRate.value = userData.exchangeRate || '';
  }
  if (userData.exchangeRateUpdatedAt?.toDate) {
    exchangeRateUpdatedEl.textContent = `Mis à jour le ${userData.exchangeRateUpdatedAt.toDate().toLocaleDateString('fr-FR')}`;
  } else {
    exchangeRateUpdatedEl.textContent = '';
  }
}

// ---------- Formulaire objectif d'épargne ----------
formSavings.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const savingsGoalAmount = Number(inputSavingsGoal.value) || 0;
  const savingsCurrentAmount = Number(inputSavingsCurrent.value) || 0;

  try {
    await updateDoc(doc(db, 'users', currentUser.uid), {
      savingsGoalAmount,
      savingsCurrentAmount,
    });
    flashSavedMessage(savingsSavedMsg);
  } catch (err) {
    console.error('Erreur de sauvegarde de l’objectif d’épargne :', err);
  }
});

// ---------- Formulaire devise ----------
formCurrency.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const currencySymbol = inputCurrencySymbol.value.trim();
  const exchangeRate = Number(inputExchangeRate.value) || 0;

  try {
    await updateDoc(doc(db, 'users', currentUser.uid), {
      currencySymbol,
      exchangeRate,
      exchangeRateUpdatedAt: serverTimestamp(),
    });
    flashSavedMessage(currencySavedMsg);
  } catch (err) {
    console.error('Erreur de sauvegarde de la devise :', err);
  }
});

function flashSavedMessage(el) {
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 2000);
}

// ---------- Modale créditer / débiter ----------
document.getElementById('btn-credit').addEventListener('click', () => openTransactionModal('credit'));
document.getElementById('btn-debit').addEventListener('click', () => openTransactionModal('debit'));
document.querySelectorAll('[data-action="close-transaction-modal"]').forEach((btn) => {
  btn.addEventListener('click', () => modalTransaction.close());
});

function openTransactionModal(type) {
  pendingTransactionType = type;
  modalTransactionTitle.textContent = type === 'credit' ? 'Créditer le solde' : 'Débiter le solde';
  btnConfirmTransaction.textContent = type === 'credit' ? 'Créditer' : 'Débiter';
  formTransaction.reset();
  transactionError.hidden = true;
  modalTransaction.showModal();
}

formTransaction.addEventListener('submit', async (e) => {
  e.preventDefault();
  transactionError.hidden = true;

  const amount = Number(formTransaction.amount.value);
  const description = formTransaction.description.value.trim();

  if (!amount || amount <= 0) {
    return showTransactionError('Merci de saisir un montant valide.');
  }
  if (!currentUser) {
    return showTransactionError('Session expirée, reconnecte-toi.');
  }
  if (pendingTransactionType === 'debit' && amount > userData.balance) {
    return showTransactionError('Le montant dépasse le solde disponible.');
  }

  btnConfirmTransaction.disabled = true;

  try {
    if (navigator.onLine) {
      await applyTransactionInFirestore(currentUser.uid, pendingTransactionType, amount, description);
    } else {
      await queueOfflineTransaction(pendingTransactionType, amount, description);
    }
    modalTransaction.close();
  } catch (err) {
    console.error('Erreur de transaction :', err);
    showTransactionError("L'opération a échoué. Réessaie.");
  } finally {
    btnConfirmTransaction.disabled = false;
  }
});

function showTransactionError(message) {
  transactionError.textContent = message;
  transactionError.hidden = false;
}

// ---------- Écriture Firestore transactionnelle ----------
async function applyTransactionInFirestore(uid, type, amount, description) {
  const userRef = doc(db, 'users', uid);
  const newTransactionRef = doc(collection(db, 'users', uid, 'transactions'));

  await runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists()) throw new Error('Profil utilisateur introuvable.');

    const currentBalance = userSnap.data().balance || 0;
    const balanceAfter = type === 'credit' ? currentBalance + amount : currentBalance - amount;

    if (type === 'debit' && balanceAfter < 0) {
      throw new Error('Solde insuffisant.');
    }

    tx.update(userRef, { balance: balanceAfter });
    tx.set(newTransactionRef, {
      type,
      amount,
      description: description || null,
      balanceAfter,
      createdAt: serverTimestamp(),
    });
  });
}

// ---------- Mode hors ligne ----------
async function queueOfflineTransaction(type, amount, description) {
  const optimisticBalanceAfter =
    type === 'credit' ? userData.balance + amount : userData.balance - amount;

  const entry = await addPendingAction('transaction', {
    type,
    amount,
    description: description || null,
  });

  // Mise à jour optimiste de l'affichage (le solde réel sera recalculé par
  // Firestore lors de la synchro, cette valeur n'est qu'indicative).
  userData.balance = optimisticBalanceAfter;
  renderBalance();

  loadedTransactions.unshift({
    id: entry.localId,
    type,
    amount,
    description,
    balanceAfter: optimisticBalanceAfter,
    createdAt: null,
    createdAtLocal: entry.createdAtLocal,
    isPending: true,
  });
  renderTransactionsList();
}

// ---------- Historique des transactions ----------
async function loadTransactionsFirstPage(uid) {
  transactionsLoadingEl.hidden = false;
  transactionsEmptyEl.hidden = true;
  lastVisibleDoc = null;
  hasMoreTransactions = true;

  try {
    const q = query(
      collection(db, 'users', uid, 'transactions'),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE)
    );
    const snap = await getDocs(q);
    loadedTransactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    lastVisibleDoc = snap.docs[snap.docs.length - 1] || null;
    hasMoreTransactions = snap.docs.length === PAGE_SIZE;

    // Réinjecte les transactions en attente de synchro (encore hors ligne)
    const pending = await getPendingActions('transaction');
    const pendingRows = pending.map((entry) => ({
      id: entry.localId,
      type: entry.payload.type,
      amount: entry.payload.amount,
      description: entry.payload.description,
      createdAt: null,
      createdAtLocal: entry.createdAtLocal,
      isPending: true,
    }));
    loadedTransactions = [...pendingRows, ...loadedTransactions];
  } catch (err) {
    console.error('Erreur de chargement des transactions :', err);
  } finally {
    transactionsLoadingEl.hidden = true;
    renderTransactionsList();
  }
}

async function loadMoreTransactions() {
  if (!currentUser || !lastVisibleDoc || !hasMoreTransactions) return;

  btnLoadMore.disabled = true;
  btnLoadMore.textContent = 'Chargement…';

  try {
    const q = query(
      collection(db, 'users', currentUser.uid, 'transactions'),
      orderBy('createdAt', 'desc'),
      startAfter(lastVisibleDoc),
      limit(PAGE_SIZE)
    );
    const snap = await getDocs(q);
    const newRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    loadedTransactions = [...loadedTransactions, ...newRows];
    lastVisibleDoc = snap.docs[snap.docs.length - 1] || lastVisibleDoc;
    hasMoreTransactions = snap.docs.length === PAGE_SIZE;
    renderTransactionsList();
  } catch (err) {
    console.error('Erreur de pagination des transactions :', err);
  } finally {
    btnLoadMore.disabled = false;
    btnLoadMore.textContent = 'Charger plus';
  }
}

btnLoadMore.addEventListener('click', loadMoreTransactions);

function renderTransactionsList() {
  if (loadedTransactions.length === 0) {
    transactionsListEl.innerHTML = '';
    transactionsEmptyEl.hidden = false;
    btnLoadMore.hidden = true;
    return;
  }

  transactionsEmptyEl.hidden = true;
  transactionsListEl.innerHTML = loadedTransactions.map(renderTransactionRow).join('');
  btnLoadMore.hidden = !hasMoreTransactions;
}

function renderTransactionRow(t) {
  const isCredit = t.type === 'credit';
  const sign = isCredit ? '+' : '−';
  const dateLabel = t.createdAt?.toDate
    ? t.createdAt.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : t.createdAtLocal
    ? new Date(t.createdAtLocal).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';

  return `
    <div class="transaction-row ${t.isPending ? 'is-pending' : ''}">
      <div class="transaction-info">
        <span class="transaction-description">
          ${escapeHtml(t.description || (isCredit ? 'Crédit' : 'Débit'))}
          ${t.isPending ? '<span class="pending-tag">En attente de synchro</span>' : ''}
        </span>
        <span class="transaction-date">${dateLabel}</span>
      </div>
      <span class="transaction-amount ${isCredit ? 'is-credit' : 'is-debit'}">
        ${sign} ${formatAmount(t.amount)}
      </span>
    </div>
  `;
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
