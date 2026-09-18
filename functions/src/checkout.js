/**
 * Contrôleur pour initier une session de paiement SasPay.
 */

const { db, SASPAY_API_URL, SASPAY_SECRET_KEY, APP_BASE_URL } = require("./config");

const SUBSCRIPTION_AMOUNT = "5000.00"; // adapte selon ton offre réelle
const SUBSCRIPTION_CURRENCY = "XOF";   // adapte selon la devise facturée en RDC

exports.checkout = async (req, res) => {
  try {
    const { firebaseUid, email, firstName, lastName, phone } = req.body;

    if (!firebaseUid) {
      return res.status(400).json({ error: "Le firebaseUid est requis." });
    }

    // référence unique pour retrouver cette session précisément au moment du webhook
    const reference = `kontra_${firebaseUid}_${Date.now()}`;

    const payload = {
      amount: SUBSCRIPTION_AMOUNT,
      currency: SUBSCRIPTION_CURRENCY,
      description: "Abonnement Kontra Africa",
      customer_email: email || "",
      customer_name: `${firstName || "Client"} ${lastName || ""}`.trim(),
      reference: reference,
      // Sans ce paramètre, SasPay renvoie le client vers sa page par défaut
      // au lieu de le ramener dans l'app. On le ramène directement sur son profil.
      return_url: `${APP_BASE_URL}/profil.html?payment=success`,
      metadata: {
        firebase_uid: firebaseUid
      }
    };

    const response = await fetch(`${SASPAY_API_URL}/checkout-sessions/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SASPAY_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Erreur API SasPay:", response.status, errorText);

      let saspayMessage = null;
      try {
        saspayMessage = JSON.parse(errorText).message;
      } catch (_) { /* corps non-JSON, on garde le message générique */ }

      const statusToForward = response.status >= 400 && response.status < 500 ? response.status : 502;
      return res.status(statusToForward).json({ error: saspayMessage || "Erreur de communication avec le service de paiement." });
    }

    const data = await response.json();

    // trace la session en attente, liée précisément à cet utilisateur et à cette référence
    await db.collection("paiements_en_attente").doc(reference).set({
      firebaseUid,
      email: email || "",
      sessionId: data.id,
      status: "PENDING",
      createdAt: new Date()
    });

    return res.status(200).json({ checkoutUrl: data.checkout_url, reference });

  } catch (error) {
    console.error("Erreur dans checkout:", error);
    return res.status(500).json({ error: "Erreur serveur interne." });
  }
};
