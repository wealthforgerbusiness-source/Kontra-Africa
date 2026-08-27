const API_BASE = 'https://kontra-africa.onrender.com';

// ============================================================
// TOKEN
// ============================================================

const params = new URLSearchParams(
  window.location.search
);

const token = params.get('token');

// ============================================================
// ELEMENTS DOM
// ============================================================

const els = {

  loading:
    document.getElementById(
      'state-loading'
    ),

  error:
    document.getElementById(
      'state-error'
    ),

  errorMessage:
    document.getElementById(
      'error-message'
    ),

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
// AFFICHAGE DES ETATS
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
// CHARGEMENT DU CONTRAT
// ============================================================

async function init() {

  // ----------------------------------------------------------
  // VERIFICATION TOKEN
  // ----------------------------------------------------------

  if (!token) {

    els.errorMessage.textContent =
      'Lien invalide : aucun code de signature fourni.';

    showOnly(els.error);

    return;
  }

  try {

    showOnly(els.loading);

    const res = await fetch(
      `${API_BASE}/api/contracts/public/${encodeURIComponent(token)}`
    );

    if (!res.ok) {

      const body =
        await res.json()
          .catch(() => ({}));

      els.errorMessage.textContent =
        body.message ||
        'Ce lien de signature est invalide ou a expiré.';

      showOnly(els.error);

      return;
    }

    const contract =
      await res.json();

    // --------------------------------------------------------
    // CONTRAT DEJA SIGNE
    // --------------------------------------------------------

    if (
      contract.status === 'signed'
    ) {

      els.alreadySignedDate.textContent =
        contract.signerSignedAt
          ? new Date(
              contract.signerSignedAt
            ).toLocaleDateString('fr-FR')
          : '';

      els.linkDownloadPdf.href =
        `${API_BASE}/api/contracts/public/${encodeURIComponent(token)}/pdf`;

      els.linkDownloadPdf.hidden =
        false;

      showOnly(
        els.alreadySigned
      );

      return;
    }

    // --------------------------------------------------------
    // CONTRAT REFUSE
    // --------------------------------------------------------

    if (
      contract.status === 'rejected'
    ) {

      els.errorMessage.textContent =
        'Ce contrat a été refusé.';

      showOnly(els.error);

      return;
    }

    // --------------------------------------------------------
    // CONTRAT EN ATTENTE
    // --------------------------------------------------------

    if (
      contract.status !== 'pending'
    ) {

      els.errorMessage.textContent =
        'Ce contrat n’est plus disponible.';

      showOnly(els.error);

      return;
    }

    // --------------------------------------------------------
    // AFFICHAGE
    // --------------------------------------------------------

    els.title.textContent =
      contract.title || '';

    els.creatorName.textContent =
      contract.creatorName || '';

    els.content.textContent =
      contract.content || '';

    // --------------------------------------------------------
    // SI LE CREATEUR AVAIT DEJA FOURNI UN NOM DE SIGNATAIRE
    // ON PEUT LE PRE-REMPLIR MAIS LE SIGNATAIRE DOIT
    // TOUJOURS LE CONFIRMER / MODIFIER AVANT SIGNATURE.
    // --------------------------------------------------------

    if (
      contract.signerName &&
      els.typedName
    ) {

      els.typedName.value =
        contract.signerName;
    }

    showOnly(
      els.contractView
    );

    initSignaturePad();

  } catch (err) {

    console.error(
      'Erreur de chargement du contrat :',
      err
    );

    els.errorMessage.textContent =
      "Impossible de charger le contrat. Vérifie ta connexion.";

    showOnly(els.error);
  }
}

// ============================================================
// SIGNATURE DESSINEE
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
    canvas.getContext('2d');

  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#2A2140';

  let drawing = false;
  let hasStroke = false;

  // ----------------------------------------------------------
  // POSITION
  // ----------------------------------------------------------

  function getPos(e) {

    const rect =
      canvas.getBoundingClientRect();

    const scaleX =
      canvas.width /
      rect.width;

    const scaleY =
      canvas.height /
      rect.height;

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

  // ----------------------------------------------------------
  // DEBUT
  // ----------------------------------------------------------

  function start(e) {

    drawing = true;
    hasStroke = true;

    const {
      x,
      y
    } = getPos(e);

    ctx.beginPath();

    ctx.moveTo(
      x,
      y
    );

    e.preventDefault();
  }

  // ----------------------------------------------------------
  // DESSIN
  // ----------------------------------------------------------

  function move(e) {

    if (!drawing) return;

    const {
      x,
      y
    } = getPos(e);

    ctx.lineTo(
      x,
      y
    );

    ctx.stroke();

    e.preventDefault();
  }

  // ----------------------------------------------------------
  // FIN
  // ----------------------------------------------------------

  function end() {

    drawing = false;
  }

  // ----------------------------------------------------------
  // SOURIS
  // ----------------------------------------------------------

  canvas.onmousedown =
    start;

  canvas.onmousemove =
    move;

  window.onmouseup =
    end;

  // ----------------------------------------------------------
  // MOBILE
  // ----------------------------------------------------------

  canvas.ontouchstart =
    start;

  canvas.ontouchmove =
    move;

  canvas.ontouchend =
    end;

  // ----------------------------------------------------------
  // EFFACER
  // ----------------------------------------------------------

  const clearBtn =
    document.getElementById(
      'btn-clear-signature'
    );

  if (clearBtn) {

    clearBtn.onclick = () => {

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

    isEmpty: () =>
      !hasStroke,

    toDataURL: () =>
      canvas.toDataURL(
        'image/png'
      ),
  };
}

// ============================================================
// SIGNATURE DU CONTRAT
// ============================================================

els.btnSign.addEventListener(
  'click',
  async () => {

    els.signError.hidden =
      true;

    // --------------------------------------------------------
    // CONDITIONS
    // --------------------------------------------------------

    if (
      !els.checkboxTerms.checked
    ) {

      return showSignError(
        "Merci de cocher la case d'acceptation des termes."
      );
    }

    // --------------------------------------------------------
    // NOM DU SIGNATAIRE
    // --------------------------------------------------------

    const typedName =
      els.typedName.value.trim();

    if (!typedName) {

      return showSignError(
        "Tu dois saisir ton nom complet avant de signer."
      );
    }

    if (
      typedName.length < 2
    ) {

      return showSignError(
        "Ton nom doit contenir au moins 2 caractères."
      );
    }

    // --------------------------------------------------------
    // SIGNATURE
    // --------------------------------------------------------

    if (
      !signaturePad ||
      signaturePad.isEmpty()
    ) {

      return showSignError(
        "Ajoute ta signature pour continuer."
      );
    }

    // --------------------------------------------------------
    // BOUTON
    // --------------------------------------------------------

    els.btnSign.disabled =
      true;

    els.btnSign.textContent =
      'Signature en cours…';

    try {

      // ------------------------------------------------------
      // DONNEES SIGNATURE
      // ------------------------------------------------------

      const signatureDataUrl =
        signaturePad.toDataURL();

      // ------------------------------------------------------
      // ENVOI BACKEND
      // ------------------------------------------------------

      const res =
        await fetch(
          `${API_BASE}/api/contracts/public/${encodeURIComponent(token)}/sign`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body: JSON.stringify({

              // Acceptation
              termsAccepted:
                true,

              // Signature dessinée
              signatureDataUrl:
                signatureDataUrl,

              // NOM SAISI PAR LE SIGNATAIRE
              typedName:
                typedName,
            }),
          }
        );

      // ------------------------------------------------------
      // ERREUR
      // ------------------------------------------------------

      if (!res.ok) {

        const body =
          await res.json()
            .catch(() => ({}));

        throw new Error(
          body.message ||
          'La signature a échoué.'
        );
      }

      const result =
        await res.json();

      console.log(
        '✅ Contrat signé :',
        result
      );

      // ------------------------------------------------------
      // SUCCES
      // ------------------------------------------------------

      if (
        result.status === 'signed'
      ) {

        const pdfUrl =
          `${API_BASE}/api/contracts/public/${encodeURIComponent(token)}/pdf`;

        // Mettre à jour le lien PDF
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

        // ----------------------------------------------------
        // TELECHARGEMENT AUTOMATIQUE
        // ----------------------------------------------------
        //
        // On garde le comportement actuel.
        // Le PDF sera généré côté serveur.
        //

        window.location.href =
          pdfUrl;

      } else {

        throw new Error(
          'La signature n’a pas été confirmée par le serveur.'
        );
      }

    } catch (err) {

      console.error(
        'Erreur de signature :',
        err
      );

      showSignError(
        err.message ||
        'La signature a échoué. Réessaie.'
      );

    } finally {

      els.btnSign.disabled =
        false;

      els.btnSign.textContent =
        'Signer le contrat';
    }
  }
);

// ============================================================
// MESSAGE ERREUR
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
// DEMARRAGE
// ============================================================

init();
