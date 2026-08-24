// js/contracts.js
// Module Contrats — vue créateur (protégée par auth-guard.js)
//
// Hypothèses sur firebase-config.js : il exporte `auth` (Firebase Auth) et
// `db` (Firestore) via `export { auth, db }`. Adapte les imports ci-dessous
// si tes noms d'export diffèrent.

import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { renderAppNav } from './app-nav.js';

renderAppNav('contrats'); // sidebar desktop + bottom nav mobile

const API_BASE = ''; // même origine que le frontend (Render), ex: '' si servi sous le même domaine

// ---------- État ----------
let currentUser = null;
let currentFilter = 'all';
let unsubscribeContracts = null;
let allContracts = [];
let signaturePad = null;

// ---------- Éléments DOM ----------
const listEl = document.getElementById('contracts-list');
const loadingEl = document.getElementById('contracts-loading');
const emptyEl = document.getElementById('contracts-empty');
const offlineBanner = document.getElementById('offline-banner');

const modalNew = document.getElementById('modal-new-contract');
const formNew = document.getElementById('form-new-contract');
const formError = document.getElementById('form-error');
const btnSubmit = document.getElementById('btn-submit-contract');

const modalShare = document.getElementById('modal-share');
const linkWhatsapp = document.getElementById('link-whatsapp-share');
const inputShareLink = document.getElementById('input-share-link');
const btnCopyLink = document.getElementById('btn-copy-link');

// ---------- Auth ----------
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    listenToContracts(user.uid);
  } else if (unsubscribeContracts) {
    unsubscribeContracts();
  }
});

// ---------- Hors ligne (indicateur simple ; la file de synchro complète
// arrive avec le Service Worker, tâche #4) ----------
function updateOnlineStatus() {
  offlineBanner.hidden = navigator.onLine;
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// ---------- Liste en temps réel ----------
function listenToContracts(uid) {
  const q = query(
    collection(db, 'contracts'),
    where('creatorId', '==', uid),
    orderBy('createdAt', 'desc')
  );

  unsubscribeContracts = onSnapshot(
    q,
    (snapshot) => {
      allContracts = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderList();
    },
    (error) => {
      console.error('Erreur de lecture des contrats :', error);
      loadingEl.textContent = "Impossible de charger les contrats. Vérifie ta connexion.";
    }
  );
}

function renderList() {
  loadingEl.hidden = true;

  const filtered =
    currentFilter === 'all'
      ? allContracts
      : allContracts.filter((c) => c.status === currentFilter);

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
  listEl.innerHTML = filtered.map(renderCard).join('');

  // Brancher les actions de chaque carte
  listEl.querySelectorAll('[data-action="copy-share-link"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = buildShareUrl(btn.dataset.token);
      navigator.clipboard.writeText(url);
      btn.textContent = 'Copié !';
      setTimeout(() => (btn.textContent = 'Copier le lien'), 1500);
    });
  });
}

function renderCard(contract) {
  const statusLabels = {
    draft: 'Brouillon',
    pending: 'En attente de signature',
    signed: 'Signé',
    rejected: 'Refusé',
  };

  const createdDate = contract.createdAt?.toDate
    ? contract.createdAt.toDate().toLocaleDateString('fr-FR')
    : '';

  let actions = '';
  if (contract.status === 'pending') {
    actions = `
      <a class="btn btn-sm btn-whatsapp" style="margin:0;" target="_blank" rel="noopener"
         href="${buildWhatsAppUrl(contract)}">Renvoyer sur WhatsApp</a>
      <button class="btn btn-sm btn-secondary" data-action="copy-share-link" data-token="${escapeHtml(contract.shareToken || '')}">
        Copier le lien
      </button>`;
  } else if (contract.status === 'signed') {
    actions = `
      ${contract.pdfUrlCreator ? `<a class="btn btn-sm btn-secondary" href="${contract.pdfUrlCreator}" target="_blank" rel="noopener">Voir le PDF</a>` : ''}
    `;
  }

  return `
    <article class="contract-card">
      <div class="contract-card-top">
        <div>
          <h3 class="contract-title">${escapeHtml(contract.title)}</h3>
          <p class="contract-signer">Signataire : ${escapeHtml(contract.signerName)}</p>
        </div>
        <span class="status-badge status-${contract.status}">${statusLabels[contract.status] || contract.status}</span>
      </div>
      <div class="contract-meta">
        <span>Créé le ${createdDate}</span>
      </div>
      <div class="contract-actions">${actions}</div>
    </article>
  `;
}

function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- Filtres ----------
document.querySelectorAll('.status-filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.status-filter').forEach((b) => {
      b.classList.remove('is-active');
      b.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('is-active');
    btn.setAttribute('aria-selected', 'true');
    currentFilter = btn.dataset.status;
    renderList();
  });
});

