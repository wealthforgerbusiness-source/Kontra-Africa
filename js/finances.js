import { db } from './firebase-config.js';
import { requireAppAccess } from './auth-guard.js';
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
import { renderAppNav } from './app-nav.js';

renderAppNav('finances'); // sidebar desktop + bottom nav mobile

const PAGE_SIZE = 20;

// ---------- État ----------
let currentUser = null;
let userData = {
  balance: 0,
  currencySymbol: '',
  exchangeRate: 0,
  exchangeRateUpdatedAt: null,
  displayCurrency: 'local',
  savingsGoalAmount: 0,
  savingsCurrentAmount: 0,
};
// Devise affichée à l'écran pendant la session (peut différer de
// userData.displayCurrency si l'utilisateur clique sur "⇄" sans enregistrer).
let viewCurrency = 'local';

let pendingTransactionType = 'credit';
let lastVisibleDoc = null;
let loadedTransactions = [];
let hasMoreTransactions = true;

// ---------- Éléments DOM ----------
const balanceAmountEl = document.getElementById('balance-amount');
const offlineBanner = document.getElementById('offline-banner');
const currencyGateBanner = document.getElementById('currency-gate-banner');

const btnCredit = document.getElementById('btn-credit');
const btnDebit = document.getElementById('btn-debit');
const btnConvertBalance = document.getElementById('btn-convert-balance');
const btnConvertBalanceLabel = document.getElementById('btn-convert-balance-label');
const btnConvertSavings = document.getElementById('btn-convert-savings');
const btnConvertSavingsLabel = document.getElementById('btn-convert-savings-label');

const modalTransaction = document.getElementById('modal-transaction');
const modalTransactionTitle = document.getElementById('modal-transaction-title');
const formTransaction = document.getElementById('form-transaction');
const transactionError = document.getElementById('transaction-error');
const btnConfirmTransaction = document.getElementById('btn-confirm-transaction');

const formSavingsGoal = document.getElementById('form-savings-goal');
const inputSavingsGoal = document.getElementById('input-savings-goal');
const savingsGoalSavedMsg = document.getElementById('savings-goal-saved-msg');

const savingsProgressFill = document.getElementById('savings-progress-fill');
const savingsProgressLabel = document.getElementById('savings-progress-label');
const savingsProgressRemaining = document.getElementById('savings-progress-remaining');

const inputSavingsAddAmount = document.getElementById('input-savings-add-amount');
const btnSavingsAdd = document.getElementById('btn-savings-add');
const btnSavingsWithdraw = document.getElementById('btn-savings-withdraw');
const savingsAddError = document.getElementById('savings-add-error');
const savingsAddMsg = document.getElementById('savings-add-msg');
const savingsAddCurrencyRadios = document.getElementsByName('addCurrency');

const formCurrency = document.getElementById('form-currency');
const inputCurrencySymbol = document.getElementById('input-currency-symbol');
const inputExchangeRate = document.getElementById('input-exchange-rate');
const exchangeRateUpdatedEl = document.getElementById('exchange-rate-updated');
const currencyError = document.getElementById('currency-error');
const currencySavedMsg = document.getElementById('currency-saved-msg');

const transactionsListEl = document.getElementById('transactions-list');
const transactionsLoadingEl = document.getElementById('transactions-loading');
const transactionsEmptyEl = document.getElementById('transactions-empty');
const btnLoadMore = document.getElementById('btn-load-more');

// État initial : on ne sait pas encore si la devise est configurée tant que
// Firestore n'a pas répondu, mais on n'affiche PLUS la bannière rouge par
// défaut à l'arrivée sur la page — elle n'apparaît que si l'utilisateur tente
// une action (créditer, débiter, ajouter à l'épargne, etc.) sans avoir
// configuré sa devise. Voir requireCurrencySetup().
renderCurrencyLabels();
renderConvertButtons();

// ---------- Auth + garde d'accès (paywall) ----------
async function init() {
  const session = await requireAppAccess();
  if (!session) return; // redirection vers /login.html ou paywall déjà affiché

  currentUser = session.user;
  listenToUserDoc(session.user.uid);
  loadTransactionsFirstPage(session.user.uid);
  trySyncPending(session.user.uid);
}

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
    const wasFirstLoad = !userData.currencySymbol && !userData.exchangeRate;

    userData = {
      balance: data.balance || 0,
      currencySymbol: data.currencySymbol || '',
      exchangeRate: data.exchangeRate || 0,
      exchangeRateUpdatedAt: data.exchangeRateUpdatedAt || null,
      displayCurrency: data.displayCurrency === 'usd' ? 'usd' : 'local',
      savingsGoalAmount: data.savingsGoalAmount || 0,
      savingsCurrentAmount: data.savingsCurrentAmount || 0,
    };

    // La vue suit la devise d'affichage enregistrée, sauf si l'utilisateur a
    // déjà basculé manuellement pendant cette session.
    if (wasFirstLoad) viewCurrency = userData.displayCurrency;

    renderBalance();
    renderSavings();
    renderCurrencyForm();
    renderCurrencyLabels();
    renderCurrencyGate();
    renderConvertButtons();
    renderTransactionsList(); // pour rafraîchir le symbole de devise affiché
  });
}

