// functions/src/pdf-generator.js

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

/*
 * Le sceau doit être placé dans :
 *
 * functions/
 *   src/
 *     pdf-generator.js
 *     assets/
 *       kontrasceau.png
 *
 * Cela évite les problèmes de chemin après le déploiement
 * de la Cloud Function.
 */
const SEAL_PATH = path.join(
  __dirname,
  'assets',
  'kontrasceau.png'
);

// Vérification du sceau au démarrage.
if (!fs.existsSync(SEAL_PATH)) {
  console.warn(
    'ATTENTION : sceau introuvable :',
    SEAL_PATH
  );
}

// ============================================================
// UTILITAIRES
// ============================================================

function formatDate(value) {
  if (!value) {
    return '';
  }

  let date;

  if (
    value &&
    typeof value.toDate === 'function'
  ) {
    date = value.toDate();
  } else if (value instanceof Date) {
    date = value;
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString(
    'fr-FR',
    {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }
  );
}

function drawLine(
  doc,
  x1,
  y1,
  x2,
  y2
) {
  doc
    .moveTo(x1, y1)
    .lineTo(x2, y2)
    .stroke();
}

function drawSeal(
  doc,
  x,
  y,
  size
) {
  if (!fs.existsSync(SEAL_PATH)) {
    return;
  }

  try {
    doc.image(
      SEAL_PATH,
      x,
      y,
      {
        width: size,
        height: size,
      }
    );
  } catch (error) {
    console.error(
      'Erreur lors de l’insertion du sceau :',
      error
    );
  }
}

function drawSignatureBlock(
  doc,
  {
    x,
    y,
    width,
    title,
    name,
    signatureDataUrl,
    signedAt,
  }
) {
  const height = 190;

  // Cadre
  doc
    .roundedRect(
      x,
      y,
      width,
      height,
      8
    )
    .lineWidth(1)
    .strokeColor('#D8D3E2')
    .stroke();

  // Titre
  doc
    .fontSize(11)
    .font('Helvetica-Bold')
    .fillColor('#2A2140')
    .text(
      title,
      x + 15,
      y + 15,
      {
        width:
          width - 30,
      }
    );

  // Ligne sous le titre
  drawLine(
    doc,
    x + 15,
    y + 38,
    x + width - 15,
    y + 38
  );

  // Signature
  if (
    signatureDataUrl &&
    typeof signatureDataUrl === 'string'
  ) {
    try {
      const base64 =
        signatureDataUrl.replace(
          /^data:image\/png;base64,/,
          ''
        );

      const buffer =
        Buffer.from(
          base64,
          'base64'
        );

      doc.image(
        buffer,
        x + 15,
        y + 50,
        {
          fit: [
            width - 30,
            65,
          ],
          align: 'left',
          valign: 'center',
        }
      );
    } catch (error) {
      console.error(
        'Impossible d’insérer la signature :',
        error
      );
    }
  }

  // Ligne de signature
  drawLine(
    doc,
    x + 15,
    y + 122,
    x + width - 15,
    y + 122
  );

  // Nom
  doc
    .fontSize(10)
    .font('Helvetica-Bold')
    .fillColor('#222222')
    .text(
      name || 'Non renseigné',
      x + 15,
      y + 132,
      {
        width:
          width - 100,
      }
    );

  // Date
  doc
    .fontSize(8)
    .font('Helvetica')
    .fillColor('#666666')
    .text(
      signedAt
        ? `Signé le ${formatDate(signedAt)}`
        : 'En attente de signature',
      x + 15,
      y + 150,
      {
        width:
          width - 30,
      }
    );

  /*
   * PETIT SCEAU
   *
   * Il est volontairement placé en bas à droite
   * de chaque bloc de signature.
   */
  drawSeal(
    doc,
    x + width - 58,
    y + 130,
    42
  );

  return height;
}

// ============================================================
// GÉNÉRATION DU PDF
// ============================================================

function generateContractPdf(
  contract
) {
  return new Promise(
    (resolve, reject) => {

      try {

        const doc =
          new PDFDocument({
            size: 'A4',
            margin: 50,
            bufferPages: true,
            info: {
              Title:
                contract.title ||
                'Contrat Kontra-Africa',

              Author:
                contract.creatorName ||
                'Kontra-Africa',

              Subject:
                'Contrat signé électroniquement',
            },
          });

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
        // COULEURS
        // ======================================================

        const purple =
          '#5B21B6';

        const dark =
          '#222222';

        const gray =
          '#666666';

        const lightGray =
          '#E5E7EB';

        // ======================================================
        // EN-TÊTE
        // ======================================================

        doc
          .font('Helvetica-Bold')
          .fontSize(20)
          .fillColor(purple)
          .text(
            'KONTRA-AFRICA',
            50,
            45,
            {
              width: 350,
            }
          );

        /*
         * GRAND SCEAU EN HAUT À DROITE
         */
        drawSeal(
          doc,
          470,
          35,
          75
        );

        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(gray)
          .text(
            'Contrat électronique',
            50,
            72
          );

        drawLine(
          doc,
          50,
          90,
          545,
          90
        );

        // ======================================================
        // TITRE
        // ======================================================

        doc
          .font('Helvetica-Bold')
          .fontSize(18)
          .fillColor(dark)
          .text(
            contract.title ||
              'Contrat',
            50,
            115,
            {
              width: 495,
              align: 'center',
            }
          );

        // ======================================================
        // INFORMATIONS
        // ======================================================

        let currentY = 160;

        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor(dark)
          .text(
            'CRÉATEUR',
            50,
            currentY
          );

        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(dark)
          .text(
            contract.creatorName ||
              'Non renseigné',
            140,
            currentY
          );

        currentY += 22;

        doc
          .font('Helvetica-Bold')
          .text(
            'SIGNATAIRE',
            50,
            currentY
          );

        doc
          .font('Helvetica')
          .text(
            contract.signerName ||
              'Non renseigné',
            140,
            currentY
          );

        currentY += 35;

        // ======================================================
        // CONTENU DU CONTRAT
        // ======================================================

        doc
          .font('Helvetica-Bold')
          .fontSize(12)
          .fillColor(purple)
          .text(
            'TERMES DU CONTRAT',
            50,
            currentY
          );

        currentY += 22;

        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(dark)
          .text(
            contract.content ||
              '',
            50,
            currentY,
            {
              width: 495,
              align: 'left',
              lineGap: 4,
            }
          );

        // ======================================================
        // SIGNATURES
        // ======================================================

        /*
         * On demande à PDFKit de nous donner la position
         * actuelle après le contenu.
         */
        currentY =
          doc.y + 35;

        /*
         * Si les signatures ne tiennent pas correctement
         * sur la page, on commence une nouvelle page.
         */
        if (
          currentY >
          580
        ) {
          doc.addPage();

          currentY = 55;
        }

        doc
          .font('Helvetica-Bold')
          .fontSize(13)
          .fillColor(purple)
          .text(
            'SIGNATURES',
            50,
            currentY
          );

        currentY += 22;

        const gap = 15;

        const blockWidth =
          (495 - gap) / 2;

        // ======================================================
        // SIGNATURE CRÉATEUR
        // ======================================================

        drawSignatureBlock(
          doc,
          {
            x: 50,

            y: currentY,

            width:
              blockWidth,

            title:
              'CRÉATEUR',

            name:
              contract.creatorName,

            signatureDataUrl:
              contract.creatorSignatureDataUrl,

            signedAt:
              contract.creatorSignedAt,
          }
        );

        // ======================================================
        // SIGNATURE CLIENT
        // ======================================================

        drawSignatureBlock(
          doc,
          {
            x:
              50 +
              blockWidth +
              gap,

            y: currentY,

            width:
              blockWidth,

            title:
              'SIGNATAIRE',

            /*
             * IMPORTANT :
             * On utilise le nom réellement saisi
             * par le client lors de la signature.
             */
            name:
              contract.signerTypedName ||
              contract.signerName,

            signatureDataUrl:
              contract.signerSignatureDataUrl,

            signedAt:
              contract.signerSignedAt,
          }
        );

        // ======================================================
        // PIED DE PAGE
        // ======================================================

        const range =
          doc.bufferedPageRange();

        for (
          let i = range.start;
          i <
          range.start +
            range.count;
          i++
        ) {

          doc.switchToPage(i);

          const footerY =
            doc.page.height -
            35;

          drawLine(
            doc,
            50,
            footerY - 8,
            545,
            footerY - 8
          );

          doc
            .font('Helvetica')
            .fontSize(7)
            .fillColor(gray)
            .text(
              'Kontra-Africa — Contrat électronique',
              50,
              footerY,
              {
                width: 300,
              }
            );

          doc
            .fontSize(7)
            .text(
              `Page ${i + 1} / ${range.count}`,
              450,
              footerY,
              {
                width: 95,
                align: 'right',
              }
            );
        }

        doc.end();

      } catch (error) {

        reject(error);
      }
    }
  );
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  generateContractPdf,
};
