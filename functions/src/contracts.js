// functions/src/contracts.js

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

const { generateContractPdf } = require('./pdf-generator');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const PDF_ACCESS_DURATION_MS = 24 * 60 * 60 * 1000;


// ============================================================
// CORS
// ============================================================

function setCors(res, methods) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', methods);
  res.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );
}


// ============================================================
// TOKENS
// ============================================================

function getShareToken(req) {
  return (
    req.params.token ||
    req.query.token ||
    ''
  ).trim();
}


function getBearerToken(req) {
  const authorization =
    req.headers.authorization || '';

  if (!authorization.startsWith('Bearer ')) {
    return null;
  }

  return authorization.substring(7).trim();
}


// ============================================================
// AUTHENTIFICATION
// ============================================================

async function getAuthenticatedUser(req) {
  const idToken = getBearerToken(req);

  if (!idToken) {
    return null;
  }

  try {
    return await admin
      .auth()
      .verifyIdToken(idToken);
  } catch (error) {
    console.error(
      'Token Firebase invalide :',
      error
    );

    return null;
  }
}


// ============================================================
// FIRESTORE
// ============================================================

async function findContractByShareToken(token) {
  if (!token) {
    return null;
  }

  const snapshot = await db
    .collection('contracts')
    .where('shareToken', '==', token)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  return snapshot.docs[0];
}


async function findContractById(contractId) {
  if (!contractId) {
    return null;
  }

  const contractDoc = await db
    .collection('contracts')
    .doc(contractId)
    .get();

  if (!contractDoc.exists) {
    return null;
  }

  return contractDoc;
}


// ============================================================
// EXPIRATION
// ============================================================

function getPdfExpirationMillis(contract) {
  if (!contract.pdfExpiresAt) {
    return null;
  }

  if (
    typeof contract.pdfExpiresAt.toMillis ===
    'function'
  ) {
    return contract.pdfExpiresAt.toMillis();
  }

  if (
    typeof contract.pdfExpiresAt ===
    'number'
  ) {
    return contract.pdfExpiresAt;
  }

  const date = new Date(
    contract.pdfExpiresAt
  );

  const millis = date.getTime();

  return Number.isNaN(millis)
    ? null
    : millis;
}


// ============================================================
// SUPPRESSION APRÈS 24 H
// ============================================================

async function expireContract(contractRef) {
  await contractRef.update({

    status: 'expired',

    content:
      admin.firestore.FieldValue.delete(),

    signerName:
      admin.firestore.FieldValue.delete(),

    creatorName:
      admin.firestore.FieldValue.delete(),

    creatorSignatureDataUrl:
      admin.firestore.FieldValue.delete(),

    signerTypedName:
      admin.firestore.FieldValue.delete(),

    signerSignatureDataUrl:
      admin.firestore.FieldValue.delete(),

    termsAcceptedBySigner:
      admin.firestore.FieldValue.delete(),

    signerSignedAt:
      admin.firestore.FieldValue.delete(),

    creatorSignedAt:
      admin.firestore.FieldValue.delete(),

    pdfAccessStartedAt:
      admin.firestore.FieldValue.delete(),

    pdfExpiresAt:
      admin.firestore.FieldValue.delete(),

    shareToken:
      admin.firestore.FieldValue.delete(),

  });
}


async function ensurePdfAccessStillValid(
  contractDoc,
  contract
) {
  const expiresAt =
    getPdfExpirationMillis(contract);

  if (!expiresAt) {
    return {
      valid: true,
      contract,
    };
  }

  if (Date.now() < expiresAt) {
    return {
      valid: true,
      contract,
    };
  }

  await expireContract(
    contractDoc.ref
  );

  return {
    valid: false,
    contract: null,
  };
}


// ============================================================
// CHARGER CONTRAT PUBLIC
// GET /api/contracts/public/:token
// ============================================================

