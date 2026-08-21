/**
 * Contrôleur Webhook pour la réception des Pulses Chariow.
 */
const { db } = require("./config");

exports.chariowWebhook = async (req, res) => {
  try {
    const body = req.body || {};
    const eventType = body.event || body.type || "unknown_event";
    const data = body.data || body.payload || {};

    console.log(`Webhook Chariow reçu. Événement : ${eventType}`);

    const customMetadata =
      data.custom_metadata ||
      data.sale?.custom_metadata ||
      data.license?.custom_metadata ||
      data.customer?.custom_metadata ||
      {};

    const firebaseUid = customMetadata.firebase_uid;

    if (!firebaseUid) {
      console.warn("Aucun firebase_uid trouvé dans le webhook.");
      return res.status(200).json({ received: true, status: "skipped_no_uid" });
    }

    const userRef = db.collection("users").doc(firebaseUid);
    const normalizedEvent = eventType.toLowerCase();

    if (
      normalizedEvent.includes("sale.completed") ||
      normalizedEvent.includes("order.completed") ||
      normalizedEvent.includes("license.created") ||
      normalizedEvent.includes("license.active") ||
      normalizedEvent.includes("subscription.created") ||
      normalizedEvent.includes("subscription.active")
    ) {
      const licenseKey = data.license_key || data.license?.key || data.key || null;
      let subscriptionExpiresAt;
      const rawExpiresAt = data.expires_at || data.license?.expires_at || data.subscription?.expires_at;

      if (rawExpiresAt) {
        subscriptionExpiresAt = new Date(rawExpiresAt);
      } else {
        const now = new Date();
        subscriptionExpiresAt = new Date(now.setDate(now.getDate() + 30));
      }

      const updateData = {
        subscriptionStatus: "active",
        subscriptionExpiresAt: subscriptionExpiresAt,
        updatedAt: new Date()
      };

      if (licenseKey) updateData.chariowLicenseKey = licenseKey;

      await userRef.set(updateData, { merge: true });
      console.log(`Statut de ${firebaseUid} mis à jour : active`);

    } else if (
      normalizedEvent.includes("license.expired") ||
      normalizedEvent.includes("subscription.expired")
    ) {
      await userRef.set({ subscriptionStatus: "expired", updatedAt: new Date() }, { merge: true });
      console.log(`Statut de ${firebaseUid} mis à jour : expired`);

    } else if (
      normalizedEvent.includes("subscription.cancelled") ||
      normalizedEvent.includes("subscription.canceled") ||
      normalizedEvent.includes("payment.failed") ||
      normalizedEvent.includes("sale.refunded")
    ) {
      await userRef.set({ subscriptionStatus: "cancelled", updatedAt: new Date() }, { merge: true });
      console.log(`Statut de ${firebaseUid} mis à jour : cancelled`);
    }

    // Répond toujours 200 à Chariow
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Erreur traitement webhook:", error);
    return res.status(200).json({ received: true, error: error.message });
  }
};
