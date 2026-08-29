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
  limit,
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


// ============================================================
// DOM
// ============================================================

const listEl =
  document.getElementById('contracts-list');

const loadingEl =
  document.getElementById('contracts-loading');

const emptyEl =
  document.getElementById('contracts-empty');

const offlineBanner =
  document.getElementById('offline-banner');

const modalNew =
  document.getElementById('modal-new-contract');

const formNew =
  document.getElementById('form-new-contract');

const formError =
  document.getElementById('form-error');

const btnSubmit =
  document.getElementById('btn-submit-contract');

const modalShare =
  document.getElementById('modal-share');

const inputShareLink =
  document.getElementById('input-share-link');

const btnCopyLink =
  document.getElementById('btn-copy-link');

const btnShareWhatsapp =
  document.getElementById('btn-share-whatsapp');


// ============================================================
// INITIALISATION
// ============================================================

async function init() {

  const session =
    await requireAppAccess();

  if (!session) {
    return;
  }

  currentUser =
    session.user;

  listenToContracts(
    currentUser.uid
  );
}

init();


// ============================================================
// ONLINE / OFFLINE
// ============================================================

function updateOnlineStatus() {

  if (offlineBanner) {

    offlineBanner.hidden =
      navigator.onLine;

  }
}

window.addEventListener(
  'online',
  updateOnlineStatus
);

window.addEventListener(
  'offline',
  updateOnlineStatus
);

updateOnlineStatus();


// ============================================================
// FIRESTORE
// ============================================================

function listenToContracts(uid) {

  const q =
    query(
      collection(
        db,
        'contracts'
      ),

      where(
        'creatorId',
        '==',
        uid
      ),

      orderBy(
        'createdAt',
        'desc'
      ),

      limit(50)
    );


  unsubscribeContracts =
    onSnapshot(
      q,

      (snapshot) => {

        allContracts =
          snapshot.docs.map(
            (doc) => ({
              id: doc.id,
              ...doc.data(),
            })
          );

        renderList();
      },

      (error) => {

        console.error(
          'Erreur de lecture des contrats :',
          error
        );

        if (loadingEl) {

          loadingEl.textContent =
            'Impossible de charger les contrats. Vérifie ta connexion.';

        }
      }
    );
}


// ============================================================
// LISTE
// ============================================================

function renderList() {

  if (loadingEl) {
    loadingEl.hidden = true;
  }


  const filtered =
    currentFilter === 'all'
      ? allContracts
      : allContracts.filter(
          (contract) =>
            contract.status ===
            currentFilter
        );


  if (
    filtered.length ===
    0
  ) {

    listEl.innerHTML =
      '';

    emptyEl.hidden =
      false;

    return;
  }


  emptyEl.hidden =
    true;


  listEl.innerHTML =
    filtered
      .map(renderCard)
      .join('');


  // ----------------------------------------------------------
  // COPIER LIEN
  // ----------------------------------------------------------

  listEl
    .querySelectorAll(
      '[data-action="copy-share-link"]'
    )
    .forEach(
      (button) => {

        button.addEventListener(
          'click',
          async () => {

            const url =
              buildShareUrl(
                button.dataset.token
              );

            try {

              await navigator.clipboard.writeText(
                url
              );

              button.textContent =
                'Copié !';

              setTimeout(
                () => {
                  button.textContent =
                    'Copier le lien';
                },
                1500
              );

            } catch (error) {

              console.error(
                'Erreur lors de la copie :',
                error
              );

            }
          }
        );

      }
    );


  // ----------------------------------------------------------
  // WHATSAPP
  // ----------------------------------------------------------

  listEl
    .querySelectorAll(
      '[data-action="whatsapp-share"]'
    )
    .forEach(
      (button) => {

        button.addEventListener(
          'click',
          () => {

            openWhatsAppShare({
              shareToken:
                button.dataset.token,

              title:
                button.dataset.title ||
                'Contrat',
            });

          }
        );

      }
    );


  // ----------------------------------------------------------
  // TÉLÉCHARGEMENT CRÉATEUR
  // ----------------------------------------------------------

  listEl
    .querySelectorAll(
      '[data-action="creator-download-pdf"]'
    )
    .forEach(
      (button) => {

        button.addEventListener(
          'click',
          () => {

            const contract =
              allContracts.find(
                (item) =>
                  item.id ===
                  button.dataset.contractId
              );


            if (!contract) {

              showTemporaryError(
                'Contrat introuvable.'
              );

              return;
            }


            startCreatorPdfDownload(
              contract,
              button
            );

          }
        );

      }
    );

}


