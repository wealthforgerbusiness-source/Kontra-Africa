/* ==========================================================================
   Kontra-Africa — Configuration Firebase
   ------------------------------------------------------------------------
   REMPLACE les valeurs ci-dessous par ton firebaseConfig réel, copié depuis :
   Console Firebase > Paramètres du projet > Vos applications > Config SDK
   ------------------------------------------------------------------------
   Ce fichier est importé par toutes les pages qui ont besoin de Firebase
   (login.js pour l'instant, puis dashboard/app plus tard).
   ========================================================================== */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "REMPLACE_MOI_apiKey",
  authDomain: "REMPLACE_MOI_authDomain",
  projectId: "REMPLACE_MOI_projectId",
  storageBucket: "REMPLACE_MOI_storageBucket",
  messagingSenderId: "REMPLACE_MOI_messagingSenderId",
  appId: "REMPLACE_MOI_appId"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
