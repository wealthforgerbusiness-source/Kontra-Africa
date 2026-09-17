/**
 * Contrôleur d'authentification pour initialiser le profil utilisateur.
 */
const { db, TRIAL_DURATION_DAYS } = require("./config");
const { getVerifiedUser } = require("./verify-auth");

exports.initUser = async (req, res) => {

  const startedAt = Date.now();

  console.log(
    `[INIT-USER] ▶️ Requête reçue — IP: ${req.ip}, Origin: ${req.headers.origin || "(absent)"}`
  );

  try {
    const user = await getVerifiedUser(req);

    if (!user) {
      console.warn(
        `[INIT-USER] ⛔ Rejeté : token absent ou invalide (voir logs [AUTH] ci-dessus). Durée: ${Date.now() - startedAt}ms`
      );
      return res.status(401).json({ error: "Authentification requise ou invalide." });
    }

    console.log(
      `[INIT-USER] 🔑 Utilisateur authentifié — uid: ${user.uid}, email: ${user.email || "(absent)"}`
    );

    // IMPORTANT : l'email vient du token vérifié, jamais du body. Ce champ
    // est ensuite utilisé par webhook.js pour retrouver un compte par email
    // (fallback sur les événements successful.sale) — un email non vérifié
    // permettrait à n'importe qui de se faire passer pour le propriétaire
    // d'une autre adresse et de capter ses mises à jour d'abonnement.
    const { displayName, photoURL } = req.body;

    console.log(
      `[INIT-USER] 📋 Corps reçu — displayName: ${displayName || "(absent)"}, photoURL présent: ${Boolean(photoURL)}`
    );

    const userRef = db.collection("users").doc(user.uid);

    console.log(`[INIT-USER] 🔎 Lecture Firestore users/${user.uid}...`);

    const userDoc = await userRef.get();

    console.log(
      `[INIT-USER] 🔎 Résultat lecture Firestore — document existant: ${userDoc.exists}`
    );

    // Vérification pour éviter d'écraser un profil existant
    if (!userDoc.exists) {
      const now = new Date();
      const trialEndDate = new Date(now);
      trialEndDate.setDate(now.getDate() + TRIAL_DURATION_DAYS);

      console.log(
        `[INIT-USER] 🆕 Aucun profil existant — création d'un nouveau compte (inscription) pour uid: ${user.uid}, essai jusqu'au ${trialEndDate.toISOString()}`
      );

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

      console.log(
        `[INIT-USER] ✅ Profil créé avec succès pour uid: ${user.uid}. Durée totale: ${Date.now() - startedAt}ms`
      );

      return res.status(201).json({ success: true, message: "Profil créé avec succès." });
    }

    console.log(
      `[INIT-USER] ✅ Profil déjà existant (connexion) pour uid: ${user.uid}. Durée totale: ${Date.now() - startedAt}ms`
    );

    return res.status(200).json({ success: true, message: "Le profil existe déjà." });
  } catch (error) {
    console.error(
      `[INIT-USER] ❌ ERREUR — uid inconnu ou échec avant vérification, durée: ${Date.now() - startedAt}ms, message: ${error.message}, stack:`,
      error
    );
    return res.status(500).json({ error: "Erreur lors de la création du profil." });
  }
};