// ============================================================
// CARTE CONTRAT
// ============================================================

function renderCard(
  contract
) {

  const statusLabels = {

    draft:
      'Brouillon',

    pending:
      'En attente de signature',

    signed:
      'Signé',

    rejected:
      'Refusé',

    expired:
      'Expiré',

  };


  const createdDate =
    contract.createdAt?.toDate
      ? contract.createdAt
          .toDate()
          .toLocaleDateString(
            'fr-FR'
          )
      : '';


  let actions =
    '';


  // ==========================================================
  // EN ATTENTE
  // ==========================================================

  if (
    contract.status ===
    'pending'
  ) {

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


  // ==========================================================
  // SIGNÉ
  // ==========================================================

  if (
    contract.status ===
    'signed'
  ) {

    const countdown =
      getPdfCountdownText(
        contract
      );


    actions = `

      <button
        type="button"
        class="btn btn-sm btn-primary"
        data-action="creator-download-pdf"
        data-contract-id="${escapeHtml(
          contract.id
        )}"
      >
        ${contract.pdfAccessStartedAt
          ? 'Télécharger le PDF'
          : 'Télécharger le PDF'}
      </button>

      ${
        countdown
          ? `
            <span
              class="contract-pdf-countdown"
              data-countdown-contract="${escapeHtml(
                contract.id
              )}"
            >
              ${escapeHtml(countdown)}
            </span>
          `
          : ''
      }

    `;
  }


  // ==========================================================
  // EXPIRÉ
  // ==========================================================

  if (
    contract.status ===
    'expired'
  ) {

    actions = `

      <span class="contract-expired-message">
        Contrat expiré
      </span>

    `;
  }


  return `

    <article class="contract-card">

      <div class="contract-card-top">

        <div>

          <h3 class="contract-title">
            ${escapeHtml(
              contract.title || ''
            )}
          </h3>

          <p class="contract-signer">
            Signataire :
            ${escapeHtml(
              contract.signerName || ''
            )}
          </p>

          <p class="contract-creator">
            Créé par :
            ${escapeHtml(
              contract.creatorName || ''
            )}
          </p>

        </div>


        <span
          class="status-badge status-${escapeHtml(
            contract.status || ''
          )}"
        >
          ${
            statusLabels[
              contract.status
            ] ||
            escapeHtml(
              contract.status || ''
            )
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
// COMPTE À REBOURS
// ============================================================

function getPdfCountdownText(
  contract
) {

  if (
    !contract.pdfExpiresAt
  ) {

    return '';

  }


  const expires =
    firestoreDateToMillis(
      contract.pdfExpiresAt
    );


  if (!expires) {
    return '';
  }


  const remaining =
    expires -
    Date.now();


  if (
    remaining <=
    0
  ) {

    return 'PDF expiré';

  }


  return (
    'PDF disponible pendant ' +
    formatDuration(
      remaining
    )
  );
}


// ============================================================
// REFRESH COMPTE À REBOURS
// ============================================================

setInterval(
  () => {

    document
      .querySelectorAll(
        '[data-countdown-contract]'
      )
      .forEach(
        (element) => {

          const contract =
            allContracts.find(
              (item) =>
                item.id ===
                element.dataset
                  .countdownContract
            );


          if (!contract) {
            return;
          }


          element.textContent =
            getPdfCountdownText(
              contract
            );

        }
      );

  },
  1000
);


// ============================================================
// TÉLÉCHARGEMENT CRÉATEUR
// ============================================================

async function startCreatorPdfDownload(
  contract,
  button
) {

  if (!currentUser) {

    showTemporaryError(
      'Session expirée. Reconnecte-toi.'
    );

    return;
  }


  if (
    contract.status !==
    'signed'
  ) {

    showTemporaryError(
      'Le contrat doit être signé avant le téléchargement.'
    );

    return;
  }


  const originalText =
    button.textContent;


  button.disabled =
    true;

  button.textContent =
    'Préparation du PDF…';


  try {

    /*
     * IMPORTANT :
     *
     * On ne va plus ouvrir directement :
     *
     * /public/TOKEN/pdf
     *
     * Le clic du créateur passe d'abord
     * par une route backend dédiée.
     *
     * Cette route doit :
     *
     * 1. vérifier le créateur connecté ;
     * 2. vérifier que le contrat est signé ;
     * 3. démarrer les 24 h si elles ne
     *    sont pas encore démarrées ;
     * 4. générer le PDF ;
     * 5. renvoyer le PDF ;
     * 6. ne PAS stocker le PDF.
     */


    const idToken =
      await currentUser.getIdToken(
        true
      );


    const response =
      await fetch(
        `${API_BASE}/api/contracts/${encodeURIComponent(
          contract.id
        )}/creator-pdf`,
        {

          method:
            'POST',

          headers: {

            Authorization:
              `Bearer ${idToken}`,

            Accept:
              'application/pdf',

          },

        }
      );


    if (!response.ok) {

      let message =
        'Impossible de télécharger le PDF.';


      try {

        const contentType =
          response.headers.get(
            'content-type'
          ) || '';


        if (
          contentType.includes(
            'application/json'
          )
        ) {

          const data =
            await response.json();


          message =
            data.message ||
            message;

        }

      } catch (_) {
        // Ignorer.
      }


      throw new Error(
        message
      );

    }


    const blob =
      await response.blob();


    if (
      !blob ||
      blob.size ===
        0
    ) {

      throw new Error(
        'Le PDF généré est vide.'
      );

    }


    const blobUrl =
      URL.createObjectURL(
        blob
      );


    const link =
      document.createElement(
        'a'
      );


    link.href =
      blobUrl;


    link.download =
      createPdfFilename(
        contract.title
      );


    link.style.display =
      'none';


    document.body.appendChild(
      link
    );


    link.click();


    link.remove();


    setTimeout(
      () => {

        URL.revokeObjectURL(
          blobUrl
        );

      },
      5000
    );


    /*
     * Firestore va normalement mettre à jour
     * pdfAccessStartedAt / pdfExpiresAt.
     *
     * On recharge la liste afin que le
     * compte à rebours apparaisse.
     */

    await refreshContractsOnce();


  } catch (error) {

    console.error(
      'Erreur téléchargement PDF créateur :',
      error
    );


    showTemporaryError(
      error.message ||
      'Le téléchargement du PDF a échoué.'
    );


  } finally {

    button.disabled =
      false;

    button.textContent =
      originalText;

  }

}


// ============================================================
// RAFRAÎCHIR LES DONNÉES
// ============================================================

async function refreshContractsOnce() {

  /*
   * onSnapshot est déjà actif.
   *
   * Cette fonction sert surtout à laisser
   * le temps au listener Firestore de recevoir
   * la modification du backend.
   */

  await new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        500
      )
  );

}


// ============================================================
// DATE FIRESTORE
// ============================================================

function firestoreDateToMillis(
  value
) {

  if (!value) {
    return null;
  }


  if (
    typeof value.toMillis ===
    'function'
  ) {

    return value.toMillis();

  }


  if (
    typeof value.toDate ===
    'function'
  ) {

    return value
      .toDate()
      .getTime();

  }


  if (
    typeof value ===
    'number'
  ) {

    return value;

  }


  const date =
    new Date(value);


  const timestamp =
    date.getTime();


  return Number.isNaN(
    timestamp
  )
    ? null
    : timestamp;
}


// ============================================================
// DURÉE
// ============================================================

function formatDuration(
  milliseconds
) {

  let seconds =
    Math.floor(
      milliseconds /
        1000
    );


  const days =
    Math.floor(
      seconds /
        86400
    );


  seconds %=
    86400;


  const hours =
    Math.floor(
      seconds /
        3600
    );


  seconds %=
    3600;


  const minutes =
    Math.floor(
      seconds /
        60
    );


  seconds %=
    60;


  if (days > 0) {

    return `${days}j ${hours}h ${minutes}min`;

  }


  if (hours > 0) {

    return `${hours}h ${minutes}min ${seconds}s`;

  }


  if (minutes > 0) {

    return `${minutes}min ${seconds}s`;

  }


  return `${seconds}s`;

}


// ============================================================
// NOM PDF
// ============================================================

function createPdfFilename(
  title
) {

  const clean =
    String(
      title ||
      'contrat'
    )
      .normalize(
        'NFD'
      )
      .replace(
        /[\u0300-\u036f]/g,
        ''
      )
      .replace(
        /[^a-zA-Z0-9]+/g,
        '-'
      )
      .replace(
        /^-+|-+$/g,
        ''
      )
      .toLowerCase();


  return `${
    clean ||
    'contrat'
  }-kontra-africa.pdf`;
}


// ============================================================
// ERREUR TEMPORAIRE
// ============================================================

function showTemporaryError(
  message
) {

  console.error(
    message
  );


  if (
    formError
  ) {

    formError.textContent =
      message;

    formError.hidden =
      false;


    setTimeout(
      () => {

        formError.hidden =
          true;

      },
      5000
    );

  } else {

    alert(
      message
    );

  }

}


// ============================================================
// ESCAPE HTML
// ============================================================

function escapeHtml(
  value = ''
) {

  return String(
    value
  ).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&':
          '&amp;',

        '<':
          '&lt;',

        '>':
          '&gt;',

        '"':
          '&quot;',

        "'":
          '&#39;',
      }[character])
  );

}


// ============================================================
// FILTRES
// ============================================================

document
  .querySelectorAll(
    '.status-filter'
  )
  .forEach(
    (button) => {

      button.addEventListener(
        'click',
        () => {

          document
            .querySelectorAll(
              '.status-filter'
            )
            .forEach(
              (item) => {

                item.classList.remove(
                  'is-active'
                );

                item.setAttribute(
                  'aria-selected',
                  'false'
                );

              }
            );


          button.classList.add(
            'is-active'
          );


          button.setAttribute(
            'aria-selected',
            'true'
          );


          currentFilter =
            button.dataset.status;


          renderList();

        }
      );

    }
  );


// ============================================================
// NOUVEAU CONTRAT
// ============================================================

document
  .getElementById(
    'btn-new-contract'
  )
  .addEventListener(
    'click',
    openNewContractModal
  );


document
  .getElementById(
    'contracts-empty'
  )
  .addEventListener(
    'click',
    (event) => {

      if (
        event.target.dataset.action ===
        'open-new-contract'
      ) {

        openNewContractModal();

      }

    }
  );


function openNewContractModal() {

  formNew.reset();

  formError.hidden =
    true;

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
  .forEach(
    (button) => {

      button.addEventListener(
        'click',
        () => {

          modalNew.close();

        }
      );

    }
  );


document
  .querySelectorAll(
    '[data-action="close-share-modal"]'
  )
  .forEach(
    (button) => {

      button.addEventListener(
        'click',
        () => {

          modalShare.close();

        }
      );

    }
  );


// ============================================================
// SIGNATURE CREATEUR
// ============================================================

function initSignaturePad() {

  const canvas =
    document.getElementById(
      'signature-canvas'
    );


  if (!canvas) {
    return;
  }


  const ctx =
    canvas.getContext(
      '2d'
    );


  if (!ctx) {
    return;
  }


  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );


  ctx.lineWidth =
    2.5;

  ctx.lineCap =
    'round';

  ctx.lineJoin =
    'round';

  ctx.strokeStyle =
    '#2A2140';


  let drawing =
    false;


  let hasStroke =
    false;


  function getPosition(
    event
  ) {

    const rect =
      canvas.getBoundingClientRect();


    const scaleX =
      canvas.width /
      rect.width;


    const scaleY =
      canvas.height /
      rect.height;


    const point =
      event.touches &&
      event.touches.length
        ? event.touches[0]
        : event;


    return {

      x:
        (point.clientX -
          rect.left) *
        scaleX,

      y:
        (point.clientY -
          rect.top) *
        scaleY,

    };

  }


  function startDrawing(
    event
  ) {

    drawing =
      true;

    hasStroke =
      true;


    const point =
      getPosition(
        event
      );


    ctx.beginPath();


    ctx.moveTo(
      point.x,
      point.y
    );


    event.preventDefault();

  }


  function draw(
    event
  ) {

    if (!drawing) {
      return;
    }


    const point =
      getPosition(
        event
      );


    ctx.lineTo(
      point.x,
      point.y
    );


    ctx.stroke();


    event.preventDefault();

  }


  function stopDrawing() {

    drawing =
      false;

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

    clearButton.onclick =
      () => {

        ctx.clearRect(
          0,
          0,
          canvas.width,
          canvas.height
        );


        hasStroke =
          false;

      };

  }


  signaturePad = {

    isEmpty:
      () => !hasStroke,

    toDataURL:
      () =>
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
  async (event) => {

    event.preventDefault();


    formError.hidden =
      true;


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


    if (
      creatorName.length <
      2
    ) {

      return showFormError(
        'Ton nom doit contenir au moins 2 caractères.'
      );

    }


    if (
      signerName.length <
      2
    ) {

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


    btnSubmit.disabled =
      true;


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
             * Aucun numéro WhatsApp du client.
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

            /*
             * IMPORTANT :
             *
             * Le compteur PDF ne commence
             * PAS à la création.
             *
             * Il sera défini par le backend
             * lorsque le créateur téléchargera
             * le PDF après signature.
             */

            pdfAccessStartedAt:
              null,

            pdfExpiresAt:
              null,

          }
        );


      await Promise.race([

        waitForPendingWrites(
          db
        ),

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

        id:
          docRef.id,

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

function showFormError(
  message
) {

  formError.textContent =
    message;

  formError.hidden =
    false;

}


// ============================================================
// TOKEN
// ============================================================

function generateShareToken() {

  const bytes =
    new Uint8Array(
      24
    );


  crypto.getRandomValues(
    bytes
  );


  return Array.from(
    bytes,
    (byte) =>
      byte
        .toString(16)
        .padStart(
          2,
          '0'
        )
  ).join('');

}


// ============================================================
// LIEN SIGNATURE
// ============================================================

function buildShareUrl(
  token
) {

  return (
    `${window.location.origin}` +
    `/sign.html?token=` +
    encodeURIComponent(
      token
    )
  );

}


// ============================================================
// WHATSAPP
// ============================================================

function buildWhatsAppUrl(
  contract
) {

  const shareUrl =
    buildShareUrl(
      contract.shareToken
    );


  const message =
    `Bonjour, voici le contrat "${contract.title}" à signer sur Kontra-Africa : ${shareUrl}`;


  return (
    `https://wa.me/?text=` +
    encodeURIComponent(
      message
    )
  );

}


function openWhatsAppShare(
  contract
) {

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


// ============================================================
// MODALE PARTAGE
// ============================================================

function openShareModal(
  contract
) {

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


// ============================================================
// COPIE LIEN
// ============================================================

btnCopyLink.addEventListener(
  'click',
  async () => {

    try {

      await navigator.clipboard.writeText(
        inputShareLink.value
      );


      btnCopyLink.textContent =
        'Copié !';


      setTimeout(
        () => {

          btnCopyLink.textContent =
            'Copier';

        },
        1500
      );


    } catch (error) {

      console.error(
        'Erreur de copie :',
        error
      );

    }

  }
);
