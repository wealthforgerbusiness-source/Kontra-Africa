/**
 * Configuration principale et initialisation des services Firebase.
 */
const admin = require("firebase-admin");

// L'initialisation utilise automatiquement la variable d'environnement GOOGLE_APPLICATION_CREDENTIALS
// Assurez-vous d'avoir téléchargé serviceAccountKey.json depuis les paramètres du projet Firebase
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();

// Variables d'environnement
const CHARIOW_API_KEY = process.env.CHARIOW_API_KEY;
const CHARIOW_API_URL = "https://api.chariow.com/v1";
const CHARIOW_PRODUCT_ID = "prd_tqwlmf8w";
const TRIAL_DURATION_DAYS = 3;

// Secret partagé avec Chariow pour authentifier les appels webhook
// (voir functions/src/webhook.js : ?secret=... comparé en timing-safe).
// À définir sur Render dans les variables d'environnement, avec la même
// valeur que celle configurée côté Chariow pour l'URL du webhook.
const CHARIOW_WEBHOOK_SECRET = process.env.CHARIOW_WEBHOOK_SECRET;

// URL publique du frontend (hébergé sur Render), utilisée pour ramener
// l'utilisateur dans l'app après un paiement Chariow (redirect_url).
// Peut être surchargée via la variable d'environnement APP_BASE_URL sur Render.
const APP_BASE_URL = process.env.APP_BASE_URL || "https://kontra-africa-app.onrender.com";

// Origines autorisées à appeler l'API (CORS).
// Peut être étendu via la variable d'environnement EXTRA_ALLOWED_ORIGINS
// (liste séparée par des virgules) si tu ajoutes un domaine personnalisé plus tard.
const ALLOWED_ORIGINS = [
  APP_BASE_URL,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  ...((process.env.EXTRA_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)),
];

module.exports = {
  admin,
  db,
  CHARIOW_API_KEY,
  CHARIOW_API_URL,
  CHARIOW_PRODUCT_ID,
  CHARIOW_WEBHOOK_SECRET,
  APP_BASE_URL,
  ALLOWED_ORIGINS,
  TRIAL_DURATION_DAYS,
};
