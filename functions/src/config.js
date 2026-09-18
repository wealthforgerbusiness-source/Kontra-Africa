const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

// ============================================================
// FIREBASE ADMIN
// ============================================================
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

const adminApp = initializeApp({
  credential: cert(serviceAccount),
});

// Firestore
const db = getFirestore(adminApp);

// ============================================================
// VARIABLES D'ENVIRONNEMENT — SASPAY
// ============================================================

const SASPAY_SECRET_KEY = process.env.SASPAY_SECRET_KEY;
const SASPAY_API_URL = "https://api.saspay.me/api/v1";

const TRIAL_DURATION_DAYS = 3;

// ============================================================
// SASPAY WEBHOOK
// ============================================================
// Secret partagé avec SasPay pour authentifier les appels webhook.
// Doit être identique à celui configuré côté dashboard SasPay.

const SASPAY_WEBHOOK_SECRET = process.env.SASPAY_WEBHOOK_SECRET;

// ============================================================
// FRONTEND
// ============================================================

const APP_BASE_URL =
  process.env.APP_BASE_URL || "https://kontra-africa-app.onrender.com";

// ============================================================
// CORS
// ============================================================

const ALLOWED_ORIGINS = [
  APP_BASE_URL,

  ...(process.env.NODE_ENV !== "production"
    ? [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
      ]
    : []),

  ...((process.env.EXTRA_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)),
];

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  adminApp,
  db,
  SASPAY_SECRET_KEY,
  SASPAY_API_URL,
  SASPAY_WEBHOOK_SECRET,
  APP_BASE_URL,
  ALLOWED_ORIGINS,
  TRIAL_DURATION_DAYS,
};
