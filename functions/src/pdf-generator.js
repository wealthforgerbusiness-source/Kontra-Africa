// functions/src/pdf-generator.js

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

/*
 * SCEAU
 *
 * Le fichier doit être ici :
 *
 * functions/
 *   src/
 *     pdf-generator.js
 *     assets/
 *       kontrasceau.png
 */

const SEAL_PATH = path.join(
  __dirname,
  'assets',
  'kontrasceau.png'
);


// ============================================================
// VÉRIFICATION DU SCEAU
// ============================================================

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

  } else if (
    value instanceof Date
  ) {

    date = value;

  } else {

    date = new Date(value);

  }


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

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


// ============================================================
// LIGNE
// ============================================================

function drawLine(
  doc,
  x1,
  y1,
  x2,
  y2
) {

  doc
    .moveTo(
      x1,
      y1
    )
    .lineTo(
      x2,
      y2
    )
    .stroke();

}


// ============================================================
// SCEAU
// ============================================================

function drawSeal(
  doc,
  x,
  y,
  size
) {

  if (
    !fs.existsSync(
      SEAL_PATH
    )
  ) {

    return;

  }


  try {

    /*
     * IMPORTANT :
     *
     * On utilise "fit" au lieu de forcer
     * width + height.
     *
     * Cela conserve les proportions du PNG
     * et empêche le sceau de prendre une
     * taille énorme si son image originale
     * possède un grand canvas transparent.
     */

    doc.image(
      SEAL_PATH,
      x,
      y,
      {
        fit: [
          size,
          size,
        ],

        align:
          'center',

        valign:
          'center',
      }
    );


  } catch (error) {

    console.error(
      'Erreur lors de l’insertion du sceau :',
      error
    );

  }

}


// ============================================================
// BLOC DE SIGNATURE
// ============================================================

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

  /*
   * Hauteur fixe du bloc.
   *
   * Le sceau est contenu à l'intérieur
   * de cette zone.
   */

  const height = 190;


  // ==========================================================
  // CADRE
  // ==========================================================

  doc
    .roundedRect(
      x,
      y,
      width,
      height,
      8
    )
    .lineWidth(1)
    .strokeColor(
      '#D8D3E2'
    )
    .stroke();


  // ==========================================================
  // TITRE
  // ==========================================================

  doc
    .fontSize(11)
    .font(
      'Helvetica-Bold'
    )
    .fillColor(
      '#2A2140'
    )
    .text(
      title,
      x + 15,
      y + 15,
      {
        width:
          width - 30,
      }
    );


  // ==========================================================
  // LIGNE SOUS LE TITRE
  // ==========================================================

  drawLine(
    doc,
    x + 15,
    y + 38,
    x + width - 15,
    y + 38
  );


  // ==========================================================
  // SIGNATURE
  // ==========================================================

  if (
    signatureDataUrl &&
    typeof signatureDataUrl ===
      'string'
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


      /*
       * Signature volontairement limitée.
       *
       * Elle ne pourra jamais dépasser
       * cette zone.
       */

      const signatureMaxWidth =
        Math.min(
          130,
          width - 110
        );


      const signatureMaxHeight =
        48;


      doc.image(
        buffer,
        x + 15,
        y + 50,
        {
          fit: [
            signatureMaxWidth,
            signatureMaxHeight,
          ],

          align:
            'left',

          valign:
            'center',
        }
      );


    } catch (error) {

      console.error(
        'Impossible d’insérer la signature :',
        error
      );

    }

  }


// ==========================================================
// LIGNE DE SIGNATURE
// ==========================================================

  drawLine(
    doc,
    x + 15,
    y + 122,
    x + width - 15,
    y + 122
  );


// ==========================================================
// NOM
// ==========================================================

  doc
    .fontSize(10)
    .font(
      'Helvetica-Bold'
    )
    .fillColor(
      '#222222'
    )
    .text(
      name ||
        'Non renseigné',
      x + 15,
      y + 132,
      {
        width:
          width - 85,
      }
    );


// ==========================================================
// DATE
// ==========================================================

  doc
    .fontSize(8)
    .font(
      'Helvetica'
    )
    .fillColor(
      '#666666'
    )
    .text(
      signedAt
        ? `Signé le ${formatDate(
            signedAt
          )}`
        : 'En attente de signature',
      x + 15,
      y + 150,
      {
        width:
          width - 80,
      }
    );


