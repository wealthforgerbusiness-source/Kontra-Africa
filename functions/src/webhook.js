/**
 * Contrôleur Webhook pour la réception des Pulses Chariow.
 */
const { db } = require("./config");

exports.chariowWebhook = async (req, res) => {
  try {
    const body = req.body || {};
    // IMPORTANT : Chariow n'enveloppe PAS le payload dans "data" ou "payload".
    // Le payload d'une Pulse est à plat : { event, sale, product, customer, store, ... }
    // Voir https://chariow.dev/en/guides/pulses
    const eventType = body.event || "unknown_event";
    const normalizedEvent = eventType.toLowerCase();

    const sale = body.sale || {};
    const license = body.license || {};
    const customer = body.customer || {};

    console.log(`Webhook Chariow reçu. Événement : ${eventType}`);

    // custom_metadata vit sur l'objet "sale" (ou "license" selon l'événement),
    // jamais sous une clé "data" qui n'existe pas dans le payload réel.
    const customMetadata = sale.custom_metadata || license.custom_metadata || {};
    let firebaseUid = customMetadata.firebase_uid || null;

    // Fallback : si le firebase_uid n'est pas dans les métadonnées (ex. vieilles
    // ventes créées avant ce correctif), on retrouve l'utilisateur par email,
    // puisque l'email est déjà en base Firestore.
    let userRef = null;
    if (firebaseUid) {
      userRef = db.collection("users").doc(firebaseUid);
    } else if (customer.email) {
      console.warn(`Aucun firebase_uid dans le webhook, tentative de résolution par email : ${customer.email}`);
      const snap = await db.collection("users").where("email", "==", customer.email).limit(1).get();
      if (!snap.empty) {
        userRef = snap.docs[0].ref;
        firebaseUid = snap.docs[0].id;
        console.log(`Utilisateur résolu par email : ${firebaseUid}`);
      }
    }

    if (!userRef) {
      console.warn("Aucun utilisateur trouvé (ni firebase_uid, ni email correspondant).");
      return res.status(200).json({ received: true, status: "skipped_no_user" });
    }

    // Noms d'événements réels envoyés par Chariow (voir doc Pulses) :
    // successful.sale, failed.sale, abandoned.sale,
    // license.issued, license.activated, license.revoked, license.expired, license.nearing_expiry
    if (normalizedEvent === "successful.sale" || normalizedEvent === "license.issued" || normalizedEvent === "license.activated") {
      const licenseKey = sale.license_key || license.key || null;
      const rawExpiresAt = sale.expires_at || license.expires_at;

      let subscriptionExpiresAt;
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
      normalizedEvent === "license.expired"
    ) {
      await userRef.set({ subscriptionStatus: "expired", updatedAt: new Date() }, { merge: true });
      console.log(`Statut de ${firebaseUid} mis à jour : expired`);

    } else if (
      normalizedEvent === "failed.sale" ||
      normalizedEvent === "abandoned.sale"
    ) {
      // IMPORTANT : failed.sale / abandoned.sale signifient "cette tentative de
      // paiement a échoué", PAS "l'abonnement en cours est révoqué". Comme les
      // webhooks Chariow peuvent arriver dans le désordre (retries, confirmation
      // mobile money asynchrone), on ne doit JAMAIS écraser un abonnement encore
      // "active" et non expiré à cause d'une tentative ratée, sous peine de
      // couper l'accès à un utilisateur qui vient tout juste d'être réactivé
      // par un successful.sale reçu juste avant (voir capture du 26/08 19h45-19h51).
      const currentSnap = await userRef.get();
      const currentData = currentSnap.exists ? currentSnap.data() : {};
      const currentlyActive = currentData.subscriptionStatus === "active";
      const expiresAt = currentData.subscriptionExpiresAt?.toDate
        ? currentData.subscriptionExpiresAt.toDate()
        : currentData.subscriptionExpiresAt ? new Date(currentData.subscriptionExpiresAt) : null;
      const stillWithinPaidPeriod = expiresAt && expiresAt > new Date();

      if (currentlyActive && stillWithinPaidPeriod) {
        console.log(
          `${eventType} reçu pour ${firebaseUid} mais abonnement encore actif jusqu'au ${expiresAt.toISOString()} — statut inchangé (tentative ratée ignorée).`
        );
      } else {
        await userRef.set({ subscriptionStatus: "cancelled", updatedAt: new Date() }, { merge: true });
        console.log(`Statut de ${firebaseUid} mis à jour : cancelled`);
      }
    } else if (normalizedEvent === "license.revoked") {
      // license.revoked est une action explicite et volontaire (ex. remboursement,
      // fraude) : contrairement à failed/abandoned, elle doit toujours s'appliquer.
      await userRef.set({ subscriptionStatus: "cancelled", updatedAt: new Date() }, { merge: true });
      console.log(`Statut de ${firebaseUid} mis à jour : cancelled (licence révoquée)`);
    } else {
      console.log(`Événement ${eventType} reçu mais non traité (pas d'action nécessaire).`);
    }

    // Répond toujours 200 à Chariow
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Erreur traitement webhook:", error);
    return res.status(200).json({ received: true, error: error.message });
  }
};
