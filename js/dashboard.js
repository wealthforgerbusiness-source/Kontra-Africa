/* ==========================================================================
   Kontra-Africa — Tableau de bord
   ------------------------------------------------------------------------
   Schéma Firestore attendu (utilisé aussi par les modules Contrats/Finances
   à venir, garder ce commentaire synchronisé si le schéma évolue) :

   users/{uid}
     - displayName, photoURL, subscriptionStatus, trialEndDate  (déjà utilisés)
     - balance              : number   (solde actuel)
     - currencySymbol       : string   (ex: "$", "FC")
     - savingsGoalAmount    : number   (objectif d'épargne, optionnel)
     - savingsCurrentAmount : number   (épargne actuelle, optionnel)

   contracts/{contractId}
     - creatorId : string    (uid du créateur — filtré via where('creatorId', '==', uid))
     - status    : 'draft' | 'pending' | 'signed' | 'rejected'
     - createdAt : Timestamp

   users/{uid}/transactions/{transactionId}
     - amount : number
     - type   : 'in' | 'out'
     - date   : Timestamp
   ========================================================================== */

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

/* --- Solde actuel --- */
function renderBalance(userData) {
  const symbol = userData.currencySymbol || '$';
  const balance = typeof userData.balance === 'number' ? userData.balance : 0;
  document.getElementById('balanceValue').textContent = formatAmount(balance, symbol);
}

/* --- Objectif d'épargne + barre de progression --- */
function renderSavings(userData) {
  const symbol = userData.currencySymbol || '$';
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

  const percent = Math.min(100, Math.round((current / goal) * 100));
  amountsEl.textContent = `${formatAmount(current, symbol)} / ${formatAmount(goal, symbol)}`;
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

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - CHART_DAYS);

    const transactionsQuery = query(
      collection(db, 'users', uid, 'transactions'),
      where('date', '>=', cutoff),
      orderBy('date', 'asc')
    );

    const snap = await getDocs(transactionsQuery);

    if (snap.empty) {
      canvas.hidden = true;
      emptyState.hidden = false;
      return;
    }

    const { labels, balances } = buildDailySeries(snap, userData, cutoff);
    renderChart(canvas, labels, balances);
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
    const date = toDate(data.date);
    if (!date) return;

    const key = date.toISOString().slice(0, 10);
    const signedAmount = data.type === 'out' ? -Math.abs(data.amount || 0) : Math.abs(data.amount || 0);
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
function renderChart(canvas, labels, data) {
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
            label: (ctx) => `Solde : ${ctx.parsed.y}`
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
