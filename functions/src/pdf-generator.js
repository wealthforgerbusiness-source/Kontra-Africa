const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');


// ============================================================
// CONFIGURATION
// ============================================================

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

const MARGIN = 50;

const PRIMARY_COLOR = '#5B3FE0';
const DARK_COLOR = '#2A2140';
const TEXT_COLOR = '#111111';
const MUTED_COLOR = '#6B6480';


// ============================================================
// CHEMIN DU SCEAU
// ============================================================
//
// __dirname = functions/src
//
// ../../images/kontrasceau.png
//        ↓
// racine du projet /images/kontrasceau.png
//

const SEAL_PATH = path.join(
  __dirname,
  '../../images/kontrasceau.png'
);


// ============================================================
// GENERATION DU PDF
// ============================================================

function generateContractPdf(contract) {

  return new Promise((resolve, reject) => {

    try {

      // --------------------------------------------------------
      // VERIFICATION DU SCEAU
      // --------------------------------------------------------

      if (!fs.existsSync(SEAL_PATH)) {

        return reject(
          new Error(
            `Sceau Kontra-Africa introuvable : ${SEAL_PATH}`
          )
        );
      }


      // --------------------------------------------------------
      // DOCUMENT A4
      // --------------------------------------------------------

      const doc = new PDFDocument({
        size: 'A4',
        margin: MARGIN,

        info: {
          Title:
            contract.title ||
            'Contrat Kontra-Africa',

          Author:
            'Kontra-Africa',

          Subject:
            'Contrat signé électroniquement',

          Creator:
            'Kontra-Africa',
        },
      });


      // --------------------------------------------------------
      // BUFFER
      // --------------------------------------------------------

      const chunks = [];

      doc.on(
        'data',
        (chunk) => {
          chunks.push(chunk);
        }
      );

      doc.on(
        'end',
        () => {
          resolve(
            Buffer.concat(chunks)
          );
        }
      );

      doc.on(
        'error',
        reject
      );


      // ======================================================
      // EN-TETE
      // ======================================================

      drawHeader(
        doc,
        contract
      );


      // ======================================================
      // INFORMATIONS DES PARTIES
      // ======================================================

      drawParties(
        doc,
        contract
      );


      // ======================================================
      // CONTENU DU CONTRAT
      // ======================================================

      drawContractContent(
        doc,
        contract
      );


      // ======================================================
      // SIGNATURES
      // ======================================================

      drawSignatures(
        doc,
        contract
      );


      // ======================================================
      // PIED DE PAGE
      // ======================================================

      drawFooter(
        doc
      );


      // ======================================================
      // FIN
      // ======================================================

      doc.end();

    } catch (err) {

      reject(err);
    }
  });
}


// ============================================================
// EN-TETE
// ============================================================

