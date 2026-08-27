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

const CONTRACT_LIFETIME_MS =
  24 * 60 * 60 * 1000;

// ============================================================
// OUTILS
// ============================================================

function getTimestampMillis(value) {
  if (!value) {
    return null;
  }

  if (
    typeof value.toMillis === 'function'
  ) {
    return value.toMillis();
  }

  if (
    typeof value.toDate === 'function'
  ) {
    return value.toDate().getTime();
  }

  if (
    value instanceof Date
  ) {
    return value.getTime();
  }

  if (
    typeof value === 'number'
  ) {
    return value;
  }

  const date =
    new Date(value);

  const time =
    date.getTime();

  return Number.isNaN(time)
    ? null
    : time;
}

function isContractExpired(
  contract
) {
  const expiresAt =
    getTimestampMillis(
      contract.expiresAt
    );

  if (!expiresAt) {
    return false;
  }

  return Date.now() >= expiresAt;
}

function getRemainingMs(
  contract
) {
  const expiresAt =
    getTimestampMillis(
      contract.expiresAt
    );

  if (!expiresAt) {
    return null;
  }

  return Math.max(
    0,
    expiresAt - Date.now()
  );
}

// ============================================================
// CHARGER UN CONTRAT PUBLIC
// ============================================================

exports.getPublicContract =
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
          req.method === 'OPTIONS'
        ) {
          return res
            .status(204)
            .send('');
        }

        if (
          req.method !== 'GET'
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
              'Lien de signature invalide.',
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

        if (
          snapshot.empty
        ) {
          return res.status(404).json({
            message:
              'Contrat introuvable ou lien invalide.',
          });
        }

        const doc =
          snapshot.docs[0];

        const contract =
          doc.data();

        // ======================================================
        // CONTRAT EXPIRÉ
        // ======================================================

        if (
          contract.status ===
          'signed' &&
          isContractExpired(
            contract
          )
        ) {

          return res.status(410).json({
            message:
              'Le délai de 24 heures de ce contrat est expiré.',

            status:
              'expired',
          });
        }

        // ======================================================
        // RÉPONSE
        // ======================================================

        return res.status(200).json({

          id:
            doc.id,

          title:
            contract.title || '',

          content:
            contract.content || '',

          creatorName:
            contract.creatorName || '',

          signerName:
            contract.signerName || '',

          status:
            contract.status ||
            'pending',

          signerSignedAt:
            contract.signerSignedAt ||
            null,

          signedAt:
            contract.signedAt ||
            null,

          expiresAt:
            contract.expiresAt ||
            null,

          remainingMs:
            getRemainingMs(
              contract
            ),
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

exports.signPublicContract =
  functions.https.onRequest(
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

        if (
          req.method === 'OPTIONS'
        ) {
          return res
            .status(204)
            .send('');
        }

        if (
          req.method !== 'POST'
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

        if (
          termsAccepted !== true
        ) {
          return res.status(400).json({
            message:
              'Vous devez accepter les termes du contrat.',
          });
        }

        if (
          typeof typedName !==
            'string' ||
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

        if (
          snapshot.empty
        ) {
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

            if (
              isContractExpired(
                contract
              )
            ) {
              return res.status(410).json({
                message:
                  'Le délai de 24 heures de ce contrat est expiré.',

                status:
                  'expired',
              });
            }

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
        // DEUXIÈME SIGNATURE
        // ======================================================

        const signerSignedAt =
          admin.firestore.Timestamp.now();

        /*
         * Le créateur a déjà signé lors de la création.
         *
         * La signature du client est donc la deuxième
         * signature.
         *
         * C'est À CE MOMENT que les 24 heures commencent.
         */

        const expiresAt =
          admin.firestore.Timestamp.fromMillis(
            Date.now() +
              CONTRACT_LIFETIME_MS
          );

        await contractDoc.ref.update({

          // Nom réellement saisi par le client
          signerTypedName,

          // Signature réellement dessinée par le client
          signerSignatureDataUrl:
            signatureDataUrl,

          termsAcceptedBySigner:
            true,

          signerSignedAt,

          // Début officiel des 24 heures
          signedAt:
            signerSignedAt,

          // Expiration 24h plus tard
          expiresAt,

          status:
            'signed',
        });

        // ======================================================
        // RELECTURE DU CONTRAT
        // ======================================================

        const updatedSnapshot =
          await contractDoc.ref.get();

        const updatedContract =
          updatedSnapshot.data();

        // ======================================================
        // GÉNÉRATION DU PDF
        // ======================================================

        try {

          /*
           * IMPORTANT :
           * Le PDF n'est PAS enregistré dans Firestore.
           *
           * Il est seulement généré temporairement
           * lorsqu'il est nécessaire.
           */

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

        // ======================================================
        // RÉPONSE
        // ======================================================

        return res.status(200).json({

          id:
            contractDoc.id,

          status:
            'signed',

          signerTypedName,

          signerSignedAt:
            signerSignedAt
              .toDate()
              .toISOString(),

          signedAt:
            signerSignedAt
              .toDate()
              .toISOString(),

          expiresAt:
            expiresAt
              .toDate()
              .toISOString(),

          remainingMs:
            CONTRACT_LIFETIME_MS,

          message:
            'Contrat signé avec succès. Le délai de 24 heures commence maintenant.',
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
          req.method === 'OPTIONS'
        ) {
          return res
            .status(204)
            .send('');
        }

        if (
          req.method !== 'GET'
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

        if (
          snapshot.empty
        ) {
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
        // DOIT ÊTRE SIGNÉ
        // ======================================================

        if (
          contract.status !==
          'signed'
        ) {
          return res.status(409).json({
            message:
              'Le contrat doit être signé avant de télécharger le PDF.',
          });
        }

        // ======================================================
        // VÉRIFICATION DES 24 HEURES
        // ======================================================

        if (
          isContractExpired(
            contract
          )
        ) {

          return res.status(410).json({
            message:
              'Le délai de téléchargement de 24 heures est expiré.',

            status:
              'expired',

            expiresAt:
              contract.expiresAt ||
              null,
          });
        }

        // ======================================================
        // GÉNÉRATION TEMPORAIRE DU PDF
        // ======================================================

        /*
         * Le PDF est créé en mémoire.
         *
         * Il n'est PAS sauvegardé dans Firestore.
         * Il n'est PAS sauvegardé sur le serveur.
         */

        const pdfBuffer =
          await generateContractPdf(
            contract
          );

        // ======================================================
        // RÉPONSE PDF
        // ======================================================

        res.set(
          'Content-Type',
          'application/pdf'
        );

        res.set(
          'Content-Disposition',
          `inline; filename="kontra-africa-contrat-${contractDoc.id}.pdf"`
        );

        res.set(
          'Cache-Control',
          'no-store, no-cache, must-revalidate'
        );

        res.set(
          'Pragma',
          'no-cache'
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
