import { requireAppAccess, logout } from '/js/auth-guard.js';
import { db } from '/js/firebase-config.js';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const PAGE_NAME = 'dashboard';
const ACTIVITY_DAYS = 7; // nombre de jours affichés dans "Activité des 7 derniers jours"

// Devise affichée à l'écran pendant la session (bascule via les boutons "⇄",
// ne modifie jamais les données enregistrées ni le choix par défaut de Finances).
let viewCurrency = 'local';

async function init() {
  const session = await requireAppAccess();
  if (!session) return; // redirection ou paywall déjà géré par le garde

  const { user, userData } = session;

  viewCurrency = userData.displayCurrency === 'usd' ? 'usd' : 'local';

  fillUserInfo(user, userData);
  renderBalance(userData);
  renderSavings(userData);
  wireConvertButtons(userData);
  revealShell();
  wireLogoutButtons();

  // Le reste dépend de sous-collections : ne bloque pas l'affichage du shell.
  loadContractsSummary(user.uid);
  loadBalanceActivity(user.uid, userData);
}

/* --- Identité (nom, avatar, message de bienvenue) --- */
function fillUserInfo(user, userData) {
  const firstName = (userData.displayName || user.displayName || '').split(' ')[0];
  const greeting = document.getElementById('dashboardGreeting');
  if (greeting) {
    greeting.textContent = firstName ? `Bonjour, ${firstName}` : 'Bonjour';
  }

  const nameEl = document.getElementById('sidebarUserName');
  if (nameEl) {
    nameEl.textContent = userData.displayName || user.displayName || user.email || 'Mon compte';
  }

  const photoURL = userData.photoURL || user.photoURL;
  if (photoURL) {
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    const topbarAvatar = document.getElementById('topbarAvatar');
    [sidebarAvatar, topbarAvatar].forEach((el) => {
      if (!el) return;
      el.src = photoURL;
      el.alt = userData.displayName || user.displayName || 'Photo de profil';
      el.hidden = false;
    });
  }
}

/* --- Devise : les montants sont TOUJOURS stockés en devise locale.
   `viewCurrency` indique dans quelle devise les afficher ici. Elle démarre
   sur `displayCurrency` (réglé dans Finances) mais peut être basculée
   temporairement avec les boutons "⇄" sans rien enregistrer. --- */
function hasCurrencySetup(userData) {
  return !!(userData.currencySymbol && Number(userData.exchangeRate) > 0);
}

function toDisplayAmount(amountLocal, userData) {
  if (viewCurrency === 'usd') {
    const rate = Number(userData.exchangeRate || 0);
    return rate > 0 ? amountLocal / rate : 0;
  }
  return amountLocal;
}

function displaySymbol(userData) {
  return viewCurrency === 'usd' ? '$' : (userData.currencySymbol || '$');
}

/* --- Bouton(s) "⇄ Convertir" sur les cartes Solde et Objectif --- */
function wireConvertButtons(userData) {
  const btnBalance = document.getElementById('btnConvertBalance');
  const btnSavings = document.getElementById('btnConvertSavings');
  if (!btnBalance || !btnSavings) return;

  const ready = hasCurrencySetup(userData);
  btnBalance.disabled = !ready;
  btnSavings.disabled = !ready;
  btnBalance.title = ready
    ? "Convertir l'affichage"
    : "Configurez d'abord votre devise dans Finances pour activer la conversion.";
  btnSavings.title = btnBalance.title;

  const toggle = () => {
    if (!hasCurrencySetup(userData)) return;
    viewCurrency = viewCurrency === 'usd' ? 'local' : 'usd';
    renderBalance(userData);
    renderSavings(userData);
    updateConvertLabels(userData);
  };

  btnBalance.addEventListener('click', toggle);
  btnSavings.addEventListener('click', toggle);
  updateConvertLabels(userData);
}

