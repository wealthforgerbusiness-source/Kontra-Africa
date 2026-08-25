import { requireAppAccess, logout } from '/js/auth-guard.js';
import { db } from '/js/firebase-config.js';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const PAGE_NAME = 'dashboard';
const CHART_DAYS = 14;

async function init() {
  const session = await requireAppAccess();
  if (!session) return; // redirection ou paywall déjà géré par le garde

  const { user, userData } = session;

  fillUserInfo(user, userData);
  renderBalance(userData);
  renderSavings(userData);
  revealShell();
  wireLogoutButtons();

  // Le reste dépend de sous-collections : ne bloque pas l'affichage du shell.
  loadContractsSummary(user.uid);
  loadBalanceChart(user.uid, userData);
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
   `displayCurrency` (réglé dans Finances) indique dans quelle devise les
   afficher ici (comme sur la page Finances). --- */
function toDisplayAmount(amountLocal, userData) {
  if (userData.displayCurrency === 'usd') {
    const rate = Number(userData.exchangeRate || 0);
    return rate > 0 ? amountLocal / rate : 0;
  }
  return amountLocal;
}

function displaySymbol(userData) {
  return userData.displayCurrency === 'usd' ? '$' : (userData.currencySymbol || '$');
}

/* --- Solde actuel --- */
function renderBalance(userData) {
  const balance = typeof userData.balance === 'number' ? userData.balance : 0;
  document.getElementById('balanceValue').textContent =
    formatAmount(toDisplayAmount(balance, userData), displaySymbol(userData));
}

/* --- Objectif d'épargne + barre de progression --- */
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

  // Le pourcentage se calcule toujours sur les montants en devise locale
  // (la conversion ne doit jamais fausser la progression réelle).
  const percent = Math.min(100, Math.round((current / goal) * 100));
  const symbol = displaySymbol(userData);
  amountsEl.textContent =
    `${formatAmount(toDisplayAmount(current, userData), symbol)} / ${formatAmount(toDisplayAmount(goal, userData), symbol)}`;
  fillEl.style.width = `${percent}%`;
  hintEl.textContent = `${percent}% de l'objectif atteint`;
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

/* --- Graphique d'évolution du solde sur 14 jours --- */
async function loadBalanceChart(uid, userData) {
  const canvas = document.getElementById('balanceChart');
  const emptyState = document.getElementById('chartEmptyState');

  // Filet de sécurité : si le script CDN de Chart.js n'a pas pu se charger
  // (CSP, bloqueur de contenu, panne réseau), window.Chart sera undefined.
  // On l'affiche clairement au lieu de laisser un ReferenceError silencieux
  // planter le rendu sans explication visible pour l'utilisateur.
  if (window.__chartLoadFailed || typeof Chart === 'undefined') {
    console.error('Chart.js indisponible : le script CDN n’a pas pu être chargé.');
    canvas.hidden = true;
    emptyState.hidden = false;
    emptyState.textContent = "Le graphique n'a pas pu se charger (bibliothèque indisponible). Réessaie de recharger la page.";
    return;
  }

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - CHART_DAYS);

    // FIX : le champ écrit par finances.js s'appelle "createdAt", pas "date".
    const transactionsQuery = query(
      collection(db, 'users', uid, 'transactions'),
      where('createdAt', '>=', cutoff),
      orderBy('createdAt', 'asc')
    );

    const snap = await getDocs(transactionsQuery);

    if (snap.empty) {
      canvas.hidden = true;
      emptyState.hidden = false;
      return;
    }

    // La série est construite en devise locale (calcul exact des variations
    // cumulées), puis convertie SEULEMENT pour l'affichage si l'utilisateur
    // a choisi d'afficher en USD — diviser par un taux constant ne change
    // jamais le sens de la courbe (elle monte/descend pareil), seulement
    // son échelle.
    const { labels, balances } = buildDailySeries(snap, userData, cutoff);
    const displayBalances = balances.map((b) => toDisplayAmount(b, userData));
    renderChart(canvas, labels, displayBalances, displaySymbol(userData));
  } catch (err) {
    console.error('Erreur de chargement du graphique :', err);
    canvas.hidden = true;
    emptyState.hidden = false;
    emptyState.textContent = "Impossible de charger l'évolution du solde pour le moment.";
  }
}

/* --- Construit une série quotidienne de solde cumulé à partir des transactions --- */
function buildDailySeries(transactionsSnap, userData, cutoff) {
  const dailyNet = new Map(); // 'YYYY-MM-DD' -> variation nette du jour

  transactionsSnap.forEach((docSnap) => {
    const data = docSnap.data();
    // FIX : le champ écrit par finances.js s'appelle "createdAt", pas "date".
    const date = toDate(data.createdAt);
    if (!date) return;

    const key = date.toISOString().slice(0, 10);
    // FIX : finances.js écrit type: 'credit' | 'debit', pas 'in' | 'out'.
    const signedAmount = data.type === 'debit' ? -Math.abs(data.amount || 0) : Math.abs(data.amount || 0);
    dailyNet.set(key, (dailyNet.get(key) || 0) + signedAmount);
  });

  // Le solde actuel est connu ; on remonte dans le temps pour reconstituer l'historique.
  const currentBalance = typeof userData.balance === 'number' ? userData.balance : 0;

  const days = [];
  for (let i = 0; i <= CHART_DAYS; i++) {
    const d = new Date(cutoff);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }

  // Somme totale des variations sur la période, pour repartir du solde de départ.
  let totalNetInPeriod = 0;
  dailyNet.forEach((value) => { totalNetInPeriod += value; });

  let runningBalance = currentBalance - totalNetInPeriod;
  const balances = [];
  const labels = [];

  days.forEach((key) => {
    runningBalance += dailyNet.get(key) || 0;
    balances.push(Math.round(runningBalance * 100) / 100);
    const d = new Date(key);
    labels.push(d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
  });

  return { labels, balances };
}

/* --- Rendu Chart.js --- */
function renderChart(canvas, labels, data, symbol) {
  const styles = getComputedStyle(document.documentElement);
  const primary = styles.getPropertyValue('--color-primary').trim();
  const textMuted = styles.getPropertyValue('--color-text-muted').trim();
  const border = styles.getPropertyValue('--color-border').trim();

  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: primary,
        backgroundColor: hexToRgba(primary, 0.1),
        borderWidth: 2,
        tension: 0.35,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: primary
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            label: (ctx) => `Solde : ${ctx.parsed.y} ${symbol || ''}`.trim()
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: textMuted, font: { family: 'Inter', size: 11 } }
        },
        y: {
          grid: { color: border },
          ticks: { color: textMuted, font: { family: 'Inter', size: 11 } }
        }
      }
    }
  });
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

function hexToRgba(hex, alpha) {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
