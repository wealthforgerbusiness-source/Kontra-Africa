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

module.exports = {
  admin,
  db,
  CHARIOW_API_KEY,
  CHARIOW_API_URL,
  CHARIOW_PRODUCT_ID,
  TRIAL_DURATION_DAYS,
};
