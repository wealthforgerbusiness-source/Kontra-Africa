const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

// ============================================================
// FIREBASE ADMIN
// ============================================================
// Utilise automatiquement GOOGLE_APPLICATION_CREDENTIALS
// configuré dans les variables d'environnement de Render.

const adminApp = initializeApp({
  credential: applicationDefault(),
});

// Firestore
const db = getFirestore(adminApp);

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
