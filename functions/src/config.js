/**
 * Configuration principale et initialisation des services Firebase pour Cloud Functions.
 */

const admin = require("firebase-admin");

// Initialisation du SDK Firebase Admin
admin.initializeApp();

// Exportation de l'instance Firestore
const db = admin.firestore();

// Clé API Chariow lue depuis les variables d'environnement / secrets Firebase
// Pour configurer ce secret en production, exécutez la commande suivante dans votre terminal :
// firebase functions:secrets:set CHARIOW_API_KEY
const CHARIOW_API_KEY = process.env.CHARIOW_API_KEY;

// Constantes de configuration
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
