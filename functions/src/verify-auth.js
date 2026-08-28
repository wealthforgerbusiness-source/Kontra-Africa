/**
 * Helper partagé : vérifie le token Firebase envoyé dans le header
 * Authorization: Bearer <idToken>, et renvoie l'UID vérifié.
 * Ne JAMAIS faire confiance à un uid/firebaseUid envoyé dans req.body :
 * n'importe qui peut mettre l'uid qu'il veut dans un body JSON.
 */
const { admin } = require("./config");

async function getVerifiedUid(req) {
  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const idToken = authorization.substring(7).trim();

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid;
  } catch (error) {
    console.error("Token Firebase invalide :", error.message);
    return null;
  }
}

module.exports = { getVerifiedUid };
