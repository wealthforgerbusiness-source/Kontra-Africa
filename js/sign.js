// js/sign.js
// Page publique de signature — Kontra-Africa

const API_BASE = 'https://kontra-africa.onrender.com';

const params = new URLSearchParams(window.location.search);
const token = params.get('token');

const els = {
  loading: document.getElementById('state-loading'),
  error: document.getElementById('state-error'),
  errorMessage: document.getElementById('error-message'),

  alreadySigned: document.getElementById('state-already-signed'),
  alreadySignedDate: document.getElementById('already-signed-date'),
  linkDownloadPdf: document.getElementById('link-download-pdf'),

  contractView: document.getElementById('contract-view'),
  title: document.getElementById('contract-title'),
  creatorName: document.getElementById('contract-creator-name'),
  content: document.getElementById('contract-content'),

  checkboxTerms: document.getElementById('checkbox-terms'),
  typedName: document.getElementById('input-typed-name'),

  signError: document.getElementById('sign-error'),
  btnSign: document.getElementById('btn-sign'),

  success: document.getElementById('state-success'),
  linkDownloadPdfSuccess:
    document.getElementById('link-download-pdf-success'),
};

let signaturePad = null;


// ============================================================
// AFFICHAGE DES ÉTATS
// ============================================================

function showOnly(element) {
  [
    els.loading,
    els.error,
    els.alreadySigned,
    els.contractView,
    els.success,
  ].forEach((item) => {
    if (item) {
      item.hidden = item !== element;
    }
  });
}


// ============================================================
// CHARGEMENT DU CONTRAT
// ============================================================

async function init() {
  if (!token) {
    els.errorMessage.textContent =
      'Lien invalide : aucun code de signature fourni.';

    showOnly(els.error);
    return;
  }

  try {
    const response = await fetch(
      `${API_BASE}/api/contracts/public/${encodeURIComponent(token)}`
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message ||
        'Ce lien de signature est invalide ou a expiré.'
      );
    }

    const contract = data;


    // ========================================================
    // CONTRAT DÉJÀ SIGNÉ
    // ========================================================

    if (contract.status === 'signed') {
      els.alreadySignedDate.textContent =
        formatDate(contract.signerSignedAt);

      /*
       * Si le créateur a déjà démarré sa période de 24 h,
       * le PDF peut éventuellement être consulté.
       *
       * Sinon, aucun accès PDF supplémentaire n'est déclenché
       * ici.
       */

      if (
        contract.pdfAccessStartedAt &&
        contract.pdfExpiresAt &&
        !isExpired(contract.pdfExpiresAt)
      ) {
        els.linkDownloadPdf.href =
          `${API_BASE}/api/contracts/public/${encodeURIComponent(token)}/pdf`;

        els.linkDownloadPdf.hidden = false;
      } else {
        els.linkDownloadPdf.hidden = true;
      }

      showOnly(els.alreadySigned);
      return;
    }


    // ========================================================
    // CONTRAT EXPIRÉ
    // ========================================================

    if (contract.status === 'expired') {
      els.errorMessage.textContent =
        'Ce contrat a expiré.';

      showOnly(els.error);
      return;
    }


    // ========================================================
    // CONTRAT REFUSÉ
    // ========================================================

    if (contract.status === 'rejected') {
      els.errorMessage.textContent =
        'Ce contrat a été refusé.';

      showOnly(els.error);
      return;
    }


    // ========================================================
    // AFFICHAGE DU CONTRAT
    // ========================================================

    els.title.textContent =
      contract.title || '';

    els.creatorName.textContent =
      contract.creatorName || '';

    els.content.textContent =
      contract.content || '';

    showOnly(els.contractView);

    initSignaturePad();

  } catch (error) {
    console.error(
      'Erreur de chargement du contrat :',
      error
    );

    els.errorMessage.textContent =
      error.message ||
      'Impossible de charger le contrat.';

    showOnly(els.error);
  }
}


// ============================================================
// SIGNATURE PAD
// ============================================================

function initSignaturePad() {
  const canvas =
    document.getElementById('signature-canvas');

  if (!canvas) {
    return;
  }

  const ctx =
    canvas.getContext('2d');

  if (!ctx) {
    return;
  }

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
      event.touches && event.touches.length
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
    if (!drawing) {
      return;
    }

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


  canvas.addEventListener(
    'mousedown',
    startDrawing
  );

  canvas.addEventListener(
    'mousemove',
    draw
  );

  window.addEventListener(
    'mouseup',
    stopDrawing
  );


  canvas.addEventListener(
    'touchstart',
    startDrawing,
    { passive: false }
  );

  canvas.addEventListener(
    'touchmove',
    draw,
    { passive: false }
  );

  canvas.addEventListener(
    'touchend',
    stopDrawing
  );


  const clearButton =
    document.getElementById(
      'btn-clear-signature'
    );

  if (clearButton) {
    clearButton.addEventListener(
      'click',
      () => {
        ctx.clearRect(
          0,
          0,
          canvas.width,
          canvas.height
        );

        hasStroke = false;
      }
    );
  }


  signaturePad = {
    isEmpty() {
      return !hasStroke;
    },

    toDataURL() {
      return canvas.toDataURL(
        'image/png'
      );
    },
  };
}


// ============================================================
// SIGNER
// ============================================================

if (els.btnSign) {
  els.btnSign.addEventListener(
    'click',
    signContract
  );
}


