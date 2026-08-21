/**
 * Gestionnaire pour l'initiation des paiements et abonnements via Chariow.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { db, CHARIOW_API_URL, CHARIOW_API_KEY, CHARIOW_PRODUCT_ID } = require("./config");

/**
 * Fonction callable déclenchée par le frontend pour initier une session de paiement Chariow.
 */
exports.initiateCheckout = onCall({ secrets: ["CHARIOW_API_KEY"] }, async (request) => {
  // 1. Vérification de l'authentification de l'utilisateur
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "L'utilisateur doit être connecté pour effectuer cette action."
    );
  }

  const uid = request.auth.uid;

  try {
    // 2. Récupération des informations de l'utilisateur depuis Firestore
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    const email = request.auth.token.email || userData.email || "";
    const displayName = userData.displayName || request.auth.token.name || "";
    
    // Extraction simplifiée du prénom et du nom
    const nameParts = displayName.trim().split(" ");
    const firstName = nameParts[0] || "Client";
    const lastName = nameParts.slice(1).join(" ") || "Inconnu";

    const phone = request.data?.phone || userData.phone || "000000000";

    // 3. Appel à l'API Chariow
    const payload = {
      product_id: CHARIOW_PRODUCT_ID,
      email: email,
      first_name: firstName,
      last_name: lastName,
      phone: {
        number: phone,
        country_code: "CD"
      },
      custom_metadata: {
        firebase_uid: uid
      }
    };

    const apiKey = CHARIOW_API_KEY || process.env.CHARIOW_API_KEY;

    const response = await fetch(`${CHARIOW_API_URL}/checkout`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Erreur renvoyée par l'API Chariow:", { status: response.status, body: errorText });
      throw new HttpsError(
        "internal",
        `Erreur lors de la communication avec le service de paiement (Code ${response.status}).`
      );
    }

    const responseData = await response.json();
    const data = responseData.data || responseData;

    // 4. Traitement du statut de la réponse Chariow
    if (data.step === "payment") {
      return { checkoutUrl: data.payment.checkout_url };
    } else if (data.step === "already_purchased") {
      return { alreadyPurchased: true };
    } else {
      logger.warn("Étape de paiement Chariow non reconnue:", data);
      return {
        checkoutUrl: data.payment?.checkout_url || null,
        step: data.step
      };
    }

  } catch (error) {
    logger.error("Erreur dans initiateCheckout pour l'utilisateur " + uid + ":", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      "Une erreur est survenue lors de l'initialisation du paiement.",
      error.message
    );
  }
});
