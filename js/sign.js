// js/sign.js
// Page publique de signature Kontra-Africa

const API_BASE = 'https://kontra-africa.onrender.com';

const params = new URLSearchParams(
  window.location.search
);

const token = params.get('token');

// ============================================================
// ÉLÉMENTS DOM
// ============================================================

const els = {
  loading:
    document.getElementById('state-loading'),

  error:
    document.getElementById('state-error'),

  errorMessage:
    document.getElementById('error-message'),

  alreadySigned:
    document.getElementById('state-already-signed'),

  alreadySignedDate:
    document.getElementById('already-signed-date'),

  linkDownloadPdf:
    document.getElementById('link-download-pdf'),

  contractView:
    document.getElementById('contract-view'),

  title:
    document.getElementById('contract-title'),

  creatorName:
    document.getElementById('contract-creator-name'),

  content:
    document.getElementById('contract-content'),

  checkboxTerms:
    document.getElementById('checkbox-terms'),

  typedName:
    document.getElementById('input-typed-name'),

  signError:
    document.getElementById('sign-error'),

  btnSign:
    document.getElementById('btn-sign'),

  success:
    document.getElementById('state-success'),

  linkDownloadPdfSuccess:
    document.getElementById(
      'link-download-pdf-success'
    ),

  // Compte à rebours
  countdown:
    document.getElementById(
      'contract-countdown'
    ),

  countdownContainer:
    document.getElementById(
      'countdown-container'
    ),

  expirationMessage:
    document.getElementById(
      'expiration-message'
    ),
};

let signaturePad = null;
let countdownInterval = null;
let contractExpiresAt = null;

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
  ].forEach((el) => {
    if (el) {
      el.hidden = el !== element;
    }
  });
}

// ============================================================
// ERREUR
// ============================================================

function showLoadError(message) {
  if (els.errorMessage) {
    els.errorMessage.textContent =
      message;
  }

  showOnly(els.error);
}

// ============================================================
// REQUÊTE API
// ============================================================

async function fetchJson(
  url,
  options = {},
  timeoutMs = 25000
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response =
      await fetch(url, {
        ...options,

        signal:
          controller.signal,

        headers: {
          Accept:
            'application/json',

          ...(options.headers || {}),
        },
      });

    const contentType =
      response.headers.get(
        'content-type'
      ) || '';

    let body = {};

    if (
      contentType.includes(
        'application/json'
      )
    ) {
      body =
        await response
          .json()
          .catch(() => ({}));
    } else {
      const text =
        await response
          .text()
          .catch(() => '');

      body = text
        ? { message: text }
        : {};
    }

    return {
      response,
      body,
    };

  } catch (error) {

    if (
      error.name ===
      'AbortError'
    ) {
      throw new Error(
        'Le serveur met trop de temps à répondre.'
      );
    }

    throw new Error(
      'Impossible de joindre le serveur Kontra-Africa. Vérifie ta connexion.'
    );

  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// URL PDF
// ============================================================

function buildPdfUrl(currentToken) {
  return (
    `${API_BASE}/api/contracts/public/` +
    `${encodeURIComponent(
      currentToken
    )}/pdf`
  );
}

// ============================================================
// CONVERSION DATE
// ============================================================

function getExpirationTime(value) {
  if (!value) {
    return null;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number'
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
      value.seconds * 1000 +
      Math.floor(
        (value.nanoseconds || 0) /
          1000000
      )
    );
  }

  return null;
}

// ============================================================
// FORMATAGE DU COMPTE À REBOURS
// ============================================================

