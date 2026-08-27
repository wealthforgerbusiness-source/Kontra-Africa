// js/contracts.js
// Module Contrats — vue créateur

import { db } from './firebase-config.js';
import { requireAppAccess } from './auth-guard.js';

import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  waitForPendingWrites,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

import { renderAppNav } from './app-nav.js';

renderAppNav('contrats');

const API_BASE = 'https://kontra-africa.onrender.com';

let currentUser = null;
let currentFilter = 'all';
let unsubscribeContracts = null;
let allContracts = [];
let signaturePad = null;

const listEl = document.getElementById('contracts-list');
const loadingEl = document.getElementById('contracts-loading');
const emptyEl = document.getElementById('contracts-empty');
const offlineBanner = document.getElementById('offline-banner');

const modalNew = document.getElementById('modal-new-contract');
const formNew = document.getElementById('form-new-contract');
const formError = document.getElementById('form-error');
const btnSubmit = document.getElementById('btn-submit-contract');

const modalShare = document.getElementById('modal-share');
const inputShareLink = document.getElementById('input-share-link');
const btnCopyLink = document.getElementById('btn-copy-link');
const btnShareWhatsapp = document.getElementById('btn-share-whatsapp');

async function init() {
  const session = await requireAppAccess();

  if (!session) return;

  currentUser = session.user;
  listenToContracts(currentUser.uid);
}

init();

function updateOnlineStatus() {
  if (offlineBanner) {
    offlineBanner.hidden = navigator.onLine;
  }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

updateOnlineStatus();

function listenToContracts(uid) {
  const q = query(
    collection(db, 'contracts'),
    where('creatorId', '==', uid),
    orderBy('createdAt', 'desc')
  );

  unsubscribeContracts = onSnapshot(
    q,
    (snapshot) => {
      allContracts = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      renderList();
    },
    (error) => {
      console.error('Erreur de lecture des contrats :', error);

      if (loadingEl) {
        loadingEl.textContent =
          'Impossible de charger les contrats. Vérifie ta connexion.';
      }
    }
  );
}

function renderList() {
  if (loadingEl) {
    loadingEl.hidden = true;
  }

  const filtered =
    currentFilter === 'all'
      ? allContracts
      : allContracts.filter(
          (contract) => contract.status === currentFilter
        );

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;

  listEl.innerHTML = filtered
    .map(renderCard)
    .join('');

  listEl
    .querySelectorAll('[data-action="copy-share-link"]')
    .forEach((button) => {
      button.addEventListener('click', async () => {
        const url = buildShareUrl(button.dataset.token);

        try {
          await navigator.clipboard.writeText(url);

          button.textContent = 'Copié !';

          setTimeout(() => {
            button.textContent = 'Copier le lien';
          }, 1500);
        } catch (error) {
          console.error(
            'Erreur lors de la copie :',
            error
          );
        }
      });
    });

  listEl
    .querySelectorAll('[data-action="whatsapp-share"]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        openWhatsAppShare({
          shareToken: button.dataset.token,
          title: button.dataset.title || 'Contrat',
        });
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

  const createdDate =
    contract.createdAt?.toDate
      ? contract.createdAt
          .toDate()
          .toLocaleDateString('fr-FR')
      : '';

  let actions = '';

  if (contract.status === 'pending') {
    actions = `
      <button
        type="button"
        class="btn btn-sm btn-whatsapp"
        data-action="whatsapp-share"
        data-token="${escapeHtml(
          contract.shareToken || ''
        )}"
        data-title="${escapeHtml(
          contract.title || 'Contrat'
        )}"
      >
        Renvoyer sur WhatsApp
      </button>

      <button
        type="button"
        class="btn btn-sm btn-secondary"
        data-action="copy-share-link"
        data-token="${escapeHtml(
          contract.shareToken || ''
        )}"
      >
        Copier le lien
      </button>
    `;
  }

  if (contract.status === 'signed') {
    actions = `
      <a
        class="btn btn-sm btn-secondary"
        href="${API_BASE}/api/contracts/public/${encodeURIComponent(
          contract.shareToken || ''
        )}/pdf"
        target="_blank"
        rel="noopener"
      >
        Télécharger le PDF
      </a>
    `;
  }

  return `
    <article class="contract-card">

      <div class="contract-card-top">

        <div>

          <h3 class="contract-title">
            ${escapeHtml(contract.title || '')}
          </h3>

          <p class="contract-signer">
            Signataire :
            ${escapeHtml(contract.signerName || '')}
          </p>

          <p class="contract-creator">
            Créé par :
            ${escapeHtml(contract.creatorName || '')}
          </p>

        </div>

        <span
          class="status-badge status-${escapeHtml(
            contract.status || ''
          )}"
        >
          ${
            statusLabels[contract.status] ||
            escapeHtml(contract.status || '')
          }
        </span>

      </div>

      <div class="contract-meta">
        <span>
          Créé le ${createdDate}
        </span>
      </div>

      <div class="contract-actions">
        ${actions}
      </div>

    </article>
  `;
}

