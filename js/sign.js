// js/sign.js

const API_BASE = 'https://kontra-africa.onrender.com';

const params = new URLSearchParams(
  window.location.search
);

const token = params.get('token');

let countdownInterval = null;
let contractExpiresAt = null;
let signaturePad = null;


// ============================================================
// DOM
// ============================================================

const els = {
  loading: document.getElementById('state-loading'),

  error: document.getElementById('state-error'),
  errorMessage: document.getElementById('error-message'),

  alreadySigned:
    document.getElementById('state-already-signed'),

  alreadySignedDate:
    document.getElementById('already-signed-date'),

  alreadySignedCountdownContainer:
    document.getElementById(
      'already-signed-countdown-container'
    ),

  alreadySignedCountdown:
    document.getElementById(
      'already-signed-countdown'
    ),

  alreadySignedExpirationMessage:
    document.getElementById(
      'already-signed-expiration-message'
    ),

  downloadPdf:
    document.getElementById(
      'link-download-pdf'
    ),

  contractView:
    document.getElementById('contract-view'),

  contractTitle:
    document.getElementById('contract-title'),

  contractCreatorName:
    document.getElementById(
      'contract-creator-name'
    ),

  contractContent:
    document.getElementById(
      'contract-content'
    ),

  terms:
    document.getElementById(
      'checkbox-terms'
    ),

  typedName:
    document.getElementById(
      'input-typed-name'
    ),

  canvas:
    document.getElementById(
      'signature-canvas'
    ),

  clearSignature:
    document.getElementById(
      'btn-clear-signature'
    ),

  signError:
    document.getElementById(
      'sign-error'
    ),

  signButton:
    document.getElementById(
      'btn-sign'
    ),

  success:
    document.getElementById(
      'state-success'
    ),

  successCountdownContainer:
    document.getElementById(
      'success-countdown-container'
    ),

  successCountdown:
    document.getElementById(
      'success-countdown'
    ),

  successExpirationMessage:
    document.getElementById(
      'success-expiration-message'
    ),

  successPdf:
    document.getElementById(
      'link-download-pdf-success'
    ),
};


// ============================================================
// AFFICHAGE DES ÉTATS
// ============================================================

function showState(state) {
  const states = [
    els.loading,
    els.error,
    els.alreadySigned,
    els.contractView,
    els.success
  ];

  states.forEach((element) => {
    if (!element) return;

    element.hidden =
      element !== state;
  });
}


// ============================================================
// ERREUR
// ============================================================

function showError(message) {
  if (els.errorMessage) {
    els.errorMessage.textContent =
      message;
  }

  showState(els.error);
}


function showSignError(message) {
  if (!els.signError) return;

  els.signError.textContent =
    message;

  els.signError.hidden =
    false;
}


// ============================================================
// API
// ============================================================

async function apiRequest(
  url,
  options = {}
) {

  const response =
    await fetch(url, {
      ...options,

      headers: {
        Accept:
          'application/json',

        ...(options.headers || {})
      }
    });

  const contentType =
    response.headers.get(
      'content-type'
    ) || '';

  let data = {};

  if (
    contentType.includes(
      'application/json'
    )
  ) {
    data =
      await response.json()
        .catch(() => ({}));
  } else {
    const text =
      await response.text()
        .catch(() => '');

    data = {
      message: text
    };
  }

  return {
    response,
    data
  };
}


// ============================================================
// URL PDF
// ============================================================

function getPdfUrl() {

  return (
    `${API_BASE}/api/contracts/public/` +
    `${encodeURIComponent(token)}/pdf`
  );
}


// ============================================================
// DATE
// ============================================================

function getTime(value) {

  if (!value) {
    return null;
  }

  if (
    typeof value === 'number'
  ) {
    return value;
  }

  if (
    typeof value === 'string'
  ) {

    const time =
      new Date(value).getTime();

    return Number.isNaN(time)
      ? null
      : time;
  }

  if (
    value &&
    typeof value.seconds ===
      'number'
  ) {

    return (
      value.seconds * 1000
    );
  }

  if (
    value &&
    typeof value._seconds ===
      'number'
  ) {

    return (
      value._seconds * 1000
    );
  }

  return null;
}


