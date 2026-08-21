/**
 * Gestionnaire d'événements pour l'authentification des utilisateurs (Firebase Auth v2).
 */

const { beforeUserCreated, beforeUserSignedIn } = require("firebase-functions/v2/identity");
const { db, TRIAL_DURATION_DAYS } = require("./config");

/**
 * Trigger Identity Platform (v2) / Firebase Auth qui s'exécute à la création d'un utilisateur.
 * Initialise automatiquement le profil utilisateur dans Firestore avec l'offre d'essai.
 */
exports.onUserCreated = beforeUserCreated(async (event) => {
  const user = event.data;
  if (!user) {
    return;
  }

  const userRef = db.collection("users").doc(user.uid);

  try {
    // Vérification de l'existence du document pour éviter les écritures en doublon
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      const now = new Date();
      const trialEndDate = new Date(now);
      trialEndDate.setDate(now.getDate() + TRIAL_DURATION_DAYS);

      await userRef.set({
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || "",
        photoURL: user.photoURL || "",
        createdAt: now,
        trialStartDate: now,
        trialEndDate: trialEndDate,
        subscriptionStatus: "trial",
        currencySymbol: "",
        exchangeRate: 0,
        balance: 0,
        savingsGoal: 0,
      });
    }
  } catch (error) {
    console.error(`Erreur lors de la création de la fiche utilisateur pour ${user.uid}:`, error);
  }
});
