/**
 * Contrôleur d'authentification pour initialiser le profil utilisateur.
 */
const { db, TRIAL_DURATION_DAYS } = require("./config");
const { getVerifiedUser } = require("./verify-auth");

exports.initUser = async (req, res) => {
  try {
    const user = await getVerifiedUser(req);

    if (!user) {
      return res.status(401).json({ error: "Authentification requise ou invalide." });
    }

    // IMPORTANT : l'email vient du token vérifié, jamais du body. Ce champ
    // est ensuite utilisé par webhook.js pour retrouver un compte par email
    // (fallback sur les événements successful.sale) — un email non vérifié
    // permettrait à n'importe qui de se faire passer pour le propriétaire
    // d'une autre adresse et de capter ses mises à jour d'abonnement.
    const { displayName, photoURL } = req.body;

    const userRef = db.collection("users").doc(user.uid);
    const userDoc = await userRef.get();

    // Vérification pour éviter d'écraser un profil existant
    if (!userDoc.exists) {
      const now = new Date();
      const trialEndDate = new Date(now);
      trialEndDate.setDate(now.getDate() + TRIAL_DURATION_DAYS);

      await userRef.set({
        uid: user.uid,
        email: user.email || "",
        displayName: displayName || "",
        photoURL: photoURL || "",
        createdAt: now,
        trialStartDate: now,
        trialEndDate,
        subscriptionStatus: "trial",
        currencySymbol: "",
        exchangeRate: 0,
        balance: 0,
        savingsGoal: 0,
      });

      return res.status(201).json({ success: true, message: "Profil créé avec succès." });
    }

    return res.status(200).json({ success: true, message: "Le profil existe déjà." });
  } catch (error) {
    console.error(`Erreur initUser:`, error);
    return res.status(500).json({ error: "Erreur lors de la création du profil." });
  }
};