// ---------- Devise : lecture, conversion, verrouillage ----------
function hasCurrencySetup() {
  return !!(userData.currencySymbol && Number(userData.exchangeRate) > 0);
}

// Parse un montant saisi par l'utilisateur, en acceptant la virgule comme
// séparateur décimal (ex : "5000,50" ou "0,5") en plus du point.
function parseAmount(rawValue) {
  if (typeof rawValue !== 'string') return Number(rawValue) || 0;
  const normalized = rawValue.trim().replace(/\s/g, '').replace(',', '.');
  const value = Number(normalized);
  return isNaN(value) ? NaN : value;
}

// Convertit un montant saisi par l'utilisateur (dans la devise choisie dans
// le formulaire) vers la devise locale, qui est la devise de stockage.
function convertToLocal(amount, chosenCurrency) {
  if (chosenCurrency === 'usd') {
    return amount * Number(userData.exchangeRate || 0);
  }
  return amount;
}

// Convertit un montant stocké en devise locale vers la devise demandée,
// pour l'affichage uniquement (ne modifie jamais les données enregistrées).
function convertFromLocal(amountLocal, targetCurrency) {
  if (targetCurrency === 'usd') {
    const rate = Number(userData.exchangeRate || 0);
    return rate > 0 ? amountLocal / rate : 0;
  }
  return amountLocal;
}

function getCheckedCurrency(scopeEl, radioName) {
  const checked = scopeEl.querySelector(`input[name="${radioName}"]:checked`);
  return checked ? checked.value : 'local';
}

// Remplit dynamiquement les libellés "Devise locale" avec le symbole réel
// (ex : "FC (devise locale)") dans tous les sélecteurs de devise de la page.
function renderCurrencyLabels() {
  const label = userData.currencySymbol
    ? `${userData.currencySymbol} (devise locale)`
    : 'Devise locale';
  document.querySelectorAll('.currency-choice-local-label').forEach((el) => {
    el.textContent = label;
  });
}

// Met à jour le texte des boutons "⇄" (ils affichent la devise VERS
// laquelle on bascule, pas celle actuellement affichée).
function renderConvertButtons() {
  const ready = hasCurrencySetup();
  const targetLabel = viewCurrency === 'usd'
    ? (userData.currencySymbol ? `Voir en ${userData.currencySymbol}` : 'Voir en devise locale')
    : 'Voir en $';

  btnConvertBalanceLabel.textContent = targetLabel;
  btnConvertSavingsLabel.textContent = targetLabel;
  btnConvertBalance.disabled = !ready;
  btnConvertSavings.disabled = !ready;
}

// La bannière rouge ne s'affiche plus automatiquement à l'arrivée sur la
// page : les boutons (créditer/débiter/épargne) restent utilisables, et
// c'est seulement une tentative d'action sans devise configurée qui
// déclenche l'avertissement, via requireCurrencySetup() ci-dessous. Dès que
// la devise est configurée, on masque la bannière si jamais elle était
// affichée.
function renderCurrencyGate() {
  if (hasCurrencySetup()) {
    currencyGateBanner.hidden = true;
  }
}

// À appeler au début de toute action qui nécessite une devise configurée
// (créditer/débiter, ajouter/retirer de l'épargne, définir un objectif).
// Affiche la bannière uniquement si la devise n'est pas prête, et la
// masque sinon.
function requireCurrencySetup() {
  if (hasCurrencySetup()) {
    currencyGateBanner.hidden = true;
    return true;
  }
  currencyGateBanner.hidden = false;
  currencyGateBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return false;
}

