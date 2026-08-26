/**
 * Vérification manuelle de clé de licence Chariow.
 *
 * Pourquoi ce fichier existe :
 * Le webhook (pulse) Chariow est asynchrone et peut, dans de rares cas, ne
 * jamais arriver ou ne jamais être émis côté Chariow (paiement mobile money
 * confirmé chez l'opérateur mais pulse non déclenché sur leur plateforme).
 * Ce endpoint est un filet de secours indépendant du webhook : l'utilisateur
 * saisit lui-même sa clé de licence (reçue après paiement sur Chariow), et on
 * la vérifie en interrogeant directement l'API Chariow — sans dépendre d'une
 * notification qui aurait pu se perdre.
 *
 * Endpoint Chariow utilisé : GET /v1/licenses/{key}
 * Doc : https://chariow.dev/en/guides/saas-license-integration
 */
const { db, CHARIOW_API_URL, CHARIOW_API_KEY } = require("./config");

exports.verifyLicenseKey = async (req, res) => {
  try {
    const { firebaseUid, licenseKey } = req.body;

    if (!firebaseUid) {
      return res.status(400).json({ error: "Le firebaseUid est requis." });
    }
    if (!licenseKey || typeof licenseKey !== "string" || !licenseKey.trim()) {
      return res.status(400).json({ error: "Une clé de licence est requise." });
    }

    const cleanKey = licenseKey.trim();

    const response = await fetch(
      `${CHARIOW_API_URL}/licenses/${encodeURIComponent(cleanKey)}`,
      {
        headers: {
          "Authorization": `Bearer ${CHARIOW_API_KEY}`
        }
      }
    );

    if (!response.ok) {
      // 404 = clé inconnue chez Chariow. On ne donne pas plus de détail au
      // client pour éviter de faciliter le brute-force de clés.
      console.warn(`Vérification licence échouée (HTTP ${response.status}) pour clé fournie par ${firebaseUid}`);
      return res.status(200).json({ valid: false, error: "Clé de licence invalide ou introuvable." });
    }

    const { data } = await response.json();

    if (!data || !data.is_active) {
      return res.status(200).json({ valid: false, error: "Cette licence n'est pas active." });
    }

    const expiresAtRaw = data.expires_at ? new Date(data.expires_at) : null;

    // Double vérification volontaire : on ne se fie pas uniquement au booléen
    // is_expired renvoyé par Chariow. On recalcule nous-mêmes à partir de
    // expires_at, au cas où le produit serait mal configuré côté Chariow
    // (ex. licence "permanente" par erreur) ou en cas de décalage d'horloge.
    // Une licence SANS date d'expiration n'est acceptée que si Chariow la
    // déclare explicitement non-expirée ET que ce n'est pas censé arriver
    // pour ce produit (licence mensuelle) — on logue une alerte si ça se
    // produit pour pouvoir vérifier la config du produit sur Chariow.
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

    const subscriptionExpiresAt = expiresAtRaw;

    await db.collection("users").doc(firebaseUid).set(
      {
        subscriptionStatus: "active",
        subscriptionExpiresAt: subscriptionExpiresAt,
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
