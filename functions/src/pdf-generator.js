// functions/src/pdf-generator.js

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const SEAL_PATH = path.join(
  __dirname,
  'assets',
  'kontrasceau.png'
);


// ============================================================
// UTILITAIRES
// ============================================================

function formatDate(value) {

  if (!value) return '';

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
      year: 'numeric'
    }
  );
}


// ============================================================
// LIGNE NOIRE
// ============================================================

function drawLine(
  doc,
  x1,
  y1,
  x2,
  y2
) {

  doc
    .strokeColor('#000000')
    .moveTo(x1,y1)
    .lineTo(x2,y2)
    .stroke();

}


// ============================================================
// SCEAU PETIT
// ============================================================

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
        fit:[
          size,
          size
        ]
      }
    );


  } catch(error) {

    console.error(
      'Erreur sceau:',
      error
    );

  }

}


// ============================================================
// SIGNATURE BLOCK COMPACT
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
    signedAt
  }
) {


  const height = 125;


  doc
    .roundedRect(
      x,
      y,
      width,
      height,
      6
    )
    .lineWidth(0.8)
    .strokeColor('#000000')
    .stroke();



  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#000000')
    .text(
      title,
      x + 10,
      y + 10
    );


  drawLine(
    doc,
    x + 10,
    y + 28,
    x + width - 10,
    y + 28
  );



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
        x + 10,
        y + 35,
        {
          fit:[
            100,
            35
          ]
        }
      );


    } catch(error){

      console.error(
        'Erreur signature:',
        error
      );

    }

  }


  drawLine(
    doc,
    x + 10,
    y + 75,
    x + width - 10,
    y + 75
  );



  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#000000')
    .text(
      name || 'Non renseigné',
      x + 10,
      y + 82,
      {
        width:
          width - 60
      }
    );



  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor('#000000')
    .text(
      signedAt
        ? `Signé le ${formatDate(signedAt)}`
        : 'En attente de signature',
      x + 10,
      y + 98
    );



  drawSeal(
    doc,
    x + width - 45,
    y + 80,
    30
  );


  return height;

}


// ============================================================
// GENERATION PDF
// ============================================================

function generateContractPdf(contract) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      try {


        const doc =
          new PDFDocument({

            size:'A4',

            margin:50,

            bufferPages:true,

            info:{
              Title:
                contract.title ||
                'Contrat Kontra-Africa',

              Author:
                contract.creatorName ||
                'Kontra-Africa'
            }

          });



        const chunks=[];


        doc.on(
          'data',
          chunk=>{
            chunks.push(chunk);
          }
        );


        doc.on(
          'end',
          ()=>{
            resolve(
              Buffer.concat(chunks)
            );
          }
        );


        doc.on(
          'error',
          reject
        );



        const BLACK =
          '#000000';



        const GRAY =
          '#000000';



        // EN-TETE

        doc
          .font('Helvetica-Bold')
          .fontSize(20)
          .fillColor(BLACK)
          .text(
            'KONTRA-AFRICA',
            50,
            45
          );


        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(BLACK)
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


        // TITRE

        doc
          .font('Helvetica-Bold')
          .fontSize(18)
          .fillColor(BLACK)
          .text(
            contract.title || 'Contrat',
            50,
            115,
            {
              width:495,
              align:'center',
              underline:true
            }
          );

        let currentY =
          doc.y + 25;

        // ======================================================
// TERMES DU CONTRAT (contenu)
// ======================================================

doc
  .font('Helvetica-Bold')
  .fontSize(12)
  .fillColor(BLACK)
  .text(
    'TERMES DU CONTRAT',
    50,
    currentY
  );


currentY += 22;


doc
  .font('Helvetica')
  .fontSize(10)
  .fillColor(BLACK)
  .text(
    contract.content || '',
    50,
    currentY,
    {
      width:495,
      align:'left',
      lineGap:3
    }
  );


currentY =
  doc.y + 25;



// ======================================================
// INFORMATIONS CONTRAT (créateur / signataire)
// ======================================================

if (
  currentY > 680
) {

  doc.addPage();

  currentY = 50;

}


doc
  .font('Helvetica-Bold')
  .fontSize(10)
  .fillColor(BLACK)
  .text(
    'CRÉATEUR',
    50,
    currentY
  );


doc
  .font('Helvetica')
  .fontSize(10)
  .fillColor(BLACK)
  .text(
    contract.creatorName ||
      'Non renseigné',
    140,
    currentY
  );


currentY += 22;


doc
  .font('Helvetica-Bold')
  .fillColor(BLACK)
  .text(
    'SIGNATAIRE',
    50,
    currentY
  );


doc
  .font('Helvetica')
  .fillColor(BLACK)
  .text(
    contract.signerName ||
      'Non renseigné',
    140,
    currentY
  );


currentY += 35;



// ======================================================
// SIGNATURES
// ======================================================

if (
  currentY > 590
) {

  doc.addPage();

  currentY = 50;

}



doc
  .font('Helvetica-Bold')
  .fontSize(12)
  .fillColor(BLACK)
  .text(
    'SIGNATURES',
    50,
    currentY
  );


currentY += 20;



const gap = 15;


const blockWidth =
  (495-gap)/2;



drawSignatureBlock(
  doc,
  {
    x:50,

    y:currentY,

    width:blockWidth,

    title:'CRÉATEUR',

    name:
      contract.creatorName,

    signatureDataUrl:
      contract.creatorSignatureDataUrl,

    signedAt:
      contract.creatorSignedAt
  }
);



drawSignatureBlock(
  doc,
  {
    x:
      50 +
      blockWidth +
      gap,

    y:currentY,

    width:blockWidth,

    title:'SIGNATAIRE',

    name:
      contract.signerTypedName ||
      contract.signerName,

    signatureDataUrl:
      contract.signerSignatureDataUrl,

    signedAt:
      contract.signerSignedAt
  }
);



// ======================================================
// PIED DE PAGE
// ======================================================

const range =
  doc.bufferedPageRange();


for (
  let i = range.start;

  i < range.start + range.count;

  i++
) {


  doc.switchToPage(i);


  const originalBottomMargin =
    doc.page.margins.bottom;

  doc.page.margins.bottom = 0;


  const footerY =
    doc.page.height - 35;



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
    .fillColor(BLACK)
    .text(
      'Kontra-Africa — Contrat électronique',
      50,
      footerY,
      {
        width:300,
        lineBreak:false
      }
    );



  doc
    .fontSize(7)
    .text(
      `Page ${i + 1} / ${range.count}`,
      450,
      footerY,
      {
        width:95,
        align:'right',
        lineBreak:false
      }
    );


  doc.page.margins.bottom =
    originalBottomMargin;

}



// ======================================================
// FIN
// ======================================================

doc.end();


      } catch(error) {

        reject(error);

      }

    }
  );

}



// ======================================================
// EXPORT
// ======================================================

module.exports = {
  generateContractPdf
};