function updateConvertLabels(userData) {
  const targetLabel = viewCurrency === 'usd'
    ? (userData.currencySymbol ? `Voir en ${userData.currencySymbol}` : 'Voir en devise locale')
    : 'Voir en $';
  const balanceLabelEl = document.getElementById('btnConvertBalanceLabel');
  const savingsLabelEl = document.getElementById('btnConvertSavingsLabel');
  if (balanceLabelEl) balanceLabelEl.textContent = targetLabel;
  if (savingsLabelEl) savingsLabelEl.textContent = targetLabel;
}

/* --- Solde actuel --- */
function renderBalance(userData) {
  const balance = typeof userData.balance === 'number' ? userData.balance : 0;
  document.getElementById('balanceValue').textContent =
    formatAmount(toDisplayAmount(balance, userData), displaySymbol(userData));
}

/* --- Objectif d'épargne + barre de progression ----------------------------
   FIX : avec Math.round(), un petit ajout face à un gros objectif (ex :
   100 FC sur un objectif de 11 250 000 FC) donnait 0 % à chaque fois — la
   barre semblait "ne jamais bouger" alors que le montant était bien
   enregistré. On garde désormais 2 décimales tant que le pourcentage est
   inférieur à 1 %, et on force une largeur minimale visible dès que
   current > 0, pour que toute progression, même infime, se voie. --------- */
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

function renderSavings(userData) {
  const goal = userData.savingsGoalAmount;
  const current = typeof userData.savingsCurrentAmount === 'number' ? userData.savingsCurrentAmount : 0;

  const amountsEl = document.getElementById('savingsAmounts');
  const fillEl = document.getElementById('savingsProgressFill');
  const hintEl = document.getElementById('savingsHint');

  if (!goal || goal <= 0) {
    amountsEl.textContent = '';
    fillEl.style.width = '0%';
    hintEl.textContent = "Aucun objectif défini pour l'instant. Configurez-en un dans Finances.";
    return;
  }

  const percent = computeSavingsPercent(current, goal);
  const symbol = displaySymbol(userData);
  amountsEl.textContent =
    `${formatAmount(toDisplayAmount(current, userData), symbol)} / ${formatAmount(toDisplayAmount(goal, userData), symbol)}`;
  fillEl.style.width = `${current > 0 ? Math.max(percent, 1) : 0}%`;
  hintEl.textContent = `${formatPercent(percent)}% de l'objectif atteint`;
}

/* --- Contrats : compte les statuts pending / signed --- */
async function loadContractsSummary(uid) {
  const pendingEl = document.getElementById('pendingContractsValue');
  const signedEl = document.getElementById('signedContractsValue');

  try {
    const contractsQuery = query(
      collection(db, 'contracts'),
      where('creatorId', '==', uid)
    );
    const snap = await getDocs(contractsQuery);

    let pending = 0;
    let signed = 0;

    snap.forEach((docSnap) => {
      const status = docSnap.data().status;
      if (status === 'pending') pending += 1;
      if (status === 'signed') signed += 1;
    });

    pendingEl.textContent = String(pending);
    signedEl.textContent = String(signed);
  } catch (err) {
    console.error('Erreur de chargement des contrats :', err);
    pendingEl.textContent = '—';
    signedEl.textContent = '—';
  }
}

/* --- Activité des 7 derniers jours (remplace l'ancien graphique) ----------
   Règle demandée : la liste commence au jour du tout premier mouvement de
   solde si le compte a moins de 7 jours d'historique (pas de jours "vides"
   avant la création du compte), sinon elle couvre les 7 derniers jours
   glissants. Le jour le plus récent (aujourd'hui) est affiché en dernier,
   en bas de la liste. --------------------------------------------------- */
