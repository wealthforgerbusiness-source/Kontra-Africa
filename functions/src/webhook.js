/**
 * Gestionnaire Webhook HTTP (v2) pour la réception des événements Chariow.
 *
 * NOTE DE DÉVELOPPEMENT :
 * La structure exacte du payload JSON transmis par les webhooks / Pulses Chariow pouvant évoluer
 * ou varier selon l'événement, il conviendra d'ajuster l'extraction des champs
 * (notamment l'emplacement de `custom_metadata.firebase_uid`, `license_key`, et `expires_at`)
 * après avoir inspecté un vrai payload reçu en environnement de test / staging.
 */

const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { db } = require("./config");

/**
 * Fonction HTTP onRequest recevant et traitant les webhooks émis par Chariow.
 */
exports.chariowWebhook = onRequest(async (req, res) => {
  // 1. Filtrage sur la méthode HTTP : seules les requêtes POST sont acceptées
  if (req.method !== "POST") {
    logger.warn(`Méthode non autorisée reçue : ${req.method}`);
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    // 2. Lecture du corps de la requête JSON
    const body = req.body || {};
    const eventType = body.event || body.type || "unknown_event";
    const data = body.data || body.payload || {};

    logger.info(`Webhook Chariow reçu. Événement : ${eventType}`);

    // 3. Extraction du firebase_uid depuis les métadonnées (custom_metadata)
    // Recherche de firebase_uid à différents endroits fréquents du payload
    const customMetadata =
      data.custom_metadata ||
      data.sale?.custom_metadata ||
      data.license?.custom_metadata ||
      data.customer?.custom_metadata ||
      {};

    const firebaseUid = customMetadata.firebase_uid;

    // 7. Traitement du cas où le firebase_uid n'est pas identifié
    if (!firebaseUid) {
      logger.warn("Aucun firebase_uid trouvé dans le payload du webhook Chariow.", {
        eventType,
        bodyPayload: body
      });
      // Réponse 200 pour éviter que Chariow ne réessaye indéfiniment
      res.status(200).json({ received: true, status: "skipped_no_uid" });
      return;
    }

    logger.info(`firebase_uid identifié pour l'événement ${eventType}: ${firebaseUid}`);

    const userRef = db.collection("users").doc(firebaseUid);

    // 4. Traitement selon le type d'événement
    const normalizedEvent = eventType.toLowerCase();

    if (
      normalizedEvent.includes("sale.completed") ||
      normalizedEvent.includes("order.completed") ||
      normalizedEvent.includes("license.created") ||
      normalizedEvent.includes("license.active") ||
      normalizedEvent.includes("subscription.created") ||
      normalizedEvent.includes("subscription.active")
    ) {
      // Extraction de la clé de licence
      const licenseKey =
        data.license_key ||
        data.license?.key ||
        data.key ||
        null;

      // Calcul ou récupération de la date d'expiration de l'abonnement
      let subscriptionExpiresAt;
      const rawExpiresAt = data.expires_at || data.license?.expires_at || data.subscription?.expires_at;

      if (rawExpiresAt) {
        subscriptionExpiresAt = new Date(rawExpiresAt);
      } else {
        // Par défaut : expiration à +30 jours si non spécifiée
        const now = new Date();
        subscriptionExpiresAt = new Date(now.setDate(now.getDate() + 30));
      }

      const updateData = {
        subscriptionStatus: "active",
        subscriptionExpiresAt: subscriptionExpiresAt,
        updatedAt: new Date()
      };

      if (licenseKey) {
        updateData.chariowLicenseKey = licenseKey;
      }

      await userRef.set(updateData, { merge: true });
      logger.info(`Statut de l'utilisateur ${firebaseUid} mis à jour : active`);

    } else if (
      normalizedEvent.includes("license.expired") ||
      normalizedEvent.includes("subscription.expired")
    ) {
      await userRef.set(
        {
          subscriptionStatus: "expired",
          updatedAt: new Date()
        },
        { merge: true }
      );
      logger.info(`Statut de l'utilisateur ${firebaseUid} mis à jour : expired`);

    } else if (
      normalizedEvent.includes("subscription.cancelled") ||
      normalizedEvent.includes("subscription.canceled") ||
      normalizedEvent.includes("payment.failed") ||
      normalizedEvent.includes("sale.refunded")
    ) {
      await userRef.set(
        {
          subscriptionStatus: "cancelled",
          updatedAt: new Date()
        },
        { merge: true }
      );
      logger.info(`Statut de l'utilisateur ${firebaseUid} mis à jour : cancelled`);

    } else {
      logger.info(`Type d'événement non géré explicitement : ${eventType}`);
    }

    // 5. Toujours retourner un statut HTTP 200 au webhook Chariow
    res.status(200).json({ received: true });

  } catch (error) {
    logger.error("Erreur lors du traitement du webhook Chariow :", error);
    // On renvoie un code 200 pour valider la réception du webhook côté Chariow
    res.status(200).json({ received: true, error: error.message });
  }
});