function escapeHtml(value = '') {
  return String(value).replace(
    /[&<>"']/g,
    (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[character])
  );
}

document
  .querySelectorAll('.status-filter')
  .forEach((button) => {
    button.addEventListener('click', () => {
      document
        .querySelectorAll('.status-filter')
        .forEach((item) => {
          item.classList.remove('is-active');
          item.setAttribute(
            'aria-selected',
            'false'
          );
        });

      button.classList.add('is-active');
      button.setAttribute(
        'aria-selected',
        'true'
      );

      currentFilter = button.dataset.status;

      renderList();
    });
  });

document
  .getElementById('btn-new-contract')
  .addEventListener(
    'click',
    openNewContractModal
  );

document
  .getElementById('contracts-empty')
  .addEventListener('click', (event) => {
    if (
      event.target.dataset.action ===
      'open-new-contract'
    ) {
      openNewContractModal();
    }
  });

function openNewContractModal() {
  formNew.reset();

  formError.hidden = true;

  modalNew.showModal();

  initSignaturePad();
}

document
  .querySelectorAll(
    '[data-action="close-modal"]'
  )
  .forEach((button) => {
    button.addEventListener('click', () => {
      modalNew.close();
    });
  });

document
  .querySelectorAll(
    '[data-action="close-share-modal"]'
  )
  .forEach((button) => {
    button.addEventListener('click', () => {
      modalShare.close();
    });
  });

function initSignaturePad() {
  const canvas =
    document.getElementById(
      'signature-canvas'
    );

  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  if (!ctx) return;

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#2A2140';

  let drawing = false;
  let hasStroke = false;

  function getPosition(event) {
    const rect =
      canvas.getBoundingClientRect();

    const scaleX =
      canvas.width / rect.width;

    const scaleY =
      canvas.height / rect.height;

    const point =
      event.touches &&
      event.touches.length
        ? event.touches[0]
        : event;

    return {
      x:
        (point.clientX - rect.left) *
        scaleX,

      y:
        (point.clientY - rect.top) *
        scaleY,
    };
  }

  function startDrawing(event) {
    drawing = true;
    hasStroke = true;

    const point =
      getPosition(event);

    ctx.beginPath();

    ctx.moveTo(
      point.x,
      point.y
    );

    event.preventDefault();
  }

  function draw(event) {
    if (!drawing) return;

    const point =
      getPosition(event);

    ctx.lineTo(
      point.x,
      point.y
    );

    ctx.stroke();

    event.preventDefault();
  }

  function stopDrawing() {
    drawing = false;
  }

  canvas.onmousedown =
    startDrawing;

  canvas.onmousemove =
    draw;

  canvas.onmouseleave =
    stopDrawing;

  window.onmouseup =
    stopDrawing;

  canvas.ontouchstart =
    startDrawing;

  canvas.ontouchmove =
    draw;

  canvas.ontouchend =
    stopDrawing;

  canvas.ontouchcancel =
    stopDrawing;

  const clearButton =
    document.getElementById(
      'btn-clear-signature'
    );

  if (clearButton) {
    clearButton.onclick = () => {
      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );

      hasStroke = false;
    };
  }

  signaturePad = {
    isEmpty: () => !hasStroke,

    toDataURL: () =>
      canvas.toDataURL(
        'image/png'
      ),
  };
}

