/* ==========================================================================
   Kontra-Africa — Configuration Firebase
   ========================================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
const firebaseConfig = {
  apiKey: "AIzaSyDRwWJ-BzdDiepdmuRQ4OezrdY3vyOHjEQ",
  authDomain: "kontra-africa.firebaseapp.com",
  projectId: "kontra-africa",
  storageBucket: "kontra-africa.firebasestorage.app",
  messagingSenderId: "42432583683",
  appId: "1:42432583683:web:28c63a02e78aff84771636"
};
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
