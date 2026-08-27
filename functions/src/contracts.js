```js
// functions/src/contracts.js
//
// Routes publiques du module Contrats.
// Le signataire n'a pas besoin de compte Firebase.
//
// IMPORTANT :
// - Le créateur est identifié par Firebase côté client.
// - Le signataire utilise uniquement un shareToken.
// - Le nom du signataire doit maintenant être fourni
//   par le signataire lui-même.
// - Une signature dessinée est obligatoire.
// - Le PDF est généré côté serveur.
//
// Suppression automatique 24h :
// elle sera ajoutée avec le système de téléchargement
// créateur afin de ne pas supprimer un contrat trop tôt.

const express = require('express');
const { admin, db } = require('./config');
const { generateContractPdf } = require('./pdf-generator');

const router = express.Router();


// ============================================================
// GET /api/contracts/public/:token
// ============================================================
//
// Retourne uniquement les informations nécessaires
// à la page publique de signature.
//
// Ne jamais retourner creatorId ni les données internes.
// ============================================================

router.get('/public/:token', async (req, res) => {

  const { token } = req.params;

  try {

    const contractDoc =
      await findContractByToken(token);

    if (!contractDoc) {

      return res.status(404).json({
        message:
          'Lien de signature introuvable.',
      });
    }

    const data =
      contractDoc.data();

    // --------------------------------------------------------
    // CONTRAT DEJA SIGNE
    // --------------------------------------------------------

    if (
      data.status === 'signed'
    ) {

      return res.json({

        title:
          data.title || '',

        content:
          data.content || '',

        creatorName:
          data.creatorName || '',

        signerName:
          data.signerTypedName ||
          data.signerName ||
          '',

        status:
          data.status,

        signerSignedAt:
          data.signerSignedAt
            ? data.signerSignedAt
                .toDate()
                .toISOString()
            : null,
      });
    }

    // --------------------------------------------------------
    // CONTRAT EN ATTENTE
    // --------------------------------------------------------

    return res.json({

      title:
        data.title || '',

      content:
        data.content || '',

      creatorName:
        data.creatorName || '',

      // IMPORTANT :
      // On peut afficher le nom initialement indiqué
      // par le créateur, mais le signataire devra
      // saisir/confirmer son propre nom lors de la signature.
      signerName:
        data.signerName || '',

      status:
        data.status,

      signerSignedAt:
        null,
    });

  } catch (err) {

    console.error(
      'Erreur GET /contracts/public/:token',
      err
    );

    return res.status(500).json({
      message:
        'Erreur serveur.',
    });
  }
});


// ============================================================
// POST /api/contracts/public/:token/sign
// ============================================================
//
// Le signataire doit obligatoirement fournir :
//
// 1. termsAccepted = true
// 2. typedName
// 3. signatureDataUrl
//
// Le backend ne fait PAS confiance uniquement au frontend.
// Toutes les validations importantes sont refaites ici.
// ============================================================

router.post('/public/:token/sign', async (req, res) => {

  const { token } =
    req.params;

  const {
    termsAccepted,
    signatureDataUrl,
    typedName,
  } = req.body || {};


  // ==========================================================
  // VALIDATION ACCEPTATION
  // ==========================================================

  if (
    termsAccepted !== true
  ) {

    return res.status(400).json({
      message:
        "L'acceptation des termes est requise.",
    });
  }


  // ==========================================================
  // VALIDATION NOM
  // ==========================================================

  const cleanTypedName =
    typeof typedName === 'string'
      ? typedName.trim()
      : '';

  if (!cleanTypedName) {

    return res.status(400).json({
      message:
        'Le nom complet du signataire est obligatoire.',
    });
  }

  if (
    cleanTypedName.length < 2
  ) {

    return res.status(400).json({
      message:
        'Le nom du signataire doit contenir au moins 2 caractères.',
    });
  }

  // Protection contre des noms anormalement longs
  if (
    cleanTypedName.length > 150
  ) {

    return res.status(400).json({
      message:
        'Le nom du signataire est trop long.',
    });
  }


  // ==========================================================
  // VALIDATION SIGNATURE
  // ==========================================================

  if (
    typeof signatureDataUrl !== 'string' ||
    !signatureDataUrl.startsWith(
      'data:image/'
    )
  ) {

    return res.status(400).json({
      message:
        'Une signature dessinée est obligatoire.',
    });
  }


  try {

    // ========================================================
    // RECHERCHE CONTRAT
    // ========================================================

    const contractDoc =
      await findContractByToken(token);

    if (!contractDoc) {

      return res.status(404).json({
        message:
          'Lien de signature introuvable.',
      });
    }


    const data =
      contractDoc.data();


    // ========================================================
    // VERIFICATION ETAT
    // ========================================================

    if (
      data.status === 'signed'
    ) {

      return res.status(409).json({

        message:
          'Ce contrat a déjà été signé.',

        pdfUrlSigner:
          data.pdfUrlSigner || null,
      });
    }


    if (
      data.status !== 'pending'
    ) {

      return res.status(409).json({
        message:
          'Ce contrat ne peut plus être signé.',
      });
    }


    // ========================================================
    // SIGNATURE ATOMIQUE
    // ========================================================
    //
    // On utilise une transaction pour éviter qu'une personne
    // signe deux fois simultanément ou qu'une double requête
    // écrase les données.
    // ========================================================

    const now =
      admin.firestore.Timestamp.now();

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

        const freshData =
          freshDoc.data();


        // ----------------------------------------------------
        // REVERIFICATION ETAT
        // ----------------------------------------------------

        if (
          freshData.status === 'signed'
        ) {

          throw new Error(
            'CONTRACT_ALREADY_SIGNED'
          );
        }

        if (
          freshData.status !== 'pending'
        ) {

          throw new Error(
            'CONTRACT_NOT_PENDING'
          );
        }


        // ----------------------------------------------------
        // ENREGISTREMENT
        // ----------------------------------------------------

        transaction.update(
          contractDoc.ref,
          {

            // Etat final
            status:
              'signed',

            // Conditions acceptées
            termsAcceptedBySigner:
              true,

            // Signature dessinée
            signerSignatureDataUrl:
              signatureDataUrl,

            // Nom réellement saisi
            // par le signataire
            signerTypedName:
              cleanTypedName,

            // Date officielle
            signerSignedAt:
              now,
          }
        );
      }
    );


    // ========================================================
    // SUCCES
    // ========================================================

    console.log(
      `✅ Contrat signé : ${contractDoc.id}`
    );

    return res.json({

      status:
        'signed',

      message:
        'Contrat signé avec succès.',
    });


  } catch (err) {

    console.error(
      'Erreur POST /contracts/public/:token/sign',
      err
    );


    // ========================================================
    // ERREURS METIER
    // ========================================================

    if (
      err.message ===
      'CONTRACT_NOT_FOUND'
    ) {

      return res.status(404).json({
        message:
          'Contrat introuvable.',
      });
    }


    if (
      err.message ===
      'CONTRACT_ALREADY_SIGNED'
    ) {

      return res.status(409).json({
        message:
          'Ce contrat a déjà été signé.',
      });
    }


    if (
      err.message ===
      'CONTRACT_NOT_PENDING'
    ) {

      return res.status(409).json({
        message:
          'Ce contrat ne peut plus être signé.',
      });
    }


    return res.status(500).json({
      message:
        'La signature a échoué. Réessaie.',
    });
  }
});


// ============================================================
// GET /api/contracts/public/:token/pdf
// ============================================================
//
// Le PDF est généré à la demande.
//
// Pour le moment, aucune suppression 24h n'est effectuée ici.
// Elle sera ajoutée avec le système de suivi du téléchargement
// du créateur.
// ============================================================

router.get('/public/:token/pdf', async (req, res) => {

  const { token } =
    req.params;

  try {

    const contractDoc =
      await findContractByToken(token);

    if (!contractDoc) {

      return res.status(404).json({
        message:
          'Lien de signature introuvable.',
      });
    }


    const data =
      contractDoc.data();


    // --------------------------------------------------------
    // SEUL UN CONTRAT SIGNÉ PEUT PRODUIRE LE PDF FINAL
    // --------------------------------------------------------

    if (
      data.status !== 'signed'
    ) {

      return res.status(409).json({
        message:
          "Ce contrat n'a pas encore été signé par les deux parties.",
      });
    }


    // --------------------------------------------------------
    // GENERATION PDF
    // --------------------------------------------------------

    const pdfBuffer =
      await generateContractPdf(
        data
      );


    // --------------------------------------------------------
    // NOM DU FICHIER
    // --------------------------------------------------------

    const safeTitle =
      (
        data.title ||
        'kontra-africa'
      )
        .replace(
          /[^a-z0-9]+/gi,
          '-'
        )
        .toLowerCase()
        .replace(
          /^-+|-+$/g,
          ''
        );


    const filename =
      `contrat-${safeTitle || 'kontra-africa'}.pdf`;


    // --------------------------------------------------------
    // HEADERS
    // --------------------------------------------------------

    res.setHeader(
      'Content-Type',
      'application/pdf'
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );

    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, private'
    );


    // --------------------------------------------------------
    // ENVOI
    // --------------------------------------------------------

    return res.send(
      pdfBuffer
    );


  } catch (err) {

    console.error(
      'Erreur GET /contracts/public/:token/pdf',
      err
    );

    return res.status(500).json({
      message:
        'Impossible de générer le PDF.',
    });
  }
});


// ============================================================
// HELPER : RECHERCHE PAR TOKEN
// ============================================================

async function findContractByToken(
  token
) {

  if (
    !token ||
    typeof token !== 'string'
  ) {
    return null;
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

    return null;
  }


  return snapshot.docs[0];
}


// ============================================================
// EXPORT
// ============================================================

module.exports = router;
```
