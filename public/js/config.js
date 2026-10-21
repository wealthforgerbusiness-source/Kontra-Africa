export const FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyDRwWJ-BzdDiepdmuRQ4OezrdY3vyOHjEQ',
  authDomain: 'kontra-africa.firebaseapp.com',
  projectId: 'kontra-africa',
  storageBucket: 'kontra-africa.firebasestorage.app',
  messagingSenderId: '42432583683',
  appId: '1:42432583683:web:28c63a02e78aff84771636'
});

export const FIREBASE_SDK_VERSION = '10.14.1';
export const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/' + FIREBASE_SDK_VERSION + '/';

export const API_URL = 'https://kontra-africa.onrender.com/';
export const APP_URL = 'https://kontra-africa-app.onrender.com';

export const BRAND = Object.freeze({
  name: 'Kontra Africa',
  tagline: 'Gérez votre stock, vos ventes et vos dettes clients',
  logo: 'assets/logo/logo-512.png'
});

export const LIMITS = Object.freeze({
  requestTimeoutMs: 20000,
  tokenRefreshMarginMs: 60000,
  minSecondsBetweenCheckouts: 15
});

export const BACKEND_READY = !/VOTRE-BACKEND/.test(API_URL);

if (!BACKEND_READY) {
  console.error('config.js : renseigne API_URL avec l\'adresse de ton service back-end Render.');
}
