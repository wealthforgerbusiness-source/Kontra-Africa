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

// ============================================================
// ÉTAT
// ============================================================

let currentUser = null;
let currentFilter = 'all';
let unsubscribeContracts = null;
let allContracts = [];
let signaturePad = null;

// ============================================================
// ÉLÉMENTS DOM
// ============================================================

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

// ============================================================
// AUTH + GARDE D'ACCÈS
// ============================================================

async function init() {
  const session = await requireAppAccess();

  if (!session) return;

  currentUser = session.user;

  listenToContracts(session.user.uid);
}

init();

// ============================================================
// HORS LIGNE
// ============================================================

function updateOnlineStatus() {
  if (offlineBanner) {
    offlineBanner.hidden = navigator.onLine;
  }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

updateOnlineStatus();

// ============================================================
// LISTE DES CONTRATS EN TEMPS RÉEL
// ============================================================

function listenToContracts(uid) {
  const q = query(
    collection(db, 'contracts'),
    where('creatorId', '==', uid),
    orderBy('createdAt', 'desc')
  );

  unsubscribeContracts = onSnapshot(
    q,
    (snapshot) => {
      allContracts = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      renderList();
    },
    (error) => {
      console.error(
        'Erreur de lecture des contrats :',
        error
      );

      loadingEl.textContent =
        "Impossible de charger les contrats. Vérifie ta connexion.";
    }
  );
}

// ============================================================
// AFFICHAGE DE LA LISTE
// ============================================================

function renderList() {
  loadingEl.hidden = true;

  const filtered =
    currentFilter === 'all'
      ? allContracts
      : allContracts.filter(
          (c) => c.status === currentFilter
        );

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;

  listEl.innerHTML =
    filtered.map(renderCard).join('');

  listEl
    .querySelectorAll(
      '[data-action="copy-share-link"]'
    )
    .forEach((btn) => {
      btn.addEventListener('click', async () => {

        const url = buildShareUrl(
          btn.dataset.token
        );

        try {
          await navigator.clipboard.writeText(url);

          btn.textContent = 'Copié !';

          setTimeout(() => {
            btn.textContent = 'Copier le lien';
          }, 1500);

        } catch (error) {
          console.error(
            'Erreur copie lien :',
            error
          );
        }
      });
    });
}

// ============================================================
// CARTE CONTRAT
// ============================================================

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
      <a
        class="btn btn-sm btn-whatsapp"
        style="margin:0;"
        target="_blank"
        rel="noopener"
        href="${buildWhatsAppUrl(contract)}"
      >
        Renvoyer sur WhatsApp
      </a>

      <button
        class="btn btn-sm btn-secondary"
        data-action="copy-share-link"
        data-token="${escapeHtml(
          contract.shareToken || ''
        )}"
      >
        Copier le lien
      </button>
    `;

  } else if (contract.status === 'signed') {

    actions = `
      <a
        class="btn btn-sm btn-secondary"
        href="${API_BASE}/api/contracts/public/${escapeHtml(
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
            ${escapeHtml(contract.title)}
          </h3>

          <p class="contract-signer">
            Signataire :
            ${escapeHtml(contract.signerName)}
          </p>

          <p class="contract-creator">
            Créé par :
            ${escapeHtml(contract.creatorName)}
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

// ============================================================
// PROTECTION HTML
// ============================================================

function escapeHtml(str = '') {

  return String(str).replace(
    /[&<>"']/g,
    (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c])
  );
}

// ============================================================
// FILTRES
// ============================================================

document
  .querySelectorAll('.status-filter')
  .forEach((btn) => {

    btn.addEventListener('click', () => {

      document
        .querySelectorAll('.status-filter')
        .forEach((b) => {

          b.classList.remove('is-active');

          b.setAttribute(
            'aria-selected',
            'false'
          );
        });

      btn.classList.add('is-active');

      btn.setAttribute(
        'aria-selected',
        'true'
      );

      currentFilter =
        btn.dataset.status;

      renderList();
    });
  });

// ============================================================
// NOUVEAU CONTRAT
// ============================================================