async function signContract() {

  els.signError.hidden = true;


  // ----------------------------------------------------------
  // ACCEPTATION
  // ----------------------------------------------------------

  if (
    !els.checkboxTerms ||
    !els.checkboxTerms.checked
  ) {
    showSignError(
      "Merci de cocher la case d'acceptation des termes."
    );

    return;
  }


  // ----------------------------------------------------------
  // NOM DU CLIENT
  // ----------------------------------------------------------

  const typedName =
    els.typedName.value.trim();


  if (!typedName) {
    showSignError(
      'Saisissez votre nom complet pour continuer.'
    );

    return;
  }


  if (typedName.length < 2) {
    showSignError(
      'Votre nom doit contenir au moins 2 caractères.'
    );

    return;
  }


  if (typedName.length > 150) {
    showSignError(
      'Votre nom est trop long.'
    );

    return;
  }


  // ----------------------------------------------------------
  // SIGNATURE
  // ----------------------------------------------------------

  if (
    !signaturePad ||
    signaturePad.isEmpty()
  ) {
    showSignError(
      'Ajoutez votre signature pour continuer.'
    );

    return;
  }


  // ----------------------------------------------------------
  // BOUTON
  // ----------------------------------------------------------

  els.btnSign.disabled = true;

  els.btnSign.textContent =
    'Signature en cours…';


  try {

    const signatureDataUrl =
      signaturePad.toDataURL();


    // ========================================================
    // ENVOI AU BACKEND
    // ========================================================

    const response =
      await fetch(
        `${API_BASE}/api/contracts/public/${encodeURIComponent(token)}/sign`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',
          },

          body: JSON.stringify({
            termsAccepted: true,

            signatureDataUrl,

            typedName,
          }),
        }
      );


    const data =
      await response
        .json()
        .catch(() => ({}));


    if (!response.ok) {
      throw new Error(
        data.message ||
        'La signature a échoué.'
      );
    }


    // ========================================================
    // SIGNATURE VALIDÉE
    // ========================================================

    /*
     * IMPORTANT :
     *
     * Le client signe.
     *
     * Le backend enregistre :
     * - son nom
     * - sa signature
     * - la date de signature
     * - le statut signed
     *
     * Les 24 h NE commencent PAS ici.
     */


    // ========================================================
    // TÉLÉCHARGEMENT AUTOMATIQUE DU PDF
    // ========================================================

    /*
     * Le client reçoit automatiquement son PDF
     * juste après avoir signé.
     *
     * Cette requête ne doit PAS appeler
     * start-pdf-access.
     *
     * Elle ne démarre donc pas le compteur de 24 h.
     */

    await downloadSignedPdfForClient();


    // ========================================================
    // ÉTAT SUCCÈS
    // ========================================================

    showOnly(
      els.success
    );


    /*
     * Le bouton PDF de la page succès est masqué :
     * le téléchargement automatique vient déjà d'être effectué.
     */

    if (
      els.linkDownloadPdfSuccess
    ) {
      els.linkDownloadPdfSuccess.hidden =
        true;
    }

  } catch (error) {

    console.error(
      'Erreur lors de la signature :',
      error
    );

    showSignError(
      error.message ||
      'La signature a échoué. Réessayez.'
    );

  } finally {

    els.btnSign.disabled =
      false;

    els.btnSign.textContent =
      'Signer le contrat';
  }
}


// ============================================================
// TÉLÉCHARGEMENT AUTOMATIQUE CLIENT
// ============================================================

async function downloadSignedPdfForClient() {

  /*
   * Petit délai pour laisser le backend terminer
   * l'enregistrement Firestore avant de générer le PDF.
   */

  await sleep(500);


  const pdfUrl =
    `${API_BASE}/api/contracts/public/${encodeURIComponent(token)}/pdf`;


  const response =
    await fetch(pdfUrl);


  if (!response.ok) {

    const data =
      await response
        .json()
        .catch(() => ({}));


    throw new Error(
      data.message ||
      'La signature est enregistrée, mais le PDF n’a pas pu être téléchargé automatiquement.'
    );
  }


  const blob =
    await response.blob();


  if (!blob || blob.size === 0) {
    throw new Error(
      'Le PDF généré est vide.'
    );
  }


  const blobUrl =
    URL.createObjectURL(blob);


  const filename =
    `contrat-kontra-africa-${token}.pdf`;


  /*
   * Création temporaire d'un lien de téléchargement.
   */

  const link =
    document.createElement('a');


  link.href =
    blobUrl;

  link.download =
    filename;

  link.style.display =
    'none';


  document.body.appendChild(
    link
  );


  link.click();


  link.remove();


  /*
   * Libération de la mémoire.
   */

  setTimeout(
    () => {
      URL.revokeObjectURL(
        blobUrl
      );
    },
    5000
  );
}


// ============================================================
// ERREUR
// ============================================================

function showSignError(
  message
) {

  els.signError.textContent =
    message;

  els.signError.hidden =
    false;
}


// ============================================================
// DATE
// ============================================================

function formatDate(
  value
) {

  if (!value) {
    return '';
  }


  let date;


  if (
    typeof value ===
    'object' &&
    typeof value.toDate ===
    'function'
  ) {

    date =
      value.toDate();

  } else {

    date =
      new Date(value);
  }


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return '';
  }


  return date.toLocaleString(
    'fr-FR',
    {
      dateStyle: 'long',
      timeStyle: 'short',
    }
  );
}


// ============================================================
// EXPIRATION
// ============================================================

function isExpired(
  value
) {

  if (!value) {
    return false;
  }


  let date;


  if (
    typeof value ===
    'object' &&
    typeof value.toDate ===
    'function'
  ) {

    date =
      value.toDate();

  } else {

    date =
      new Date(value);
  }


  return (
    !Number.isNaN(
      date.getTime()
    ) &&
    date.getTime() <=
      Date.now()
  );
}


// ============================================================
// SLEEP
// ============================================================

function sleep(
  milliseconds
) {

  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}


// ============================================================
// LANCEMENT
// ============================================================

init();