// ============================================================
// FORMAT COMPTE À REBOURS
// ============================================================

function formatCountdown(ms) {

  if (ms <= 0) {
    return '00h 00min 00s';
  }

  const totalSeconds =
    Math.floor(ms / 1000);

  const hours =
    Math.floor(
      totalSeconds / 3600
    );

  const minutes =
    Math.floor(
      (totalSeconds % 3600) / 60
    );

  const seconds =
    totalSeconds % 60;

  return (
    `${String(hours).padStart(2, '0')}h ` +
    `${String(minutes).padStart(2, '0')}min ` +
    `${String(seconds).padStart(2, '0')}s`
  );
}


// ============================================================
// DÉMARRER COMPTE À REBOURS
// ============================================================

function startCountdown(expiresAt) {

  stopCountdown();

  const expiration =
    getTime(expiresAt);

  if (!expiration) {
    return;
  }

  contractExpiresAt =
    expiration;

  updateCountdown();

  countdownInterval =
    setInterval(
      updateCountdown,
      1000
    );
}


function stopCountdown() {

  if (
    countdownInterval
  ) {

    clearInterval(
      countdownInterval
    );

    countdownInterval =
      null;
  }
}


// ============================================================
// MISE À JOUR COMPTE À REBOURS
// ============================================================

function updateCountdown() {

  if (
    !contractExpiresAt
  ) {
    return;
  }

  const remaining =
    contractExpiresAt -
    Date.now();

  if (
    remaining <= 0
  ) {

    expireContract();

    return;
  }

  const text =
    formatCountdown(
      remaining
    );


  // État "déjà signé"

  if (
    els.alreadySignedCountdown
  ) {

    els.alreadySignedCountdown.textContent =
      text;
  }


  // État "succès"

  if (
    els.successCountdown
  ) {

    els.successCountdown.textContent =
      text;
  }
}


// ============================================================
// EXPIRATION
// ============================================================

function expireContract() {

  stopCountdown();

  contractExpiresAt =
    null;


  if (
    els.alreadySignedCountdown
  ) {

    els.alreadySignedCountdown.textContent =
      '00h 00min 00s';
  }


  if (
    els.successCountdown
  ) {

    els.successCountdown.textContent =
      '00h 00min 00s';
  }


  if (
    els.alreadySignedExpirationMessage
  ) {

    els.alreadySignedExpirationMessage.hidden =
      false;
  }


  if (
    els.successExpirationMessage
  ) {

    els.successExpirationMessage.hidden =
      false;
  }


  disablePdfButton(
    els.downloadPdf
  );

  disablePdfButton(
    els.successPdf
  );
}


// ============================================================
// ACTIVER PDF
// ============================================================

function enablePdfButton(
  button
) {

  if (!button) return;

  button.href =
    getPdfUrl();

  button.hidden =
    false;

  button.classList.remove(
    'disabled'
  );

  button.removeAttribute(
    'aria-disabled'
  );
}


// ============================================================
// DÉSACTIVER PDF
// ============================================================

function disablePdfButton(
  button
) {

  if (!button) return;

  button.removeAttribute(
    'href'
  );

  button.classList.add(
    'disabled'
  );

  button.setAttribute(
    'aria-disabled',
    'true'
  );

  button.hidden =
    false;
}


// ============================================================
// AFFICHER LE CONTRAT
// ============================================================

function displayContract(
  contract
) {

  if (
    els.contractTitle
  ) {

    els.contractTitle.textContent =
      contract.title || '';
  }


  if (
    els.contractCreatorName
  ) {

    els.contractCreatorName.textContent =
      contract.creatorName || '';
  }


  if (
    els.contractContent
  ) {

    /*
     * textContent volontairement utilisé.
     *
     * Cela évite qu'un contenu provenant
     * de Firestore puisse injecter du HTML.
     */

    els.contractContent.textContent =
      contract.content || '';
  }


  /*
   * IMPORTANT :
   *
   * On ne pré-remplit PAS le nom du client.
   * Le client doit lui-même saisir son nom.
   */

  if (
    els.typedName
  ) {

    els.typedName.value =
      '';

    els.typedName.placeholder =
      'Ex. Jean Dupont';
  }
}


