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

const PDF_ACCESS_DURATION_MS =
  24 * 60 * 60 * 1000;


// ============================================================
// UTILITAIRES
// ============================================================

function timestampToISOString(value) {
  if (!value) return null;

  if (
    value &&
    typeof value.toDate === 'function'
  ) {
    return value.toDate().toISOString();
  }

  if (
    value &&
    typeof value.toMillis === 'function'
  ) {
    return new Date(
      value.toMillis()
    ).toISOString();
  }

  return null;
}


function getTimestampMillis(value) {
  if (!value) return null;

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
    typeof value === 'string'
  ) {
    const time =
      new Date(value).getTime();

    return Number.isNaN(time)
      ? null
      : time;
  }

  if (
    typeof value === 'number'
  ) {
    return value;
  }

  return null;
}


function isPdfAccessExpired(contract) {
  if (!contract.pdfExpiresAt) {
    return false;
  }

  const expiresAt =
    getTimestampMillis(
      contract.pdfExpiresAt
    );

  if (!expiresAt) {
    return false;
  }

  return Date.now() >= expiresAt;
}


// ============================================================
// CHARGER CONTRAT PUBLIC
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


        // ------------------------------------------------------
        // SI PDF EXPIRÉ
        // ------------------------------------------------------

        if (
          contract.pdfAccessStartedAt &&
          isPdfAccessExpired(contract)
        ) {

          return res.status(410).json({

            id: doc.id,

            status:
              'expired',

            message:
              'Le délai de 24 heures pour le PDF est expiré.',

            signerSignedAt:
              timestampToISOString(
                contract.signerSignedAt
              ),

            pdfAccessStartedAt:
              timestampToISOString(
                contract.pdfAccessStartedAt
              ),

            pdfExpiresAt:
              timestampToISOString(
                contract.pdfExpiresAt
              ),
          });
        }


        return res.status(200).json({

          id: doc.id,

          title:
            contract.title || '',

          content:
            contract.content || '',

          creatorName:
            contract.creatorName || '',

          signerName:
            contract.signerName || '',

          status:
            contract.status || 'pending',

          signerSignedAt:
            contract.signerSignedAt || null,

          pdfAccessStartedAt:
            contract.pdfAccessStartedAt || null,

          pdfExpiresAt:
            contract.pdfExpiresAt || null,
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


        // ------------------------------------------------------
        // VALIDATION
        // ------------------------------------------------------

        if (
          termsAccepted !== true
        ) {
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


        // ------------------------------------------------------
        // RECHERCHE
        // ------------------------------------------------------

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


        // ------------------------------------------------------
        // STATUT
        // ------------------------------------------------------

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

              signerSignedAt:
                timestampToISOString(
                  contract.signerSignedAt
                ),

              pdfAccessStartedAt:
                timestampToISOString(
                  contract.pdfAccessStartedAt
                ),

              pdfExpiresAt:
                timestampToISOString(
                  contract.pdfExpiresAt
                ),
            });
          }

          return res.status(409).json({
            message:
              'Ce contrat n’est plus disponible.',
          });
        }


        // ------------------------------------------------------
        // SIGNATURE CLIENT
        // ------------------------------------------------------

        const signerSignedAt =
          admin.firestore.Timestamp.now();


        await contractDoc.ref.update({

          signerTypedName:
            signerTypedName,

          signerSignatureDataUrl:
            signatureDataUrl,

          termsAcceptedBySigner:
            true,

          signerSignedAt:
            signerSignedAt,

          status:
            'signed',

          /*
           * IMPORTANT :
           *
           * On NE démarre PAS le délai ici.
           */

          pdfAccessStartedAt:
            null,

          pdfExpiresAt:
            null,
        });


        return res.status(200).json({

          id:
            contractDoc.id,

          status:
            'signed',

          signerTypedName:
            signerTypedName,

          signerSignedAt:
            signerSignedAt
              .toDate()
              .toISOString(),

          pdfAccessStartedAt:
            null,

          pdfExpiresAt:
            null,

          message:
            'Contrat signé avec succès. Le délai PDF commencera lorsque le créateur téléchargera le contrat.',
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
// DÉMARRER LA PÉRIODE PDF
//
// CETTE ROUTE DOIT ÊTRE APPELÉE PAR LE CRÉATEUR
// LORSQU'IL CLIQUE SUR "TÉLÉCHARGER LE PDF".
// ============================================================

exports.startContractPdfAccess =
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
          'Content-Type, Authorization'
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
          req.body?.token ||
          req.query.token;


        if (!token) {
          return res.status(400).json({
            message:
              'Token du contrat manquant.',
          });
        }


        // ------------------------------------------------------
        // AUTHENTIFICATION CRÉATEUR
        // ------------------------------------------------------

        const authHeader =
          req.headers.authorization ||
          '';


        if (
          !authHeader.startsWith(
            'Bearer '
          )
        ) {

          return res.status(401).json({
            message:
              'Authentification requise.',
          });
        }


        const idToken =
          authHeader.substring(
            7
          );


        const decoded =
          await admin
            .auth()
            .verifyIdToken(
              idToken
            );


        const creatorId =
          decoded.uid;


        // ------------------------------------------------------
        // RECHERCHE CONTRAT
        // ------------------------------------------------------

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


        // ------------------------------------------------------
        // VÉRIFIER QUE C'EST BIEN LE CRÉATEUR
        // ------------------------------------------------------

        if (
          contract.creatorId !==
          creatorId
        ) {

          return res.status(403).json({
            message:
              'Vous n’êtes pas le créateur de ce contrat.',
          });
        }


        // ------------------------------------------------------
        // CLIENT DOIT AVOIR SIGNÉ
        // ------------------------------------------------------

        if (
          contract.status !==
          'signed'
        ) {

          return res.status(409).json({
            message:
              'Le client doit d’abord signer le contrat.',
          });
        }


        // ------------------------------------------------------
        // SI LE COMPTE À REBOURS EXISTE DÉJÀ
        // ------------------------------------------------------

        if (
          contract.pdfAccessStartedAt &&
          contract.pdfExpiresAt
        ) {

          if (
            isPdfAccessExpired(
              contract
            )
          ) {

            return res.status(410).json({

              status:
                'expired',

              message:
                'Les 24 heures sont déjà écoulées.',
            });
          }


          return res.status(200).json({

            status:
              'active',

            pdfAccessStartedAt:
              timestampToISOString(
                contract.pdfAccessStartedAt
              ),

            pdfExpiresAt:
              timestampToISOString(
                contract.pdfExpiresAt
              ),
          });
        }


        // ------------------------------------------------------
        // DÉMARRER LES 24 HEURES
        // ------------------------------------------------------

        const startedAt =
          admin.firestore.Timestamp.now();


        const expiresAt =
          admin.firestore.Timestamp.fromMillis(
            startedAt.toMillis() +
              PDF_ACCESS_DURATION_MS
          );


        await contractDoc.ref.update({

          pdfAccessStartedAt:
            startedAt,

          pdfExpiresAt:
            expiresAt,
        });


        return res.status(200).json({

          status:
            'active',

          pdfAccessStartedAt:
            startedAt
              .toDate()
              .toISOString(),

          pdfExpiresAt:
            expiresAt
              .toDate()
              .toISOString(),

          message:
            'La période de disponibilité du PDF de 24 heures commence maintenant.',
        });


      } catch (error) {

        console.error(
          'Erreur startContractPdfAccess :',
          error
        );


        return res.status(500).json({
          message:
            'Impossible de démarrer la période PDF.',
        });
      }
    }
  );


