/**
 * Contrôleur pour initier une session de paiement Chariow.
 */
const { db, CHARIOW_API_URL, CHARIOW_API_KEY, CHARIOW_PRODUCT_ID } = require("./config");

exports.checkout = async (req, res) => {
  try {
    const { firebaseUid, email, firstName, lastName, phone } = req.body;

    if (!firebaseUid) {
      return res.status(400).json({ error: "Le firebaseUid est requis." });
    }

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
      // Erreur 4xx de Chariow (ex: numéro invalide) = erreur de validation, pas un souci
      // temporaire de serveur : on la transmet telle quelle pour que le front n'insiste pas.
      const statusToForward = response.status >= 400 && response.status < 500 ? response.status : 502;
      return res.status(statusToForward).json({ error: chariowMessage || "Erreur de communication avec le service de paiement." });
    }

    const responseData = await response.json();
    const data = responseData.data || responseData;

    if (data.step === "payment") {
      return res.status(200).json({ checkoutUrl: data.payment.checkout_url });
    } else if (data.step === "already_purchased") {
      // Chariow considère que ce client possède déjà ce produit — typiquement un
      // client qui s'est déjà abonné une première fois et dont l'abonnement a
      // expiré côté Kontra-Africa (statut "expired"/"cancelled" en base), mais
      // dont l'enregistrement d'achat existe toujours chez Chariow. Dans ce cas
      // il n'y a rien de plus à payer : on réactive directement l'accès ici,
      // plutôt que de renvoyer une erreur "aucune URL de paiement reçue".
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
