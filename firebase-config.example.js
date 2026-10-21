// ============================================================================
//  CONFIGURACIÓN DE FIREBASE — PLANTILLA
//  Copia este archivo como firebase-config.js y reemplaza con las credenciales
//  de tu proyecto Firebase (https://console.firebase.google.com).
//
//  Si deseas inyectar la config en CI/CD, define window.__FIREBASE_CONFIG__
//  antes de cargar este script y se usará ese valor en lugar del hardcodeado.
// ============================================================================

const firebaseConfig = (typeof window !== 'undefined' && window.__FIREBASE_CONFIG__) || {
  apiKey: "TU_API_KEY_AQUI",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO_ID",
  storageBucket: "TU_PROYECTO.firebasestorage.app",
  messagingSenderId: "XXXXXXXXXXXX",
  appId: "1:XXXXXXXXXX:web:XXXXXXXXXXXXXXXXXXXXXXXX",
  measurementId: "G-XXXXXXXXXX"
};

try {
  firebase.initializeApp(firebaseConfig);

  window.FB_AUTH = firebase.auth();
  window.FB_DB = firebase.firestore();

  window.FB_AUTH.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

  if (typeof firebase.appCheck === 'function') {
    const _recaptchaKey = (typeof window !== 'undefined' && window.__RECAPTCHA_SITE_KEY__) || '';
    if (_recaptchaKey) {
      firebase.appCheck().activate(_recaptchaKey, true);
    }
  }
} catch (e) {
  console.error('[Firebase] Error al inicializar:', e);
}