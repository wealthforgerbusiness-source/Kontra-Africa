import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { logout } from './auth-guard.js';

/* IMPORTANT : ces chemins doivent correspondre EXACTEMENT aux noms de
   fichiers réels sur GitHub (sensible à la casse et à l'orthographe).
   Le bug précédent venait d'un lien vers /contrats.html alors que le
   fichier s'appelle contracts.html. */
const NAV_ITEMS = [
  {
    page: 'dashboard',
    href: '/dashboard.html',
    label: 'Tableau de bord',
    icon: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'
  },
  {
    page: 'contrats',
    href: '/contracts.html',
    label: 'Contrats',
    icon: '<path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>'
  },
  {
    page: 'finances',
    href: '/finances.html',
    label: 'Finances',
    icon: '<path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3H3Z"/><path d="M3 9v9a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H3Z"/><circle cx="16.5" cy="14" r="1.2" fill="currentColor" stroke="none"/>'
  },
  {
    page: 'profil',
    href: '/profil.html',
    label: 'Profil',
    icon: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>'
  }
];

function navLinksHTML(activePage, linkClass) {
  return NAV_ITEMS.map((item) => {
    const isActive = item.page === activePage;
    return `
      <a href="${item.href}" class="${linkClass}${isActive ? ' is-active' : ''}" data-page="${item.page}"${isActive ? ' aria-current="page"' : ''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${item.icon}</svg>
        <span>${item.label}</span>
      </a>`;
  }).join('');
}

function renderSidebar(activePage) {
  const sidebar = document.getElementById('app-sidebar');
  if (!sidebar) return;

  sidebar.innerHTML = `
    <a href="/" class="app-sidebar__brand">
      <img src="/logo.webp" alt="Kontra-Africa" class="app-sidebar__logo">
      <span class="app-sidebar__brand-text">Kontra-Africa</span>
    </a>
    <div class="app-nav">
      ${navLinksHTML(activePage, 'app-nav__link')}
    </div>
    <div class="app-sidebar__user" id="sidebarUser">
      <img src="" alt="" class="app-sidebar__avatar" id="sidebarAvatar" hidden>
      <div class="app-sidebar__user-info">
        <p class="app-sidebar__user-name" id="sidebarUserName">—</p>
        <button type="button" class="app-sidebar__logout" id="sidebarLogout">Se déconnecter</button>
      </div>
    </div>
  `;

  document.getElementById('sidebarLogout')?.addEventListener('click', logout);
}

function renderBottomNav(activePage) {
  // Si une bottom nav existe déjà sur la page (cas de dashboard.html, qui la
  // code en dur), on ne la duplique pas.
  if (document.querySelector('.app-bottomnav')) return;

  const nav = document.createElement('nav');
  nav.className = 'app-bottomnav';
  nav.setAttribute('aria-label', "Navigation de l'application");
  nav.innerHTML = navLinksHTML(activePage, 'app-bottomnav__link');
  document.body.appendChild(nav);
}

function fillUserInfo(user, userData) {
  const nameEl = document.getElementById('sidebarUserName');
  if (nameEl) {
    nameEl.textContent = (userData && userData.displayName) || user.displayName || user.email || 'Mon compte';
  }

  const photoURL = (userData && userData.photoURL) || user.photoURL;
  if (photoURL) {
    const avatar = document.getElementById('sidebarAvatar');
    if (avatar) {
      avatar.src = photoURL;
      avatar.alt = (userData && userData.displayName) || user.displayName || 'Photo de profil';
      avatar.hidden = false;
    }
  }
}

/* --- Point d'entrée : à appeler une fois, en haut du script de la page --- */
export function renderAppNav(activePage) {
  renderSidebar(activePage);
  renderBottomNav(activePage);

  onAuthStateChanged(auth, async (user) => {
    if (!user) return; // la redirection vers /login.html est gérée ailleurs
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      fillUserInfo(user, snap.exists() ? snap.data() : null);
    } catch (err) {
      console.error('app-nav : impossible de charger le profil utilisateur :', err);
      fillUserInfo(user, null);
    }
  });
}
