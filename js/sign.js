// js/sign.js
// Page publique de signature — aucune dépendance Firebase côté client :
// le signataire n'a pas de compte, tout passe par le backend (functions/src/contracts.js)
// qui utilise le SDK Admin pour lire/écrire Firestore en toute sécurité.

const API_BASE = ''; // même origine (Render)

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
  linkDownloadPdfSuccess: document.getElementById('link-download-pdf-success'),
};

let signaturePad = null;

function showOnly(el) {
  [els.loading, els.error, els.alreadySigned, els.contractView, els.success].forEach((e) => {
    e.hidden = e !== el;
  });
}

async function init() {
  if (!token) {
    els.errorMessage.textContent = "Lien invalide : aucun code de signature fourni.";
    showOnly(els.error);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/contracts/public/${encodeURIComponent(token)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      els.errorMessage.textContent = body.message || "Ce lien de signature est invalide ou a expiré.";
      showOnly(els.error);
      return;
    }

    const contract = await res.json();

    if (contract.status === 'signed') {
      els.alreadySignedDate.textContent = contract.signerSignedAt
        ? new Date(contract.signerSignedAt).toLocaleDateString('fr-FR')
        : '';
      if (contract.pdfUrlSigner) {
        els.linkDownloadPdf.href = contract.pdfUrlSigner;
        els.linkDownloadPdf.hidden = false;
      }
      showOnly(els.alreadySigned);
      return;
    }

    if (contract.status === 'rejected') {
      els.errorMessage.textContent = "Ce contrat a été refusé.";
      showOnly(els.error);
      return;
    }

    // status pending : afficher le contrat pour signature
    els.title.textContent = contract.title;
    els.creatorName.textContent = contract.creatorName;
    els.content.textContent = contract.content;
    showOnly(els.contractView);
    initSignaturePad();
  } catch (err) {
    console.error('Erreur de chargement du contrat :', err);
    els.errorMessage.textContent = "Impossible de charger le contrat. Vérifie ta connexion.";
    showOnly(els.error);
  }
}

function initSignaturePad() {
  const canvas = document.getElementById('signature-canvas');
  const ctx = canvas.getContext('2d');
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
    isEmpty: () => !hasStroke,
    toDataURL: () => canvas.toDataURL('image/png'),
  };
}

els.btnSign.addEventListener('click', async () => {
  els.signError.hidden = true;

  if (!els.checkboxTerms.checked) {
    return showSignError("Merci de cocher la case d'acceptation des termes.");
  }
  const typedName = els.typedName.value.trim();
  if (signaturePad.isEmpty() && !typedName) {
    return showSignError('Ajoute ta signature (dessin ou nom tapé) pour continuer.');
  }

  els.btnSign.disabled = true;
  els.btnSign.textContent = 'Signature en cours…';

  try {
    const res = await fetch(`${API_BASE}/api/contracts/public/${encodeURIComponent(token)}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        termsAccepted: true,
        signatureDataUrl: signaturePad.isEmpty() ? null : signaturePad.toDataURL(),
        typedName: typedName || null,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || 'La signature a échoué.');
    }

    const result = await res.json();
    if (result.pdfUrlSigner) {
      els.linkDownloadPdfSuccess.href = result.pdfUrlSigner;
    }
    showOnly(els.success);
  } catch (err) {
    console.error('Erreur de signature :', err);
    showSignError(err.message || 'La signature a échoué. Réessaie.');
  } finally {
    els.btnSign.disabled = false;
    els.btnSign.textContent = 'Signer le contrat';
  }
});

function showSignError(message) {
  els.signError.textContent = message;
  els.signError.hidden = false;
}

init();
