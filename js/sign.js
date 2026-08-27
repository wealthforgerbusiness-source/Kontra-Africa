// js/sign.js
// Page publique de signature Kontra-Africa

const API_BASE = 'https://kontra-africa.onrender.com';

const params = new URLSearchParams(
  window.location.search
);

const token = params.get('token');

const els = {
  loading:
    document.getElementById('state-loading'),

  error:
    document.getElementById('state-error'),

  errorMessage:
    document.getElementById('error-message'),

  alreadySigned:
    document.getElementById(
      'state-already-signed'
    ),

  alreadySignedDate:
    document.getElementById(
      'already-signed-date'
    ),

  linkDownloadPdf:
    document.getElementById(
      'link-download-pdf'
    ),

  contractView:
    document.getElementById(
      'contract-view'
    ),

  title:
    document.getElementById(
      'contract-title'
    ),

  creatorName:
    document.getElementById(
      'contract-creator-name'
    ),

  content:
    document.getElementById(
      'contract-content'
    ),

  checkboxTerms:
    document.getElementById(
      'checkbox-terms'
    ),

  typedName:
    document.getElementById(
      'input-typed-name'
    ),

  signError:
    document.getElementById(
      'sign-error'
    ),

  btnSign:
    document.getElementById(
      'btn-sign'
    ),

  success:
    document.getElementById(
      'state-success'
    ),

  linkDownloadPdfSuccess:
    document.getElementById(
      'link-download-pdf-success'
    ),
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
  ].forEach((el) => {
    if (el) {
      el.hidden = el !== element;
    }
  });
}

// ============================================================
// ERREUR DE CHARGEMENT
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
        'Le serveur met trop de temps à répondre. Le serveur Kontra-Africa est peut-être en cours de démarrage.'
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
// CHARGEMENT DU CONTRAT
// ============================================================

async function init() {

  if (!token) {

    showLoadError(
      'Lien de signature invalide : aucun code de signature fourni.'
    );

    return;
  }

  showOnly(els.loading);

  try {

    const url =
      `${API_BASE}/api/contracts/public/` +
      encodeURIComponent(token);

    const {
      response,
      body,
    } =
      await fetchJson(url);

    if (!response.ok) {

      showLoadError(
        body.message ||
        `Impossible de charger le contrat (HTTP ${response.status}).`
      );

      return;
    }

    const contract = body;

    // ========================================================
    // CONTRAT DÉJÀ SIGNÉ
    // ========================================================

    if (
      contract.status ===
      'signed'
    ) {

      if (
        els.alreadySignedDate
      ) {

        els.alreadySignedDate.textContent =
          contract.signerSignedAt
            ? new Date(
                contract.signerSignedAt
              ).toLocaleDateString(
                'fr-FR'
              )
            : '';
      }

      if (
        els.linkDownloadPdf
      ) {

        els.linkDownloadPdf.href =
          buildPdfUrl(token);

        els.linkDownloadPdf.hidden =
          false;
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
    // AFFICHER LE CONTRAT
    // ========================================================

    if (els.title) {
      els.title.textContent =
        contract.title || '';
    }

    if (els.creatorName) {
      els.creatorName.textContent =
        contract.creatorName || '';
    }

    if (els.content) {
      els.content.textContent =
        contract.content || '';
    }

    // ========================================================
    // IMPORTANT :
    // NE PAS PRÉREMPLIR LE NOM DU CLIENT
    // ========================================================

    if (els.typedName) {

      els.typedName.value = '';

      els.typedName.removeAttribute(
        'value'
      );

      els.typedName.placeholder =
        'Saisissez votre nom complet';

      els.typedName.autocomplete =
        'name';
    }

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
// SIGNATURE SUR CANVAS
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
    console.error(
      'Impossible d’initialiser le canvas.'
    );

    return;
  }

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

  function getPoint(event) {

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

  function start(event) {

    drawing = true;
    hasStroke = true;

    const point =
      getPoint(event);

    ctx.beginPath();

    ctx.moveTo(
      point.x,
      point.y
    );

    event.preventDefault();
  }

  function move(event) {

    if (!drawing) {
      return;
    }

    const point =
      getPoint(event);

    ctx.lineTo(
      point.x,
      point.y
    );

    ctx.stroke();

    event.preventDefault();
  }

  function end() {
    drawing = false;
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

        hasStroke = false;
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
// URL DU PDF
// ============================================================

function buildPdfUrl(
  currentToken
) {

  return (
    `${API_BASE}/api/contracts/public/` +
    `${encodeURIComponent(
      currentToken
    )}/pdf`
  );
}

// ============================================================
// ERREUR DE SIGNATURE
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

  if (els.signError) {
    els.signError.hidden =
      true;
  }

  // ----------------------------------------------------------
  // CONDITIONS
  // ----------------------------------------------------------

  if (
    !els.checkboxTerms ||
    !els.checkboxTerms.checked
  ) {

    showSignError(
      'Merci de cocher la case d’acceptation des termes.'
    );

    return;
  }

  // ----------------------------------------------------------
  // NOM DU CLIENT
  // ----------------------------------------------------------

  const typedName =
    els.typedName
      ? els.typedName.value.trim()
      : '';

  if (!typedName) {

    showSignError(
      'Vous devez saisir votre nom complet avant de signer.'
    );

    if (els.typedName) {
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

  if (!token) {

    showSignError(
      'Lien de signature invalide.'
    );

    return;
  }

  // ----------------------------------------------------------
  // BOUTON
  // ----------------------------------------------------------

  if (els.btnSign) {

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

    if (!response.ok) {

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

    // --------------------------------------------------------
    // SUCCÈS
    // --------------------------------------------------------

    const pdfUrl =
      buildPdfUrl(token);

    if (
      els.linkDownloadPdfSuccess
    ) {

      els.linkDownloadPdfSuccess.href =
        pdfUrl;

      els.linkDownloadPdfSuccess.hidden =
        false;
    }

    showOnly(
      els.success
    );

    // Ouvre le PDF signé dans un nouvel onglet.
    window.open(
      pdfUrl,
      '_blank',
      'noopener'
    );

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

    if (els.btnSign) {

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

if (els.btnSign) {

  els.btnSign.addEventListener(
    'click',
    signContract
  );

} else {

  console.error(
    'Bouton de signature introuvable.'
  );
}

// ============================================================
// DÉMARRAGE
// ============================================================

init();
