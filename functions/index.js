/**
 * Point d'entrée principal des Firebase Cloud Functions.
 *
 * Ce fichier regroupe et réexporte l'ensemble des déclencheurs et fonctions
 * définis dans le dossier ./src/.
 */

const { onUserCreated } = require("./src/auth");
const { initiateCheckout } = require("./src/checkout");
const { chariowWebhook } = require("./src/webhook");

// Déclencheur Firebase Auth : Initialisation automatique du profil utilisateur
exports.onUserCreated = onUserCreated;

// Fonction Callable : Initiation de la session de paiement via Chariow
exports.initiateCheckout = initiateCheckout;

// Webhook HTTP : Réception et traitement des événements Chariow
exports.chariowWebhook = chariowWebhook;