formNew.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    formError.hidden = true;

    const title =
      formNew.title.value.trim();

    const content =
      formNew.content.value.trim();

    const signerName =
      formNew.signerName.value.trim();

    const creatorName =
      formNew.creatorTypedName.value.trim();

    if (
      !title ||
      !content ||
      !signerName ||
      !creatorName
    ) {
      return showFormError(
        'Merci de remplir tous les champs obligatoires.'
      );
    }

    if (creatorName.length < 2) {
      return showFormError(
        'Ton nom doit contenir au moins 2 caractères.'
      );
    }

    if (signerName.length < 2) {
      return showFormError(
        'Le nom du signataire doit contenir au moins 2 caractères.'
      );
    }

    if (
      !signaturePad ||
      signaturePad.isEmpty()
    ) {
      return showFormError(
        'Ajoute ta signature pour continuer.'
      );
    }

    if (!currentUser) {
      return showFormError(
        'Session expirée. Reconnecte-toi.'
      );
    }

    btnSubmit.disabled = true;
    btnSubmit.textContent =
      'Création…';

    try {
      const shareToken =
        generateShareToken();

      const creatorSignatureDataUrl =
        signaturePad.toDataURL();

      const docRef =
        await addDoc(
          collection(
            db,
            'contracts'
          ),
          {
            creatorId:
              currentUser.uid,

            creatorName,

            title,

            content,

            signerName,

            /*
             * IMPORTANT :
             * Aucun numéro WhatsApp du client
             * n'est demandé ou enregistré.
             */

            shareToken,

            status:
              'pending',

            termsAcceptedBySigner:
              false,

            creatorSignedAt:
              serverTimestamp(),

            creatorSignatureDataUrl,

            signerSignedAt:
              null,

            signerSignatureDataUrl:
              null,

            signerTypedName:
              null,

            createdAt:
              serverTimestamp(),
          }
        );

      await Promise.race([
        waitForPendingWrites(db),

        new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              10000
            )
        ),
      ]);

      modalNew.close();

      openShareModal({
        id: docRef.id,

        title,

        signerName,

        creatorName,

        shareToken,
      });

    } catch (error) {
      console.error(
        'Erreur de création :',
        error
      );

      showFormError(
        'La création du contrat a échoué. Vérifie ta connexion et réessaie.'
      );
    } finally {
      btnSubmit.disabled = false;

      btnSubmit.textContent =
        'Signer et créer le lien';
    }
  }
);

function showFormError(message) {
  formError.textContent =
    message;

  formError.hidden = false;
}

function generateShareToken() {
  const bytes =
    new Uint8Array(24);

  crypto.getRandomValues(bytes);

  return Array.from(
    bytes,
    (byte) =>
      byte
        .toString(16)
        .padStart(2, '0')
  ).join('');
}

function buildShareUrl(token) {
  return (
    `${window.location.origin}` +
    `/sign.html?token=` +
    encodeURIComponent(token)
  );
}

function buildWhatsAppUrl(contract) {
  const shareUrl =
    buildShareUrl(
      contract.shareToken
    );

  const message =
    `Bonjour, voici le contrat "${contract.title}" à signer sur Kontra-Africa : ${shareUrl}`;

  /*
   * Aucun numéro ici.
   *
   * WhatsApp s'ouvre avec le message préparé.
   * Le créateur choisit ensuite lui-même
   * le contact à qui envoyer le lien.
   */

  return (
    `https://wa.me/?text=` +
    encodeURIComponent(message)
  );
}

function openWhatsAppShare(contract) {
  const whatsappUrl =
    buildWhatsAppUrl(
      contract
    );

  window.open(
    whatsappUrl,
    '_blank',
    'noopener,noreferrer'
  );
}

function openShareModal(contract) {
  inputShareLink.value =
    buildShareUrl(
      contract.shareToken
    );

  if (btnShareWhatsapp) {
    btnShareWhatsapp.onclick =
      () => {
        openWhatsAppShare(
          contract
        );
      };
  }

  modalShare.showModal();
}

btnCopyLink.addEventListener(
  'click',
  async () => {
    try {
      await navigator.clipboard.writeText(
        inputShareLink.value
      );

      btnCopyLink.textContent =
        'Copié !';

      setTimeout(() => {
        btnCopyLink.textContent =
          'Copier';
      }, 1500);

    } catch (error) {
      console.error(
        'Erreur de copie :',
        error
      );
    }
  }
);
