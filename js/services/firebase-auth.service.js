
const FirebaseAuth = {
  _mapError(code) {
    const messages = {
      'auth/invalid-email': 'Correo o usuario inválido',
      'auth/missing-email': 'Escribe tu correo',
      'auth/user-disabled': 'Esta cuenta ha sido deshabilitada',
      'auth/user-not-found': 'Credenciales incorrectas',
      'auth/wrong-password': 'Credenciales incorrectas',
      'auth/invalid-credential': 'Credenciales incorrectas',
      'auth/email-already-in-use': 'Ese correo o usuario ya está registrado',
      'auth/weak-password': 'La contraseña es muy débil (mínimo 8 caracteres)',
      'auth/requires-recent-login': 'Por seguridad, vuelve a iniciar sesión e inténtalo de nuevo',
      'auth/operation-not-allowed': 'Esta operación no está habilitada en Firebase (Authentication → Método de acceso)',
      'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo',
      'auth/network-request-failed': 'Error de conexión. Verifica tu internet',
      'auth/popup-closed-by-user': 'Ventana emergente cerrada',
      'auth/cancelled-popup-request': 'Solicitud cancelada'
    };
    return messages[code] || ('Error de autenticación: ' + code);
  },

  _requireAuth() {
    if (!window.FB_AUTH) throw new Error('Firebase no está configurado. Verifica firebase-config.js');
    // Los correos de Firebase (verificación y restablecimiento) salen en español
    try { window.FB_AUTH.languageCode = 'es'; } catch (e) {}
  },

  // Acepta un correo real o un nombre de usuario (cuentas antiguas: usuario@sistema.local)
  _toEmail(identifier) {
    const v = String(identifier || '').trim().toLowerCase();
    return v.includes('@') ? v : v + '@sistema.local';
  },

  _wrap(e) {
    if (e && e.code && String(e.code).startsWith('auth/')) {
      const err = new Error(this._mapError(e.code));
      err.code = e.code;
      return err;
    }
    return e;
  },

  // Busca a qué correo pertenece un nombre de usuario (colección "usernames", ver firestore.rules)
  async _lookupUsername(name) {
    if (!/^[a-z0-9_]{3,30}$/.test(name) || !window.FB_DB) return null;
    try {
      const snap = await window.FB_DB.collection('usernames').doc(name).get();
      const email = snap.exists && snap.data() && snap.data().email;
      return email ? String(email).toLowerCase() : null;
    } catch (e) {
      return null; // sin conexión o sin permiso: se intenta con el usuario interno
    }
  },

  // Acepta un correo o un nombre de usuario
  async login(identifier, password) {
    this._requireAuth();
    identifier = (identifier || '').trim();
    if (!identifier) throw new Error('Usuario o correo requerido');
    if (!password) throw new Error('Contraseña requerida');
    const signIn = (email) => window.FB_AUTH.signInWithEmailAndPassword(email, password);
    try {
      if (identifier.includes('@')) {
        return (await signIn(identifier.toLowerCase())).user;
      }
      const name = identifier.toLowerCase();
      const synthetic = name + '@sistema.local';
      const mapped = await this._lookupUsername(name);
      if (!mapped) return (await signIn(synthetic)).user; // cuenta antigua sin correo
      try {
        return (await signIn(mapped)).user;
      } catch (e) {
        // Si otra persona ya usa ese nombre con su correo, la cuenta antigua con ese usuario sigue entrando
        if (e && e.code === 'auth/invalid-credential' && mapped !== synthetic) {
          return (await signIn(synthetic)).user;
        }
        throw e;
      }
    } catch (e) {
      throw this._wrap(e);
    }
  },

  // Solo inicia sesión: la licencia y el perfil se resuelven en app.js (loadSession)
  async loginWithGoogle() {
    this._requireAuth();
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const cred = await window.FB_AUTH.signInWithPopup(provider);
      return cred.user;
    } catch (e) {
      throw this._wrap(e);
    }
  },

  // Envía el enlace para crear una contraseña nueva.
  // Si el correo no existe NO se informa (evita descubrir qué correos están registrados).
  async sendPasswordReset(email) {
    this._requireAuth();
    email = String(email || '').trim().toLowerCase();
    try {
      await window.FB_AUTH.sendPasswordResetEmail(email);
    } catch (e) {
      if (e && e.code === 'auth/user-not-found') return true;
      throw this._wrap(e);
    }
    return true;
  },

  async sendVerification() {
    this._requireAuth();
    const user = window.FB_AUTH.currentUser;
    if (!user) throw new Error('No hay una sesión iniciada');
    try {
      await user.sendEmailVerification();
    } catch (e) {
      throw this._wrap(e);
    }
    return true;
  },

  // Cambia el correo de la cuenta (conserva UID, licencia y datos). El cambio se aplica
  // cuando la persona abre el enlace que Firebase envía al correo nuevo.
  async startEmailChange(newEmail, password) {
    this._requireAuth();
    const user = window.FB_AUTH.currentUser;
    if (!user || !user.email) throw new Error('No hay una sesión iniciada');
    try {
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, password);
      await user.reauthenticateWithCredential(credential);
      await user.verifyBeforeUpdateEmail(String(newEmail || '').trim().toLowerCase());
    } catch (e) {
      throw this._wrap(e);
    }
    return true;
  },

  // Vuelve a leer el estado de la cuenta (por ejemplo, después de verificar el correo)
  async refreshUser() {
    const user = window.FB_AUTH && window.FB_AUTH.currentUser;
    if (!user) return null;
    await user.reload();
    await user.getIdToken(true);
    return window.FB_AUTH.currentUser;
  },

  // Crea una cuenta sin cerrar la sesión del administrador que la está creando
  async createUserNoSwitch(email, password, opts) {
    this._requireAuth();
    let app;
    try {
      app = firebase.app('secondary');
    } catch (e) {
      app = firebase.initializeApp(firebase.app().options, 'secondary');
    }
    const auth = app.auth();
    try { auth.languageCode = 'es'; } catch (e) {}
    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      const uid = cred.user.uid;
      if (opts && opts.sendVerification) {
        try { await cred.user.sendEmailVerification(); } catch (e) { console.warn('[auth] No se pudo enviar la verificación:', e && e.code); }
      }
      await auth.signOut();
      return uid;
    } catch (e) {
      throw this._wrap(e);
    }
  },

  async logout() {
    if (!window.FB_AUTH) return;
    try {
      await window.FB_AUTH.signOut();
    } catch (e) {
      console.error('Logout error:', e);
    }
  },

  onAuthChange(callback) {
    if (!window.FB_AUTH) return () => {};
    return window.FB_AUTH.onAuthStateChanged(callback);
  }
};

window.App = window.App || {};
window.App.Services = window.App.Services || {};
window.App.Services.FirebaseAuth = FirebaseAuth;
