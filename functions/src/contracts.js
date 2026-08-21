// functions/src/contracts.js
//
// Routes publiques du module Contrats. Le signataire n'a pas de compte
// Firebase : toutes ses actions passent par ces routes, qui utilisent le
// SDK Admin (donc contournent les règles de sécurité Firestore côté client).
// La création et la lecture de la liste, elles, restent gérées côté client
// directement via le SDK Firestore (comme le reste de l'app), protégées par
// les règles `creatorId == request.auth.uid`.
//
// Hypothèse sur functions/src/config.js : il exporte `admin` (firebase-admin
// déjà initialisé, avec un storageBucket configuré) et `db`
// (admin.firestore()). Adapte les imports si tes noms diffèrent.
//
// Installation requise : npm install pdfkit

const express = require('express');
const { admin, db } = require('./config');
const { generateContractPdf } = require('./pdf-generator');

const router = express.Router();

// ---------- GET /api/contracts/public/:token ----------
// Retourne les données publiques d'un contrat pour la page de signature.
// Ne renvoie jamais creatorId ni de données internes.
router.get('/public/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const contract = await findContractByToken(token);
    if (!contract) {
      return res.status(404).json({ message: 'Lien de signature introuvable.' });
    }

    const data = contract.data();

    res.json({
      title: data.title,
      content: data.content,
      creatorName: data.creatorName,
      signerName: data.signerName,
      status: data.status,
      signerSignedAt: data.signerSignedAt ? data.signerSignedAt.toDate().toISOString() : null,
      pdfUrlSigner: data.pdfUrlSigner || null,
    });
  } catch (err) {
    console.error('Erreur GET /contracts/public/:token', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ---------- POST /api/contracts/public/:token/sign ----------
// Enregistre la signature du signataire, génère le PDF final, l'uploade,
// et met à jour le contrat.
router.post('/public/:token/sign', async (req, res) => {
  const { token } = req.params;
  const { termsAccepted, signatureDataUrl, typedName } = req.body || {};

  if (!termsAccepted) {
    return res.status(400).json({ message: "L'acceptation des termes est requise." });
  }
  if (!signatureDataUrl && !typedName) {
    return res.status(400).json({ message: 'Une signature (dessin ou nom tapé) est requise.' });
  }

  try {
    const contractDoc = await findContractByToken(token);
    if (!contractDoc) {
      return res.status(404).json({ message: 'Lien de signature introuvable.' });
    }

    const data = contractDoc.data();

    if (data.status === 'signed') {
      return res.status(409).json({
        message: 'Ce contrat a déjà été signé.',
        pdfUrlSigner: data.pdfUrlSigner || null,
      });
    }
    if (data.status !== 'pending') {
      return res.status(409).json({ message: 'Ce contrat ne peut plus être signé.' });
    }

    const now = admin.firestore.Timestamp.now();

    const fullContract = {
      ...data,
      signerSignatureDataUrl: signatureDataUrl,
      signerTypedName: typedName,
      signerSignedAt: now,
    };

    // Génère un seul PDF final (contenu + les deux signatures)
    const pdfBuffer = await generateContractPdf(fullContract);

    const bucket = admin.storage().bucket();
    const filePath = `contracts/${contractDoc.id}/contrat-signe.pdf`;
    const file = bucket.file(filePath);

    await file.save(pdfBuffer, {
      metadata: { contentType: 'application/pdf' },
    });
    await file.makePublic().catch(() => {
      // Si le bucket n'autorise pas makePublic(), génère une URL signée à la place.
    });

    let pdfUrl;
    try {
      pdfUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
    } catch {
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: '01-01-2099',
      });
      pdfUrl = signedUrl;
    }

    await contractDoc.ref.update({
      status: 'signed',
      termsAcceptedBySigner: true,
      signerSignatureDataUrl: signatureDataUrl,
      signerTypedName: typedName || null,
      signerSignedAt: now,
      pdfUrlCreator: pdfUrl,
      pdfUrlSigner: pdfUrl,
    });

    res.json({ status: 'signed', pdfUrlSigner: pdfUrl });
  } catch (err) {
    console.error('Erreur POST /contracts/public/:token/sign', err);
    res.status(500).json({ message: 'La signature a échoué. Réessaie.' });
  }
});

// ---------- Helper ----------
async function findContractByToken(token) {
  if (!token) return null;
  const snapshot = await db
    .collection('contracts')
    .where('shareToken', '==', token)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return snapshot.docs[0];
}

module.exports = router;
