/**
 * Helper partagé : vérifie le token Firebase envoyé dans le header
 * Authorization: Bearer <idToken>, et renvoie l'UID + l'EMAIL vérifiés.
 *
 * Ne JAMAIS faire confiance à un uid/email envoyé dans req.body :
 * n'importe qui peut mettre ce qu'il veut dans un body JSON. L'email
 * décodé du token, lui, vient de Firebase Auth et ne peut pas être
 * falsifié côté client — c'est important car cet email est ensuite
 * transmis à Chariow pour l'envoi de la clé de licence par mail, et
 * réutilisé par le webhook pour retrouver un compte (voir webhook.js).
 */
const { getAuth } = require("firebase-admin/auth");
const { adminApp } = require("./config");

async function getVerifiedUser(req) {
  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const idToken = authorization.substring(7).trim();

  try {
    const decoded = await getAuth(adminApp).verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email || null,
      emailVerified: Boolean(decoded.email_verified),
    };
  } catch (error) {
    console.error("Token Firebase invalide :", error.message);
    return null;
  }
}

// Conservé pour compatibilité avec le code existant qui n'a besoin que
// de l'uid (ex. stock.js utilise son propre middleware, contracts.js
// pourrait appeler celui-ci).
async function getVerifiedUid(req) {
  const user = await getVerifiedUser(req);
  return user ? user.uid : null;
}

module.exports = { getVerifiedUser, getVerifiedUid };