// Formate un montant STOCKÉ EN DEVISE LOCALE pour l'affichage, en tenant
// compte de la devise de vue actuelle (locale ou USD).
function formatAmount(amountLocal) {
  const displayed = convertFromLocal(amountLocal, viewCurrency);
  if (viewCurrency === 'usd') {
    return `$ ${Number(displayed || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;
  }
  const symbol = userData.currencySymbol || '';
  const formatted = Number(displayed || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  return symbol ? `${formatted} ${symbol}` : formatted;
}

function renderBalance() {
  balanceAmountEl.textContent = formatAmount(userData.balance);
}

// FIX : avec Math.round(), un petit ajout face à un gros objectif (ex :
// 100 FC sur un objectif de 11 250 000 FC) donnait 0 % à chaque fois — la
// barre semblait "ne jamais bouger" alors que le montant était bien
// enregistré. On garde 2 décimales tant que le pourcentage est inférieur à
// 1 %, et on force une largeur minimale visible dès que current > 0.
function computeSavingsPercent(current, goal) {
  if (!goal || goal <= 0) return 0;
  const raw = (current / goal) * 100;
  if (raw <= 0) return 0;
  if (raw >= 100) return 100;
  if (raw < 1) return Math.round(raw * 100) / 100;
  return Math.round(raw);
}

function formatPercent(percent) {
  return Number.isInteger(percent) ? `${percent}` : `${percent.toFixed(2)}`;
}

function renderSavings() {
  if (document.activeElement !== inputSavingsGoal) {
    inputSavingsGoal.value = userData.savingsGoalAmount
      ? String(userData.savingsGoalAmount).replace('.', ',')
      : '';
  }

  const goal = Number(userData.savingsGoalAmount) || 0;
  const current = Number(userData.savingsCurrentAmount) || 0;
  const percent = computeSavingsPercent(current, goal);
  savingsProgressFill.style.width = `${current > 0 ? Math.max(percent, 1) : 0}%`;
  savingsProgressLabel.textContent = `${formatPercent(percent)}% — ${formatAmount(current)} / ${formatAmount(goal)}`;

  if (goal <= 0) {
    savingsProgressRemaining.textContent = "Définissez un montant objectif pour suivre votre progression.";
  } else if (current >= goal) {
    savingsProgressRemaining.textContent = '🎉 Objectif atteint !';
  } else {
    savingsProgressRemaining.textContent = `Il reste ${formatAmount(goal - current)} pour atteindre votre objectif.`;
  }
}

function renderCurrencyForm() {
  if (document.activeElement !== inputCurrencySymbol) {
    inputCurrencySymbol.value = userData.currencySymbol || '';
  }
  if (document.activeElement !== inputExchangeRate) {
    inputExchangeRate.value = userData.exchangeRate ? String(userData.exchangeRate).replace('.', ',') : '';
  }
  if (userData.exchangeRateUpdatedAt?.toDate) {
    exchangeRateUpdatedEl.textContent = `Mis à jour le ${userData.exchangeRateUpdatedAt.toDate().toLocaleDateString('fr-FR')}`;
  } else {
    exchangeRateUpdatedEl.textContent = '';
  }
  const displayRadio = formCurrency.querySelector(`input[name="displayCurrency"][value="${userData.displayCurrency}"]`);
  if (displayRadio) displayRadio.checked = true;
}

// ---------- Boutons "⇄ Convertir" (aperçu de session, rien n'est enregistré) ----------
function toggleViewCurrency() {
  if (!hasCurrencySetup()) return;
  viewCurrency = viewCurrency === 'usd' ? 'local' : 'usd';
  renderBalance();
  renderSavings();
  renderConvertButtons();
  renderTransactionsList();
}
btnConvertBalance.addEventListener('click', toggleViewCurrency);
btnConvertSavings.addEventListener('click', toggleViewCurrency);

// ---------- Formulaire devise (obligatoire avant tout le reste) ----------
formCurrency.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  currencyError.hidden = true;

  const currencySymbol = inputCurrencySymbol.value.trim();
  const exchangeRate = parseAmount(inputExchangeRate.value);
  const displayCurrency = getCheckedCurrency(formCurrency, 'displayCurrency');

  if (!currencySymbol) {
    currencyError.textContent = 'Merci de saisir le symbole de votre devise locale (ex : FC).';
    currencyError.hidden = false;
    return;
  }
  if (!exchangeRate || isNaN(exchangeRate) || exchangeRate <= 0) {
    currencyError.textContent = 'Merci de saisir un taux de change valide (valeur de 1 USD dans votre devise).';
    currencyError.hidden = false;
    return;
  }

  try {
    await updateDoc(doc(db, 'users', currentUser.uid), {
      currencySymbol,
      exchangeRate,
      exchangeRateUpdatedAt: serverTimestamp(),
      displayCurrency,
    });
    viewCurrency = displayCurrency; // la session suit immédiatement le nouveau choix
    flashSavedMessage(currencySavedMsg);
  } catch (err) {
    console.error('Erreur de sauvegarde de la devise :', err);
    currencyError.textContent = "L'enregistrement a échoué. Réessaie.";
    currencyError.hidden = false;
  }
});

// ---------- Formulaire objectif d'épargne (montant cible) ----------
formSavingsGoal.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  if (!requireCurrencySetup()) return;

  const rawAmount = parseAmount(inputSavingsGoal.value);
  if (isNaN(rawAmount) || rawAmount < 0) return;

  const chosenCurrency = getCheckedCurrency(formSavingsGoal, 'goalCurrency');
  const savingsGoalAmount = convertToLocal(rawAmount, chosenCurrency);

  try {
    await updateDoc(doc(db, 'users', currentUser.uid), { savingsGoalAmount });
    flashSavedMessage(savingsGoalSavedMsg);
  } catch (err) {
    console.error('Erreur de sauvegarde de l’objectif d’épargne :', err);
  }
});

// ---------- Ajout / retrait sur l'épargne ----------
btnSavingsAdd.addEventListener('click', () => handleSavingsOperation('add'));
btnSavingsWithdraw.addEventListener('click', () => handleSavingsOperation('withdraw'));

async function handleSavingsOperation(operation) {
  savingsAddError.hidden = true;
  savingsAddMsg.hidden = true;

  if (!currentUser) return;
  if (!requireCurrencySetup()) {
    savingsAddError.textContent = "Configurez d'abord votre devise avant de modifier votre épargne.";
    savingsAddError.hidden = false;
    return;
  }

  const rawAmount = parseAmount(inputSavingsAddAmount.value);
  if (!rawAmount || isNaN(rawAmount) || rawAmount <= 0) {
    savingsAddError.textContent = 'Merci de saisir un montant valide.';
    savingsAddError.hidden = false;
    return;
  }

  let chosenCurrency = 'local';
  savingsAddCurrencyRadios.forEach((radio) => {
    if (radio.checked) chosenCurrency = radio.value;
  });

  const amount = convertToLocal(rawAmount, chosenCurrency);
  const goal = Number(userData.savingsGoalAmount) || 0;
  const currentAmount = Number(userData.savingsCurrentAmount) || 0;

  if (operation === 'withdraw' && amount > currentAmount) {
    savingsAddError.textContent = 'Le montant dépasse votre épargne actuelle.';
    savingsAddError.hidden = false;
    return;
  }

  const newCurrent = operation === 'withdraw'
    ? Math.max(0, currentAmount - amount)
    : currentAmount + amount;

  try {
    await updateDoc(doc(db, 'users', currentUser.uid), { savingsCurrentAmount: newCurrent });

    if (operation === 'add') {
      if (goal > 0 && newCurrent >= goal) {
        savingsAddMsg.textContent = `🎉 Objectif atteint ! Vous avez épargné ${formatAmount(newCurrent)}.`;
      } else if (goal > 0) {
        savingsAddMsg.textContent = `Ajouté ! Il reste ${formatAmount(goal - newCurrent)} pour atteindre votre objectif.`;
      } else {
        savingsAddMsg.textContent = `Ajouté ! Épargne actuelle : ${formatAmount(newCurrent)}.`;
      }
    } else {
      savingsAddMsg.textContent = goal > 0 && newCurrent < goal
        ? `Retiré ! Il reste ${formatAmount(goal - newCurrent)} pour atteindre votre objectif.`
        : `Retiré ! Épargne actuelle : ${formatAmount(newCurrent)}.`;
    }

    savingsAddMsg.hidden = false;
    inputSavingsAddAmount.value = '';
    setTimeout(() => (savingsAddMsg.hidden = true), 4000);
  } catch (err) {
    console.error('Erreur sur l’épargne :', err);
    savingsAddError.textContent = "L'opération a échoué. Réessaie.";
    savingsAddError.hidden = false;
  }
}

function flashSavedMessage(el) {
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 2000);
}

// ---------- Modale créditer / débiter ----------
btnCredit.addEventListener('click', () => openTransactionModal('credit'));
btnDebit.addEventListener('click', () => openTransactionModal('debit'));
document.querySelectorAll('[data-action="close-transaction-modal"]').forEach((btn) => {
  btn.addEventListener('click', () => modalTransaction.close());
});

function openTransactionModal(type) {
  if (!requireCurrencySetup()) return; // affiche la bannière si la devise n'est pas configurée
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

  if (!requireCurrencySetup()) {
    return showTransactionError("Configurez d'abord votre devise avant de faire une opération.");
  }

  const rawAmount = parseAmount(formTransaction.amount.value);
  const description = formTransaction.description.value.trim();
  const chosenCurrency = getCheckedCurrency(formTransaction, 'amountCurrency');

  if (!rawAmount || isNaN(rawAmount) || rawAmount <= 0) {
    return showTransactionError('Merci de saisir un montant valide.');
  }
  if (!currentUser) {
    return showTransactionError('Session expirée, reconnecte-toi.');
  }

  const amount = convertToLocal(rawAmount, chosenCurrency);

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

init();
