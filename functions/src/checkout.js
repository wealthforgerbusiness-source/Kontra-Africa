/**
 * Contrôleur pour initier une session de paiement Chariow.
 */
const { CHARIOW_API_URL, CHARIOW_API_KEY, CHARIOW_PRODUCT_ID } = require("./config");

exports.checkout = async (req, res) => {
  try {
    const { firebaseUid, email, firstName, lastName } = req.body;

    if (!firebaseUid) {
      return res.status(400).json({ error: "Le firebaseUid est requis." });
    }

    const payload = {
      product_id: CHARIOW_PRODUCT_ID,
      email: email || "",
      first_name: firstName || "Client",
      last_name: lastName || "Inconnu",
      phone: {
        number: "000000000",
        country_code: "CD"
      },
      custom_metadata: {
        firebase_uid: firebaseUid
      }
    };

    const response = await fetch(`${CHARIOW_API_URL}/checkout`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CHARIOW_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Erreur API Chariow:", response.status, errorText);
      return res.status(502).json({ error: "Erreur de communication avec le service de paiement." });
    }

    const responseData = await response.json();
    const data = responseData.data || responseData;

    if (data.step === "payment") {
      return res.status(200).json({ checkoutUrl: data.payment.checkout_url });
    } else if (data.step === "already_purchased") {
      return res.status(200).json({ alreadyPurchased: true });
    } else {
      console.warn("Étape inattendue:", data.step);
      return res.status(200).json({ checkoutUrl: data.payment?.checkout_url || null, step: data.step });
    }
  } catch (error) {
    console.error("Erreur dans checkout:", error);
    return res.status(500).json({ error: "Erreur serveur interne." });
  }
};
