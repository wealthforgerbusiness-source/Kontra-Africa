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
// CORRECTIF SUIVANT : la RDC n'est pas le seul pays pris en charge (voir
// COUNTRIES dans js/phone-countries.js — 8 pays au total). Le CDF n'est la
// devise locale QUE pour la RDC. Les 7 autres pays utilisent le franc CFA
// (XOF pour l'Afrique de l'Ouest, XAF pour le Cameroun, Afrique centrale).
// La devise à facturer dépend donc du PAYS choisi par le client, pas d'une
// devise fixe.
const SUBSCRIPTION_PRICE_USD = 1;

// Taux de change USD -> devise locale, un par devise réellement utilisée
// par l'un des 8 pays. Modifiable via variables d'environnement sans
// redéployer le code (utile car ces taux bougent).
const EXCHANGE_RATES = {
  CDF: Number(process.env.USD_TO_CDF_RATE) || 2250, // RD Congo
  XOF: Number(process.env.USD_TO_XOF_RATE) || 600,  // Côte d'Ivoire, Sénégal, Togo, Bénin, Burkina Faso, Mali
  XAF: Number(process.env.USD_TO_XAF_RATE) || 600,  // Cameroun
};

// Devise locale par pays — code ISO2 tel qu'envoyé par le frontend
// (phone.countryCode, voir js/phone-countries.js pour la liste complète
// des 8 pays pris en charge).
const COUNTRY_CURRENCY = {
  CD: 'CDF', // RD Congo
  CI: 'XOF', // Côte d'Ivoire
  CM: 'XAF', // Cameroun
  SN: 'XOF', // Sénégal
  TG: 'XOF', // Togo
  BJ: 'XOF', // Bénin
  BF: 'XOF', // Burkina Faso
  ML: 'XOF', // Mali
};

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
  EXCHANGE_RATES,
  COUNTRY_CURRENCY,
};