router.get(
  '/public/:token',
  async (req, res) => {

    try {

      setCors(
        res,
        'GET, OPTIONS'
      );

      if (req.method === 'OPTIONS') {
        return res
          .status(204)
          .send('');
      }

      const token =
        getShareToken(req);

      if (!token) {
        return res.status(400).json({
          message:
            'Lien de signature invalide.',
        });
      }

      const contractDoc =
        await findContractByShareToken(
          token
        );

      if (!contractDoc) {
        return res.status(404).json({
          message:
            'Contrat introuvable ou lien invalide.',
        });
      }

      const contract =
        contractDoc.data();

      if (
        contract.status ===
        'expired'
      ) {
        return res.status(410).json({
          message:
            'Ce contrat a expiré.',
          status: 'expired',
        });
      }

      const access =
        await ensurePdfAccessStillValid(
          contractDoc,
          contract
        );

      if (!access.valid) {
        return res.status(410).json({
          message:
            'La période de téléchargement de ce contrat est terminée.',
          status: 'expired',
        });
      }

      const currentContract =
        access.contract;

      return res.status(200).json({

        id:
          contractDoc.id,

        title:
          currentContract.title || '',

        content:
          currentContract.content || '',

        creatorName:
          currentContract.creatorName || '',

        signerName:
          currentContract.signerName || '',

        status:
          currentContract.status ||
          'pending',

        signerSignedAt:
          currentContract.signerSignedAt ||
          null,

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
// SIGNATURE CLIENT
// POST /api/contracts/public/:token/sign
// ============================================================

router.post(
  '/public/:token/sign',
  async (req, res) => {

    try {

      setCors(
        res,
        'POST, OPTIONS'
      );

      const token =
        getShareToken(req);

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

      if (signerTypedName.length < 2) {
        return res.status(400).json({
          message:
            'Le nom doit contenir au moins 2 caractères.',
        });
      }

      if (signerTypedName.length > 150) {
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

      const contractDoc =
        await findContractByShareToken(
          token
        );

      if (!contractDoc) {
        return res.status(404).json({
          message:
            'Contrat introuvable.',
        });
      }

      const contract =
        contractDoc.data();

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
            status: 'signed',
          });
        }

        if (
          contract.status ===
          'expired'
        ) {
          return res.status(410).json({
            message:
              'Ce contrat a expiré.',
            status: 'expired',
          });
        }

        return res.status(409).json({
          message:
            'Ce contrat n’est plus disponible.',
        });
      }

      const signerSignedAt =
        admin.firestore.Timestamp.now();

      await contractDoc.ref.update({

        signerTypedName,

        signerSignatureDataUrl:
          signatureDataUrl,

        termsAcceptedBySigner:
          true,

        signerSignedAt,

        status: 'signed',

        // Les 24 h ne commencent PAS ici.
        pdfAccessStartedAt: null,

        pdfExpiresAt: null,

      });

      const updatedSnapshot =
        await contractDoc.ref.get();

      const updatedContract =
        updatedSnapshot.data();

      try {

        await generateContractPdf(
          updatedContract
        );

      } catch (pdfError) {

        console.error(
          'Erreur génération PDF après signature :',
          pdfError
        );

        return res.status(200).json({

          id:
            contractDoc.id,

          status: 'signed',

          signerTypedName,

          signerSignedAt:
            signerSignedAt
              .toDate()
              .toISOString(),

          pdfAvailable: false,

          message:
            'Contrat signé, mais le PDF doit être régénéré.',

        });
      }

      return res.status(200).json({

        id:
          contractDoc.id,

        status: 'signed',

        signerTypedName,

        signerSignedAt:
          signerSignedAt
            .toDate()
            .toISOString(),

        pdfAvailable: true,

        pdfAccessStartedAt: null,

        pdfExpiresAt: null,

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
// PDF CLIENT
// GET /api/contracts/public/:token/pdf
// ============================================================

router.get(
  '/public/:token/pdf',
  async (req, res) => {

    try {

      setCors(
        res,
        'GET, OPTIONS'
      );

      const token =
        getShareToken(req);

      if (!token) {
        return res.status(400).json({
          message:
            'Lien de contrat invalide.',
        });
      }

      const contractDoc =
        await findContractByShareToken(
          token
        );

      if (!contractDoc) {
        return res.status(404).json({
          message:
            'Contrat introuvable.',
        });
      }

      const contract =
        contractDoc.data();

      if (
        contract.status ===
        'expired'
      ) {
        return res.status(410).json({
          message:
            'La période de téléchargement est terminée.',
          status: 'expired',
        });
      }

      if (
        contract.status !==
        'signed'
      ) {
        return res.status(409).json({
          message:
            'Le contrat doit être signé avant de télécharger le PDF.',
        });
      }

      const access =
        await ensurePdfAccessStillValid(
          contractDoc,
          contract
        );

      if (!access.valid) {
        return res.status(410).json({
          message:
            'La période de téléchargement de ce contrat est terminée.',
          status: 'expired',
        });
      }

      const pdfBuffer =
        await generateContractPdf(
          access.contract
        );

      res.set(
        'Content-Type',
        'application/pdf'
      );

      res.set(
        'Content-Disposition',
        `attachment; filename="kontra-africa-contrat-${contractDoc.id}.pdf"`
      );

      res.set(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private'
      );

      res.set(
        'Pragma',
        'no-cache'
      );

      res.set(
        'Expires',
        '0'
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


// ============================================================
// PDF CRÉATEUR
// POST /api/contracts/:contractId/creator-pdf
// ============================================================

router.post(
  '/:contractId/creator-pdf',
  async (req, res) => {

    try {

      setCors(
        res,
        'POST, OPTIONS'
      );

      const user =
        await getAuthenticatedUser(
          req
        );

      if (!user) {
        return res.status(401).json({
          message:
            'Vous devez être connecté pour télécharger le PDF.',
        });
      }

      const contractId =
        req.params.contractId ||
        req.query.contractId;

      if (!contractId) {
        return res.status(400).json({
          message:
            'Identifiant du contrat manquant.',
        });
      }

      const contractDoc =
        await findContractById(
          contractId
        );

      if (!contractDoc) {
        return res.status(404).json({
          message:
            'Contrat introuvable.',
        });
      }

      let contract =
        contractDoc.data();

      if (
        contract.creatorId !==
        user.uid
      ) {
        return res.status(403).json({
          message:
            'Vous n’êtes pas autorisé à télécharger ce contrat.',
        });
      }

      if (
        contract.status ===
        'expired'
      ) {
        return res.status(410).json({
          message:
            'La période de téléchargement est terminée.',
          status: 'expired',
        });
      }

      if (
        contract.status !==
        'signed'
      ) {
        return res.status(409).json({
          message:
            'Le contrat doit être signé par le client avant le téléchargement.',
        });
      }


      // ========================================================
      // LES 24 H COMMENCENT AU PREMIER CLIC DU CRÉATEUR
      // ========================================================

      const now =
        admin.firestore.Timestamp.now();

      const result =
        await db.runTransaction(
          async (transaction) => {

            const freshDoc =
              await transaction.get(
                contractDoc.ref
              );

            if (!freshDoc.exists) {
              throw new Error(
                'CONTRACT_NOT_FOUND'
              );
            }

            const freshContract =
              freshDoc.data();

            if (
              freshContract.creatorId !==
              user.uid
            ) {
              throw new Error(
                'NOT_OWNER'
              );
            }

            if (
              freshContract.status ===
              'expired'
            ) {
              throw new Error(
                'EXPIRED'
              );
            }

            if (
              freshContract.status !==
              'signed'
            ) {
              throw new Error(
                'NOT_SIGNED'
              );
            }


            // ==================================================
            // 24 H DÉJÀ COMMENCÉES
            // ==================================================

            if (
              freshContract.pdfAccessStartedAt
            ) {

              const expiresAt =
                getPdfExpirationMillis(
                  freshContract
                );

              if (
                expiresAt &&
                Date.now() >=
                  expiresAt
              ) {

                transaction.update(
                  contractDoc.ref,
                  {

                    status:
                      'expired',

                    content:
                      admin.firestore.FieldValue.delete(),

                    signerName:
                      admin.firestore.FieldValue.delete(),

                    creatorName:
                      admin.firestore.FieldValue.delete(),

                    creatorSignatureDataUrl:
                      admin.firestore.FieldValue.delete(),

                    signerTypedName:
                      admin.firestore.FieldValue.delete(),

                    signerSignatureDataUrl:
                      admin.firestore.FieldValue.delete(),

                    termsAcceptedBySigner:
                      admin.firestore.FieldValue.delete(),

                    signerSignedAt:
                      admin.firestore.FieldValue.delete(),

                    creatorSignedAt:
                      admin.firestore.FieldValue.delete(),

                    pdfAccessStartedAt:
                      admin.firestore.FieldValue.delete(),

                    pdfExpiresAt:
                      admin.firestore.FieldValue.delete(),

                    shareToken:
                      admin.firestore.FieldValue.delete(),

                  }
                );

                throw new Error(
                  'EXPIRED'
                );
              }

              return {
                contract:
                  freshContract,

                started: false,
              };
            }


            // ==================================================
            // PREMIER CLIC
            // ==================================================

            const expiresAt =
              admin.firestore.Timestamp.fromMillis(
                now.toMillis() +
                PDF_ACCESS_DURATION_MS
              );

            transaction.update(
              contractDoc.ref,
              {

                pdfAccessStartedAt:
                  now,

                pdfExpiresAt:
                  expiresAt,

              }
            );

            return {

              contract: {

                ...freshContract,

                pdfAccessStartedAt:
                  now,

                pdfExpiresAt:
                  expiresAt,

              },

              started: true,

            };

          }
        );


      contract =
        result.contract;


      // ========================================================
      // PDF GÉNÉRÉ À LA DEMANDE
      // ========================================================

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
        `attachment; filename="kontra-africa-contrat-${contractDoc.id}.pdf"`
      );

      res.set(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private'
      );

      res.set(
        'Pragma',
        'no-cache'
      );

      res.set(
        'Expires',
        '0'
      );

      return res
        .status(200)
        .send(pdfBuffer);

    } catch (error) {

      console.error(
        'Erreur creatorPdf :',
        error
      );


      if (
        error.message ===
        'EXPIRED'
      ) {
        return res.status(410).json({
          message:
            'La période de téléchargement de 24 heures est terminée.',
          status:
            'expired',
        });
      }


      if (
        error.message ===
        'NOT_OWNER'
      ) {
        return res.status(403).json({
          message:
            'Vous n’êtes pas autorisé à télécharger ce contrat.',
        });
      }


      if (
        error.message ===
        'NOT_SIGNED'
      ) {
        return res.status(409).json({
          message:
            'Le client doit d’abord signer le contrat.',
        });
      }


      if (
        error.message ===
        'CONTRACT_NOT_FOUND'
      ) {
        return res.status(404).json({
          message:
            'Contrat introuvable.',
        });
      }


      return res.status(500).json({
        message:
          'Impossible de générer le PDF.',
      });

    }

  }
);


// ============================================================
// EXPORT EXPRESS
// ============================================================

module.exports = router;