function drawHeader(
  doc,
  contract
) {

  // ----------------------------------------------------------
  // Sceau
  // ----------------------------------------------------------

  const sealSize = 105;

  const sealX =
    PAGE_WIDTH -
    MARGIN -
    sealSize;

  const sealY =
    38;


  doc.image(
    SEAL_PATH,
    sealX,
    sealY,
    {
      width:
        sealSize,

      height:
        sealSize,
    }
  );


  // ----------------------------------------------------------
  // NOM DE L'APPLICATION
  // ----------------------------------------------------------

  doc
    .fillColor(
      PRIMARY_COLOR
    )
    .font(
      'Helvetica-Bold'
    )
    .fontSize(21)
    .text(
      'KONTRA-AFRICA',
      MARGIN,
      48,
      {
        width:
          PAGE_WIDTH -
          MARGIN * 2 -
          sealSize -
          15,
      }
    );


  // ----------------------------------------------------------
  // SOUS-TITRE
  // ----------------------------------------------------------

  doc
    .fillColor(
      MUTED_COLOR
    )
    .font(
      'Helvetica'
    )
    .fontSize(9)
    .text(
      'CONTRAT ÉLECTRONIQUE',
      MARGIN,
      76
    );


  // ----------------------------------------------------------
  // LIGNE
  // ----------------------------------------------------------

  doc
    .moveTo(
      MARGIN,
      115
    )
    .lineTo(
      PAGE_WIDTH - MARGIN,
      115
    )
    .lineWidth(1)
    .strokeColor(
      PRIMARY_COLOR
    )
    .stroke();


  // ----------------------------------------------------------
  // GRAND TITRE
  // ----------------------------------------------------------

  const title =
    cleanText(
      contract.title ||
      'Contrat'
    );


  doc
    .fillColor(
      DARK_COLOR
    )
    .font(
      'Helvetica-Bold'
    )
    .fontSize(27)
    .text(
      title,
      MARGIN,
      135,
      {
        width:
          PAGE_WIDTH -
          MARGIN * 2,

        align:
          'center',

        lineGap:
          4,
      }
    );


  // ----------------------------------------------------------
  // PETITE LIGNE DECORATIVE
  // ----------------------------------------------------------

  const lineY =
    doc.y + 12;


  doc
    .moveTo(
      PAGE_WIDTH / 2 - 45,
      lineY
    )
    .lineTo(
      PAGE_WIDTH / 2 + 45,
      lineY
    )
    .lineWidth(2)
    .strokeColor(
      PRIMARY_COLOR
    )
    .stroke();


  doc.y =
    lineY + 25;
}


// ============================================================
// PARTIES
// ============================================================

function drawParties(
  doc,
  contract
) {

  const creatorName =
    cleanText(
      contract.creatorName ||
      '—'
    );


  // IMPORTANT :
  // On privilégie le nom réellement saisi
  // par le signataire.
  const signerName =
    cleanText(
      contract.signerTypedName ||
      contract.signerName ||
      '—'
    );


  const boxY =
    doc.y;


  const boxWidth =
    (
      PAGE_WIDTH -
      MARGIN * 2 -
      15
    ) / 2;


  // ----------------------------------------------------------
  // TITRE
  // ----------------------------------------------------------

  doc
    .fillColor(
      DARK_COLOR
    )
    .font(
      'Helvetica-Bold'
    )
    .fontSize(13)
    .text(
      'LES PARTIES',
      MARGIN,
      boxY
    );


  doc.y =
    boxY + 23;


  // ----------------------------------------------------------
  // CREATEUR
  // ----------------------------------------------------------

  drawPartyBox(
    doc,
    {
      x:
        MARGIN,

      y:
        doc.y,

      width:
        boxWidth,

      label:
        'CRÉATEUR',

      name:
        creatorName,
    }
  );


  // ----------------------------------------------------------
  // SIGNATAIRE
  // ----------------------------------------------------------

  drawPartyBox(
    doc,
    {
      x:
        MARGIN +
        boxWidth +
        15,

      y:
        boxY + 23,

      width:
        boxWidth,

      label:
        'SIGNATAIRE',

      name:
        signerName,
    }
  );


  doc.y =
    boxY +
    105;
}


// ============================================================
// BLOC PARTIE
// ============================================================

function drawPartyBox(
  doc,
  {
    x,
    y,
    width,
    label,
    name,
  }
) {

  doc
    .roundedRect(
      x,
      y,
      width,
      72,
      8
    )
    .lineWidth(1)
    .strokeColor(
      '#D9D4E5'
    )
    .stroke();


  doc
    .fillColor(
      PRIMARY_COLOR
    )
    .font(
      'Helvetica-Bold'
    )
    .fontSize(8)
    .text(
      label,
      x + 12,
      y + 12,
      {
        width:
          width - 24,
      }
    );


  doc
    .fillColor(
      TEXT_COLOR
    )
    .font(
      'Helvetica-Bold'
    )
    .fontSize(12)
    .text(
      name,
      x + 12,
      y + 31,
      {
        width:
          width - 24,
      }
    );
}


