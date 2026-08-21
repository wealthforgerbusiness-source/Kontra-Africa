// functions/src/pdf-generator.js
// Génère un PDF de contrat (contenu + signatures des deux parties) avec pdfkit.
// Installation requise : npm install pdfkit
//
// pdfkit est utilisé plutôt que puppeteer/Chromium pour rester léger en
// mémoire sur Render (pas de navigateur headless à faire tourner).

const PDFDocument = require('pdfkit');

/**
 * @param {object} contract - document contrat (avec creatorName, title, content,
 *   signerName, creatorSignatureDataUrl, creatorTypedName, signerSignatureDataUrl,
 *   signerTypedName, creatorSignedAt, signerSignedAt)
 * @returns {Promise<Buffer>}
 */
function generateContractPdf(contract) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // En-tête
      doc
        .fillColor('#5B3FE0')
        .fontSize(20)
        .text('Kontra-Africa', { align: 'left' })
        .moveDown(0.2);

      doc
        .fillColor('#2A2140')
        .fontSize(16)
        .text(contract.title || 'Contrat', { align: 'left' })
        .moveDown(1);

      // Parties
      doc
        .fontSize(11)
        .fillColor('#444')
        .text(`Entre : ${contract.creatorName || '—'}`)
        .text(`Et : ${contract.signerName || '—'}`)
        .moveDown(1);

      // Contenu
      doc
        .fillColor('#000')
        .fontSize(11)
        .text(contract.content || '', { align: 'left', lineGap: 4 })
        .moveDown(2);

      // Signatures
      doc.fontSize(12).fillColor('#2A2140').text('Signatures', { underline: true });
      doc.moveDown(0.5);

      const signatureBlockY = doc.y;

      renderSignatureBlock(doc, {
        label: `${contract.creatorName || 'Créateur'}`,
        dataUrl: contract.creatorSignatureDataUrl,
        typedName: contract.creatorTypedName,
        signedAt: contract.creatorSignedAt,
        x: 50,
      });

      doc.y = signatureBlockY;

      renderSignatureBlock(doc, {
        label: `${contract.signerName || 'Signataire'}`,
        dataUrl: contract.signerSignatureDataUrl,
        typedName: contract.signerTypedName,
        signedAt: contract.signerSignedAt,
        x: 310,
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function renderSignatureBlock(doc, { label, dataUrl, typedName, signedAt, x }) {
  const startY = doc.y;
  const width = 220;

  if (dataUrl && dataUrl.startsWith('data:image')) {
    try {
      const base64 = dataUrl.split(',')[1];
      const buffer = Buffer.from(base64, 'base64');
      doc.image(buffer, x, startY, { width, height: 70, fit: [width, 70] });
      doc.y = startY + 75;
    } catch (e) {
      doc.font('Helvetica-Oblique').fontSize(14).text(typedName || label, x, startY);
      doc.font('Helvetica');
    }
  } else if (typedName) {
    doc.font('Helvetica-Oblique').fontSize(16).text(typedName, x, startY, { width });
    doc.font('Helvetica');
    doc.y = startY + 75;
  } else {
    doc.y = startY + 75;
  }

  doc
    .fontSize(9)
    .fillColor('#6B6480')
    .text(label, x, doc.y, { width })
    .text(
      signedAt ? `Signé le ${formatDate(signedAt)}` : 'Non signé',
      x,
      doc.y,
      { width }
    )
    .fillColor('#000');
}

function formatDate(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  return date.toLocaleDateString('fr-FR');
}

module.exports = { generateContractPdf };