// ============================================================
// TÉLÉCHARGER LE PDF
//
// Le PDF est généré à la demande.
// Il n'est PAS stocké.
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


        if (
          snapshot.empty
        ) {

          return res.status(404).json({
            message:
              'Contrat introuvable.',
          });
        }


        const doc =
          snapshot.docs[0];

        const contract =
          doc.data();


        // ------------------------------------------------------
        // CLIENT DOIT AVOIR SIGNÉ
        // ------------------------------------------------------

        if (
          contract.status !==
          'signed'
        ) {

          return res.status(409).json({
            message:
              'Le contrat doit être signé avant de télécharger le PDF.',
          });
        }


        // ------------------------------------------------------
        // LE CRÉATEUR DOIT AVOIR DÉMARRÉ LE DÉLAI
        // ------------------------------------------------------

        if (
          !contract.pdfAccessStartedAt ||
          !contract.pdfExpiresAt
        ) {

          return res.status(403).json({
            message:
              'Le créateur doit d’abord cliquer sur Télécharger le PDF pour démarrer la période de 24 heures.',
          });
        }


        // ------------------------------------------------------
        // EXPIRATION
        // ------------------------------------------------------

        if (
          isPdfAccessExpired(
            contract
          )
        ) {

          return res.status(410).json({

            status:
              'expired',

            message:
              'Le délai de 24 heures est expiré. Le PDF n’est plus disponible.',
          });
        }


        // ------------------------------------------------------
        // GÉNÉRATION PDF À LA DEMANDE
        // ------------------------------------------------------

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
          `inline; filename="kontra-africa-contrat-${doc.id}.pdf"`
        );


        res.set(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, max-age=0'
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
