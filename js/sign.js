// js/sign.js
// Page publique de signature — Kontra-Africa

const API_BASE = 'https://kontra-africa.onrender.com';

const params = new URLSearchParams(window.location.search);
const token = params.get('token');

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

  downloadPdf:
    document.getElementById('link-download-pdf'),

  contractView:
    document.getElementById('contract-view'),

  contractTitle:
    document.getElementById('contract-title'),

  contractCreatorName:
    document.getElementById('contract-creator-name'),

  contractContent:
    document.getElementById('contract-content'),

  terms:
    document.getElementById('checkbox-terms'),

  typedName:
    document.getElementById('input-typed-name'),

  canvas:
    document.getElementById('signature-canvas'),

  clearSignature:
    document.getElementById('btn-clear-signature'),

  signError:
    document.getElementById('sign-error'),

  signButton:
    document.getElementById('btn-sign'),

  success:
    document.getElementById('state-success'),

  successPdf:
    document.getElementById(
      'link-download-pdf-success'
    )
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

    if (!element) {
      return;
    }

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

  showState(
    els.error
  );
}


function showSignError(message) {

  if (!els.signError) {
    return;
  }

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
    await fetch(
      url,
      {
        ...options,

        headers: {
          Accept:
            'application/json',

          ...(options.headers || {})
        }
      }
    );


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
      await response
        .json()
        .catch(
          () => ({})
        );

  } else {

    const text =
      await response
        .text()
        .catch(
          () => ''
        );

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
// AFFICHER LE CONTRAT
// ============================================================

function displayContract(
  contract
) {

  if (els.contractTitle) {

    els.contractTitle.textContent =
      contract.title || '';

  }


  if (els.contractCreatorName) {

    els.contractCreatorName.textContent =
      contract.creatorName || '';

  }


  if (els.contractContent) {

    /*
     * IMPORTANT :
     *
     * textContent empêche l'injection
     * de HTML venant de Firestore.
     */

    els.contractContent.textContent =
      contract.content || '';

  }


  /*
   * IMPORTANT :
   *
   * Le nom du client n'est JAMAIS
   * prérempli.
   *
   * Le client doit le saisir lui-même.
   */

  if (els.typedName) {

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
    {
      passive: false
    }
  );


  canvas.addEventListener(
    'touchmove',
    draw,
    {
      passive: false
    }
  );


  canvas.addEventListener(
    'touchend',
    stopDrawing
  );


  if (els.clearSignature) {

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
        'Ce contrat a expiré.'
      );

      return;

    }


    // --------------------------------------------------------
    // ERREUR
    // --------------------------------------------------------

    if (!response.ok) {

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


      /*
       * IMPORTANT :
       *
       * Aucun compte à rebours ici.
       *
       * La signature du client ne démarre
       * PAS les 24 heures.
       *
       * Le créateur déclenchera les 24 h
       * depuis son interface.
       */


      if (els.downloadPdf) {

        els.downloadPdf.hidden =
          true;

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


  if (els.signButton) {

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

          method:
            'POST',

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

    if (!response.ok) {

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


    // ========================================================
    // IMPORTANT : PAS DE 24 H ICI
    // ========================================================

    /*
     * Le client vient de signer.
     *
     * Le backend doit simplement avoir enregistré
     * la signature et changé le statut en "signed".
     *
     * Le compte à rebours de 24 h NE commence PAS ici.
     *
     * Le créateur le déclenchera lorsqu'il cliquera
     * sur "Télécharger le PDF".
     */


    // ========================================================
    // TÉLÉCHARGEMENT AUTOMATIQUE DU CLIENT
    // ========================================================

    /*
     * Le client reçoit son PDF immédiatement.
     *
     * IMPORTANT :
     * cette requête ne doit pas démarrer le compteur.
     *
     * Le backend doit autoriser le PDF du signataire
     * juste après la signature.
     */

    await downloadPdfAutomatically();


    // ========================================================
    // SUCCÈS
    // ========================================================

    showState(
      els.success
    );


    /*
     * Le bouton PDF de la page succès est caché,
     * car le PDF vient déjà d'être téléchargé.
     */

    if (els.successPdf) {

      els.successPdf.hidden =
        true;

    }


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

    if (els.signButton) {

      els.signButton.disabled =
        false;

      els.signButton.textContent =
        originalText;

    }

  }

}


// ============================================================
// TÉLÉCHARGEMENT AUTOMATIQUE PDF
// ============================================================

async function downloadPdfAutomatically() {

  /*
   * Petite attente pour laisser Firestore terminer
   * l'enregistrement de la signature.
   */

  await new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        500
      )
  );


  const pdfUrl =
    getPdfUrl();


  const response =
    await fetch(
      pdfUrl,
      {
        method:
          'GET',

        headers: {
          Accept:
            'application/pdf'
        }
      }
    );


  if (!response.ok) {

    let message =
      'Le contrat a été signé, mais le PDF n’a pas pu être téléchargé.';


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

        if (data.message) {

          message =
            data.message;

        }

      }

    } catch (_) {
      // Rien à faire.
    }


    throw new Error(
      message
    );

  }


  const blob =
    await response.blob();


  if (
    !blob ||
    blob.size === 0
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
    'contrat-kontra-africa.pdf';


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

}


// ============================================================
// ÉVÉNEMENT SIGNATURE
// ============================================================

if (els.signButton) {

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

    // Aucun compte à rebours côté client.
    // Le délai est géré côté serveur.

  }
);


// ============================================================
// DÉMARRAGE
// ============================================================

loadContract();
