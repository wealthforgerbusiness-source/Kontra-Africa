// functions/src/contracts.js

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const {
  generateContractPdf,
} = require('./pdf-generator');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ============================================================
// CHARGER UN CONTRAT PUBLIC
// ============================================================

exports.getPublicContract = functions.https.onRequest(
  async (req, res) => {
    try {
      res.set('Access-Control-Allow-Origin', '*');
      res.set(
        'Access-Control-Allow-Methods',
        'GET, OPTIONS'
      );
      res.set(
        'Access-Control-Allow-Headers',
        'Content-Type'
      );

      if (req.method === 'OPTIONS') {
        return res.status(204).send('');
      }

      if (req.method !== 'GET') {
        return res.status(405).json({
          message: 'Méthode non autorisée.',
        });
      }

      const token =
        req.params.token ||
        req.query.token;

      if (!token) {
        return res.status(400).json({
          message:
            'Lien de signature invalide.',
        });
      }

      const snapshot = await db
        .collection('contracts')
        .where(
          'shareToken',
          '==',
          token
        )
        .limit(1)
        .get();

      if (snapshot.empty) {
        return res.status(404).json({
          message:
            'Contrat introuvable ou lien invalide.',
        });
      }

      const doc =
        snapshot.docs[0];

      const contract =
        doc.data();

      return res.status(200).json({
        id: doc.id,

        title:
          contract.title || '',

        content:
          contract.content || '',

        creatorName:
          contract.creatorName || '',

        /*
         * Ce nom permet seulement d'identifier
         * le signataire attendu.
         *
         * Il ne doit PAS être envoyé comme
         * valeur du champ de saisie client.
         */
        signerName:
          contract.signerName || '',

        status:
          contract.status || 'pending',

        signerSignedAt:
          contract.signerSignedAt || null,
      });

    } catch (error) {

      console.error(
        'Erreur getPublicContract :',
        error
      );

      return res.status(500).json({
        message:
          'Erreur serveur lors du chargement du contrat.',
      });
    }
  }
);

// ============================================================
// SIGNER UN CONTRAT PUBLIC
// ============================================================

