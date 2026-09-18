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
// Filet de sécurité : si jamais un champ undefined arrive jusqu'à un .set(),
// Firestore l'ignore au lieu de lever une exception qui casse toute la requête.
db.settings({ ignoreUndefinedProperties: true });

// ============================================================
// VARIABLES D'ENVIRONNEMENT — SASPAY
// ============================================================

const SASPAY_SECRET_KEY = process.env.SASPAY_SECRET_KEY;
const SASPAY_API_URL = "https://api.saspay.me/api/v1";

const TRIAL_DURATION_DAYS = 3;

// ============================================================
// PRIX DE L'ABONNEMENT
// ============================================================
// PROBLÈME CORRIGÉ ICI : checkout.js envoyait un montant totalement
// déconnecté du vrai prix ("5000.00" en "XOF") — c'était l'exemple brut
// de la doc SasPay, jamais remplacé par le vrai prix ni la vraie devise.
// SasPay ne convertit RIEN automatiquement : il faut calculer nous-mêmes
// le montant à facturer, dans la devise choisie, à partir de ce prix
// officiel.
//
// Prix officiel affiché dans l'app (voir paywall__price dans
// auth-guard.js) : 5 $ / mois.
//
// ⚠️ USD_TO_CDF_RATE doit être mis à jour régulièrement (le franc
// congolais bouge). Pour changer le taux SANS redéployer le code : ajoute
// la variable d'environnement USD_TO_CDF_RATE sur Render (ou Netlify) —
// sinon la valeur par défaut ci-dessous est utilisée.
const SUBSCRIPTION_PRICE_USD = 5;
const USD_TO_CDF_RATE = Number(process.env.USD_TO_CDF_RATE) || 2250;

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
  SUBSCRIPTION_PRICE_USD,
  USD_TO_CDF_RATE,
};
