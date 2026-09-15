/**
 * Contrôleur pour initier une session de paiement Chariow.
 */
const { CHARIOW_API_URL, CHARIOW_API_KEY, CHARIOW_PRODUCT_ID, APP_BASE_URL } = require("./config");
const { getVerifiedUser } = require("./verify-auth");

exports.checkout = async (req, res) => {
  try {
    const user = await getVerifiedUser(req);

    if (!user) {
      return res.status(401).json({ error: "Authentification requise ou invalide." });
    }

    const { firebaseUid: _ignoredUid, email: _ignoredEmail } = req.body; // jamais utilisés, volontairement

    // IMPORTANT : l'email vient du token Firebase vérifié, jamais du body.
    // C'est cet email que Chariow utilise pour créer le client et pour
    // ENVOYER LA CLÉ DE LICENCE PAR MAIL — un email non vérifié pourrait
    // envoyer la clé de quelqu'un d'autre à un tiers.
    const email = user.email;

    if (!email) {
      return res.status(400).json({
        error: "Ton compte n'a pas d'adresse email valide — la clé de licence ne pourrait pas t'être envoyée. Contacte le support.",
      });
    }

    const { firstName, lastName, phone } = req.body;

    const phoneNumber = phone && phone.number ? String(phone.number).replace(/\D/g, '') : '';
    const phoneCountryCode = phone && phone.countryCode ? String(phone.countryCode) : '';

    if (!phoneNumber || phoneNumber.length < 8 || !phoneCountryCode) {
      return res.status(400).json({ error: "Un numéro Mobile Money valide est requis pour le paiement." });
    }

    const payload = {
      product_id: CHARIOW_PRODUCT_ID,
      email,
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
        firebase_uid: user.uid
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

    // NOTE : la branche "already_purchased" a été retirée. D'après la doc
    // Chariow, un produit de type Licence autorise TOUJOURS le rachat
    // (chaque achat génère une nouvelle clé) — "already_purchased" ne peut
    // se produire que sur des produits Downloadable/Course/Bundle, pas sur
    // le tien. La garder aurait permis d'accorder 30 jours gratuits sans
    // paiement si le type de produit change un jour côté Chariow.
    if (data.step === "payment") {
      return res.status(200).json({ checkoutUrl: data.payment.checkout_url });
    } else {
      console.warn("Étape inattendue:", data.step);
      return res.status(200).json({ checkoutUrl: data.payment?.checkout_url || null, step: data.step });
    }
  } catch (error) {
    console.error("Erreur dans checkout:", error);
    return res.status(500).json({ error: "Erreur serveur interne." });
  }
};
