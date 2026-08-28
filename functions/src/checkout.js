/**
 * Contrôleur pour initier une session de paiement Chariow.
 */
const { db, CHARIOW_API_URL, CHARIOW_API_KEY, CHARIOW_PRODUCT_ID, APP_BASE_URL } = require("./config");
const { getVerifiedUid } = require("./verify-auth");

exports.checkout = async (req, res) => {
  try {
    const firebaseUid = await getVerifiedUid(req);

    if (!firebaseUid) {
      return res.status(401).json({ error: "Authentification requise ou invalide." });
    }

    const { email, firstName, lastName, phone } = req.body;

    const phoneNumber = phone && phone.number ? String(phone.number).replace(/\D/g, '') : '';
    const phoneCountryCode = phone && phone.countryCode ? String(phone.countryCode) : '';

    if (!phoneNumber || phoneNumber.length < 8 || !phoneCountryCode) {
      return res.status(400).json({ error: "Un numéro Mobile Money valide est requis pour le paiement." });
    }

    const payload = {
      product_id: CHARIOW_PRODUCT_ID,
      email: email || "",
      first_name: firstName || "Client",
      last_name: lastName || "Inconnu",
      phone: {
        number: phoneNumber,
        country_code: phoneCountryCode
      },
      // Sans ce paramètre, Chariow renvoie le client vers sa page de post-achat
      // par défaut (celle du compte/boutique Chariow) au lieu de le ramener dans
      // l'app. On le ramène directement sur son profil.
      redirect_url: `${APP_BASE_URL}/profil.html?payment=success`,
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
      let chariowMessage = null;
      try {
        chariowMessage = JSON.parse(errorText).message;
      } catch (_) { /* corps non-JSON, on garde le message générique */ }
      const statusToForward = response.status >= 400 && response.status < 500 ? response.status : 502;
      return res.status(statusToForward).json({ error: chariowMessage || "Erreur de communication avec le service de paiement." });
    }

    const responseData = await response.json();
    const data = responseData.data || responseData;

    if (data.step === "payment") {
      return res.status(200).json({ checkoutUrl: data.payment.checkout_url });
    } else if (data.step === "already_purchased") {
      const now = new Date();
      const newExpiry = new Date(now.setDate(now.getDate() + 30));

      await db.collection("users").doc(firebaseUid).set(
        {
          subscriptionStatus: "active",
          subscriptionExpiresAt: newExpiry,
          updatedAt: new Date()
        },
        { merge: true }
      );

      console.log(`Réactivation directe (already_purchased) pour ${firebaseUid}`);
      return res.status(200).json({ reactivated: true });
    } else {
      console.warn("Étape inattendue:", data.step);
      return res.status(200).json({ checkoutUrl: data.payment?.checkout_url || null, step: data.step });
    }
  } catch (error) {
    console.error("Erreur dans checkout:", error);
    return res.status(500).json({ error: "Erreur serveur interne." });
  }
};
