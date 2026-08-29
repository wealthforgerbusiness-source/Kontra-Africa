const admin = require("firebase-admin");

// ============================================================
// FIREBASE ADMIN
// ============================================================
// Render n'a pas de disque persistant : on ne peut pas utiliser
// applicationDefault() qui cherche un fichier via
// GOOGLE_APPLICATION_CREDENTIALS. On charge donc le JSON du
// service account depuis une variable d'env (FIREBASE_SERVICE_ACCOUNT),
// à définir sur Render avec le contenu complet du fichier JSON
// téléchargé dans Firebase Console > Paramètres > Comptes de service.

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error(
    "FIREBASE_SERVICE_ACCOUNT manquante : ajoute la clé JSON du service account dans les variables d'environnement Render."
  );
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (err) {
  throw new Error(
    "FIREBASE_SERVICE_ACCOUNT invalide : vérifie que le JSON est bien collé en entier, sans être tronqué."
  );
}

const adminApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Firestore
const db = adminApp.firestore();

// ============================================================
// VARIABLES D'ENVIRONNEMENT
// ============================================================

const CHARIOW_API_KEY = process.env.CHARIOW_API_KEY;
const CHARIOW_API_URL = "https://api.chariow.com/v1";
const CHARIOW_PRODUCT_ID = "prd_tqwlmf8w";

const TRIAL_DURATION_DAYS = 3;

// ============================================================
// CHARIOW WEBHOOK
// ============================================================
// Secret partagé avec Chariow pour authentifier les appels
// webhook.
// Doit être identique à celui configuré côté Chariow.

const CHARIOW_WEBHOOK_SECRET = process.env.CHARIOW_WEBHOOK_SECRET;

// ============================================================
// FRONTEND
// ============================================================
// URL publique du frontend.
// Peut être remplacée par APP_BASE_URL dans Render.

const APP_BASE_URL =
  process.env.APP_BASE_URL || "https://kontra-africa-app.onrender.com";

// ============================================================
// CORS
// ============================================================

const ALLOWED_ORIGINS = [
  APP_BASE_URL,

  // Autoriser localhost uniquement hors production
  ...(process.env.NODE_ENV !== "production"
    ? [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
      ]
    : []),

  // Origines supplémentaires définies dans Render
  ...((process.env.EXTRA_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)),
];

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  admin,
  adminApp,
  db,
  CHARIOW_API_KEY,
  CHARIOW_API_URL,
  CHARIOW_PRODUCT_ID,
  CHARIOW_WEBHOOK_SECRET,
  APP_BASE_URL,
  ALLOWED_ORIGINS,
  TRIAL_DURATION_DAYS,
};