// ============================================================
// CONTENU DU CONTRAT
// ============================================================

function drawContractContent(
  doc,
  contract
) {

  const content =
    cleanText(
      contract.content ||
      ''
    );


  // ----------------------------------------------------------
  // TITRE
  // ----------------------------------------------------------

  doc
    .fillColor(
      DARK_COLOR
    )
    .font(
      'Helvetica-Bold'
    )
    .fontSize(13)
    .text(
      'CONTENU DU CONTRAT'
    );


  doc.moveDown(
    0.6
  );


  // ----------------------------------------------------------
  // TEXTE
  // ----------------------------------------------------------

  doc
    .fillColor(
      TEXT_COLOR
    )
    .font(
      'Helvetica'
    )
    .fontSize(11)
    .text(
      content,
      {
        align:
          'left',

        lineGap:
          5,

        paragraphGap:
          8,

        width:
          PAGE_WIDTH -
          MARGIN * 2,
      }
    );


  doc.moveDown(
    1.2
  );
}


// ============================================================
// SIGNATURES
// ============================================================

function drawSignatures(
  doc,
  contract
) {

  // ----------------------------------------------------------
  // EVITER DE COUPER LES SIGNATURES
  // ----------------------------------------------------------

  const requiredHeight =
    205;


  if (
    doc.y >
    PAGE_HEIGHT -
    MARGIN -
    requiredHeight
  ) {

    doc.addPage();

    drawPageHeader(
      doc
    );
  }


  // ----------------------------------------------------------
  // TITRE
  // ----------------------------------------------------------

  doc
    .fillColor(
      DARK_COLOR
    )
    .font(
      'Helvetica-Bold'
    )
    .fontSize(13)
    .text(
      'SIGNATURES'
    );


  doc.moveDown(
    0.7
  );


  const startY =
    doc.y;


  const blockWidth =
    (
      PAGE_WIDTH -
      MARGIN * 2 -
      25
    ) / 2;


  // ----------------------------------------------------------
  // CREATEUR
  // ----------------------------------------------------------

  renderSignatureBlock(
    doc,
    {
      x:
        MARGIN,

      y:
        startY,

      width:
        blockWidth,

      label:
        'CRÉATEUR',

      name:
        contract.creatorName,

      signature:
        contract.creatorSignatureDataUrl,

      signedAt:
        contract.creatorSignedAt,
    }
  );


  // ----------------------------------------------------------
  // SIGNATAIRE
  // ----------------------------------------------------------

  renderSignatureBlock(
    doc,
    {
      x:
        MARGIN +
        blockWidth +
        25,

      y:
        startY,

      width:
        blockWidth,

      label:
        'SIGNATAIRE',

      // IMPORTANT :
      // Le nom réellement saisi par le signataire
      name:
        contract.signerTypedName ||
        contract.signerName,

      signature:
        contract.signerSignatureDataUrl,

      signedAt:
        contract.signerSignedAt,
    }
  );


  doc.y =
    startY +
    170;
}


// ============================================================
// BLOC SIGNATURE
// ============================================================

