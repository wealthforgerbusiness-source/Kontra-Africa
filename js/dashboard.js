/* ==========================================================================
   Kontra-Africa — Tableau de bord
   ========================================================================== */

import { requireAppAccess, logout } from '/js/auth-guard.js';

const PAGE_NAME = 'dashboard';

async function init() {
  const session = await requireAppAccess();

  // Si null : redirection vers /login.html ou paywall déjà affiché par le garde.
  if (!session) return;

  const { user, userData } = session;

  fillUserInfo(user, userData);
  revealShell();
  wireLogoutButtons();
}

/* --- Remplit le nom, l'avatar et le message de bienvenue --- */
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
