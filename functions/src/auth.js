/**
 * Contrôleur d'authentification pour initialiser le profil utilisateur.
 */
const { db, TRIAL_DURATION_DAYS } = require("./config");
const { getVerifiedUid } = require("./verify-auth");

exports.initUser = async (req, res) => {
  try {
    const uid = await getVerifiedUid(req);

    if (!uid) {
      return res.status(401).json({ error: "Authentification requise ou invalide." });
    }

    const { email, displayName, photoURL } = req.body;

    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();

    // Vérification pour éviter d'écraser un profil existant
    if (!userDoc.exists) {
      const now = new Date();
      const trialEndDate = new Date(now);
      trialEndDate.setDate(now.getDate() + TRIAL_DURATION_DAYS);

      await userRef.set({
        uid,
        email: email || "",
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