document
  .getElementById('btn-new-contract')
  .addEventListener(
    'click',
    openNewContractModal
  );

document
  .getElementById('contracts-empty')
  .addEventListener('click', (e) => {

    if (
      e.target.dataset.action ===
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

// ============================================================
// FERMETURE MODALES
// ============================================================

document
  .querySelectorAll(
    '[data-action="close-modal"]'
  )
  .forEach((btn) => {

    btn.addEventListener('click', () => {
      modalNew.close();
    });
  });

document
  .querySelectorAll(
    '[data-action="close-share-modal"]'
  )
  .forEach((btn) => {

    btn.addEventListener('click', () => {
      modalShare.close();
    });
  });

// ============================================================
// SIGNATURE CRÉATEUR
// ============================================================

function initSignaturePad() {

  const canvas =
    document.getElementById(
      'signature-canvas'
    );

  const ctx =
    canvas.getContext('2d');

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#2A2140';

  let drawing = false;
  let hasStroke = false;

  function getPos(e) {

    const rect =
      canvas.getBoundingClientRect();

    const scaleX =
      canvas.width / rect.width;

    const scaleY =
      canvas.height / rect.height;

    const point =
      e.touches
        ? e.touches[0]
        : e;

    return {
      x:
        (point.clientX - rect.left) *
        scaleX,

      y:
        (point.clientY - rect.top) *
        scaleY,
    };
  }

  function start(e) {

    drawing = true;
    hasStroke = true;

    const {
      x,
      y
    } = getPos(e);

    ctx.beginPath();

    ctx.moveTo(x, y);

    e.preventDefault();
  }

  function move(e) {

    if (!drawing) return;

    const {
      x,
      y
    } = getPos(e);

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

  document
    .getElementById(
      'btn-clear-signature'
    )
    .onclick = () => {

      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );

      hasStroke = false;
    };

  signaturePad = {

    canvas,

    isEmpty: () =>
      !hasStroke,

    toDataURL: () =>
      canvas.toDataURL(
        'image/png'
      ),
  };
}

// ============================================================
// CRÉATION DU CONTRAT
// ============================================================

formNew.addEventListener(
  'submit',
  async (e) => {

    e.preventDefault();

    formError.hidden = true;

    const title =
      formNew.title.value.trim();

    const content =
      formNew.content.value.trim();

    const signerName =
      formNew.signerName.value.trim();

    const signerPhone =
      formNew.signerPhone.value.trim();

    // IMPORTANT :
    // Le créateur doit maintenant saisir
    // manuellement son nom.
    const creatorName =
      formNew.creatorTypedName.value.trim();

    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    if (
      !title ||
      !content ||
      !signerName ||
      !signerPhone ||
      !creatorName
    ) {

      return showFormError(
        'Merci de remplir tous les champs obligatoires, y compris ton nom.'
      );
    }

    if (
      creatorName.length < 2
    ) {

      return showFormError(
        'Ton nom doit contenir au moins 2 caractères.'
      );
    }

    if (
      signerName.length < 2
    ) {

      return showFormError(
        'Le nom du signataire doit contenir au moins 2 caractères.'
      );
    }

    if (
      signaturePad.isEmpty()
    ) {

      return showFormError(
        'Ajoute ta signature pour continuer.'
      );
    }

    if (!currentUser) {

      return showFormError(
        'Session expirée, reconnecte-toi.'
      );
    }

    // --------------------------------------------------------
    // BOUTON
    // --------------------------------------------------------

    btnSubmit.disabled = true;

    btnSubmit.textContent =
      'Création…';

    try {

      // ------------------------------------------------------
      // TOKEN UNIQUE
      // ------------------------------------------------------

      const shareToken =
        generateShareToken();

      // ------------------------------------------------------
      // SIGNATURE CREATEUR
      // ------------------------------------------------------

      const creatorSignatureDataUrl =
        signaturePad.toDataURL();

      // ------------------------------------------------------
      // CREATION FIRESTORE
      // ------------------------------------------------------

      const docRef =
        await addDoc(
          collection(
            db,
            'contracts'
          ),
          {

            // Identité technique Firebase
            creatorId:
              currentUser.uid,

            // IMPORTANT :
            // Nom fourni manuellement par
            // le créateur.
            creatorName:
              creatorName,

            // Informations contrat
            title,
            content,

            // Signataire
            signerName,

            signerPhone:
              normalizePhone(
                signerPhone
              ),

            // Lien sécurisé
            shareToken,

            // Etat
            status:
              'pending',

            // Conditions
            termsAcceptedBySigner:
              false,

            // Signature créateur
            creatorSignedAt:
              serverTimestamp(),

            creatorSignatureDataUrl:
              creatorSignatureDataUrl,

            // Le signataire signera plus tard
            signerSignedAt:
              null,

            signerSignatureDataUrl:
              null,

            signerTypedName:
              null,

            // Création
            createdAt:
              serverTimestamp(),
          }
        );

      // ------------------------------------------------------
      // SYNCHRONISATION
      // ------------------------------------------------------

      btnSubmit.textContent =
        'Synchronisation…';

      const synced =
        await Promise.race([

          waitForPendingWrites(
            db
          ).then(() => true),

          new Promise(
            (resolve) =>
              setTimeout(
                () => resolve(false),
                10000
              )
          ),
        ]);

      modalNew.close();

      if (!synced) {

        showFormError(
          "Le contrat est enregistré mais pas encore synchronisé. Vérifie ta connexion avant de l'envoyer."
        );
      }

      // ------------------------------------------------------
      // PARTAGE WHATSAPP
      // ------------------------------------------------------

      openShareModal({

        id:
          docRef.id,

        title,

        signerName,

        signerPhone,

        creatorName,

        shareToken,
      });

    } catch (err) {

      console.error(
        'Erreur de création du contrat :',
        err
      );

      showFormError(
        "La création a échoué. Vérifie ta connexion et réessaie."
      );

    } finally {

      btnSubmit.disabled =
        false;

      btnSubmit.textContent =
        'Signer et créer le lien';
    }
  }
);

// ============================================================
// ERREUR FORMULAIRE
// ============================================================

function showFormError(message) {

  formError.textContent =
    message;

  formError.hidden =
    false;
}

// ============================================================
// TOKEN
// ============================================================

function generateShareToken() {

  const array =
    new Uint8Array(24);

  crypto.getRandomValues(
    array
  );

  return Array.from(
    array,
    (byte) =>
      byte
        .toString(16)
        .padStart(2, '0')
  ).join('');
}

// ============================================================
// TELEPHONE
// ============================================================

function normalizePhone(phone) {

  return phone.replace(
    /[^\d+]/g,
    ''
  );
}

// ============================================================
// LIEN DE SIGNATURE
// ============================================================

function buildShareUrl(token) {

  return (
    `${window.location.origin}` +
    `/sign.html?token=` +
    encodeURIComponent(token)
  );
}

// ============================================================
// WHATSAPP
// ============================================================

function buildWhatsAppUrl(contract) {

  const url =
    buildShareUrl(
      contract.shareToken
    );

  const message =
    `Bonjour ${contract.signerName}, ` +
    `voici le contrat "${contract.title}" ` +
    `à signer sur Kontra-Africa : ${url}`;

  const phone =
    (contract.signerPhone || '')
      .replace(/[^\d]/g, '');

  return (
    `https://wa.me/${phone}` +
    `?text=${encodeURIComponent(message)}`
  );
}

// ============================================================
// MODALE PARTAGE
// ============================================================

function openShareModal(contract) {

  linkWhatsapp.href =
    buildWhatsAppUrl(
      contract
    );

  inputShareLink.value =
    buildShareUrl(
      contract.shareToken
    );

  modalShare.showModal();
}

// ============================================================
// COPIER LE LIEN
// ============================================================

btnCopyLink.addEventListener(
  'click',
  async () => {

    try {

      inputShareLink.select();

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
        'Erreur copie lien :',
        error
      );
    }
  }
);