// ---------- Modale nouveau contrat ----------
document.getElementById('btn-new-contract').addEventListener('click', openNewContractModal);
document.getElementById('contracts-empty').addEventListener('click', (e) => {
  if (e.target.dataset.action === 'open-new-contract') openNewContractModal();
});

function openNewContractModal() {
  formNew.reset();
  formError.hidden = true;
  modalNew.showModal();
  initSignaturePad();
}

document.querySelectorAll('[data-action="close-modal"]').forEach((btn) => {
  btn.addEventListener('click', () => modalNew.close());
});
document.querySelectorAll('[data-action="close-share-modal"]').forEach((btn) => {
  btn.addEventListener('click', () => modalShare.close());
});

// ---------- Signature (canvas) ----------
function initSignaturePad() {
  const canvas = document.getElementById('signature-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#2A2140';

  let drawing = false;
  let hasStroke = false;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const point = e.touches ? e.touches[0] : e;
    return {
      x: (point.clientX - rect.left) * scaleX,
      y: (point.clientY - rect.top) * scaleY,
    };
  }

  function start(e) {
    drawing = true;
    hasStroke = true;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.preventDefault();
  }

  function move(e) {
    if (!drawing) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    e.preventDefault();
  }

  function end() {
    drawing = false;
  }

  canvas.onmousedown = start;
  canvas.onmousemove = move;
  window.onmouseup = end;
  canvas.ontouchstart = start;
  canvas.ontouchmove = move;
  canvas.ontouchend = end;

  document.getElementById('btn-clear-signature').onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStroke = false;
  };

  signaturePad = {
    canvas,
    isEmpty: () => !hasStroke,
    toDataURL: () => canvas.toDataURL('image/png'),
  };
}

// ---------- Soumission du formulaire ----------
formNew.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const title = formNew.title.value.trim();
  const content = formNew.content.value.trim();
  const signerName = formNew.signerName.value.trim();
  const signerPhone = formNew.signerPhone.value.trim();
  const typedName = formNew.creatorTypedName.value.trim();

  if (!title || !content || !signerName || !signerPhone) {
    return showFormError('Merci de remplir tous les champs obligatoires.');
  }
  if (signaturePad.isEmpty() && !typedName) {
    return showFormError('Ajoute ta signature (dessin ou nom tapé) pour continuer.');
  }
  if (!currentUser) {
    return showFormError('Session expirée, reconnecte-toi.');
  }

  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Création…';

  try {
    const shareToken = generateShareToken();
    const creatorSignatureDataUrl = signaturePad.isEmpty() ? null : signaturePad.toDataURL();

    const docRef = await addDoc(collection(db, 'contracts'), {
      creatorId: currentUser.uid,
      creatorName: currentUser.displayName || currentUser.email || 'Créateur',
      title,
      content,
      signerName,
      signerPhone: normalizePhone(signerPhone),
      shareToken,
      status: 'pending',
      termsAcceptedBySigner: false,
      creatorSignedAt: serverTimestamp(),
      signerSignedAt: null,
      creatorSignatureDataUrl: creatorSignatureDataUrl,
      creatorTypedName: typedName || null,
      pdfUrlCreator: null,
      pdfUrlSigner: null,
      createdAt: serverTimestamp(),
    });

    modalNew.close();
    openShareModal({ id: docRef.id, title, signerName, signerPhone, shareToken });
  } catch (err) {
    console.error('Erreur de création du contrat :', err);
    showFormError("La création a échoué. Vérifie ta connexion et réessaie.");
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Signer et créer le lien';
  }
});

function showFormError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

function generateShareToken() {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

function normalizePhone(phone) {
  return phone.replace(/[^\d+]/g, '');
}

function buildShareUrl(token) {
  return `${window.location.origin}/sign.html?token=${encodeURIComponent(token)}`;
}

function buildWhatsAppUrl(contract) {
  const url = buildShareUrl(contract.shareToken);
  const message = `Bonjour ${contract.signerName}, voici le contrat "${contract.title}" à signer sur Kontra-Africa : ${url}`;
  const phone = (contract.signerPhone || '').replace(/[^\d]/g, '');
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function openShareModal(contract) {
  linkWhatsapp.href = buildWhatsAppUrl(contract);
  inputShareLink.value = buildShareUrl(contract.shareToken);
  modalShare.showModal();
}

btnCopyLink.addEventListener('click', () => {
  inputShareLink.select();
  navigator.clipboard.writeText(inputShareLink.value);
  btnCopyLink.textContent = 'Copié !';
  setTimeout(() => (btnCopyLink.textContent = 'Copier'), 1500);
});
