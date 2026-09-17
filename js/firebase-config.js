/* ==========================================================================
   Kontra-Africa — Configuration Firebase
   ========================================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
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

// Persistance Auth explicitement forcée en local (survit à la fermeture du
// navigateur/de la PWA, contrairement à la persistance "session" par
// défaut de certains contextes). Configurée ICI, dans le module partagé par
// TOUTES les pages (login, inscription, dashboard, stock, finances,
// contrats, profil) — auparavant seul login.js le faisait, donc les autres
// pages dépendaient du comportement par défaut du SDK plutôt que d'une
// configuration explicite et garantie.
//
// Exportée en promesse : tout script qui a besoin d'être certain que la
// persistance est bien appliquée avant d'agir (ex: juste avant
// signInWithPopup(), voir login.js) peut faire `await authPersistenceReady`.
// Les autres pages (qui ne font qu'écouter via onAuthStateChanged) n'ont
// pas besoin de l'attendre : la restauration d'une session déjà stockée se
// fait de toute façon automatiquement par le SDK au chargement.
export const authPersistenceReady = setPersistence(auth, browserLocalPersistence)
  .catch((err) => {
    console.error('Persistence Firebase — configuration échouée :', err);
  });

// Persistance hors ligne activée : sans ça, la lecture du document
// utilisateur (abonnement, devise, etc.) échoue dès que l'app est ouverte
// sans réseau, même si la session Firebase Auth est correctement restaurée.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});
export const googleProvider = new GoogleAuthProvider();
