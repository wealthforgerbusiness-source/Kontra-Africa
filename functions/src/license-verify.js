const { db, CHARIOW_API_URL, CHARIOW_API_KEY } = require("./config");
const { getVerifiedUid } = require("./verify-auth");

exports.verifyLicenseKey = async (req, res) => {
  try {
    const firebaseUid = await getVerifiedUid(req);

    if (!firebaseUid) {
      return res.status(401).json({ error: "Authentification requise ou invalide." });
    }

    const { licenseKey } = req.body;

    if (!licenseKey || typeof licenseKey !== "string" || !licenseKey.trim()) {
      return res.status(400).json({ error: "Une clé de licence est requise." });
    }

    const cleanKey = licenseKey.trim();

    let response = await fetch(
      `${CHARIOW_API_URL}/licenses/${encodeURIComponent(cleanKey)}`,
      { headers: { "Authorization": `Bearer ${CHARIOW_API_KEY}` } }
    );

    if (!response.ok) {
      // 404 = clé inconnue chez Chariow. On ne donne pas plus de détail au
      // client pour éviter de faciliter le brute-force de clés.
      console.warn(`Vérification licence échouée (HTTP ${response.status}) pour clé fournie par ${firebaseUid}`);
      return res.status(200).json({ valid: false, error: "Clé de licence invalide ou introuvable." });
    }

    let { data } = await response.json();

    // NOUVEAU : une licence fraîchement achetée n'est pas "active" tant
    // qu'elle n'a pas été activée une première fois (status
    // "pending_activation", can_activate = true). On l'active nous-mêmes,
    // de façon transparente pour l'utilisateur, avant de la juger invalide.
    if (!data.is_active && data.can_activate) {
      console.log(`Licence ${cleanKey} en attente d'activation, activation automatique pour ${firebaseUid}.`);

      const activateResponse = await fetch(
        `${CHARIOW_API_URL}/licenses/${encodeURIComponent(cleanKey)}/activate`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${CHARIOW_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ device_identifier: firebaseUid })
        }
      );

      if (!activateResponse.ok) {
        const errorText = await activateResponse.text();
        console.error(`Échec activation licence ${cleanKey} pour ${firebaseUid} : HTTP ${activateResponse.status} - ${errorText}`);
        return res.status(200).json({ valid: false, error: "Impossible d'activer cette licence pour le moment." });
      }

      const activateResult = await activateResponse.json();
      // On repart des données fraîches renvoyées par l'activation (is_active
      // doit désormais être true), au lieu de refaire un GET.
      data = activateResult.data || data;
    }

    if (!data || !data.is_active) {
      return res.status(200).json({ valid: false, error: "Cette licence n'est pas active." });
    }

    const expiresAtRaw = data.expires_at ? new Date(data.expires_at) : null;

    // Double vérification volontaire : on ne se fie pas uniquement au booléen
    // is_expired renvoyé par Chariow. On recalcule nous-mêmes à partir de
    // expires_at, au cas où le produit serait mal configuré côté Chariow
    // (ex. licence "permanente" par erreur) ou en cas de décalage d'horloge.
    if (data.is_expired) {
      return res.status(200).json({ valid: false, error: "Cette licence a expiré." });
    }
    if (expiresAtRaw && expiresAtRaw.getTime() <= Date.now()) {
      console.warn(`Incohérence Chariow : is_expired=false mais expires_at (${data.expires_at}) est dans le passé pour la clé ${cleanKey}.`);
      return res.status(200).json({ valid: false, error: "Cette licence a expiré." });
    }
    if (!expiresAtRaw) {
      console.warn(`Licence ${cleanKey} sans date d'expiration (expires_at manquant) — vérifie la config du produit "Durée de validité" sur Chariow.`);
    }

    // IMPORTANT : une même clé ne doit pouvoir activer QU'UN SEUL compte
    // Firebase (une clé = une vente = un abonné). Sinon n'importe qui pourrait
    // réutiliser la clé d'un autre utilisateur pour débloquer son propre compte.
    const existingOwnerSnap = await db
      .collection("users")
      .where("chariowLicenseKey", "==", cleanKey)
      .limit(1)
      .get();

    if (!existingOwnerSnap.empty && existingOwnerSnap.docs[0].id !== firebaseUid) {
      console.warn(`Clé ${cleanKey} déjà rattachée à un autre compte, tentative de réutilisation par ${firebaseUid}.`);
      return res.status(200).json({ valid: false, error: "Cette clé de licence est déjà utilisée sur un autre compte." });
    }

    await db.collection("users").doc(firebaseUid).set(
      {
        subscriptionStatus: "active",
        subscriptionExpiresAt: expiresAtRaw,
        chariowLicenseKey: cleanKey,
        updatedAt: new Date()
      },
      { merge: true }
    );

    console.log(`Licence ${cleanKey} vérifiée et compte ${firebaseUid} réactivé manuellement.`);
    return res.status(200).json({ valid: true, reactivated: true });

  } catch (error) {
    console.error("Erreur dans verifyLicenseKey:", error);
    return res.status(500).json({ error: "Erreur serveur interne lors de la vérification." });
  }
};