function renderSignatureBlock(
  doc,
  {
    x,
    y,
    width,
    label,
    name,
    signature,
    signedAt,
  }
) {

  // ----------------------------------------------------------
  // CADRE
  // ----------------------------------------------------------

  doc
    .roundedRect(
      x,
      y,
      width,
      145,
      8
    )
    .lineWidth(1)
    .strokeColor(
      '#D9D4E5'
    )
    .stroke();


  // ----------------------------------------------------------
  // LABEL
  // ----------------------------------------------------------

  doc
    .fillColor(
      PRIMARY_COLOR
    )
    .font(
      'Helvetica-Bold'
    )
    .fontSize(8)
    .text(
      label,
      x + 12,
      y + 12,
      {
        width:
          width - 24,
      }
    );


  // ----------------------------------------------------------
  // SIGNATURE
  // ----------------------------------------------------------

  const signatureY =
    y + 30;


  if (
    typeof signature === 'string' &&
    signature.startsWith(
      'data:image/'
    )
  ) {

    try {

      const parts =
        signature.split(',');


      if (
        parts.length !== 2
      ) {
        throw new Error(
          'Signature base64 invalide'
        );
      }


      const base64 =
        parts[1];


      const buffer =
        Buffer.from(
          base64,
          'base64'
        );


      doc.image(
        buffer,
        x + 12,
        signatureY,
        {
          width:
            width - 24,

          height:
            58,

          fit: [
            width - 24,
            58,
          ],

          align:
            'center',

          valign:
            'center',
        }
      );

    } catch (err) {

      console.error(
        'Impossible de charger la signature :',
        err.message
      );
    }
  }


  // ----------------------------------------------------------
  // LIGNE SIGNATURE
  // ----------------------------------------------------------

  doc
    .moveTo(
      x + 12,
      y + 96
    )
    .lineTo(
      x + width - 12,
      y + 96
    )
    .lineWidth(0.8)
    .strokeColor(
      '#A9A3B8'
    )
    .stroke();


  // ----------------------------------------------------------
  // NOM
  // ----------------------------------------------------------

  doc
    .fillColor(
      TEXT_COLOR
    )
    .font(
      'Helvetica-Bold'
    )
    .fontSize(10)
    .text(
      cleanText(
        name || '—'
      ),
      x + 12,
      y + 103,
      {
        width:
          width - 24,

        align:
          'center',
      }
    );


  // ----------------------------------------------------------
  // DATE
  // ----------------------------------------------------------

  doc
    .fillColor(
      MUTED_COLOR
    )
    .font(
      'Helvetica'
    )
    .fontSize(8)
    .text(
      signedAt
        ? `Signé le ${formatDate(
            signedAt
          )}`
        : 'Non signé',
      x + 12,
      y + 122,
      {
        width:
          width - 24,

        align:
          'center',
      }
    );


  doc.fillColor(
    TEXT_COLOR
  );
}


// ============================================================
// HEADER NOUVELLE PAGE
// ============================================================

function drawPageHeader(
  doc
) {

  doc
    .fillColor(
      PRIMARY_COLOR
    )
    .font(
      'Helvetica-Bold'
    )
    .fontSize(12)
    .text(
      'KONTRA-AFRICA'
    );


  doc
    .moveTo(
      MARGIN,
      70
    )
    .lineTo(
      PAGE_WIDTH - MARGIN,
      70
    )
    .lineWidth(0.7)
    .strokeColor(
      '#D9D4E5'
    )
    .stroke();


  doc.y =
    90;
}


// ============================================================
// PIED DE PAGE
// ============================================================

function drawFooter(
  doc
) {

  const footerY =
    PAGE_HEIGHT -
    35;


  doc
    .font(
      'Helvetica'
    )
    .fontSize(7)
    .fillColor(
      MUTED_COLOR
    )
    .text(
      'Document généré par Kontra-Africa',
      MARGIN,
      footerY,
      {
        width:
          PAGE_WIDTH -
          MARGIN * 2,

        align:
          'center',
      }
    );
}


// ============================================================
// NETTOYAGE TEXTE
// ============================================================

function cleanText(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }


  return String(value)
    .replace(
      /\r\n/g,
      '\n'
    )
    .trim();
}


// ============================================================
// FORMAT DATE
// ============================================================

function formatDate(
  value
) {

  try {

    const date =
      value?.toDate
        ? value.toDate()
        : new Date(value);


    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return '—';
    }


    return date.toLocaleDateString(
      'fr-FR',
      {
        day:
          '2-digit',

        month:
          '2-digit',

        year:
          'numeric',
      }
    );

  } catch {

    return '—';
  }
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
  generateContractPdf,
};