async function loadBalanceActivity(uid, userData) {
  const listEl = document.getElementById('balanceActivityList');
  const emptyEl = document.getElementById('activityEmptyState');

  try {
    // 1) Le tout premier mouvement jamais enregistré pour ce compte.
    const firstTxQuery = query(
      collection(db, 'users', uid, 'transactions'),
      orderBy('createdAt', 'asc'),
      limit(1)
    );
    const firstTxSnap = await getDocs(firstTxQuery);

    if (firstTxSnap.empty) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      emptyEl.textContent = 'Pas encore de mouvement sur votre solde.';
      return;
    }

    const firstDate = toDate(firstTxSnap.docs[0].data().createdAt) || new Date();
    const firstKey = dayKey(firstDate);

    const todayKey = dayKey(new Date());
    const rollingStart = new Date();
    rollingStart.setDate(rollingStart.getDate() - (ACTIVITY_DAYS - 1));
    const rollingStartKey = dayKey(rollingStart);

    // On part du plus tardif des deux : soit le début de la fenêtre glissante
    // de 7 jours, soit le jour du premier mouvement (si le compte est récent).
    const windowStartKey = firstKey > rollingStartKey ? firstKey : rollingStartKey;
    const windowStart = new Date(`${windowStartKey}T00:00:00`);

    // 2) Les transactions de la fenêtre, pour calculer la variation nette par jour.
    const activityQuery = query(
      collection(db, 'users', uid, 'transactions'),
      where('createdAt', '>=', windowStart),
      orderBy('createdAt', 'asc')
    );
    const snap = await getDocs(activityQuery);

    const dailyNet = new Map(); // 'YYYY-MM-DD' -> variation nette du jour, en devise locale
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const date = toDate(data.createdAt);
      if (!date) return;
      const key = dayKey(date);
      const signedAmount = data.type === 'debit' ? -Math.abs(data.amount || 0) : Math.abs(data.amount || 0);
      dailyNet.set(key, (dailyNet.get(key) || 0) + signedAmount);
    });

    // 3) Construit la liste ordonnée du plus ancien (en haut) au plus récent (en bas).
    const days = [];
    const cursor = new Date(windowStart);
    while (dayKey(cursor) <= todayKey) {
      days.push(dayKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    emptyEl.hidden = true;
    listEl.innerHTML = days
      .map((key) => renderActivityRow(key, dailyNet.get(key) || 0, key === todayKey, userData))
      .join('');
  } catch (err) {
    console.error("Erreur de chargement de l'activité récente :", err);
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    emptyEl.textContent = "Impossible de charger l'activité récente pour le moment.";
  }
}

function renderActivityRow(key, netLocal, isToday, userData) {
  const d = new Date(`${key}T00:00:00`);
  const dateLabel = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const label = isToday ? `${dateLabel} (aujourd'hui)` : dateLabel;
  const symbol = displaySymbol(userData);

  let changeClass = 'balance-activity-row__change--flat';
  let changeText = 'Rien ajouté';

  if (netLocal > 0) {
    changeClass = 'balance-activity-row__change--up';
    changeText = `▲ +${formatAmount(toDisplayAmount(netLocal, userData), symbol)}`;
  } else if (netLocal < 0) {
    changeClass = 'balance-activity-row__change--down';
    changeText = `▼ -${formatAmount(toDisplayAmount(Math.abs(netLocal), userData), symbol)}`;
  }

  return `
    <div class="balance-activity-row${isToday ? ' balance-activity-row--today' : ''}">
      <span class="balance-activity-row__date">${label}</span>
      <span class="balance-activity-row__change ${changeClass}">${changeText}</span>
    </div>
  `;
}

/* --- Utilitaires --- */
function formatAmount(value, symbol) {
  return `${symbol} ${value.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

/* --- Affiche le shell une fois les données prêtes --- */
function revealShell() {
  document.getElementById('appLoading').hidden = true;
  const shell = document.getElementById('appShell');
  shell.hidden = false;
  markActiveNav();
}

/* --- Met en évidence le lien de navigation actif (sidebar + bottom nav) --- */
function markActiveNav() {
  document.querySelectorAll('[data-page]').forEach((link) => {
    const isActive = link.dataset.page === PAGE_NAME;
    link.classList.toggle('is-active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    }
  });
}

/* --- Bouton(s) de déconnexion --- */
function wireLogoutButtons() {
  const sidebarLogout = document.getElementById('sidebarLogout');
  if (sidebarLogout) {
    sidebarLogout.addEventListener('click', logout);
  }
}

init();