// ============================================================
// SIGNATURE CANVAS
// ============================================================

function initSignaturePad() {

  if (!els.canvas) {
    return;
  }

  const canvas =
    els.canvas;

  const ctx =
    canvas.getContext(
      '2d'
    );

  if (!ctx) {
    return;
  }

  let drawing =
    false;

  let hasSignature =
    false;


  function getPosition(
    event
  ) {

    const rect =
      canvas.getBoundingClientRect();

    const source =
      event.touches &&
      event.touches.length
        ? event.touches[0]
        : event;

    return {
      x:
        (source.clientX -
          rect.left) *
        (canvas.width /
          rect.width),

      y:
        (source.clientY -
          rect.top) *
        (canvas.height /
          rect.height)
    };
  }


  function startDrawing(
    event
  ) {

    drawing =
      true;

    hasSignature =
      true;

    const point =
      getPosition(event);

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
      getPosition(event);

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


  ctx.lineWidth =
    2.5;

  ctx.lineCap =
    'round';

  ctx.lineJoin =
    'round';

  ctx.strokeStyle =
    '#222';


  canvas.addEventListener(
    'mousedown',
    startDrawing
  );

  canvas.addEventListener(
    'mousemove',
    draw
  );

  canvas.addEventListener(
    'mouseup',
    stopDrawing
  );

  canvas.addEventListener(
    'mouseleave',
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


  if (
    els.clearSignature
  ) {

    els.clearSignature.addEventListener(
      'click',
      () => {

        ctx.clearRect(
          0,
          0,
          canvas.width,
          canvas.height
        );

        hasSignature =
          false;
      }
    );
  }


  signaturePad = {

    isEmpty() {
      return !hasSignature;
    },

    toDataURL() {
      return canvas.toDataURL(
        'image/png'
      );
    }
  };
}


// ============================================================
// CHARGER LE CONTRAT
// ============================================================

async function loadContract() {

  if (!token) {

    showError(
      'Ce lien de signature est invalide.'
    );

    return;
  }


  showState(
    els.loading
  );


  try {

    const url =
      `${API_BASE}/api/contracts/public/` +
      encodeURIComponent(token);


    const {
      response,
      data
    } =
      await apiRequest(
        url
      );


    // --------------------------------------------------------
    // EXPIRÉ
    // --------------------------------------------------------

    if (
      response.status === 410 ||
      data.status === 'expired'
    ) {

      showError(
        data.message ||
        'Le délai de 24 heures est expiré.'
      );

      return;
    }


    // --------------------------------------------------------
    // ERREUR
    // --------------------------------------------------------

    if (
      !response.ok
    ) {

      showError(
        data.message ||
        'Impossible de charger le contrat.'
      );

      return;
    }


    // --------------------------------------------------------
    // DÉJÀ SIGNÉ
    // --------------------------------------------------------

    if (
      data.status === 'signed'
    ) {

      if (
        els.alreadySignedDate &&
        data.signerSignedAt
      ) {

        els.alreadySignedDate.textContent =
          new Date(
            data.signerSignedAt
          ).toLocaleString(
            'fr-FR'
          );
      }


      const expiration =
        getTime(
          data.expiresAt
        );


      if (
        expiration &&
        Date.now() < expiration
      ) {

        startCountdown(
          data.expiresAt
        );

        if (
          els.alreadySignedCountdownContainer
        ) {

          els.alreadySignedCountdownContainer.hidden =
            false;
        }

        enablePdfButton(
          els.downloadPdf
        );

      } else {

        expireContract();
      }


      showState(
        els.alreadySigned
      );

      return;
    }


    // --------------------------------------------------------
    // CONTRAT EN ATTENTE
    // --------------------------------------------------------

    if (
      data.status !== 'pending'
    ) {

      showError(
        'Ce contrat n’est plus disponible.'
      );

      return;
    }


    displayContract(
      data
    );


    showState(
      els.contractView
    );


    initSignaturePad();

  } catch (error) {

    console.error(
      'Erreur chargement contrat:',
      error
    );

    showError(
      error.message ||
      'Impossible de charger le contrat.'
    );
  }
}


// ============================================================
// SIGNER
// ============================================================

async function signContract() {

  if (
    els.signError
  ) {

    els.signError.hidden =
      true;
  }


  // ----------------------------------------------------------
  // CONDITIONS
  // ----------------------------------------------------------

  if (
    !els.terms ||
    !els.terms.checked
  ) {

    showSignError(
      'Vous devez accepter les termes du contrat.'
    );

    return;
  }


  // ----------------------------------------------------------
  // NOM
  // ----------------------------------------------------------

  const typedName =
    els.typedName
      ? els.typedName.value.trim()
      : '';


  if (!typedName) {

    showSignError(
      'Veuillez saisir votre nom complet.'
    );

    els.typedName?.focus();

    return;
  }


  if (
    typedName.length < 2
  ) {

    showSignError(
      'Votre nom est trop court.'
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
      'Veuillez dessiner votre signature.'
    );

    return;
  }


  // ----------------------------------------------------------
  // BOUTON
  // ----------------------------------------------------------

  const originalText =
    els.signButton
      ? els.signButton.textContent
      : 'Signer le contrat';


  if (
    els.signButton
  ) {

    els.signButton.disabled =
      true;

    els.signButton.textContent =
      'Signature en cours…';
  }


  try {

    const signatureDataUrl =
      signaturePad.toDataURL();


    const url =
      `${API_BASE}/api/contracts/public/` +
      `${encodeURIComponent(token)}/sign`;


    const {
      response,
      data
    } =
      await apiRequest(
        url,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({

              termsAccepted:
                true,

              typedName:
                typedName,

              signatureDataUrl:
                signatureDataUrl
            })
        }
      );


    // --------------------------------------------------------
    // EXPIRÉ
    // --------------------------------------------------------

    if (
      response.status === 410 ||
      data.status === 'expired'
    ) {

      showSignError(
        data.message ||
        'Le contrat a expiré.'
      );

      return;
    }


    // --------------------------------------------------------
    // ERREUR
    // --------------------------------------------------------

    if (
      !response.ok
    ) {

      throw new Error(
        data.message ||
        'La signature a échoué.'
      );
    }


    // --------------------------------------------------------
    // VÉRIFICATION
    // --------------------------------------------------------

    if (
      data.status !== 'signed'
    ) {

      throw new Error(
        'La signature n’a pas été confirmée.'
      );
    }


    // --------------------------------------------------------
    // 24 HEURES
    // --------------------------------------------------------

    contractExpiresAt =
      getTime(
        data.expiresAt
      );


    if (
      !contractExpiresAt
    ) {

      throw new Error(
        'La date d’expiration du contrat est manquante.'
      );
    }


    // --------------------------------------------------------
    // AFFICHAGE
    // --------------------------------------------------------

    if (
      els.successCountdownContainer
    ) {

      els.successCountdownContainer.hidden =
        false;
    }


    if (
      els.successExpirationMessage
    ) {

      els.successExpirationMessage.hidden =
        true;
    }


    startCountdown(
      data.expiresAt
    );


    // --------------------------------------------------------
    // PDF
    // --------------------------------------------------------

    enablePdfButton(
      els.successPdf
    );


    // --------------------------------------------------------
    // ÉTAT SUCCÈS
    // --------------------------------------------------------

    showState(
      els.success
    );


  } catch (error) {

    console.error(
      'Erreur signature:',
      error
    );

    showSignError(
      error.message ||
      'Impossible de signer le contrat.'
    );

  } finally {

    if (
      els.signButton
    ) {

      els.signButton.disabled =
        false;

      els.signButton.textContent =
        originalText;
    }
  }
}


// ============================================================
// ÉVÉNEMENT SIGNATURE
// ============================================================

if (
  els.signButton
) {

  els.signButton.addEventListener(
    'click',
    signContract
  );
}


// ============================================================
// NETTOYAGE
// ============================================================

window.addEventListener(
  'beforeunload',
  () => {

    stopCountdown();
  }
);


// ============================================================
// DÉMARRAGE
// ============================================================

loadContract();