function formatCountdown(
  milliseconds
) {
  if (
    milliseconds <= 0
  ) {
    return '00h 00min 00s';
  }

  const totalSeconds =
    Math.floor(
      milliseconds / 1000
    );

  const days =
    Math.floor(
      totalSeconds /
        86400
    );

  const hours =
    Math.floor(
      (totalSeconds %
        86400) /
        3600
    );

  const minutes =
    Math.floor(
      (totalSeconds %
        3600) /
        60
    );

  const seconds =
    totalSeconds % 60;

  const hh =
    String(hours).padStart(
      2,
      '0'
    );

  const mm =
    String(minutes).padStart(
      2,
      '0'
    );

  const ss =
    String(seconds).padStart(
      2,
      '0'
    );

  if (days > 0) {
    return `${days}j ${hh}h ${mm}min ${ss}s`;
  }

  return `${hh}h ${mm}min ${ss}s`;
}

// ============================================================
// COMPTE À REBOURS
// ============================================================

function startCountdown(
  expiresAt
) {
  stopCountdown();

  const expiration =
    getExpirationTime(
      expiresAt
    );

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

  if (
    els.countdown
  ) {
    els.countdown.textContent =
      formatCountdown(
        remaining
      );
  }

  if (
    els.countdownContainer
  ) {
    els.countdownContainer.hidden =
      false;
  }

  if (
    els.expirationMessage
  ) {
    els.expirationMessage.hidden =
      true;
  }
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
// EXPIRATION
// ============================================================

function expireContract() {
  stopCountdown();

  if (
    els.countdown
  ) {
    els.countdown.textContent =
      '00h 00min 00s';
  }

  if (
    els.expirationMessage
  ) {
    els.expirationMessage.textContent =
      'Le délai de 24 heures est expiré. Le PDF n’est plus disponible.';

    els.expirationMessage.hidden =
      false;
  }

  if (
    els.countdownContainer
  ) {
    els.countdownContainer.hidden =
      false;
  }

  if (
    els.linkDownloadPdfSuccess
  ) {
    els.linkDownloadPdfSuccess.removeAttribute(
      'href'
    );

    els.linkDownloadPdfSuccess.textContent =
      'Contrat expiré';

    els.linkDownloadPdfSuccess.classList.add(
      'disabled'
    );

    els.linkDownloadPdfSuccess.setAttribute(
      'aria-disabled',
      'true'
    );
  }

  if (
    els.linkDownloadPdf
  ) {
    els.linkDownloadPdf.removeAttribute(
      'href'
    );

    els.linkDownloadPdf.textContent =
      'Contrat expiré';

    els.linkDownloadPdf.classList.add(
      'disabled'
    );

    els.linkDownloadPdf.setAttribute(
      'aria-disabled',
      'true'
    );
  }
}

// ============================================================
// AFFICHER PDF
// ============================================================

function enablePdfDownload(
  currentToken,
  linkElement
) {
  if (!linkElement) {
    return;
  }

  const expiration =
    contractExpiresAt;

  if (
    expiration &&
    Date.now() >= expiration
  ) {
    expireContract();

    return;
  }

  linkElement.href =
    buildPdfUrl(
      currentToken
    );

  linkElement.hidden =
    false;

  linkElement.classList.remove(
    'disabled'
  );

  linkElement.removeAttribute(
    'aria-disabled'
  );
}

// ============================================================
// CHARGEMENT DU CONTRAT
// ============================================================

async function init() {

  if (!token) {

    showLoadError(
      'Lien de signature invalide : aucun code de signature fourni.'
    );

    return;
  }

  showOnly(
    els.loading
  );

  try {

    const url =
      `${API_BASE}/api/contracts/public/` +
      encodeURIComponent(token);

    const {
      response,
      body,
    } =
      await fetchJson(
        url
      );

    // ========================================================
    // CONTRAT EXPIRÉ
    // ========================================================

    if (
      response.status ===
      410 ||
      body.status ===
        'expired'
    ) {

      showLoadError(
        body.message ||
        'Le délai de 24 heures de ce contrat est expiré.'
      );

      return;
    }

    if (!response.ok) {

      showLoadError(
        body.message ||
        `Impossible de charger le contrat (HTTP ${response.status}).`
      );

      return;
    }

    const contract =
      body;

    // ========================================================
    // CONTRAT DÉJÀ SIGNÉ
    // ========================================================

    if (
      contract.status ===
      'signed'
    ) {

      if (
        contract.signerSignedAt &&
        els.alreadySignedDate
      ) {

        els.alreadySignedDate.textContent =
          new Date(
            contract.signerSignedAt
          ).toLocaleDateString(
            'fr-FR'
          );
      }

      // Enregistrement de l'expiration
      contractExpiresAt =
        getExpirationTime(
          contract.expiresAt
        );

      if (
        contractExpiresAt
      ) {
        startCountdown(
          contract.expiresAt
        );

        enablePdfDownload(
          token,
          els.linkDownloadPdf
        );
      }

      showOnly(
        els.alreadySigned
      );

      return;
    }

    // ========================================================
    // CONTRAT REFUSÉ
    // ========================================================

    if (
      contract.status ===
      'rejected'
    ) {

      showLoadError(
        'Ce contrat a été refusé.'
      );

      return;
    }

    // ========================================================
    // CONTRAT NON DISPONIBLE
    // ========================================================

    if (
      contract.status !==
      'pending'
    ) {

      showLoadError(
        'Ce contrat n’est plus disponible.'
      );

      return;
    }

    // ========================================================
    // AFFICHER LES INFOS
    // ========================================================

    if (els.title) {
      els.title.textContent =
        contract.title || '';
    }

    if (
      els.creatorName
    ) {
      els.creatorName.textContent =
        contract.creatorName ||
        '';
    }

    if (
      els.content
    ) {
      els.content.textContent =
        contract.content ||
        '';
    }

    // ========================================================
    // NOM CLIENT
    // ========================================================

    /*
     * IMPORTANT :
     *
     * Le champ est TOUJOURS vide.
     *
     * Le nom attendu provenant de Firestore
     * n'est PAS injecté dans le champ.
     */

    if (
      els.typedName
    ) {

      els.typedName.value =
        '';

      els.typedName.placeholder =
        'Saisissez votre nom complet';

      els.typedName.autocomplete =
        'name';
    }

    // ========================================================
    // AFFICHAGE
    // ========================================================

    showOnly(
      els.contractView
    );

    initSignaturePad();

  } catch (error) {

    console.error(
      'Erreur de chargement du contrat :',
      error
    );

    showLoadError(
      error.message ||
      'Impossible de charger le contrat.'
    );
  }
}

// ============================================================
// SIGNATURE CANVAS
// ============================================================

function initSignaturePad() {

  const canvas =
    document.getElementById(
      'signature-canvas'
    );

  if (!canvas) {
    console.error(
      'Canvas de signature introuvable.'
    );

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

  function getPoint(
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

  function start(
    event
  ) {

    drawing =
      true;

    hasStroke =
      true;

    const point =
      getPoint(
        event
      );

    ctx.beginPath();

    ctx.moveTo(
      point.x,
      point.y
    );

    event.preventDefault();
  }

  function move(
    event
  ) {

    if (!drawing) {
      return;
    }

    const point =
      getPoint(
        event
      );

    ctx.lineTo(
      point.x,
      point.y
    );

    ctx.stroke();

    event.preventDefault();
  }

  function end() {
    drawing =
      false;
  }

  canvas.onmousedown =
    start;

  canvas.onmousemove =
    move;

  canvas.onmouseleave =
    end;

  window.onmouseup =
    end;

  canvas.ontouchstart =
    start;

  canvas.ontouchmove =
    move;

  canvas.ontouchend =
    end;

  canvas.ontouchcancel =
    end;

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
// ERREUR SIGNATURE
// ============================================================

function showSignError(
  message
) {

  if (!els.signError) {
    return;
  }

  els.signError.textContent =
    message;

  els.signError.hidden =
    false;
}

// ============================================================
// SIGNER LE CONTRAT
// ============================================================

async function signContract() {

  if (
    els.signError
  ) {
    els.signError.hidden =
      true;
  }

  // ==========================================================
  // ACCEPTATION
  // ==========================================================

  if (
    !els.checkboxTerms ||
    !els.checkboxTerms.checked
  ) {

    showSignError(
      'Merci de cocher la case d’acceptation des termes.'
    );

    return;
  }

  // ==========================================================
  // NOM CLIENT
  // ==========================================================

  const typedName =
    els.typedName
      ? els.typedName.value.trim()
      : '';

  if (!typedName) {

    showSignError(
      'Vous devez saisir votre nom complet avant de signer.'
    );

    if (
      els.typedName
    ) {
      els.typedName.focus();
    }

    return;
  }

  if (
    typedName.length < 2
  ) {

    showSignError(
      'Votre nom doit contenir au moins 2 caractères.'
    );

    return;
  }

  if (
    typedName.length > 150
  ) {

    showSignError(
      'Votre nom est trop long.'
    );

    return;
  }

  // ==========================================================
  // SIGNATURE
  // ==========================================================

  if (
    !signaturePad ||
    signaturePad.isEmpty()
  ) {

    showSignError(
      'Ajoutez votre signature pour continuer.'
    );

    return;
  }

  if (!token) {

    showSignError(
      'Lien de signature invalide.'
    );

    return;
  }

  // ==========================================================
  // BOUTON
  // ==========================================================

  if (
    els.btnSign
  ) {

    els.btnSign.disabled =
      true;

    els.btnSign.textContent =
      'Signature en cours…';
  }

  try {

    const signatureDataUrl =
      signaturePad.toDataURL();

    const url =
      `${API_BASE}/api/contracts/public/` +
      `${encodeURIComponent(
        token
      )}/sign`;

    const {
      response,
      body,
    } =
      await fetchJson(
        url,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json',
          },

          body:
            JSON.stringify({
              termsAccepted:
                true,

              signatureDataUrl,

              typedName,
            }),
        },
        30000
      );

    // ========================================================
    // EXPIRATION / ERREUR
    // ========================================================

    if (
      response.status ===
      410 ||
      body.status ===
        'expired'
    ) {

      showSignError(
        body.message ||
        'Le contrat a expiré.'
      );

      return;
    }

    if (
      !response.ok
    ) {

      throw new Error(
        body.message ||
        `La signature a échoué (HTTP ${response.status}).`
      );
    }

    if (
      body.status !==
      'signed'
    ) {

      throw new Error(
        'La signature n’a pas été confirmée par le serveur.'
      );
    }

    // ========================================================
    // EXPIRATION
    // ========================================================

    contractExpiresAt =
      getExpirationTime(
        body.expiresAt
      );

    if (
      contractExpiresAt
    ) {

      startCountdown(
        body.expiresAt
      );
    }

    // ========================================================
    // PDF
    // ========================================================

    const pdfUrl =
      buildPdfUrl(
        token
      );

    if (
      els.linkDownloadPdfSuccess
    ) {

      els.linkDownloadPdfSuccess.href =
        pdfUrl;

      els.linkDownloadPdfSuccess.hidden =
        false;

      els.linkDownloadPdfSuccess.classList.remove(
        'disabled'
      );
    }

    // ========================================================
    // SUCCÈS
    // ========================================================

    showOnly(
      els.success
    );

    /*
     * Le PDF n'est pas stocké.
     *
     * Le serveur le génère uniquement lorsque
     * l'utilisateur clique sur Télécharger.
     */

  } catch (error) {

    console.error(
      'Erreur de signature :',
      error
    );

    showSignError(
      error.message ||
      'La signature a échoué. Réessayez.'
    );

  } finally {

    if (
      els.btnSign
    ) {

      els.btnSign.disabled =
        false;

      els.btnSign.textContent =
        'Signer le contrat';
    }
  }
}

// ============================================================
// BOUTON SIGNER
// ============================================================

if (
  els.btnSign
) {

  els.btnSign.addEventListener(
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

init();