exports.signPublicContract = functions.https.onRequest(
  async (req, res) => {
    try {

      res.set(
        'Access-Control-Allow-Origin',
        '*'
      );

      res.set(
        'Access-Control-Allow-Methods',
        'POST, OPTIONS'
      );

      res.set(
        'Access-Control-Allow-Headers',
        'Content-Type'
      );

      if (req.method === 'OPTIONS') {
        return res.status(204).send('');
      }

      if (req.method !== 'POST') {
        return res.status(405).json({
          message:
            'Méthode non autorisée.',
        });
      }

      const token =
        req.params.token ||
        req.query.token;

      if (!token) {
        return res.status(400).json({
          message:
            'Lien de signature invalide.',
        });
      }

      const {
        termsAccepted,
        signatureDataUrl,
        typedName,
      } = req.body || {};

      // ======================================================
      // VALIDATION
      // ======================================================

      if (termsAccepted !== true) {
        return res.status(400).json({
          message:
            'Vous devez accepter les termes du contrat.',
        });
      }

      if (
        typeof typedName !== 'string' ||
        !typedName.trim()
      ) {
        return res.status(400).json({
          message:
            'Vous devez saisir votre nom complet.',
        });
      }

      const signerTypedName =
        typedName.trim();

      if (
        signerTypedName.length < 2
      ) {
        return res.status(400).json({
          message:
            'Le nom doit contenir au moins 2 caractères.',
        });
      }

      if (
        signerTypedName.length > 150
      ) {
        return res.status(400).json({
          message:
            'Le nom est trop long.',
        });
      }

      if (
        typeof signatureDataUrl !==
          'string' ||
        !signatureDataUrl.startsWith(
          'data:image/png;base64,'
        )
      ) {
        return res.status(400).json({
          message:
            'Signature invalide.',
        });
      }

      // ======================================================
      // RECHERCHE DU CONTRAT
      // ======================================================

      const snapshot =
        await db
          .collection('contracts')
          .where(
            'shareToken',
            '==',
            token
          )
          .limit(1)
          .get();

      if (snapshot.empty) {
        return res.status(404).json({
          message:
            'Contrat introuvable.',
        });
      }

      const contractDoc =
        snapshot.docs[0];

      const contract =
        contractDoc.data();

      // ======================================================
      // VÉRIFICATION DU STATUT
      // ======================================================

      if (
        contract.status !==
        'pending'
      ) {

        if (
          contract.status ===
          'signed'
        ) {
          return res.status(409).json({
            message:
              'Ce contrat a déjà été signé.',
            status:
              'signed',
          });
        }

        return res.status(409).json({
          message:
            'Ce contrat n’est plus disponible.',
        });
      }

      // ======================================================
      // DONNÉES DE SIGNATURE
      // ======================================================

      const signerSignedAt =
        admin.firestore.Timestamp.now();

      await contractDoc.ref.update({

        /*
         * IMPORTANT :
         * C'est le nom réellement tapé
         * par le client qui est enregistré.
         */
        signerTypedName,

        signerSignatureDataUrl:
          signatureDataUrl,

        termsAcceptedBySigner:
          true,

        signerSignedAt,

        status:
          'signed',
      });

      // ======================================================
      // CONTRAT MIS À JOUR
      // ======================================================

      const updatedSnapshot =
        await contractDoc.ref.get();

      const updatedContract =
        updatedSnapshot.data();

      // ======================================================
      // GÉNÉRATION DU PDF
      // ======================================================

      let pdfBuffer;

      try {

        pdfBuffer =
          await generateContractPdf(
            updatedContract
          );

      } catch (pdfError) {

        console.error(
          'Erreur génération PDF :',
          pdfError
        );

        return res.status(500).json({
          message:
            'Le contrat a été signé, mais le PDF n’a pas pu être généré.',
          status:
            'signed',
        });
      }

      /*
       * Le PDF est généré ici pour vérifier
       * immédiatement que la signature est valide.
       *
       * Le téléchargement public utilise
       * ensuite la route PDF dédiée.
       */

      return res.status(200).json({
        id:
          contractDoc.id,

        status:
          'signed',

        signerTypedName,

        signerSignedAt:
          signerSignedAt.toDate().toISOString(),

        message:
          'Contrat signé avec succès.',
      });

    } catch (error) {

      console.error(
        'Erreur signPublicContract :',
        error
      );

      return res.status(500).json({
        message:
          'Erreur serveur lors de la signature du contrat.',
      });
    }
  }
);

// ============================================================
// GÉNÉRER / TÉLÉCHARGER LE PDF
// ============================================================

exports.getPublicContractPdf =
  functions.https.onRequest(
    async (req, res) => {

      try {

        res.set(
          'Access-Control-Allow-Origin',
          '*'
        );

        res.set(
          'Access-Control-Allow-Methods',
          'GET, OPTIONS'
        );

        res.set(
          'Access-Control-Allow-Headers',
          'Content-Type'
        );

        if (
          req.method ===
          'OPTIONS'
        ) {
          return res
            .status(204)
            .send('');
        }

        if (
          req.method !==
          'GET'
        ) {
          return res.status(405).json({
            message:
              'Méthode non autorisée.',
          });
        }

        const token =
          req.params.token ||
          req.query.token;

        if (!token) {
          return res.status(400).json({
            message:
              'Lien de contrat invalide.',
          });
        }

        const snapshot =
          await db
            .collection('contracts')
            .where(
              'shareToken',
              '==',
              token
            )
            .limit(1)
            .get();

        if (snapshot.empty) {
          return res.status(404).json({
            message:
              'Contrat introuvable.',
          });
        }

        const contract =
          snapshot.docs[0].data();

        if (
          contract.status !==
          'signed'
        ) {
          return res.status(409).json({
            message:
              'Le contrat doit être signé avant de télécharger le PDF.',
          });
        }

        const pdfBuffer =
          await generateContractPdf(
            contract
          );

        res.set(
          'Content-Type',
          'application/pdf'
        );

        res.set(
          'Content-Disposition',
          `inline; filename="kontra-africa-contrat-${snapshot.docs[0].id}.pdf"`
        );

        res.set(
          'Cache-Control',
          'no-store'
        );

        return res
          .status(200)
          .send(pdfBuffer);

      } catch (error) {

        console.error(
          'Erreur génération PDF public :',
          error
        );

        return res.status(500).json({
          message:
            'Impossible de générer le PDF.',
        });
      }
    }
  );
