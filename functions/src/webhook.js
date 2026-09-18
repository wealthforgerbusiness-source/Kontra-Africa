/**
 * Contrôleur Webhook pour la réception des événements SasPay.
 * Remplace l'ancien système basé sur les clés de licence Chariow :
 * SasPay ne gère pas de licences, on utilise directement le firebase_uid
 * passé en metadata à la création de la session (voir checkout.js), donc
 * plus besoin de rechercher/activer une licence après coup.
 */
const crypto = require("crypto");
const { db, SASPAY_WEBHOOK_SECRET } = require("./config");

const TOLERANCE_SECONDS = 300;

/**
 * Vérifie la signature HMAC-SHA256 envoyée par SasPay.
 * En-têtes attendus : x-webhook-signature, x-webhook-timestamp.
 * À reconfirmer dans le dashboard SasPay si les noms d'en-têtes diffèrent.
 */
function isValidSignature(req) {
  if (!SASPAY_WEBHOOK_SECRET) {
    console.error("SASPAY_WEBHOOK_SECRET n'est pas configuré sur le serveur — webhook refusé.");
    return false;
  }

  if (!req.rawBody) {
    console.error("req.rawBody est absent — vérifie que bodyParser.json({ verify }) est bien configuré dans server.js.");
    return false;
  }

  const receivedSignature = req.header("x-webhook-signature") || "";
  const timestamp = req.header("x-webhook-timestamp") || "";

  const now = Math.floor(Date.now() / 1000);
  if (!timestamp || Math.abs(now - Number(timestamp)) > TOLERANCE_SECONDS) {
    console.error("Webhook SasPay : timestamp manquant ou hors tolérance.");
    return false;
  }

  const expected = crypto
    .createHmac("sha256", SASPAY_WEBHOOK_SECRET)
    .update(`${timestamp}.${req.rawBody}`)
    .digest("hex");

  const receivedBuffer = Buffer.from(receivedSignature);
  const expectedBuffer = Buffer.from(expected);

  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

exports.saspayWebhook = async (req, res) => {
  try {
    if (!isValidSignature(req)) {
      console.warn("Webhook SasPay refusé : signature manquante ou invalide.");
      return res.status(401).json({ received: false, error: "unauthorized" });
    }

    const body = req.body || {};

    // Comme pour checkout.js et verify-payment.js : reste tolérant si SasPay
    // enveloppe le payload webhook dans { success, event, data, code } plutôt
    // que de l'envoyer à plat. On log toujours le payload brut ci-dessous pour
    // confirmer/ajuster ce point si besoin.
    const eventType = body.event || body.type || "unknown_event";
    const data = body.data || body;

    console.log(`Webhook SasPay reçu. Événement : ${eventType}. Payload brut :`, JSON.stringify(body));

    const reference = data.reference || null;
    const transactionId = data.id || null;
    const firebaseUid = (data.metadata && data.metadata.firebase_uid) || null;

    if (!reference && !firebaseUid) {
      console.warn("Webhook SasPay : ni reference ni firebase_uid dans le payload. Payload complet :", JSON.stringify(body));
      return res.status(200).json({ received: true, status: "skipped_no_reference" });
    }

    // Retrouve la trace de paiement créée au moment du checkout (voir checkout.js)
    let pendingRef = reference ? db.collection("paiements_en_attente").doc(reference) : null;
    let resolvedUid = firebaseUid;

    if (pendingRef) {
      const pendingDoc = await pendingRef.get();
      if (pendingDoc.exists) {
        resolvedUid = resolvedUid || pendingDoc.data().firebaseUid;
      } else {
        console.warn(`Webhook SasPay : référence inconnue en base (${reference}).`);
      }
    }

    if (!resolvedUid) {
      console.warn("Webhook SasPay : impossible de résoudre le compte utilisateur. Payload :", JSON.stringify(body));
      return res.status(200).json({ received: true, status: "skipped_no_user" });
    }

    const userRef = db.collection("users").doc(resolvedUid);

    // On normalise pour rester tolérant tant que la convention exacte de
    // nommage des événements SasPay n'est pas confirmée par un vrai webhook
    // reçu (vérifier les logs Render après un paiement réel).
    const normalizedEvent = String(eventType).toLowerCase();
    const isSuccessEvent = normalizedEvent.includes("success") || normalizedEvent.includes("paid");
    const isFailedOrCancelledEvent = normalizedEvent.includes("fail") || normalizedEvent.includes("cancel");

    if (isSuccessEvent) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // abonnement 30 jours, adapte si besoin

      await userRef.set({
        subscriptionStatus: "active",
        subscriptionExpiresAt: expiresAt,
        saspayTransactionId: transactionId,
        updatedAt: new Date(),
      }, { merge: true });

      if (pendingRef) await pendingRef.update({ status: "SUCCESS" }).catch(() => {});

      console.log(`Statut de ${resolvedUid} mis à jour : active (transaction ${transactionId}).`);

    } else if (isFailedOrCancelledEvent) {
      // Même prudence que l'ancien système Chariow : une tentative ratée ne
      // doit jamais écraser un abonnement encore actif et non expiré (les
      // webhooks peuvent arriver en désordre / en retry).
      const currentSnap = await userRef.get();
      const currentData = currentSnap.exists ? currentSnap.data() : {};
      const currentlyActive = currentData.subscriptionStatus === "active";
      const expiresAtDate = currentData.subscriptionExpiresAt?.toDate
        ? currentData.subscriptionExpiresAt.toDate()
        : currentData.subscriptionExpiresAt ? new Date(currentData.subscriptionExpiresAt) : null;
      const stillWithinPaidPeriod = expiresAtDate && expiresAtDate > new Date();

      if (currentlyActive && stillWithinPaidPeriod) {
        console.log(`${eventType} reçu pour ${resolvedUid} mais abonnement encore actif jusqu'au ${expiresAtDate.toISOString()} — statut inchangé.`);
      } else {
        await userRef.set({ subscriptionStatus: "cancelled", updatedAt: new Date() }, { merge: true });
        console.log(`Statut de ${resolvedUid} mis à jour : cancelled`);
      }

      if (pendingRef) await pendingRef.update({ status: "FAILED" }).catch(() => {});

    } else {
      console.log(`Événement ${eventType} reçu mais non traité (pas d'action nécessaire).`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Erreur traitement webhook SasPay:", error);
    return res.status(200).json({ received: true, error: error.message });
  }
};