// ==========================================================
// PETIT SCEAU
// ==========================================================

  /*
   * Le sceau est maintenant placé
   * à droite du bloc de signature.
   *
   * Taille maximale : 42 x 42 pt.
   *
   * Il ne peut donc pas provoquer
   * une nouvelle page.
   */

  const sealSize = 42;


  drawSeal(
    doc,
    x + width - 58,
    y + 132,
    sealSize
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
    (
      resolve,
      reject
    ) => {

      try {

        const doc =
          new PDFDocument({
            size:
              'A4',

            margin:
              50,

            bufferPages:
              true,

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


        const chunks =
          [];


        doc.on(
          'data',
          (chunk) => {

            chunks.push(
              chunk
            );

          }
        );


        doc.on(
          'end',
          () => {

            resolve(
              Buffer.concat(
                chunks
              )
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


        // ======================================================
        // EN-TÊTE
        // ======================================================

        doc
          .font(
            'Helvetica-Bold'
          )
          .fontSize(20)
          .fillColor(
            purple
          )
          .text(
            'KONTRA-AFRICA',
            50,
            45,
            {
              width:
                350,
            }
          );


        /*
         * IMPORTANT :
         *
         * LE GRAND SCEAU QUI ÉTAIT ICI
         * A ÉTÉ SUPPRIMÉ.
         *
         * Avant :
         *
         * drawSeal(
         *   doc,
         *   470,
         *   35,
         *   75
         * );
         *
         * Maintenant le sceau apparaît
         * uniquement près des signatures.
         */


        doc
          .font(
            'Helvetica'
          )
          .fontSize(8)
          .fillColor(
            gray
          )
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
          .font(
            'Helvetica-Bold'
          )
          .fontSize(18)
          .fillColor(
            dark
          )
          .text(
            contract.title ||
              'Contrat',
            50,
            115,
            {
              width:
                495,

              align:
                'center',
            }
          );


        // ======================================================
        // INFORMATIONS
        // ======================================================

        let currentY =
          160;


        doc
          .font(
            'Helvetica-Bold'
          )
          .fontSize(10)
          .fillColor(
            dark
          )
          .text(
            'CRÉATEUR',
            50,
            currentY
          );


        doc
          .font(
            'Helvetica'
          )
          .fontSize(10)
          .fillColor(
            dark
          )
          .text(
            contract.creatorName ||
              'Non renseigné',
            140,
            currentY
          );


        currentY +=
          22;


        doc
          .font(
            'Helvetica-Bold'
          )
          .text(
            'SIGNATAIRE',
            50,
            currentY
          );


        doc
          .font(
            'Helvetica'
          )
          .text(
            contract.signerName ||
              'Non renseigné',
            140,
            currentY
          );


        currentY +=
          35;


        // ======================================================
        // CONTENU DU CONTRAT
        // ======================================================

        doc
          .font(
            'Helvetica-Bold'
          )
          .fontSize(12)
          .fillColor(
            purple
          )
          .text(
            'TERMES DU CONTRAT',
            50,
            currentY
          );


        currentY +=
          22;


        doc
          .font(
            'Helvetica'
          )
          .fontSize(10)
          .fillColor(
            dark
          )
          .text(
            contract.content ||
              '',
            50,
            currentY,
            {
              width:
                495,

              align:
                'left',

              lineGap:
                4,
            }
          );


        // ======================================================
        // SIGNATURES
        // ======================================================

        currentY =
          doc.y + 35;


        /*
         * Vérification avant les signatures.
         */

        if (
          currentY >
          580
        ) {

          doc.addPage();

          currentY =
            55;

        }


        doc
          .font(
            'Helvetica-Bold'
          )
          .fontSize(13)
          .fillColor(
            purple
          )
          .text(
            'SIGNATURES',
            50,
            currentY
          );


        currentY +=
          22;


        // ======================================================
        // DIMENSIONS DES BLOCS
        // ======================================================

        const gap =
          15;


        const blockWidth =
          (495 - gap) /
          2;


        // ======================================================
        // SIGNATURE CRÉATEUR
        // ======================================================

        drawSignatureBlock(
          doc,
          {

            x:
              50,

            y:
              currentY,

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

            y:
              currentY,

            width:
              blockWidth,

            title:
              'SIGNATAIRE',

            /*
             * IMPORTANT :
             *
             * On affiche le nom réellement
             * saisi par le client.
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
          let i =
            range.start;

          i <
          range.start +
            range.count;

          i++
        ) {

          doc.switchToPage(
            i
          );


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
            .font(
              'Helvetica'
            )
            .fontSize(7)
            .fillColor(
              gray
            )
            .text(
              'Kontra-Africa — Contrat électronique',
              50,
              footerY,
              {
                width:
                  300,
              }
            );


          doc
            .fontSize(7)
            .text(
              `Page ${
                i + 1
              } / ${
                range.count
              }`,
              450,
              footerY,
              {
                width:
                  95,

                align:
                  'right',
              }
            );

        }


        // ======================================================
        // FIN DU PDF
        // ======================================================

        doc.end();


      } catch (error) {

        reject(
          error
        );

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
