/**
 * Contrôleur pour initier une session de paiement SasPay.
 */

const { db, SASPAY_API_URL, SASPAY_SECRET_KEY, APP_BASE_URL, SUBSCRIPTION_PRICE_USD, EXCHANGE_RATES, COUNTRY_CURRENCY } = require("./config");

// PROBLÈME CORRIGÉ ICI : ce fichier envoyait auparavant un montant fixe
// ("5000.00" en "XOF") laissé tel quel depuis l'exemple de la doc SasPay —
// ni le vrai prix (5 $), ni la vraie devise (ça dépend du pays du client,
// pas d'une devise unique). Le montant est maintenant calculé à partir du
// prix officiel (SUBSCRIPTION_PRICE_USD, voir config.js) et soit de la
// devise locale du pays choisi par le client, soit directement en USD.

/**
 * Résout la devise et le montant à facturer.
 *
 * @param {string} mode         "USD" (payer en dollars) ou "LOCAL" (payer
 *                               dans la monnaie du pays du client).
 * @param {string|null} countryCode  Code ISO2 du pays (phone.countryCode),
 *                               requis uniquement si mode === "LOCAL".
 */
function resolveCurrencyAndAmount(mode, countryCode) {
  if (mode === "USD") {
    return { currency: "USD", amount: SUBSCRIPTION_PRICE_USD.toFixed(2) };
  }

  const currency = COUNTRY_CURRENCY[countryCode];
  if (!currency) {
    return null; // pays non supporté pour le paiement en monnaie locale
  }

  const rate = EXCHANGE_RATES[currency];
  const amount = (SUBSCRIPTION_PRICE_USD * rate).toFixed(2);
  return { currency, amount };
}

exports.checkout = async (req, res) => {
  try {
    const { firebaseUid, email, firstName, lastName, phone } = req.body;

    if (!firebaseUid) {
      return res.status(400).json({ error: "Le firebaseUid est requis." });
    }

    // SasPay exige customer_email (required + format email) : un "" passé
    // silencieusement peut faire échouer leur validation ou produire un
    // comportement inattendu. On le vérifie nous-mêmes, avec un message clair.
    if (!email) {
      console.error("checkout: email manquant pour firebaseUid", firebaseUid);
      return res.status(400).json({ error: "Une adresse email est requise pour initier le paiement." });
    }

    // Mode de paiement choisi par le client (bouton $ / monnaie locale
    // côté frontend). "LOCAL" par défaut si rien n'est fourni.
    const mode = String(req.body.currency || "LOCAL").toUpperCase();

    if (!["USD", "LOCAL"].includes(mode)) {
      return res.status(400).json({
        error: `Mode de paiement non supporté : ${mode}. Utilise USD ou LOCAL.`
      });
    }

    const countryCode = phone && phone.countryCode
      ? String(phone.countryCode).toUpperCase()
      : null;

    const resolved = resolveCurrencyAndAmount(mode, countryCode);

    if (!resolved) {
      return res.status(400).json({
        error: `Paiement en monnaie locale non disponible pour ce pays (${countryCode || "inconnu"}). Réessaie en payant en dollars ($).`
      });
    }

    const { currency, amount } = resolved;

    // référence unique pour retrouver cette session précisément au moment du webhook
    const reference = `kontra_${firebaseUid}_${Date.now()}`;

    const payload = {
      amount,
      currency,
      description: "Abonnement Kontra Africa",
      customer_email: email || "",
      customer_name: `${firstName || "Client"} ${lastName || ""}`.trim(),
      // Sans ce paramètre, SasPay renvoie le client vers sa page par défaut
      // au lieu de le ramener dans l'app. On le ramène directement sur son profil.
      return_url: `${APP_BASE_URL}/profil.html?payment=success`,
      // "reference" n'est pas un champ documenté à la racine du body SasPay
      // (voir docs.saspay.me/api-reference/payments/checkout-create) — seul
      // "metadata" accepte des clés libres. On l'y range pour rester conforme
      // au schéma et pouvoir la retrouver depuis le webhook si besoin.
      metadata: {
        firebase_uid: firebaseUid,
        reference: reference
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

    const rawData = await response.json();

    // La doc SasPay montre un exemple de réponse "plate", mais en pratique
    // l'API enveloppe la session créée dans { success, data: {...}, code }.
    // On gère les deux formes pour rester robuste si ça change côté SasPay.
    const data = rawData && rawData.data ? rawData.data : rawData;

    // Garde-fou : on doit obtenir `id` + `checkout_url` sur un 2xx. Si ce
    // n'est pas le cas (scope de clé API, session mal formée côté SasPay,
    // etc.), on logue la réponse brute et on renvoie une erreur propre au lieu
    // de planter au moment d'écrire dans Firestore avec un sessionId vide.
    if (!data || !data.id || !data.checkout_url) {
      console.error(
        "checkout: réponse SasPay inattendue (id/checkout_url manquant) :",
        JSON.stringify(rawData)
      );
      return res.status(502).json({
        error: "Réponse invalide du service de paiement. Réessaie dans un instant."
      });
    }

    // trace la session en attente, liée précisément à cet utilisateur et à cette référence
    await db.collection("paiements_en_attente").doc(reference).set({
      firebaseUid,
      email,
      sessionId: data.id,
      currency,
      amount,
      status: "PENDING",
      createdAt: new Date()
    });

    return res.status(200).json({ checkoutUrl: data.checkout_url, reference });

  } catch (error) {
    console.error("Erreur dans checkout:", error);
    return res.status(500).json({ error: "Erreur serveur interne." });
  }
};
