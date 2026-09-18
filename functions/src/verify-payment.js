/**
 * Remplace license-verify.js : plus de clé de licence à recopier.
 * L'utilisateur donne juste la référence de sa tentative de paiement
 * (stockée côté frontend après le retour de checkout, voir profil.js),
 * et on interroge directement l'API SasPay pour connaître le vrai statut —
 * utile si le webhook a été manqué ou retardé.
 */
const { db, SASPAY_API_URL, SASPAY_SECRET_KEY } = require("./config");
const { getVerifiedUid } = require("./verify-auth");

// Valeurs vues confirmées en prod pour "status" : PENDING (voir checkout.js).
// Par cohérence avec les enums SasPay observés ailleurs (tout en MAJUSCULES,
// ex. fee_charge_mode: ADD_ON/DEDUCTED), on part du principe que le statut
// "payé" est PAID. On reste tolérant sur la casse et sur d'autres libellés
// plausibles pour ne pas bloquer si SasPay utilise une variante.
const PAID_STATUS_VALUES = ["paid", "success", "succeeded", "completed"];

function isSessionPaid(sessionData) {
  const status = (sessionData.status || sessionData.payment_status || "").toLowerCase();
  return PAID_STATUS_VALUES.includes(status);
}

exports.verifyPayment = async (req, res) => {
  try {
    const firebaseUid = await getVerifiedUid(req);
    if (!firebaseUid) {
      return res.status(401).json({ error: "Authentification requise ou invalide." });
    }

    const { reference } = req.body;
    if (!reference || typeof reference !== "string" || !reference.trim()) {
      return res.status(400).json({ error: "Une référence de paiement est requise." });
    }

    const cleanReference = reference.trim();

    const pendingRef = db.collection("paiements_en_attente").doc(cleanReference);
    const pendingDoc = await pendingRef.get();

    if (!pendingDoc.exists) {
      return res.status(404).json({ error: "Aucune tentative de paiement trouvée avec cette référence." });
    }

    const pendingData = pendingDoc.data();
    if (pendingData.firebaseUid !== firebaseUid) {
      return res.status(403).json({ error: "Cette référence ne correspond pas à ton compte." });
    }

    if (pendingData.status === "SUCCESS") {
      return res.status(200).json({ verified: true, alreadyProcessed: true });
    }

    const sessionId = pendingData.sessionId;
    const response = await fetch(`${SASPAY_API_URL}/checkout-sessions/${encodeURIComponent(sessionId)}`, {
      headers: { "Authorization": `Bearer ${SASPAY_SECRET_KEY}` }
    });

    if (!response.ok) {
      console.error(`Vérification SasPay : HTTP ${response.status} pour la session ${sessionId}`);
      return res.status(502).json({ error: "Impossible de vérifier le paiement pour le moment. Réessaie dans quelques minutes." });
    }

    const rawSessionData = await response.json();

    // Même piège que dans checkout.js : l'API SasPay enveloppe la ressource
    // dans { success, data: {...}, code } plutôt que de la renvoyer à plat.
    const sessionData = rawSessionData && rawSessionData.data ? rawSessionData.data : rawSessionData;

    if (!isSessionPaid(sessionData)) {
      console.log(
        `verifyPayment : session ${sessionId} pas encore payée (statut reçu : ${JSON.stringify(rawSessionData)})`
      );
      return res.status(200).json({ verified: false, message: "Aucun paiement confirmé trouvé pour cette référence." });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await db.collection("users").doc(firebaseUid).set({
      subscriptionStatus: "active",
      subscriptionExpiresAt: expiresAt,
      saspayTransactionId: sessionData.payment_id || sessionData.transaction_id || null,
      updatedAt: new Date(),
    }, { merge: true });

    await pendingRef.update({ status: "SUCCESS" });

    console.log(`Abonnement de ${firebaseUid} activé manuellement via vérification (référence ${cleanReference}).`);
    return res.status(200).json({ verified: true, alreadyProcessed: false });

  } catch (error) {
    console.error("Erreur dans verifyPayment:", error);
    return res.status(500).json({ error: "Erreur serveur interne." });
  }
};
