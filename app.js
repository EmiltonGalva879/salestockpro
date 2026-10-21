const { jsPDF } = window.jspdf;
// ===== DIÁLOGOS CON EL ESTILO DEL SISTEMA =====
function showDialog({
  title,
  message,
  icon,
  confirmText,
  cancelText,
  danger,
  showCancel,
}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.padding = "16px";
    overlay.style.zIndex = "1500";

    overlay.innerHTML = `
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <h2 class="modal-title">${icon || ""} ${escapeHtml(title || "Aviso")}</h2>
          <button type="button" class="btn btn-secondary" data-action="cancel">✕</button>
        </div>
        <div class="modal-body">
          <p data-role="msg" style="white-space:pre-line;overflow-wrap:anywhere;font-size:15px;line-height:1.5"></p>
        </div>
        <div class="modal-footer">
          ${showCancel ? `<button type="button" class="btn btn-secondary" data-action="cancel">${escapeHtml(cancelText || "Cancelar")}</button>` : ""}
          <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-action="ok">${escapeHtml(confirmText || "Aceptar")}</button>
        </div>
      </div>
    `;
    // textContent evita que un nombre con < o & rompa el mensaje
    overlay.querySelector('[data-role="msg"]').textContent = String(
      message ?? "",
    );

    document.body.appendChild(overlay);

    let done = false;
    function finish(value) {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(value);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        finish(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      }
    }

    overlay
      .querySelectorAll('[data-action="cancel"]')
      .forEach((b) => b.addEventListener("click", () => finish(false)));
    overlay
      .querySelector('[data-action="ok"]')
      .addEventListener("click", () => finish(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(false);
    });
    document.addEventListener("keydown", onKey, true);
    overlay.querySelector('[data-action="ok"]').focus();
  });
}

function showConfirm(message, opts = {}) {
  return showDialog({
    title: "Confirmar",
    icon: "❓",
    confirmText: "Aceptar",
    cancelText: "Cancelar",
    showCancel: true,
    ...opts,
  });
}

// alert() ahora usa el mismo diseño. Los mensajes se muestran uno tras otro.
let _alertChain = Promise.resolve();
window.alert = function (msg) {
  const text = String(msg ?? "");
  const isError =
    /error|incorrect|inválid|invalid|no encontrad|no se pudo|no autorizad|denegad|sin stock|obligatori|no coinciden|ya fue|ya está|falta|requerid/i.test(
      text,
    );
  _alertChain = _alertChain.then(() =>
    showDialog({
      title: isError ? "Atención" : "Listo",
      icon: isError ? "⚠️" : "✅",
      message: text,
      danger: isError,
      showCancel: false,
    }),
  );
};
window.addEventListener("error", function (e) {
  const app = document.getElementById("app");
  if (app) {
    app.innerHTML =
      '<div style="padding:40px;font-family:monospace;color:#dc2626;white-space:pre-wrap">Error: ' +
      (e.message || e.error) +
      "\n" +
      (e.filename || "") +
      ":" +
      (e.lineno || "") +
      "</div>";
  }
});
console.log(
  "Elemento que recibe el clic:",
  document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2),
);

console.log(
  "Capas superpuestas:",
  [...document.querySelectorAll("body *")].filter((el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();

    return (
      s.position === "fixed" &&
      s.pointerEvents !== "none" &&
      r.width >= window.innerWidth * 0.8 &&
      r.height >= window.innerHeight * 0.8
    );
  }),
);
document.addEventListener("click", function (e) {
  const input = document.getElementById("scanner-input");
  const dropdown = document.getElementById("scanner-dropdown");
  if (!input || !dropdown) return;
  if (state.page !== "sales" || state.modal) {
    dropdown.style.display = "none";
    return;
  }
  if (!input.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.style.display = "none";
  }
});

let state = {
  page: "login",
  user: null,
  cart: [],
  search: "",
  modal: null,
  alertDismissed: false,
  testResult: "",
  loginError: "",
  loginTab: "login",
  loading: true,
  previewInvoicePdfUrl: "",
  salesListHtml: "",
  registerLicenseOk: false,
  reportDate: localDateStr(new Date()),
};

// Cambia este texto cada vez que publiques: aparece al pie del login y en la consola,
// y sirve para comprobar qué versión está sirviendo realmente Vercel / Electron.
const APP_VERSION = "2026.10.20-recuperacion";
console.info("[SalesStock Pro] versión", APP_VERSION);

let sessionLoading = false; // evita que onAuthStateChanged interfiera mientras se registra una cuenta

// Acepta un correo real o un nombre de usuario (cuentas antiguas: usuario@sistema.local)
function authEmail(identifier) {
  const v = String(identifier || "")
    .trim()
    .toLowerCase();
  return v.includes("@") ? v : v + "@sistema.local";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim());
}

// Correo "real": uno que puede recibir mensajes (no el interno @sistema.local)
function isRealEmail(email) {
  return isValidEmail(email) && !/@sistema\.local$/i.test(String(email).trim());
}

// Guarda "usuario -> correo" para poder entrar con el nombre de usuario aunque la cuenta use correo real.
// Solo la propia persona puede crear/cambiar su registro (lo exigen las reglas de Firestore).
async function syncUsernameMapping(fbUser, profile) {
  const email = (fbUser.email || "").toLowerCase();
  const name = String((profile && profile.username) || "")
    .trim()
    .toLowerCase();
  if (!isRealEmail(email) || !/^[a-z0-9_]{3,30}$/.test(name)) return;
  try {
    const ref = window.FB_DB.collection("usernames").doc(name);
    const snap = await ref.get();
    if (snap.exists) {
      const d = snap.data() || {};
      if (d.uid !== fbUser.uid) return; // otra persona ya usa ese nombre
      if (d.email === email) return; // ya está al día
    }
    await ref.set({ uid: fbUser.uid, email: email, username: profile.username });
  } catch (e) {
    console.warn("[usuario] No se pudo sincronizar el usuario:", e && e.code);
  }
}

// ¿Ese nombre de usuario ya lo usa alguien con correo real?
async function usernameTaken(username) {
  const name = String(username || "")
    .trim()
    .toLowerCase();
  try {
    const snap = await window.FB_DB.collection("usernames").doc(name).get();
    return snap.exists;
  } catch (e) {
    return false;
  }
}

// Carga el perfil de la sesión de Firebase y decide a qué pantalla ir
async function loadSession(fbUser) {
  const email = (fbUser.email || "").toLowerCase();

  if (window.isSuperAuthUser(fbUser)) {
    await ensureDB();
    state.user = {
      id: "1",
      username: "Sistemapro",
      email: email,
      role: "ADMIN",
      licensed: true,
      created:
        (fbUser.metadata && fbUser.metadata.creationTime) ||
        new Date().toISOString(),
    };
    state.page = "sales";
    return;
  }

  const snap = await window.FB_DB.collection("profiles").doc(fbUser.uid).get();
  if (!snap.exists) {
    // Cuenta sin licencia: debe activarla
    state.user = {
      id: fbUser.uid,
      username: email.split("@")[0],
      email: email,
      role: "ADMIN",
      licensed: false,
    };
    state.page = "activate-license";
    return;
  }

  const profile = snap.data();
  await ensureDB(profile.companyId);
  // Si la persona cambió su correo (ya verificado), el perfil se actualiza solo
  if (fbUser.emailVerified && email && profile.email !== email) {
    window.FB_DB.collection("profiles")
      .doc(fbUser.uid)
      .update({ email: email })
      .catch(() => {});
  }
  const entry =
    window.App.Services.DB.get("users").find(
      (u) => String(u.id) === fbUser.uid,
    ) || {};
  state.user = {
    ...entry,
    id: fbUser.uid,
    username: profile.username,
    email: email,
    role: profile.role,
    companyId: profile.companyId,
    createdBy: entry.createdBy || profile.createdBy || "1",
    licensed: true,
  };
  state.page = "sales";
  syncUsernameMapping(fbUser, profile); // sin esperar: no retrasa la entrada
}

// Reclama una licencia: crea el perfil y marca la licencia como usada en una sola operación atómica
async function claimLicense(uid, username, email, key) {
  key = (key || "").trim();
  if (!key || /[\/\s]/.test(key)) throw new Error("Clave de licencia inválida");

  const keyRef = window.FB_DB.collection("licenseKeys").doc(key);
  const snap = await keyRef.get();
  if (!snap.exists) throw new Error("Clave de licencia inválida");
  if (snap.data().used) throw new Error("Esta licencia ya fue utilizada");

  const now = new Date().toISOString();
  const batch = window.FB_DB.batch();
  batch.set(window.FB_DB.collection("profiles").doc(uid), {
    uid: uid,
    username: username,
    email: email,
    role: "ADMIN",
    companyId: uid,
    licenseKey: key,
    createdBy: "1",
    created: now,
  });
  batch.update(keyRef, {
    used: true,
    usedBy: uid,
    usedAt: now,
    companyId: uid,
  });
  try {
    await batch.commit();
  } catch (e) {
    if (e && e.code === "permission-denied")
      throw new Error("Clave de licencia inválida o ya utilizada");
    throw e;
  }

  // A partir de aquí la licencia ya está activada; un fallo en lo siguiente no la deshace
  try {
    await ensureDB(uid);
    const users = window.App.Services.DB.get("users");
    if (!users.find((u) => String(u.id) === uid)) {
      users.push({
        id: uid,
        username: username,
        email: email,
        role: "ADMIN",
        created: now,
        licenseKey: key,
        licensed: true,
        createdBy: "1",
        companyId: uid,
      });
      await window.App.Services.DB.set("users", users);
    }
  } catch (e) {
    console.warn(
      "[claimLicense] No se pudo guardar el usuario en la lista:",
      e,
    );
  }
}

async function login(username, password) {
  username = (username || "").trim();
  if (!username || !password) {
    state.loginError = "Escribe tu usuario o correo y tu contraseña";
    render();
    return false;
  }
  try {
    state.loginError = "";
    await window.App.Services.FirebaseAuth.login(username, password);
    return true; // onAuthStateChanged carga la sesión y dibuja la pantalla
  } catch (e) {
    state.loginError = mapAuthError(e);
    render();
    return false;
  }
}

async function validateRegisterLicense(key) {
  key = (key || "").trim();
  if (!key) {
    state.loginError = "Ingrese la clave de licencia";
    render();
    return;
  }
  if (/[\/\s]/.test(key)) {
    state.loginError = "Clave de licencia inválida";
    render();
    return;
  }
  // La licencia se comprueba de verdad al crear la cuenta (requiere sesión de Firebase)
  state.loginError = "";
  state.registerLicenseOk = true;
  state.registerLicenseKey = key;
  render();
}

async function registerUser(username, email, password, confirmPassword) {
  const licenseKey = state.registerLicenseKey || "";
  username = (username || "").trim();
  email = String(email || "")
    .trim()
    .toLowerCase();
  if (!username || !email || !password) {
    state.loginError = "Usuario, correo y contraseña son obligatorios";
    render();
    return false;
  }
  if (!isRealEmail(email)) {
    state.loginError = "Escribe un correo válido (por ejemplo nombre@gmail.com)";
    render();
    return false;
  }
  if (!licenseKey) {
    state.loginError = "Falta la clave de licencia";
    render();
    return false;
  }
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    state.loginError =
      "Usuario: 3 a 30 caracteres, solo letras, números y guión bajo";
    render();
    return false;
  }
  if (password.length < 8) {
    state.loginError = "La contraseña debe tener al menos 8 caracteres";
    render();
    return false;
  }
  if (password !== confirmPassword) {
    state.loginError = "Las contraseñas no coinciden";
    render();
    return false;
  }

  if (await usernameTaken(username)) {
    state.loginError = "Ese nombre de usuario ya está en uso. Elige otro.";
    render();
    return false;
  }

  let cred = null;
  sessionLoading = true;
  try {
    state.loginError = "";
    cred = await window.FB_AUTH.createUserWithEmailAndPassword(
      email,
      password,
    );
    await claimLicense(cred.user.uid, username, email, licenseKey);
  } catch (e) {
    // Si la licencia no sirvió, no se deja la cuenta creada a medias
    if (cred && cred.user) {
      try {
        await cred.user.delete();
      } catch (_) {}
    }
    sessionLoading = false;
    state.loginError = mapAuthError(e);
    render();
    return false;
  }

  // Correo de verificación (no bloquea el registro si falla)
  try {
    window.FB_AUTH.languageCode = "es";
    await cred.user.sendEmailVerification();
  } catch (e) {
    console.warn("No se pudo enviar el correo de verificación", e && e.code);
  }

  try {
    await loadSession(cred.user);
    state.registerLicenseOk = false;
    state.registerLicenseKey = "";
    state.loginError = "";
  } catch (e) {
    console.error("Error cargando la sesión", e);
    state.loginError = "Cuenta creada. Inicia sesión para continuar.";
    state.loginTab = "login";
    state.page = "login";
  } finally {
    sessionLoading = false;
    state.loading = false;
    render();
  }
  return true;
}

function mapAuthError(e) {
  const code = e && e.code;
  if (code === "auth/invalid-email") return "Correo o usuario inválido";
  if (code === "auth/requires-recent-login")
    return "Por seguridad, cierra sesión, vuelve a entrar e inténtalo de nuevo";
  if (
    code === "auth/user-not-found" ||
    code === "auth/wrong-password" ||
    code === "auth/invalid-credential"
  )
    return "Credenciales incorrectas";
  if (code === "auth/email-already-in-use")
    return "Ese correo o usuario ya está registrado";
  if (code === "auth/too-many-requests")
    return "Demasiados intentos. Espera unos minutos e inténtalo de nuevo";
  if (code === "auth/network-request-failed")
    return "Error de conexión. Verifica tu internet";
  if (code === "auth/weak-password")
    return "La contraseña es muy débil (mínimo 8 caracteres)";
  return e && e.message ? e.message : "Error de autenticación";
}

async function logout() {
  if (window.isDirty && state.cart.length > 0) {
    const ok = await showConfirm(
      "Tienes " +
        state.cart.length +
        " producto(s) en el carrito.\n\n¿Seguro que quieres cerrar sesión?",
      {
        title: "Cerrar sesión",
        icon: "⚠️",
        confirmText: "Cerrar sesión",
        danger: true,
      },
    );
    if (!ok) return;
  }
  try {
    await window.App.Services.FirebaseAuth.logout();
  } catch (e) {}
  window.App.Services.DB.destroy();
  // Borra cualquier copia de datos que haya quedado en este navegador
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("salesstock_db_"))
      .forEach((k) => localStorage.removeItem(k));
  } catch (e) {}
  try {
    await window.FB_DB.terminate();
    await window.FB_DB.clearPersistence();
  } catch (e) {}
  location.reload();
}

async function loginWithGoogle() {
  try {
    state.loginError = "";
    await window.App.Services.FirebaseAuth.loginWithGoogle();
    // onAuthStateChanged carga la sesión (o pide activar la licencia)
  } catch (e) {
    state.loginError = mapAuthError(e);
    render();
  }
}

async function activateLicense(key) {
  key = (key || "").trim();
  if (!key) {
    state.loginError = "Ingrese la clave de licencia";
    render();
    return false;
  }
  try {
    await claimLicense(
      String(state.user.id),
      state.user.username,
      state.user.email || "",
      key,
    );
    await loadSession(window.FB_AUTH.currentUser);
    state.loginError = "";
    state.registerLicenseOk = false;
    state.registerLicenseKey = "";
    render();
    return true;
  } catch (e) {
    console.error("activateLicense error", e);
    state.loginError = mapAuthError(e);
    render();
    return false;
  }
}

// ===== Recuperación de cuenta =====

// Aviso (ocultable) para cuentas sin correo real o con el correo sin verificar
function renderAccountBanner() {
  if (window._acctBannerHidden) return "";
  const u = window.FB_AUTH && window.FB_AUTH.currentUser;
  if (!u || !u.email) return "";
  const email = u.email.toLowerCase();
  const box = (icon, text, buttons) => `
    <div class="acct-banner" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#fffbeb;border:1px solid #fde68a;color:#92400e;padding:12px 14px;border-radius:10px;margin-bottom:16px;font-size:14px;text-align:left">
      <span style="font-size:20px">${icon}</span>
      <div style="flex:1;min-width:200px;line-height:1.45">${text}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${buttons}</div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="window._acctBannerHidden=true;render()" aria-label="Ocultar aviso">✕</button>
    </div>`;
  if (!isRealEmail(email)) {
    return box(
      "🔐",
      "<strong>Protege tu cuenta:</strong> registra un correo real para poder recuperar tu contraseña si la olvidas.",
      '<button type="button" class="btn btn-primary btn-sm" onclick="showRecoveryEmailModal()">Registrar correo</button>',
    );
  }
  if (!u.emailVerified) {
    return box(
      "📧",
      "<strong>Verifica tu correo:</strong> te enviamos un enlace a " +
        escapeHtml(email) +
        ". Ábrelo y luego pulsa «Ya lo verifiqué».",
      '<button type="button" class="btn btn-secondary btn-sm" onclick="resendVerification()">Reenviar enlace</button>' +
        '<button type="button" class="btn btn-primary btn-sm" onclick="refreshVerification()">Ya lo verifiqué</button>',
    );
  }
  return "";
}

async function resendVerification() {
  try {
    await window.App.Services.FirebaseAuth.sendVerification();
    alert("Te enviamos un nuevo enlace de verificación a tu correo.");
  } catch (e) {
    alert(mapAuthError(e));
  }
}

async function refreshVerification() {
  try {
    const u = await window.App.Services.FirebaseAuth.refreshUser();
    if (u && u.emailVerified) {
      try {
        await loadSession(u);
      } catch (e) {
        console.warn("[verificación] No se pudo recargar la sesión", e);
      }
      alert("¡Correo verificado!");
    } else {
      alert(
        "No se pudo confirmar todavía. Abre el enlace que te enviamos al correo y vuelve a intentarlo.",
      );
    }
  } catch (e) {
    alert(mapAuthError(e));
  }
  render();
}

// Ventana para cambiar el correo de la cuenta (conserva UID, licencia, empresa y datos)
function showRecoveryEmailModal() {
  const isSuper = state.user && String(state.user.id) === "1";
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.padding = "16px";
  overlay.style.zIndex = "1500";
  overlay.innerHTML = `
    <div class="modal" style="max-width:440px">
      <div class="modal-header">
        <h2 class="modal-title">🔐 Registrar correo de recuperación</h2>
        <button type="button" class="btn btn-secondary" data-action="close" aria-label="Cerrar">✕</button>
      </div>
      <form data-role="form" autocomplete="off">
        <div class="modal-body">
          <p style="color:#64748b;font-size:14px;line-height:1.5;margin-bottom:14px">
            Te enviaremos un enlace para confirmar el correo. Cuando lo abras, tu cuenta usará ese correo para entrar y para recuperar la contraseña. No pierdes tu licencia, usuarios ni datos.
          </p>
          <div data-role="err" style="display:none;background:#fee2e2;color:#dc2626;padding:10px 12px;border-radius:8px;margin-bottom:12px;font-weight:600;font-size:14px"></div>
          <div class="form-group">
            <label for="rec-email">Correo</label>
            <input id="rec-email" class="form-control" type="email" inputmode="email" autocomplete="email" placeholder="nombre@gmail.com" required>
          </div>
          <div class="form-group">
            <label for="rec-pass">Tu contraseña actual</label>
            <input id="rec-pass" class="form-control" type="password" autocomplete="current-password" required>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-action="close">Cancelar</button>
          <button type="submit" class="btn btn-primary" data-role="submit">Enviar enlace</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('[data-role="form"]');
  const errBox = overlay.querySelector('[data-role="err"]');
  const emailInput = overlay.querySelector("#rec-email");
  const passInput = overlay.querySelector("#rec-pass");
  const submitBtn = overlay.querySelector('[data-role="submit"]');

  function close() {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  }
  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }
  function showError(msg) {
    errBox.textContent = msg;
    errBox.style.display = "block";
  }

  overlay.querySelectorAll('[data-action="close"]').forEach((b) => b.addEventListener("click", close));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey, true);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.style.display = "none";
    const email = emailInput.value.trim().toLowerCase();
    const password = passInput.value;
    if (!isRealEmail(email)) return showError("Escribe un correo válido (por ejemplo nombre@gmail.com)");
    if (!password) return showError("Escribe tu contraseña actual");

    if (isSuper) {
      // Evita que un error de escritura deje al administrador sin acceso
      if (!window.SUPER_REAL_EMAIL)
        return showError("Primero escribe tu correo en js/services/db.js (DB_SUPER_REAL_EMAIL) y en firestore.rules, y vuelve a publicar.");
      if (email !== window.SUPER_REAL_EMAIL)
        return showError("Para el administrador principal el correo debe ser exactamente: " + window.SUPER_REAL_EMAIL);
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando...";
    try {
      await window.App.Services.FirebaseAuth.startEmailChange(email, password);
      overlay.querySelector(".modal-body").innerHTML = '<p data-role="done" style="line-height:1.55;font-size:15px"></p>';
      overlay.querySelector('[data-role="done"]').textContent =
        "Enviamos un enlace a " + email + ". Ábrelo para confirmar el cambio. Después, entra al sistema con ese correo o con tu usuario (y tu misma contraseña).";
      overlay.querySelector(".modal-footer").innerHTML = '<button type="button" class="btn btn-primary" data-action="close">Entendido</button>';
      overlay.querySelectorAll('[data-action="close"]').forEach((b) => b.addEventListener("click", close));
    } catch (err) {
      console.error("[correo] No se pudo iniciar el cambio:", err && err.code);
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar enlace";
      showError(
        err && (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential")
          ? "La contraseña actual no es correcta"
          : mapAuthError(err),
      );
    }
  });

  emailInput.focus();
}

// Pantalla "¿Olvidaste tu contraseña o usuario?" del login
function startForgot() {
  state.loginTab = "forgot";
  state.loginError = "";
  state.forgotMsg = "";
  render();
}

async function sendResetEmail(email) {
  email = String(email || "")
    .trim()
    .toLowerCase();
  state.forgotEmail = email;
  state.loginError = "";
  state.forgotMsg = "";
  if (!isValidEmail(email)) {
    state.loginError = "Escribe un correo válido";
    render();
    return false;
  }
  if (Date.now() < (state.forgotUntil || 0)) {
    state.loginError = "Espera unos segundos antes de pedir otro enlace";
    render();
    return false;
  }
  state.forgotBusy = true;
  render();
  try {
    await window.App.Services.FirebaseAuth.sendPasswordReset(email);
    // Mensaje igual exista o no el correo: no se revela qué correos están registrados
    state.forgotMsg =
      "Si ese correo está registrado, te enviamos un enlace para crear una contraseña nueva. Revisa tu bandeja de entrada y la carpeta de spam.";
    state.forgotUntil = Date.now() + 30000;
    setTimeout(() => {
      if (state.loginTab === "forgot") render();
    }, 30500);
  } catch (e) {
    console.error("[recuperación] No se pudo enviar el enlace:", e && e.code);
    state.loginError = mapAuthError(e);
  } finally {
    state.forgotBusy = false;
    render();
  }
  return true;
}

function getCompanyId() {
  if (!state.user) return null;
  if (String(state.user.id) === "1") return null;
  return String(state.user.companyId || state.user.id);
}

// ===== Datos de la empresa (por licencia/empresa, guardados en Firestore) =====
const DEFAULT_BRAND = "SalesStock Pro";

function getBizSettings() {
  const cid = getCompanyId() || "1";
  let list = [];
  try {
    list = DB.get("settings") || [];
  } catch (e) {}
  return list.find((s) => String(s.companyId) === cid) || {};
}

function bizGet(field) {
  return String(getBizSettings()[field] || "");
}

// Nombre propio de la empresa; vacío si no ha puesto uno (o dejó el de por defecto)
function bizCustomName() {
  const n = bizGet("bizname").trim();
  return n.toLowerCase() === DEFAULT_BRAND.toLowerCase() ? "" : n;
}

// Último nombre usado en este dispositivo: solo para la pantalla de login (aún sin sesión)
function cachedBizName() {
  try {
    return (localStorage.getItem("salesstock_bizname") || "").trim();
  } catch (e) {
    return "";
  }
}

// Con nombre propio se muestra solo ese nombre; sin él, "SalesStock Pro"
function brandHtml(name) {
  name = (name || "").trim();
  if (!name || name.toLowerCase() === DEFAULT_BRAND.toLowerCase())
    return "SalesStock<span>Pro</span>";
  return escapeHtml(name);
}

function getVisibleOwners(userId) {
  const owners = new Set([String(userId)]);
  const users = getUsers();
  const currentUser = users.find((u) => String(u.id) === String(userId));
  const companyId = currentUser
    ? String(currentUser.companyId || currentUser.id)
    : null;
  let current = String(userId);
  let iterations = 0;
  while (iterations < 100) {
    if (current === "1") break;
    const creator = users.find((u) => String(u.id) === current && u.createdBy);
    if (!creator) break;
    const creatorCompanyId = String(creator.companyId || creator.id);
    if (companyId && creatorCompanyId !== companyId) break;
    owners.add(String(creator.createdBy));
    current = String(creator.createdBy);
    iterations++;
  }
  return owners;
}

function getVisibleUsers() {
  if (!state.user) return [];
  const users = getUsers();
  if (String(state.user.id) === "1") return users;
  return users.filter(
    (u) =>
      String(u.createdBy) === String(state.user.id) ||
      String(u.id) === String(state.user.id),
  );
}

function getUserCreator(userId) {
  const users = getUsers();
  const user = users.find((u) => String(u.id) === String(userId));
  if (!user || !user.createdBy) return "Sistema";
  const creator = users.find((u) => String(u.id) === String(user.createdBy));
  return creator ? creator.username : "Sistema";
}

function getProducts() {
  const products = DB.get("products");
  if (!state.user) return products;
  const companyId = getCompanyId();
  if (!companyId) return products;
  if (state.search) {
    return products.filter(
      (p) =>
        String(p.companyId) === companyId &&
        (p.name.toLowerCase().includes(state.search.toLowerCase()) ||
          p.barcode.includes(state.search)),
    );
  }
  return products.filter((p) => String(p.companyId) === companyId);
}

function getLowStock() {
  return getProducts().filter((p) => p.stock <= p.minStock);
}

function saveProduct(product) {
  const products = DB.get("products");
  if (product.id) {
    const visibleProducts = getProducts();
    const idxInVisible = visibleProducts.findIndex((p) => p.id === product.id);
    if (idxInVisible < 0) return;
    const idx = products.findIndex((p) => p.id === product.id);
    if (idx >= 0) products[idx] = { ...products[idx], ...product };
  } else {
    product.id = Date.now();
    product.barcode = product.barcode || "S" + Date.now().toString().slice(-10);
    product.createdBy = String(state.user.id);
    product.companyId = String(state.user.companyId || state.user.id);
    products.push(product);
  }
  DB.set("products", products);
}

function saveQuickProduct(name, price, stock, minStock, barcode) {
  const products = DB.get("products");
  const newProduct = {
    id: Date.now(),
    name: name,
    price: parseFloat(price),
    stock: parseInt(stock) || 0,
    minStock: parseInt(minStock) || 5,
    barcode: barcode,
    createdBy: String(state.user.id),
    companyId: String(state.user.companyId || state.user.id),
    created: new Date().toISOString(),
  };
  products.push(newProduct);
  DB.set("products", products);
  state.modal = null;
  render();
  alert("Producto agregado: " + name);
}

function deleteProduct(id) {
  const visibleProducts = getProducts();
  if (!visibleProducts.find((p) => p.id === id)) return;
  const products = DB.get("products").filter((p) => p.id !== id);
  DB.set("products", products);
}

function getSales() {
  const sales = DB.get("sales") || [];
  const fiscalSales = DB.get("sales_fiscal") || [];
  const normalSales = DB.get("sales_normal") || [];
  const all = [...sales, ...fiscalSales, ...normalSales];
  const companyId = getCompanyId();
  if (!companyId) return all;
  return all.filter((s) => String(s.companyId) === companyId);
}
function getVisibleSales() {
  const sales = getSales();
  if (!state.user) return sales;
  if (String(state.user.id) === "1") return sales;
  const visibleOwners = getVisibleOwners(state.user.id);
  return sales.filter((s) => {
    const owner = String(s.userId || s.user);
    return owner === String(state.user.id) || visibleOwners.has(owner);
  });
}
function getTodaySales() {
  const today = localDateStr(new Date());
  return getVisibleSales().filter((s) => localDateStr(s.created) === today);
}

function getSalesByDate(dateStr) {
  if (!dateStr) return getTodaySales();
  return getVisibleSales()
    .filter((s) => localDateStr(s.created) === dateStr)
    .sort((a, b) => new Date(a.created) - new Date(b.created));
}
// Fecha local YYYY-MM-DD (toISOString usa UTC y adelanta el día por la noche)
function localDateStr(d) {
  const x = new Date(d);
  return (
    x.getFullYear() +
    "-" +
    String(x.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(x.getDate()).padStart(2, "0")
  );
}
function fmtDateStr(s) {
  return s.split("-").reverse().join("/");
}

// Verifica la contraseña de la cuenta con la que se inició sesión (la valida Firebase, no el navegador)
async function verifyPassword(pw) {
  const u = window.FB_AUTH && window.FB_AUTH.currentUser;
  if (!pw || !u || !u.email) return false;
  try {
    const credential = firebase.auth.EmailAuthProvider.credential(u.email, pw);
    await u.reauthenticateWithCredential(credential);
    return true;
  } catch (e) {
    return false;
  }
}

async function promptDeleteSale(id) {
  const pw = await requestAdminPassword();

  // Si el administrador cancela, no se elimina nada.
  if (pw === null) return;

  if (!(await verifyPassword(pw))) {
    alert("Password incorrecta");
    return;
  }

  await deleteSale(id);
}

function requestAdminPassword() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.padding = "16px";
    overlay.style.zIndex = "1300";

    overlay.innerHTML = `
      <div class="modal" style="max-width:400px">
        <div class="modal-header">
          <h2 class="modal-title">🔒 Autorización requerida</h2>
          <button type="button" class="btn btn-secondary" data-action="cancel">✕</button>
        </div>
        <form id="admin-auth-form" autocomplete="off">
          <div class="modal-body">
            <p style="color:#64748b;font-size:14px;margin-bottom:16px">
              Esta acción necesita la contraseña de administrador.
            </p>
            <div class="form-group" style="margin-bottom:12px">
              <label for="admin-password-input">Contraseña</label>
              <div style="display:flex;gap:8px">
                <input id="admin-password-input" class="form-control" type="password"
                  autocomplete="current-password" placeholder="••••••••" required
                  style="font-size:16px">
                <button type="button" class="btn btn-secondary" data-action="toggle"
                  title="Mostrar u ocultar contraseña">👁️</button>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-action="cancel">Cancelar</button>
            <button type="submit" class="btn btn-danger">Confirmar</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    const form = overlay.querySelector("#admin-auth-form");
    const input = overlay.querySelector("#admin-password-input");
    let finished = false;

    function finish(value) {
      if (finished) return;
      finished = true;
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(value);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") finish(null);
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(input.value);
    });

    overlay.querySelectorAll('[data-action="cancel"]').forEach((btn) => {
      btn.addEventListener("click", () => finish(null));
    });

    overlay
      .querySelector('[data-action="toggle"]')
      .addEventListener("click", () => {
        input.type = input.type === "password" ? "text" : "password";
        input.focus();
      });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });

    document.addEventListener("keydown", onKeyDown);
    input.focus();
  });
}

async function deleteSale(id) {
  const sales = getVisibleSales();
  const sale = sales.find((s) => s.id === id);
  if (!sale) return;
  const ok = await showConfirm("¿Eliminar venta #" + id + "?", {
    title: "Eliminar venta",
    icon: "🗑️",
    confirmText: "Eliminar",
    danger: true,
  });
  if (!ok) return;
  const products = getProducts();
  const visibleOwners = getVisibleOwners(state.user.id);
  sale.items.forEach((item) => {
    const p = products.find((prod) => prod.id === item.id);
    if (p && visibleOwners.has(String(p.createdBy))) {
      p.stock += item.quantity;
    }
  });
  DB.set("products", products);
  DB.set(
    "sales",
    getSales().filter((s) => s.id !== id),
  );
  DB.set(
    "sales_fiscal",
    (DB.get("sales_fiscal") || []).filter((s) => s.id !== id),
  );
  DB.set(
    "sales_normal",
    (DB.get("sales_normal") || []).filter((s) => s.id !== id),
  );
  alert("Venta eliminada");
  state.salesListHtml = "";
  render();
}

function addToCart(product) {
  const existing = state.cart.find((item) => item.id === product.id);
  if (existing) {
    if (existing.quantity < product.stock) existing.quantity++;
  } else {
    state.cart.push({ ...product, quantity: 1, hiddenDiscountPct: 0 });
  }
}

function updateCartQty(id, qty) {
  const item = state.cart.find((i) => i.id === id);
  if (!item) return;
  if (qty > 0) {
    const product = getProducts().find((p) => p.id === id);
    if (
      product &&
      (String(product.createdBy) === String(state.user.id) ||
        getVisibleOwners(state.user.id).has(String(product.createdBy)))
    ) {
      item.quantity = product ? Math.min(qty, product.stock) : qty;
    }
  } else if (qty <= 0) {
    state.cart = state.cart.filter((i) => i.id !== id);
  }
  render();
}

function removeFromCart(id) {
  state.cart = state.cart.filter((i) => i.id !== id);
}

function getCartTotal() {
  let subtotal = 0;
  state.cart.forEach((item) => {
    const raw = item.price * item.quantity;
    const discount = item.hiddenDiscountPct || 0;
    subtotal += raw * (1 - discount);
  });
  return subtotal;
}

async function cancelCart() {
  if (state.cart.length === 0) return;
  const ok = await showConfirm("¿Cancelar todo el carrito?", {
    title: "Cancelar carrito",
    icon: "🛒",
    confirmText: "Sí, cancelar",
    cancelText: "No",
    danger: true,
  });
  if (!ok) return;
  state.cart = [];
  render();
}

function showPaymentOptions(mode) {
  const subtotal = getCartTotal();
  const itbis = subtotal * ITBIS_RATE;
  const total = subtotal + itbis;
  const receiptType =
    localStorage.getItem("salesstock_receiptType") || "normal";
  state.modal = {
    type: "payment",
    subtotal: subtotal,
    itbis: itbis,
    total: total,
    paymentMode: mode || "sale",
    receiptType: receiptType,
  };
  render();
}

function updateReceiptType() {
  const receiptType =
    document.getElementById("receipt-type")?.value || "normal";
  localStorage.setItem("salesstock_receiptType", receiptType);
}

function updateChange() {
  const paidInput = document.getElementById("paid-amount");
  const changeDisplay = document.getElementById("change-display");
  if (!paidInput || !changeDisplay) return;
  const total = state.modal && state.modal.total ? state.modal.total : 0;
  const paid = parseFloat(paidInput.value) || 0;
  const change = paid - total;
  if (paid > 0) {
    changeDisplay.style.display = "block";
    if (change >= 0) {
      changeDisplay.style.background = "#f0fdf4";
      changeDisplay.style.borderColor = "#bbf7d0";
      changeDisplay.style.color = "#166534";
      changeDisplay.textContent = "Cambio: " + fmtMoneyInvoice(change);
    } else {
      changeDisplay.style.background = "#fef2f2";
      changeDisplay.style.borderColor = "#fecaca";
      changeDisplay.style.color = "#991b1b";
      changeDisplay.textContent =
        "Faltan: " + fmtMoneyInvoice(Math.abs(change));
    }
  } else {
    changeDisplay.style.display = "none";
  }
}

function promptHiddenDiscount(id) {
  const item = state.cart.find((i) => i.id === id);
  if (!item) return;

  const raw = item.price * item.quantity;
  const current = item.hiddenDiscountPct || 0;
  const currentText = current
    ? current < 1
      ? Math.round(current * 100) + "%"
      : "$" + current
    : "sin descuento";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.padding = "16px";
  overlay.style.zIndex = "1300";

  overlay.innerHTML = `
    <div class="modal" style="max-width:420px">
      <div class="modal-header">
        <h2 class="modal-title">🏷️ Aplicar descuento</h2>
        <button type="button" class="btn btn-secondary"
          data-action="cancel" aria-label="Cerrar">✕</button>
      </div>

      <form data-role="hidden-discount-form" autocomplete="off">
        <div class="modal-body">
          <p data-role="product-name"
            style="font-weight:600;margin-bottom:8px"></p>

          <p style="color:#64748b;font-size:14px;margin-bottom:12px">
            Descuento actual: ${currentText}
          </p>

          <div class="form-group">
            <label for="hidden-discount-input">Descuento</label>
            <input id="hidden-discount-input"
              class="form-control"
              type="text"
              inputmode="decimal"
              placeholder="Ej.: 10% o 50"
              autocomplete="off">

            <small style="display:block;color:#64748b;margin-top:6px">
              Escribe un porcentaje (10%) o un importe (50).
            </small>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary"
            data-action="cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary">Aplicar</button>
        </div>
      </form>
    </div>
  `;

  overlay.querySelector('[data-role="product-name"]').textContent =
    item.name || "Producto";

  document.body.appendChild(overlay);

  const form = overlay.querySelector('[data-role="hidden-discount-form"]');
  const input = overlay.querySelector("#hidden-discount-input");
  let finished = false;

  function closeModal() {
    if (finished) return;
    finished = true;
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
  }

  function onKeyDown(event) {
    if (event.key === "Escape") closeModal();
  }

  overlay.querySelectorAll('[data-action="cancel"]').forEach((button) => {
    button.addEventListener("click", closeModal);
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal();
  });

  document.addEventListener("keydown", onKeyDown);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (finished) return;

    const value = input.value.trim();
    const num = parseFloat(value.replace("%", "").replace(",", "."));

    if (isNaN(num) || num < 0) {
      item.hiddenDiscountPct = 0;
    } else if (value.includes("%")) {
      item.hiddenDiscountPct = Math.min(Math.max(num / 100, 0), 1);
    } else {
      item.hiddenDiscountPct = raw > 0 ? Math.min(num / raw, 1) : 0;
    }

    closeModal();
    render();
  });

  setTimeout(() => input.focus(), 0);
}

let printWindow = null;

function submitSale(paymentType) {
  const customerName = document.getElementById("customer-name")?.value || "";
  const customerPhone = document.getElementById("customer-phone")?.value || "";
  const notes = document.getElementById("sale-notes")?.value || "";
  const paidAmount =
    parseFloat(document.getElementById("paid-amount")?.value) || 0;
  const receiptType =
    document.getElementById("receipt-type")?.value || "normal";
  state.modal = null;
  printWindow = window.open("", "_blank", "width=800,height=600");
  completeSale(paymentType, {
    customerName,
    customerPhone,
    notes,
    paidAmount,
    receiptType,
  });
}

function submitQuote() {
  const customerName = document.getElementById("customer-name")?.value || "";
  const customerPhone = document.getElementById("customer-phone")?.value || "";
  const notes = document.getElementById("sale-notes")?.value || "";
  const receiptType =
    document.getElementById("receipt-type")?.value || "normal";
  state.modal = null;
  printWindow = window.open("", "_blank", "width=800,height=600");
  makeQuote({ customerName, customerPhone, notes, receiptType });
}

function completeSale(paymentType, customerData) {
  if (state.cart.length === 0) return;
  const modoPago = paymentType || "contado";
  const isCredit = modoPago === "credito";
  const subtotal = getCartTotal();
  const itbis = subtotal * ITBIS_RATE;
  const interest = isCredit ? subtotal * 0.05 : 0;
  const finalTotal = subtotal + itbis + interest;
  const receiptType = customerData.receiptType || "normal";

  const sale = {
    id: Date.now(),
    items: state.cart.map((i) => {
      const raw = i.price * i.quantity;
      const hiddenDiscount = i.hiddenDiscountPct || 0;
      const lineDiscount = raw * hiddenDiscount;
      return {
        id: i.id,
        name: i.name,
        barcode: i.barcode,
        quantity: i.quantity,
        price: i.price,
        subtotal: raw - lineDiscount,
      };
    }),
    total: finalTotal,
    subtotal: subtotal,
    itbis: itbis,
    interest: interest,
    paymentType: modoPago,
    user: state.user.username,
    userId: String(state.user.id),
    customerName: customerData.customerName || "",
    customerPhone: customerData.customerPhone || "",
    notes: customerData.notes || "",
    paidAmount: customerData.paidAmount || 0,
    change: (customerData.paidAmount || 0) - finalTotal,
    companyId: String(state.user.companyId || state.user.id),
    receiptType: receiptType,
    created: new Date().toISOString(),
  };
  const products = getProducts();
  const visibleOwners = getVisibleOwners(state.user.id);
  state.cart.forEach((item) => {
    const product = products.find((p) => p.id === item.id);
    if (product && visibleOwners.has(String(product.createdBy))) {
      product.stock -= item.quantity;
    }
  });
  DB.set("products", products);
  saveSaleToCollection(sale, receiptType);
  generateInvoice(sale);

  if (!isCredit && localStorage.getItem("salesstock_cashdrawer") === "yes") {
    openCashDrawer();
  }

  state.cart = [];
  state.modal = null;
  render();
}

function saveSaleToCollection(sale, receiptType) {
  const targetCollection =
    receiptType === "fiscal" ? "sales_fiscal" : "sales_normal";
  const existing = DB.get(targetCollection) || [];
  DB.set(targetCollection, [...existing, sale]);
}

let html5QrCode = null;
let cameraStarting = null; // promesa mientras la cámara arranca
let cameraSession = 0; // identifica cada apertura de cámara

function startCameraScan() {
  const session = ++cameraSession;
  state.modal = { type: "camera" };
  render();

  setTimeout(async () => {
    // Si ya la cerraron antes de arrancar, no hacemos nada
    if (session !== cameraSession || !document.getElementById("camera-reader"))
      return;

    try {
      html5QrCode = new Html5Qrcode("camera-reader");
      const config = {
        fps: 15,
        qrbox: { width: 280, height: 280 },
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
      };
      const onScan = (decodedText) => {
        if (session !== cameraSession) return;
        stopCameraScan().then(() => {
          render();
          scanProductBarcode(decodedText);
        });
      };

      const scanner = html5QrCode;
      cameraStarting = scanner
        .start({ facingMode: "environment" }, config, onScan, () => {})
        .catch(() => scanner.start({}, config, onScan, () => {}));

      await cameraStarting;
    } catch (e) {
      // Si la cerraron mientras arrancaba, el error es normal: se ignora
      if (session === cameraSession) {
        console.error("[CameraScan] Error starting scanner:", e);
        alert(
          "No se pudo iniciar la cámara: " + (e && e.message ? e.message : e),
        );
        state.modal = null;
        render();
      }
    } finally {
      cameraStarting = null;
    }
  }, 100);
}

// Detiene la cámara sin lanzar errores, esté en el estado que esté
async function stopCameraScan() {
  cameraSession++; // invalida cualquier arranque pendiente
  const scanner = html5QrCode;
  html5QrCode = null;

  try {
    if (cameraStarting) await cameraStarting; // espera a que termine de arrancar
  } catch (e) {
    /* ignorar */
  }

  if (scanner) {
    try {
      await scanner.stop();
    } catch (e) {
      /* no estaba corriendo: ignorar */
    }
    try {
      scanner.clear();
    } catch (e) {
      /* ignorar */
    }
  }
  state.modal = null;
}
window.stopCameraScan = stopCameraScan;

function makeQuote(customerData) {
  if (state.cart.length === 0) return;
  const quote = {
    id: "COT-" + Date.now(),
    items: state.cart.map((i) => ({
      id: i.id,
      name: i.name,
      barcode: i.barcode,
      quantity: i.quantity,
      price: i.price,
      subtotal: i.price * i.quantity,
    })),
    total: getCartTotal(),
    user: state.user.username,
    userId: String(state.user.id),
    customerName: customerData.customerName || "",
    customerPhone: customerData.customerPhone || "",
    notes: customerData.notes || "",
    receiptType: customerData.receiptType || "normal",
    created: new Date().toISOString(),
  };
  generateQuoteInvoice(quote);
  state.cart = [];
  render();
  alert("Cotización generada: " + quote.id);
}

function openCashDrawer() {
  // Try to open cash drawer via USB
  // ESC/POS command: ESC p 0 25 250 (some drawers respond to this)
  // Since we can't send raw USB, we use a workaround with printer
  const drawerEnabled = localStorage.getItem("salesstock_cashdrawer");
  if (drawerEnabled === "yes") {
    try {
      // Create a minimal print job to trigger cash drawer
      // Many ESC/POS printers with cash drawer port respond to this
      const cmd = "\x1b" + "p" + "\x00" + "\x19" + "\x96";
      // Try using ActiveX for older browsers or direct print
      const printWindow = window.open("", "", "width=1,height=1");
      if (printWindow) {
        printWindow.document.write("<script>window.close()</script>");
        printWindow.document.close();
        printWindow.close();
      }
    } catch (e) {
      console.log("Cash drawer: cannot trigger");
    }
  }
}

function getUsers() {
  const users = DB.get("users");
  const companyId = getCompanyId();
  if (!companyId) return users;
  return users.filter((u) => String(u.companyId) === companyId);
}
async function saveUser(user) {
  const users = DB.get("users");
  try {
    if (user.id) {
      // Editar: solo se puede cambiar el rol (el usuario es el identificador de la cuenta)
      const visibleUsers = getUsers();
      if (!visibleUsers.find((u) => String(u.id) === String(user.id)))
        return false;
      const idx = users.findIndex((u) => String(u.id) === String(user.id));
      if (idx < 0) return false;
      const role = user.role === "ADMIN" ? "ADMIN" : "USER";
      users[idx] = { ...users[idx], role: role };
      await window.FB_DB.collection("profiles")
        .doc(String(user.id))
        .update({ role: role });
    } else {
      const username = (user.username || "").trim();
      if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
        alert(
          "Usuario inválido: 3 a 30 caracteres, solo letras, números y guión bajo",
        );
        return false;
      }
      if (!user.password || user.password.length < 8) {
        alert("La contraseña debe tener al menos 8 caracteres");
        return false;
      }
      if (
        users.find(
          (u) => String(u.username).toLowerCase() === username.toLowerCase(),
        )
      ) {
        alert("Ese nombre de usuario ya está registrado");
        return false;
      }

      // Correo opcional: con correo real la persona entra con él y puede recuperar su contraseña
      let email = String(user.email || "")
        .trim()
        .toLowerCase();
      if (email && !isRealEmail(email)) {
        alert("Escribe un correo válido o deja el campo vacío");
        return false;
      }
      if (!email) email = authEmail(username);
      const uid = await window.App.Services.FirebaseAuth.createUserNoSwitch(
        email,
        user.password,
        { sendVerification: isRealEmail(email) },
      );
      const role = user.role === "ADMIN" ? "ADMIN" : "USER";
      const companyId = String(state.user.companyId || state.user.id);
      const now = new Date().toISOString();
      const createdBy = String(state.user.id);

      await window.FB_DB.collection("profiles").doc(uid).set({
        uid: uid,
        username: username,
        email: email,
        role: role,
        companyId: companyId,
        createdBy: createdBy,
        created: now,
      });
      users.push({
        id: uid,
        username: username,
        email: email,
        role: role,
        created: now,
        createdBy: createdBy,
        companyId: companyId,
        licensed: true,
      });
    }
    await DB.set("users", users);
    return true;
  } catch (e) {
    console.error("saveUser error", e);
    alert(
      e && e.code === "permission-denied"
        ? "No tienes permiso para esta acción"
        : mapAuthError(e),
    );
    return false;
  }
}

async function deleteUser(id) {
  const visibleUsers = getUsers();
  if (!visibleUsers.find((u) => String(u.id) === String(id))) return;
  // Sin perfil, la cuenta ya no puede leer ni escribir datos
  try {
    await window.FB_DB.collection("profiles").doc(String(id)).delete();
  } catch (e) {
    console.warn("No se pudo borrar el perfil", e);
  }
  await DB.set(
    "users",
    DB.get("users").filter((u) => String(u.id) !== String(id)),
  );
}

async function confirmDeleteUser(id) {
  const u = getUsers().find((x) => String(x.id) === String(id));
  const ok = await showConfirm(
    "¿Eliminar al usuario " + (u ? u.username : "") + "?",
    {
      title: "Eliminar usuario",
      icon: "👤",
      confirmText: "Eliminar",
      danger: true,
    },
  );
  if (!ok) return;
  await deleteUser(id);
  render();
}
window.confirmDeleteUser = confirmDeleteUser;

function testScanner() {
  state.testResult =
    '<div style="color:#f59e0b">⏳ Escanee un código con el lector... (10 segundos)</div>';
  render();
  let scanned = false;
  const timeout = setTimeout(() => {
    if (!scanned) {
      state.testResult =
        '<div style="color:#ef4444">❌ Lector no detectado. Verifique que esté conectado como teclado USB</div>';
      render();
    }
  }, 10000);
  const handler = (e) => {
    clearTimeout(timeout);
    scanned = true;
    const code = e.key;
    document.removeEventListener("keydown", handler);
    if (code && code.length > 0) {
      state.testResult =
        '<div style="color:#10b981">✅ Lector conectado: código "' +
        code +
        '"</div>';
    } else {
      state.testResult =
        '<div style="color:#ef4444">❌ Sin lectura. Verifique conexión</div>';
    }
    render();
  };
  document.addEventListener("keydown", handler);
}
function getStats() {
  const sales = getVisibleSales();
  const today = localDateStr(new Date());
  const todaySales = sales.filter((s) => localDateStr(s.created) === today);
  const fiados = getVisibleFiados();
  const pendingFiados = fiados.filter((f) => f.status === "pending");
  const paidFiados = fiados.filter((f) => f.status === "paid");

  return {
    totalProducts: getProducts().length,
    todaySales: todaySales.reduce((sum, s) => sum + s.total, 0),
    totalUsers: getUsers().length,
    pendingFiados: pendingFiados.reduce(
      (sum, f) => sum + (f.balance || f.total),
      0,
    ),
    totalFiados: fiados.length,
    paidFiados: paidFiados.length,
  };
}

const fmtMoney = (v) => "RD$" + v.toFixed(2);
const fmtMoneyInvoice = (v) => "RD$ " + Number(v).toFixed(2);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const roundPeso = (n) => Math.round(Number(n) || 0);
const fmtDate = (d) =>
  new Date(d).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const ITBIS_RATE = 0.18;
const PAGE_W = 80;
const MARGIN_X = 8;
const INNER_W = PAGE_W - MARGIN_X * 2;
const FONT = "helvetica";
const LINE_COLOR = [180, 180, 180];
let pdfY = 8;
function abbreviateText(doc, text, maxWidth) {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && doc.getTextWidth(t + "...") > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "...";
}
function pdfLine(doc, x, w, y) {
  doc.setDrawColor(...LINE_COLOR);
  doc.setLineWidth(0.4);
  doc.line(x, y, x + w, y);
}
function pdfTitle(doc, text, y) {
  doc.setFont(FONT, "bold");
  doc.setFontSize(13);
  doc.text(text, PAGE_W / 2, y, { align: "center" });
  return y + 5;
}
function pdfField(doc, label, value, y) {
  doc.setFont(FONT, "bold");
  doc.setFontSize(9);
  doc.text(label, MARGIN_X, y, { align: "left" });
  doc.setFont(FONT, "normal");
  doc.text(String(value), MARGIN_X + INNER_W, y, { align: "right" });
  return y + 5;
}
function pdfCalcInvoiceHeight(sale) {
  const bizName = bizGet("bizname") || "";
  const bizRnc = bizGet("bizrnc") || "";
  const bizPhone = bizGet("bizphone") || "";
  const bizEmail = bizGet("bizemail") || "";
  const bizAddr = bizGet("bizaddress") || "";
  const tmp = new jsPDF({ unit: "mm", format: [80, 1000] });
  let h = 10;
  h += 8;
  if (bizName) h += 4;
  [bizRnc, bizPhone, bizEmail].forEach((v) => {
    if (v) h += 4;
  });
  if (bizAddr) {
    const lines = tmp.splitTextToSize(bizAddr, INNER_W);
    h += lines.length * 3.5;
  }
  h += 4 + 16 + 4;
  if (sale.customerName) h += 5;
  if (sale.customerPhone) h += 5;
  if (sale.notes) {
    const lines = tmp.splitTextToSize(sale.notes, INNER_W);
    h += lines.length * 3.5 + 4;
  }
  h += 4 + 16 + 4;
  sale.items.forEach(() => {
    h += 7 + 2;
  });
  h += 4 + 20 + 4;
  return h;
}

function pdfCalcReportHeight(sales) {
  let h = 10;
  const bizName = bizGet("bizname") || "";
  const bizPhone = bizGet("bizphone") || "";
  const bizEmail = bizGet("bizemail") || "";
  const bizAddr = bizGet("bizaddress") || "";
  const bizRnc = bizGet("bizrnc") || "";
  const tmp = new jsPDF({ unit: "mm", format: [80, 1000] });
  if (bizName) h += 4;
  [bizPhone, bizEmail].forEach((v) => {
    if (v) h += 4;
  });
  if (bizAddr) {
    const lines = tmp.splitTextToSize(bizAddr, INNER_W);
    h += lines.length * 3.5;
  }
  h += 4;
  h += 4;
  h += 4 + 4 + 4 + 4;
  if (bizRnc) h += 4;
  h += 4;
  h += 4;
  h += 5 + 2 + 3;
  h += 4 + 4 * 5 + 1;
  h += 5;
  sales.forEach((s) => {
    const prods = s.items
      .map((i) => i.name + " (" + i.quantity + ")")
      .join(", ");
    const lines = tmp.splitTextToSize(prods, INNER_W - 10);
    h += 3 + lines.length * 3;
  });
  h += 1 + 4 + 4 + 4 + 4 + 5 + 4;
  h += 3 + 3;
  return h;
}

function generateQuoteInvoice(quote) {
  const doc = new jsPDF({
    unit: "mm",
    format: [PAGE_W, pdfCalcInvoiceHeight(quote)],
  });
  let y = MARGIN_X;
  const bizName = bizGet("bizname") || "SALESSTOCK PRO";
  const bizRnc = bizGet("bizrnc") || "";
  const bizPhone = bizGet("bizphone") || "";
  const bizEmail = bizGet("bizemail") || "";
  const bizAddr = bizGet("bizaddress") || "";

  doc.setFont(FONT, "bold");
  doc.setFontSize(15);
  doc.text(bizName, PAGE_W / 2, y, { align: "center" });
  y += 5;
  doc.setFont(FONT, "normal");
  doc.setFontSize(9);
  if (bizPhone) {
    doc.text("Tel: " + bizPhone, PAGE_W / 2, y, { align: "center" });
    y += 4;
  }
  if (bizEmail) {
    doc.text("Email: " + bizEmail, PAGE_W / 2, y, { align: "center" });
    y += 4;
  }
  if (bizAddr) {
    const lines = doc.splitTextToSize(bizAddr, INNER_W);
    doc.text(lines, PAGE_W / 2, y, { align: "center" });
    y += lines.length * 3.5;
  }
  y += 2;
  pdfLine(doc, MARGIN_X, INNER_W, y);
  y += 4;

  y = pdfTitle(doc, "COTIZACIÓN", y);
  doc.setFont(FONT, "normal");
  doc.setFontSize(9);
  doc.text("N° " + quote.id, PAGE_W / 2, y, { align: "center" });
  y += 4;
  if (quote.receiptType === "fiscal" && bizRnc) {
    doc.text("RNC: " + bizRnc, PAGE_W / 2, y, { align: "center" });
    y += 4;
  }
  doc.text(
    "Fecha: " + new Date(quote.created).toLocaleDateString("es-ES"),
    PAGE_W / 2,
    y,
    { align: "center" },
  );
  y += 4;
  doc.text("Vendedor: " + quote.user, PAGE_W / 2, y, { align: "center" });
  y += 4;
  pdfLine(doc, MARGIN_X, INNER_W, y);
  y += 4;

  if (quote.customerName || quote.customerPhone) {
    doc.setFont(FONT, "bold");
    doc.setFontSize(9);
    doc.text("CLIENTE", MARGIN_X, y, { align: "left" });
    y += 4;
    doc.setFont(FONT, "normal");
    if (quote.customerName) y = pdfField(doc, "Nombre:", quote.customerName, y);
    if (quote.customerPhone)
      y = pdfField(doc, "Teléfono:", quote.customerPhone, y);
    y += 1;
    pdfLine(doc, MARGIN_X, INNER_W, y);
    y += 4;
  }

  if (quote.notes) {
    doc.setFont(FONT, "bold");
    doc.setFontSize(9);
    doc.text("NOTAS", MARGIN_X, y, { align: "left" });
    y += 4;
    doc.setFont(FONT, "normal");
    doc.setFontSize(8);
    const lines = doc.splitTextToSize(quote.notes, INNER_W);
    doc.text(lines, MARGIN_X, y, { align: "left" });
    y += lines.length * 3.5 + 2;
    doc.setFontSize(9);
    pdfLine(doc, MARGIN_X, INNER_W, y);
    y += 4;
  }

  doc.setFont(FONT, "bold");
  doc.setFontSize(9);
  const colQty = MARGIN_X;
  const colDescStart = MARGIN_X + 10;
  const colUnit = MARGIN_X + INNER_W - 18;
  const colTotal = MARGIN_X + INNER_W;
  doc.text("CANT", colQty, y, { align: "left" });
  doc.text("DESCRIPCIÓN", colDescStart, y, { align: "left" });
  doc.text("P.U.", colUnit, y, { align: "right" });
  doc.text("TOTAL", colTotal, y, { align: "right" });
  y += 2;
  pdfLine(doc, MARGIN_X, INNER_W, y);
  y += 3;

  doc.setFont(FONT, "normal");
  doc.setFontSize(8);
  quote.items.forEach((item) => {
    const name = abbreviateText(doc, item.name, INNER_W - 22);
    const lineH = 7;
    const pu = "$" + Math.round(item.price);
    const tot = "$" + Math.round(item.subtotal);
    doc.text(String(item.quantity), colQty, y + 1.2, { align: "left" });
    doc.text(name, colDescStart, y + 1.2, { align: "left" });
    doc.text(pu, colUnit, y + 1.2, { align: "right" });
    doc.text(tot, colTotal, y + 1.2, { align: "right" });
    y += lineH + 2;
  });

  y += 1;
  pdfLine(doc, MARGIN_X, INNER_W, y);
  y += 4;

  doc.setFont(FONT, "bold");
  doc.setFontSize(11);
  doc.text("TOTAL: " + fmtMoneyInvoice(quote.total), colTotal, y, {
    align: "right",
  });
  y += 5;

  doc.setFont(FONT, "normal");
  doc.setFontSize(8);
  doc.text("No es venta - Validez: 7 días", PAGE_W / 2, y, { align: "center" });
  y += 4;
  doc.text("Gracias por su preferencia", PAGE_W / 2, y, { align: "center" });

  doc.save("cotizacion-" + quote.id + ".pdf");
  if (printWindow && !printWindow.closed) {
    try {
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      printWindow.location.href = url;
      setTimeout(() => {
        try {
          printWindow.focus();
          printWindow.print();
        } catch (e) {}
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 300);
    } catch (e) {
      setTimeout(() => window.print(), 300);
    }
  } else {
    setTimeout(() => window.print(), 300);
  }
}

function buildInvoiceDocument(sale, pageH) {
  // Primera pasada: dibuja en una página muy alta para medir el contenido real.
  // Segunda pasada: crea el PDF con la altura exacta.
  if (!pageH) {
    const probe = buildInvoiceDocument(sale, 2000);
    return buildInvoiceDocument(sale, probe._endY + MARGIN_X);
  }

  const doc = new jsPDF({ unit: "mm", format: [PAGE_W, pageH] });
  let y = MARGIN_X;
  const bizName = bizGet("bizname") || "SALESSTOCK PRO";
  const bizRnc = bizGet("bizrnc") || "";
  const bizPhone = bizGet("bizphone") || "";
  const bizEmail = bizGet("bizemail") || "";
  const bizAddr = bizGet("bizaddress") || "";

  doc.setFont(FONT, "bold");
  doc.setFontSize(15);
  doc.text(bizName, PAGE_W / 2, y, { align: "center" });
  y += 5;
  doc.setFont(FONT, "normal");
  doc.setFontSize(9);
  if (bizPhone) {
    doc.text("Tel: " + bizPhone, PAGE_W / 2, y, { align: "center" });
    y += 4;
  }
  if (bizEmail) {
    doc.text("Email: " + bizEmail, PAGE_W / 2, y, { align: "center" });
    y += 4;
  }
  if (bizAddr) {
    const lines = doc.splitTextToSize(bizAddr, INNER_W);
    doc.text(lines, PAGE_W / 2, y, { align: "center" });
    y += lines.length * 3.5;
  }
  y += 2;
  pdfLine(doc, MARGIN_X, INNER_W, y);
  y += 4;

  y = pdfTitle(
    doc,
    sale.receiptType === "fiscal" ? "COMPROBANTE FISCAL" : "FACTURA",
    y,
  );
  doc.setFont(FONT, "normal");
  doc.setFontSize(9);
  doc.text("N° " + sale.id, PAGE_W / 2, y, { align: "center" });
  y += 4;
  if (sale.receiptType === "fiscal" && bizRnc) {
    doc.text("RNC: " + bizRnc, PAGE_W / 2, y, { align: "center" });
    y += 4;
  }
  doc.text(
    "Fecha: " +
      new Date(sale.created).toLocaleDateString("es-ES") +
      " " +
      new Date(sale.created).toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    PAGE_W / 2,
    y,
    { align: "center" },
  );
  y += 4;
  doc.text("Cajero: " + sale.user, PAGE_W / 2, y, { align: "center" });
  y += 4;
  pdfLine(doc, MARGIN_X, INNER_W, y);
  y += 4;

  if (sale.customerName || sale.customerPhone) {
    doc.setFont(FONT, "bold");
    doc.setFontSize(9);
    doc.text("CLIENTE", MARGIN_X, y, { align: "left" });
    y += 4;
    doc.setFont(FONT, "normal");
    if (sale.customerName) y = pdfField(doc, "Nombre:", sale.customerName, y);
    if (sale.customerPhone)
      y = pdfField(doc, "Teléfono:", sale.customerPhone, y);
    y += 1;
    pdfLine(doc, MARGIN_X, INNER_W, y);
    y += 4;
  }

  if (sale.notes) {
    doc.setFont(FONT, "bold");
    doc.setFontSize(9);
    doc.text("NOTAS", MARGIN_X, y, { align: "left" });
    y += 4;
    doc.setFont(FONT, "normal");
    doc.setFontSize(8);
    const lines = doc.splitTextToSize(sale.notes, INNER_W);
    doc.text(lines, MARGIN_X, y, { align: "left" });
    y += lines.length * 3.5 + 2;
    doc.setFontSize(9);
    pdfLine(doc, MARGIN_X, INNER_W, y);
    y += 4;
  }

  // ===== TABLA DE PRODUCTOS (mismo formato que la cotización) =====
  doc.setFont(FONT, "bold");
  doc.setFontSize(9);
  const colQty = MARGIN_X;
  const colDescStart = MARGIN_X + 10;
  const colUnit = MARGIN_X + INNER_W - 18;
  const colTotal = MARGIN_X + INNER_W;
  doc.text("CANT", colQty, y, { align: "left" });
  doc.text("DESCRIPCIÓN", colDescStart, y, { align: "left" });
  doc.text("P.U.", colUnit, y, { align: "right" });
  doc.text("TOTAL", colTotal, y, { align: "right" });
  y += 2;
  pdfLine(doc, MARGIN_X, INNER_W, y);
  y += 3;

  doc.setFont(FONT, "normal");
  doc.setFontSize(8);
  sale.items.forEach((item) => {
    const pu = "$" + Math.round(item.price);
    const tot = "$" + Math.round(item.subtotal);
    const lineH = 7;
    const puWidth = doc.getTextWidth(pu);
    const nameMaxW = colUnit - puWidth - 2 - colDescStart;
    const name = abbreviateText(doc, item.name, nameMaxW);
    doc.text(String(item.quantity), colQty, y + 1.2, { align: "left" });
    doc.text(name, colDescStart, y + 1.2, { align: "left" });
    doc.text(pu, colUnit, y + 1.2, { align: "right" });
    doc.text(tot, colTotal, y + 1.2, { align: "right" });
    y += lineH + 2;
  });

  y += 1;
  pdfLine(doc, MARGIN_X, INNER_W, y);
  y += 5;

  doc.setFont(FONT, "normal");
  doc.setFontSize(10);
  doc.text("Subtotal: " + fmtMoneyInvoice(sale.subtotal), colTotal, y, {
    align: "right",
  });
  y += 5;
  doc.text("ITBIS (18%): " + fmtMoneyInvoice(sale.itbis), colTotal, y, {
    align: "right",
  });
  y += 5;
  if (sale.paymentType === "credito") {
    doc.text("Interés (5%): " + fmtMoneyInvoice(sale.interest), colTotal, y, {
      align: "right",
    });
    y += 5;
  }
  doc.setFont(FONT, "bold");
  doc.setFontSize(12);
  doc.text("TOTAL: " + fmtMoneyInvoice(sale.total), colTotal, y, {
    align: "right",
  });
  y += 5;

  if (sale.paidAmount > 0 || sale.change !== undefined) {
    doc.setFont(FONT, "normal");
    doc.setFontSize(9);
    doc.text("Pagado:", colTotal, y - 1, { align: "right" });
    y += 5;
    doc.setFont(FONT, "bold");
    doc.setFontSize(11);
    doc.text(fmtMoneyInvoice(sale.paidAmount || 0), colTotal, y, {
      align: "right",
    });
    y += 5;
    doc.setFont(FONT, "normal");
    doc.setFontSize(9);
    doc.text("Cambio:", colTotal, y - 1, { align: "right" });
    y += 5;
    doc.setFont(FONT, "bold");
    doc.setFontSize(11);
    doc.text(fmtMoneyInvoice(Math.max(0, sale.change || 0)), colTotal, y, {
      align: "right",
    });
    y += 6;
  }

  doc.setFont(FONT, "normal");
  doc.setFontSize(8);
  if (sale.paymentType === "credito") {
    doc.text("*** PAGO A CRÉDITO ***", PAGE_W / 2, y, { align: "center" });
    y += 4;
    doc.text("Se cobrará 5% extra en 30 días", PAGE_W / 2, y, {
      align: "center",
    });
  } else {
    doc.text("¡GRACIAS POR SU COMPRA!", PAGE_W / 2, y, { align: "center" });
  }
  y += 4;
  pdfLine(doc, MARGIN_X, INNER_W, y);
  y += 6;

  const ticketBarcodeY = y;
  const ticketCanvas = document.createElement("canvas");
  ticketCanvas.width = 300;
  ticketCanvas.height = 80;
  try {
    JsBarcode(ticketCanvas, String(sale.id), {
      format: "CODE128",
      lineColor: "#000000",
      width: 1.5,
      height: 32,
      displayValue: true,
      fontSize: 10,
      margin: 4,
    });
    const ticketImgData = ticketCanvas.toDataURL("image/png");
    doc.addImage(
      ticketImgData,
      "PNG",
      MARGIN_X + 8,
      ticketBarcodeY,
      INNER_W - 16,
      11,
    );
    y = ticketBarcodeY + 13;
  } catch (e) {
    doc.setFontSize(9);
    doc.text("Factura: " + sale.id, PAGE_W / 2, ticketBarcodeY + 4, {
      align: "center",
    });
    y = ticketBarcodeY + 8;
  }

  y += 4;
  doc.setDrawColor(...LINE_COLOR);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, MARGIN_X + INNER_W, y);

  // Guarda hasta dónde llegó el contenido (lo usa la primera pasada)
  doc._endY = y;
  return doc;
}
function generateInvoice(sale) {
  const doc = buildInvoiceDocument(sale);
  doc.save("venta-" + sale.id + ".pdf");
  if (printWindow && !printWindow.closed) {
    try {
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      printWindow.location.href = url;
      setTimeout(() => {
        try {
          printWindow.focus();
          printWindow.print();
        } catch (e) {}
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 300);
    } catch (e) {
      setTimeout(() => window.print(), 300);
    }
  } else {
    setTimeout(() => window.print(), 300);
  }
}

function render() {
  function showInvoicePreview(doc) {
    closeInvoicePreview();
    const url = URL.createObjectURL(doc.output("blob"));
    state.previewInvoicePdfUrl = url;

    const overlay = document.createElement("div");
    overlay.id = "invoice-preview-float";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.6)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
      zIndex: "999998",
    });

    overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;width:100%;max-width:440px;height:calc(100vh - 32px);max-height:900px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.4)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:1px solid #e2e8f0">
        <h2 style="margin:0;font-size:16px;color:#1e293b">Previsualización de Factura</h2>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" onclick="printPreviewInvoice()">🖨️ Imprimir</button>
          <button class="btn btn-secondary btn-sm" onclick="closeInvoicePreview()">✕ Cerrar</button>
        </div>
      </div>
      <div style="flex:1;background:#e2e8f0;padding:12px;box-sizing:border-box;display:flex;justify-content:center">
        <iframe id="invoice-preview-frame"
          src="${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH"
          style="width:100%;height:100%;border:none;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,.2)"></iframe>
      </div>
    </div>
  `;

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeInvoicePreview();
    });

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onPreviewKey);
  }

  function onPreviewKey(e) {
    if (e.key === "Escape") closeInvoicePreview();
  }

  function closeInvoicePreview() {
    document.removeEventListener("keydown", onPreviewKey);
    const overlay = document.getElementById("invoice-preview-float");
    if (overlay) overlay.remove();
    if (state.previewInvoicePdfUrl) {
      URL.revokeObjectURL(state.previewInvoicePdfUrl);
      state.previewInvoicePdfUrl = "";
    }
  }

  function printPreviewInvoice() {
    const frame = document.getElementById("invoice-preview-frame");
    if (!frame) return;
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (e) {
      // Plan B: si el navegador bloquea la impresión desde la ventana flotante
      if (state.previewInvoicePdfUrl)
        window.open(state.previewInvoicePdfUrl, "_blank");
    }
  }

  function previewSaleInvoice(saleId) {
    try {
      const sale = getVisibleSales().find((s) => s.id === saleId);
      if (!sale) {
        alert("Venta no encontrada o no autorizada");
        return;
      }
      showInvoicePreview(buildInvoiceDocument(sale));
    } catch (e) {
      alert("Error al cargar la previsualización: " + e.message);
      console.error(e);
    }
  }

  function previewFiadoInvoice(fiadoId) {
    try {
      const fiado = getFiadoById(fiadoId);
      if (!fiado) {
        alert("Credito no encontrado");
        return;
      }
      showInvoicePreview(buildFiadoDocument(fiado));
    } catch (e) {
      alert("Error al cargar la previsualización: " + e.message);
      console.error(e);
    }
  }
  // Imprime un PDF directo, sin abrir ventanas ni previsualización
  function printPdfDirect(doc) {
    const url = URL.createObjectURL(doc.output("blob"));
    const frame = document.createElement("iframe");
    Object.assign(frame.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: "400px",
      height: "600px",
      border: "0",
    });
    frame.src = url;

    const cleanup = () => {
      setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, 60000);
    };

    frame.onload = () => {
      setTimeout(() => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch (e) {
          // Plan B: si el navegador bloquea la impresión directa
          window.open(url, "_blank");
        }
        cleanup();
      }, 400);
    };

    document.body.appendChild(frame);
  }

  const app = document.getElementById("app");
  if (state.loading) {
    app.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center"><div style="font-size:40px;margin-bottom:16px">⏳</div><div style="color:#64748b;font-weight:600">Cargando SalesStock Pro...</div></div></div>';
    return;
  }
  if (!state.user) {
    app.innerHTML = renderLogin();
    return;
  }
  if (state.page === "activate-license") {
    app.innerHTML = renderActivateLicense();
    return;
  }
  try {
    localStorage.setItem("salesstock_bizname", bizCustomName());
  } catch (e) {}
  const lowStock = getLowStock();
  const showAlert = lowStock.length > 0 && !state.alertDismissed;
  app.innerHTML = `
    <div class="app">
      <div class="topbar">
        <button class="menu-btn" onclick="toggleMenu()" aria-label="Abrir menú">☰</button>
        <div class="topbar-title">${escapeHtml(bizCustomName() || DEFAULT_BRAND)}</div>
      </div>
      <div class="menu-backdrop" onclick="toggleMenu()"></div>
      <div class="sidebar">
        <div class="logo" style="overflow-wrap:anywhere;line-height:1.15;font-size:${bizCustomName().length > 24 ? 16 : bizCustomName().length > 14 ? 19 : 24}px">${brandHtml(bizCustomName())}</div>
        <nav class="nav">
          <div class="nav-link ${state.page === "sales" ? "active" : ""}" onclick="state.page='sales';state.testResult='';render()">💰 Punto de Venta</div>
           <div class="nav-link ${state.page === "fiados" ? "active" : ""}" onclick="state.page='fiados';state.testResult='';render()">💳 Creditos</div>
          <div class="nav-link ${state.page === "products" ? "active" : ""}" onclick="state.page='products';state.testResult='';render()">📦 Productos</div>
           <div class="nav-link ${state.page === "reports" ? "active" : ""}" onclick="state.page='reports';state.testResult='';render()">📈 Reportes</div>
           <div class="nav-link ${state.page === "dashboard" ? "active" : ""}" onclick="state.page='dashboard';state.testResult='';render()">📊 Dashboard</div>
          ${
            state.user.role === "ADMIN"
              ? `
            <div class="nav-link ${state.page === "users" ? "active" : ""}" onclick="state.page='users';state.testResult='';render()">👥 Usuarios</div>
          `
              : ""
          }
          ${
            String(state.user.id) === "1" &&
            state.user.username === "Sistemapro"
              ? `
            <div class="nav-link ${state.page === "licenses" ? "active" : ""}" onclick="state.page='licenses';state.testResult='';render()">🔑 Licencias</div>
          `
              : ""
          }
        </nav>
        <div class="user-info">
          <div class="avatar">${state.user.username[0].toUpperCase()}</div>
          <div class="user-details">
            <div class="user-name">${state.user.username}</div>
            <div class="user-role">${state.user.role === "ADMIN" ? "Administrador" : "Usuario"}</div>
          </div>
        </div>
        <button class="btn btn-secondary" style="width:100%;margin-top:12px" onclick="logout()">Cerrar Sesión</button>
      </div>
      <main class="main ${showAlert ? "main-with-alert" : ""}">
        ${renderAccountBanner()}
        ${renderPage()}
      </main>
    </div>
    ${showAlert ? renderLowStockAlert(lowStock) : ""}
    ${state.modal ? renderModal() : ""}
    ${state.modal && state.modal.type === "newFiado" ? renderNewFiadoModal() : ""}
  `;
  hideScannerDropdownIfNotProductSearch();
}

function toggleMenu() {
  const app = document.querySelector(".app");
  if (app) app.classList.toggle("menu-open");
}
window.toggleMenu = toggleMenu;

function hideScannerDropdownIfNotProductSearch() {
  const dropdown = document.getElementById("scanner-dropdown");
  if (!dropdown) return;
  if (state.page !== "sales" || state.modal) {
    dropdown.style.display = "none";
  }
}

function renderLowStockAlert(lowStock) {
  const items = lowStock.map((p) => `${p.name}`).join(", ");
  return `
    <div class="alert-container" onclick="this.style.display='none'">
      <div class="alert-box" onclick="event.stopPropagation();state.page='products';state.search='';render()">
        <div class="alert-icon">⚠️</div>
        <div class="alert-content">
          <div class="alert-title">⚡ ALERTA: Stock Bajo</div>
          <div class="alert-subtitle">${items}</div>
        </div>
        <button class="alert-close" onclick="state.alertDismissed=true;render()">✕</button>
      </div>
    </div>
  `;
}
let dbReadyPromise = null;
function ensureDB(companyId) {
  if (!dbReadyPromise) {
    dbReadyPromise = window.App.Services.DB.init(companyId).catch((e) => {
      dbReadyPromise = null;
      throw e;
    });
  }
  return dbReadyPromise;
}
function renderLogin() {
  const tabs = `
    <div class="login-tabs">
      <button class="login-tab ${state.loginTab === "login" ? "active" : ""}" onclick="state.loginTab='login';state.loginError='';state.registerLicenseOk=false;state.registerLicenseKey='';render()">Iniciar Sesión</button>
      <button class="login-tab ${state.loginTab === "register" ? "active" : ""}" onclick="state.loginTab='register';state.loginError='';state.registerLicenseOk=false;state.registerLicenseKey='';render()">Registrarse</button>
    </div>
  `;

  const loginForm = `
    <form onsubmit="event.preventDefault();login(this.u.value,this.p.value)">
      ${state.loginError ? '<div style="background:#fee2e2;color:#dc2626;padding:12px;border-radius:8px;margin-bottom:15px;text-align:center;font-weight:600">' + state.loginError + "</div>" : ""}
      <div class="form-group">
        <label>Usuario o correo</label>
        <input class="form-control" name="u" type="text" autocomplete="username" placeholder="usuario o correo@ejemplo.com" required>
      </div>
      <div class="form-group">
        <label>Contraseña</label>
        <input type="password" class="form-control" name="p" autocomplete="current-password" placeholder="Contraseña" required>
      </div>
      <div style="text-align:right;margin:-4px 0 14px">
        <button type="button" onclick="startForgot()" style="background:none;border:none;padding:0;color:#2563eb;font-weight:600;font-size:13px;cursor:pointer;text-decoration:underline">¿Olvidaste tu contraseña o usuario?</button>
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%">Iniciar Sesión</button>
    </form>
`;

  const forgotBlocked = state.forgotBusy || Date.now() < (state.forgotUntil || 0);
  const forgotForm = `
    <form onsubmit="event.preventDefault();sendResetEmail(this.fe.value)">
      ${state.loginError ? '<div style="background:#fee2e2;color:#dc2626;padding:12px;border-radius:8px;margin-bottom:15px;text-align:center;font-weight:600">' + escapeHtml(state.loginError) + "</div>" : ""}
      ${state.forgotMsg ? '<div style="background:#dcfce7;color:#166534;padding:12px;border-radius:8px;margin-bottom:15px;font-weight:600;font-size:14px;line-height:1.45">' + escapeHtml(state.forgotMsg) + "</div>" : ""}
      <h2 style="font-size:18px;margin-bottom:6px">Recuperar acceso</h2>
      <p style="color:#64748b;font-size:14px;line-height:1.5;margin-bottom:14px">Escribe el correo de tu cuenta y te enviaremos un enlace para crear una contraseña nueva.</p>
      <div class="form-group">
        <label>Correo</label>
        <input class="form-control" name="fe" type="email" inputmode="email" autocomplete="email" placeholder="correo@ejemplo.com" value="${escapeHtml(state.forgotEmail || "")}" required>
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%" ${forgotBlocked ? "disabled" : ""}>${state.forgotBusy ? "Enviando..." : "Enviar enlace"}</button>
      <div style="background:#f0f9ff;border:1px solid #bae6fd;color:#0369a1;padding:10px 12px;border-radius:8px;margin-top:14px;font-size:13px;line-height:1.5">
        <strong>¿Olvidaste tu usuario?</strong> Si ya registraste tu correo, entra con el correo en lugar del usuario. Si tu cuenta es antigua y nunca registraste un correo, pide ayuda a tu administrador.
      </div>
      <button type="button" class="btn btn-secondary" style="width:100%;margin-top:12px" onclick="state.loginTab='login';state.loginError='';state.forgotMsg='';render()">Volver al inicio de sesión</button>
    </form>
  `;

  const registerForm = state.registerLicenseOk
    ? `
    <form onsubmit="event.preventDefault();registerUser(this.ru.value,this.re.value,this.rp.value,this.rp2.value)">
      ${state.loginError ? '<div style="background:#fee2e2;color:#dc2626;padding:12px;border-radius:8px;margin-bottom:15px;text-align:center;font-weight:600">' + state.loginError + "</div>" : ""}
      <div class="form-group">
        <label>Usuario</label>
        <input class="form-control" name="ru" type="text" autocomplete="username" placeholder="nombre de usuario" required>
      </div>
      <div class="form-group">
        <label>Correo personal</label>
        <input class="form-control" name="re" type="email" inputmode="email" autocomplete="email" placeholder="correo@ejemplo.com" required>
        <small style="display:block;color:#64748b;margin-top:4px">Con este correo entrarás y podrás recuperar tu contraseña. Te enviaremos un enlace para verificarlo.</small>
      </div>
      <div class="form-group">
        <label>Contraseña</label>
        <input type="password" class="form-control" name="rp" autocomplete="new-password" placeholder="Mínimo 8 caracteres" minlength="8" required>
      </div>
      <div class="form-group">
        <label>Confirmar contraseña</label>
        <input type="password" class="form-control" name="rp2" placeholder="Repite la contraseña" required>
      </div>
      <div style="background:#f0f9ff;border:1px solid #bae6fd;color:#0369a1;padding:10px 12px;border-radius:8px;margin-bottom:15px;font-size:13px">
        Clave de licencia ingresada: <strong>${state.registerLicenseKey}</strong>
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%">Crear cuenta</button>
      <button type="button" class="btn btn-secondary" style="width:100%;margin-top:10px" onclick="state.registerLicenseOk=false;state.registerLicenseKey='';state.loginError='';render()">Cambiar licencia</button>
    </form>
  `
    : `
    <form onsubmit="event.preventDefault();validateRegisterLicense(this.lk.value)">
      ${state.loginError ? '<div style="background:#fee2e2;color:#dc2626;padding:12px;border-radius:8px;margin-bottom:15px;text-align:center;font-weight:600">' + state.loginError + "</div>" : ""}
      <div class="form-group">
        <label>Clave de Licencia</label>
        <input class="form-control" name="lk" type="text" placeholder="PRO-2024-XXXX-XXXX" required>
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%">Validar licencia</button>
    </form>
  `;

  return `
    <div class="login-container">
      <div class="login-card">
        <div class="login-logo">
          <h1>${brandHtml(cachedBizName())}</h1>
          <p>Sistema de Gestión de Ventas e Inventario</p>
        </div>
        ${state.loginTab === "forgot" ? "" : tabs}
        ${state.loginTab === "forgot" ? forgotForm : state.loginTab === "register" ? registerForm : loginForm}
        <div style="margin-top:16px;text-align:center;font-size:11px;color:#94a3b8">Versión ${APP_VERSION}</div>
      </div>
    </div>
  `;
}

function renderActivateLicense() {
  return `
    <div class="login-container">
      <div class="login-card">
        <div class="login-logo">
          <h1>${brandHtml(cachedBizName())}</h1>
          <p>Activar Licencia</p>
        </div>
        ${renderAccountBanner()}
        ${state.loginError ? '<div style="background:#fee2e2;color:#dc2626;padding:12px;border-radius:8px;margin-bottom:15px;text-align:center;font-weight:600">' + state.loginError + "</div>" : ""}
        <p style="margin-bottom:20px;color:#64748b;text-align:center">Ingrese la clave de licencia de su empresa para activar todas las funciones.</p>
         <form onsubmit="event.preventDefault();activateLicense(this.lk.value)">
           <div class="form-group">
             <label>Clave de Licencia</label>
             <input class="form-control" name="lk" type="text" placeholder="PRO-2024-XXXX-XXXX" required>
           </div>
           <button type="submit" class="btn btn-primary" style="width:100%">Activar Licencia</button>
           <div style="margin-top:10px;text-align:center">
             <button type="button" class="btn btn-secondary" style="font-size:11px;padding:5px 10px" onclick="state.modal={type:'terms'};render()">📄 Términos y Condiciones</button>
           </div>
         </form>
        <div style="margin-top:18px;text-align:center">
          <button class="btn btn-secondary" style="width:100%" onclick="logout()">Cerrar Sesión</button>
        </div>
      </div>
    </div>
  `;
}

function getFiados() {
  const fiados = DB.get("fiados");
  const companyId = getCompanyId();
  if (!companyId) return fiados;
  return fiados.filter((f) => String(f.companyId) === companyId);
}
function getVisibleFiados() {
  const fiados = getFiados();
  if (!state.user) return fiados;
  if (String(state.user.id) === "1") return fiados;
  const visibleOwners = getVisibleOwners(state.user.id);
  return fiados.filter((f) => {
    const owner = String(f.userId || f.user);
    return owner === String(state.user.id) || visibleOwners.has(owner);
  });
}

function saveFiado(fiado) {
  const fiados = DB.get("fiados");
  if (fiado.id) {
    const idx = fiados.findIndex((f) => f.id === fiado.id);
    if (idx >= 0)
      fiados[idx] = {
        ...fiados[idx],
        ...fiado,
        updated: new Date().toISOString(),
      };
  } else {
    fiado.id = Date.now();
    fiado.created = new Date().toISOString();
    if (!fiado.companyId)
      fiado.companyId = String(state.user.companyId || state.user.id);
    fiados.push(fiado);
  }
  DB.set("fiados", fiados);
}

function getFiadoById(id) {
  return getFiados().find((f) => f.id === id);
}

function addPaymentToFiado(fiadoId, amount) {
  const fiados = DB.get("fiados");
  const fiado = fiados.find((f) => f.id === fiadoId);
  if (!fiado) return;

  const payment = {
    id: Date.now(),
    amount: parseFloat(amount),
    date: new Date().toISOString(),
  };

  fiado.paid = roundPeso((fiado.paid || 0) + payment.amount);
  fiado.balance = roundPeso(fiado.total - fiado.paid);
  fiado.payments = fiado.payments || [];
  fiado.payments.push(payment);

  if (fiado.balance <= 0) {
    fiado.status = "paid";
    fiado.balance = 0;
  }

  DB.set("fiados", fiados);
}

function createFiadoFromCart(customerName, customerPhone, notes) {
  if (state.cart.length === 0) return alert("El carrito está vacío");

  const subtotal = getCartTotal();
  const itbis = subtotal * ITBIS_RATE;
  const total = roundPeso(subtotal + itbis);

  // Decrease stock
  const products = getProducts();
  const visibleOwners = getVisibleOwners(state.user.id);
  state.cart.forEach((item) => {
    const product = products.find((p) => p.id === item.id);
    if (product && visibleOwners.has(String(product.createdBy))) {
      product.stock -= item.quantity;
    }
  });
  DB.set("products", products);

  const fiado = {
    customerName: customerName,
    customerPhone: customerPhone,
    notes: notes,
    items: state.cart.map((i) => {
      const raw = i.price * i.quantity;
      const hiddenDiscount = i.hiddenDiscountPct || 0;
      const lineDiscount = raw * hiddenDiscount;
      return {
        id: i.id,
        name: i.name,
        barcode: i.barcode,
        quantity: i.quantity,
        price: i.price,
        subtotal: raw - lineDiscount,
      };
    }),
    subtotal: subtotal,
    itbis: itbis,
    total: total,
    paid: 0,
    balance: total,
    payments: [],
    status: "pending",
    user: state.user.username,
    userId: String(state.user.id),
    companyId: String(state.user.companyId || state.user.id),
  };

  saveFiado(fiado);
  state.cart = [];
  state.modal = null;
  state.page = "fiados";
  render();
  alert(
    "Credito creado: " + customerName + " - Total: " + fmtMoneyInvoice(total),
  );
  printFiadoReceipt(fiado);
}

function printFiadoReceipt(fiado) {
  if (!fiado) return;
  const doc = new jsPDF({ unit: "mm", format: [80, 120] });
  const x = 8;
  let y = 10;
  const maxW = 64;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text((bizGet("bizname") || "SalesStock Pro").toUpperCase(), 40, y, {
    align: "center",
  });
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("RECIBO DE CREDITO", 40, y, { align: "center" });
  y += 5;
  pdfLine(doc, x, maxW, y);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Cliente:", x, y);
  doc.setFont("helvetica", "normal");
  doc.text(fiado.customerName || "Cliente", x + 18, y);
  y += 5;

  if (fiado.customerPhone) {
    doc.setFont("helvetica", "bold");
    doc.text("Telefono:", x, y);
    doc.setFont("helvetica", "normal");
    doc.text(fiado.customerPhone, x + 18, y);
    y += 5;
  }

  doc.setFont("helvetica", "bold");
  doc.text("Fecha:", x, y);
  doc.setFont("helvetica", "normal");
  doc.text(new Date(fiado.created).toLocaleString("es-ES"), x + 15, y);
  y += 5;
  pdfLine(doc, x, maxW, y);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("DETALLE", x, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  (fiado.items || []).forEach((item) => {
    const name = item.name || "";
    const qty = item.quantity || 1;
    const line = name + " x" + qty;
    const lines = doc.splitTextToSize(line, maxW);
    doc.text(lines, x, y);
    y += lines.length * 4;
  });
  y += 2;
  pdfLine(doc, x, maxW, y);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Total:", x, y);
  doc.text(fmtMoneyInvoice(fiado.total), x + 18, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Pagado:", x, y);
  doc.text(fmtMoneyInvoice(fiado.paid || 0), x + 18, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Saldo Pendiente:", x, y);
  doc.text(fmtMoneyInvoice(fiado.balance || fiado.total), x + 35, y);
  y += 8;
  pdfLine(doc, x, maxW, y);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("IMPORTE A PAGAR", 40, y, { align: "center" });
  y += 6;
  doc.setFontSize(16);
  doc.text(fmtMoneyInvoice(fiado.balance || fiado.total), 40, y, {
    align: "center",
  });
  y += 6;
  pdfLine(doc, x, maxW, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Gracias por su compra", 40, y, { align: "center" });

  doc.save("credito-" + (fiado.id || Date.now()) + ".pdf");
  const win = window.open("", "_blank", "width=400,height=600");
  if (win) {
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    win.location.href = url;
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch (e) {}
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 400);
  }
}

function renderFiados() {
  const fiados = getVisibleFiados().filter((f) => f.status === "pending");
  const paidFiados = getVisibleFiados().filter((f) => f.status === "paid");

  return `
    <div class="header"><h1>Creditos</h1><button class="btn btn-primary" onclick="state.modal={type:'newFiado'};render()">+ Nuevo Credito</button></div>
    <div class="card" style="margin-bottom:24px">
      <div class="card-header"><h2 class="card-title">Creditos Pendientes</h2></div>
      <div style="padding:24px">
        ${
          fiados.length
            ? `<table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Teléfono</th>
              <th>Total</th>
              <th>Pagado</th>
              <th>Saldo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${fiados
              .map(
                (f) => `
              <tr>
                <td><strong>${escapeHtml(f.customerName)}</strong></td>
                <td>${escapeHtml(f.customerPhone || "-")}</td>
                <td>${fmtMoneyInvoice(f.total)}</td>
                <td class="text-success">${fmtMoneyInvoice(f.paid || 0)}</td>
                <td class="text-danger" style="font-weight:600">${fmtMoneyInvoice(f.balance || f.total)}</td>
                <td>
                  <button class="btn btn-warning btn-sm" onclick="showAddPaymentModal(${f.id})" title="Agregar abono">💵 Abono</button>
                  <button class="btn btn-info btn-sm" onclick="previewFiadoInvoice(${f.id})" title="Ver e imprimir factura">👁️ Ver / Imprimir</button>
                  <button class="btn btn-danger btn-sm" onclick="promptDeleteFiado(${f.id})" title="Eliminar">🗑️</button>
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>`
            : '<div class="empty">No hay creditos pendientes</div>'
        }
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h2 class="card-title">Creditos Pagados</h2></div>
      <div style="padding:24px">
        ${
          paidFiados.length
            ? `<table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Total</th>
              <th>Pagado</th>
              <th>Fecha</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${paidFiados
              .map(
                (f) => `
              <tr>
                <td><strong>${escapeHtml(f.customerName)}</strong></td>
                <td>${fmtMoneyInvoice(f.total)}</td>
                <td class="text-success">${fmtMoneyInvoice(f.paid || 0)}</td>
                <td>${new Date(f.created).toLocaleDateString("es-ES")}</td>
                <td>
                  <button class="btn btn-info btn-sm" onclick="previewFiadoInvoice(${f.id})" title="Ver e imprimir factura">👁️ Ver / Imprimir</button>
                  <button class="btn btn-danger btn-sm" onclick="promptDeleteFiado(${f.id})" title="Eliminar">🗑️</button>
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>`
            : '<div class="empty">No hay creditos pagados</div>'
        }
      </div>
    </div>
  `;
}

window.promptDeleteFiado = async function (id) {
  const pw = await requestAdminPassword();

  if (pw === null) return;

  if (!(await verifyPassword(pw))) {
    alert("Contraseña incorrecta");
    return;
  }

  await deleteFiado(id);
};

async function deleteFiado(id) {
  const fiados = getVisibleFiados();
  const fiado = fiados.find((f) => f.id === id);
  if (!fiado) return;
  const ok = await showConfirm(
    "¿Eliminar el crédito de " +
      (fiado.customerName || "Cliente") +
      "?\n\nEsta acción no se puede deshacer.",
    {
      title: "Eliminar crédito",
      icon: "🗑️",
      confirmText: "Eliminar",
      danger: true,
    },
  );
  if (!ok) return;
  const products = getProducts();
  const visibleOwners = getVisibleOwners(state.user.id);
  fiado.items.forEach((item) => {
    const p = products.find((prod) => prod.id === item.id);
    if (p && visibleOwners.has(String(p.createdBy))) {
      p.stock += item.quantity;
    }
  });
  DB.set("products", products);
  DB.set(
    "fiados",
    getFiados().filter((f) => f.id !== id),
  );
  alert("Credito eliminado");
  render();
}

function showAddPaymentModal(fiadoId) {
  const fiado = getFiadoById(fiadoId);
  if (!fiado) return;

  const balance = roundPeso(fiado.balance || fiado.total);
  const paid = roundPeso(fiado.paid || 0);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.padding = "16px";
  overlay.style.zIndex = "1200";

  overlay.innerHTML = `
    <div class="modal" style="max-width:440px">
      <div class="modal-header">
        <h2 class="modal-title">💵 Registrar abono</h2>
        <button type="button" class="btn btn-secondary" data-action="cancel">✕</button>
      </div>
      <form id="abono-form" autocomplete="off">
        <div class="modal-body">
          <div style="background:#f8fafc;padding:16px;border-radius:8px;margin-bottom:20px">
            <div style="display:flex;flex-direction:column;gap:6px">
              <div style="display:flex;justify-content:space-between;gap:12px">
                <span style="color:#64748b">Cliente</span>
                <strong style="overflow-wrap:anywhere;text-align:right">${escapeHtml(fiado.customerName || "Cliente")}</strong>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="color:#64748b">Total</span>
                <span>${fmtMoneyInvoice(fiado.total)}</span>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="color:#64748b">Pagado</span>
                <span class="text-success">${fmtMoneyInvoice(paid)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:700;border-top:1px solid #e2e8f0;padding-top:8px;margin-top:4px">
                <span>Saldo pendiente</span>
                <span class="text-danger">${fmtMoneyInvoice(balance)}</span>
              </div>
            </div>
          </div>

          <div class="form-group" style="margin-bottom:12px">
            <label for="abono-input">Monto del abono</label>
            <div style="display:flex;gap:8px">
              <input id="abono-input" class="form-control" type="number" min="0.01" max="${balance}" step="0.01" placeholder="0.00" required style="font-size:18px;font-weight:600">
              <button type="button" class="btn btn-secondary" data-action="full" style="white-space:nowrap">Pagar todo</button>
            </div>
          </div>

          <div id="abono-rest" style="display:none;padding:12px;border-radius:8px;text-align:center;font-weight:700;border:1px solid"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-action="cancel">Cancelar</button>
          <button type="submit" class="btn btn-success">Registrar abono</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  const form = overlay.querySelector("#abono-form");
  const input = overlay.querySelector("#abono-input");
  const rest = overlay.querySelector("#abono-rest");
  let closed = false;

  function closeModal() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }

  function onKey(e) {
    if (e.key === "Escape") closeModal();
  }

  // Muestra cuánto quedaría pendiente mientras escribes
  function updateRest() {
    const num = Number(input.value);
    if (!input.value || !Number.isFinite(num) || num <= 0) {
      rest.style.display = "none";
      return;
    }
    rest.style.display = "block";
    if (num > balance) {
      rest.style.background = "#fef2f2";
      rest.style.borderColor = "#fecaca";
      rest.style.color = "#991b1b";
      rest.textContent =
        "El abono supera el saldo por " + fmtMoneyInvoice(num - balance);
    } else if (num === balance) {
      rest.style.background = "#f0fdf4";
      rest.style.borderColor = "#bbf7d0";
      rest.style.color = "#166534";
      rest.textContent = "✔ Con este abono el crédito queda pagado";
    } else {
      rest.style.background = "#fffbeb";
      rest.style.borderColor = "#fde68a";
      rest.style.color = "#92400e";
      rest.textContent = "Quedará pendiente: " + fmtMoneyInvoice(balance - num);
    }
  }

  input.addEventListener("input", updateRest);

  overlay
    .querySelector('[data-action="full"]')
    .addEventListener("click", () => {
      input.value = balance;
      updateRest();
      input.focus();
    });

  overlay.querySelectorAll('[data-action="cancel"]').forEach((btn) => {
    btn.addEventListener("click", closeModal);
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const num = Number(input.value);

    if (!Number.isFinite(num) || num <= 0) {
      alert("Monto inválido");
      input.focus();
      return;
    }
    if (num > balance) {
      alert("El abono no puede ser mayor al saldo pendiente");
      input.focus();
      return;
    }

    closeModal();

    try {
      addPaymentToFiado(fiadoId, num);
      alert("Abono registrado: " + fmtMoneyInvoice(num));
      render();
    } catch (error) {
      console.error("Error al registrar el abono:", error);
      alert(
        "No se pudo registrar el abono. Verifica los datos e inténtalo nuevamente.",
      );
    }
  });

  document.addEventListener("keydown", onKey);
  input.focus();
}
function previewFiadoInvoice(fiadoId) {
  try {
    const fiado = getFiadoById(fiadoId);
    if (!fiado) {
      alert("Credito no encontrado");
      return;
    }
    const printWin = window.open("", "_blank", "width=800,height=600");
    const doc = buildFiadoDocument(fiado);
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    state.previewInvoicePdfUrl = url;
    render();
    printWin.location.href = url;
    setTimeout(() => {
      try {
        printWin.focus();
        printWin.print();
      } catch (e) {}
    }, 300);
  } catch (e) {
    alert("Error al cargar la previsualización: " + e.message);
    console.error(e);
  }
}

function printFiadoInvoice(fiadoId) {
  try {
    const fiado = getFiadoById(fiadoId);
    if (!fiado) {
      alert("Credito no encontrado");
      return;
    }
    const doc = buildFiadoDocument(fiado);
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    const printWin = window.open("", "_blank", "width=800,height=600");
    printWin.location.href = url;
    setTimeout(() => {
      try {
        printWin.focus();
        printWin.print();
      } catch (e) {}
    }, 300);
  } catch (e) {
    alert("Error al imprimir: " + e.message);
    console.error(e);
  }
}

function buildFiadoDocument(fiado) {
  const doc = new jsPDF({
    unit: "mm",
    format: [PAGE_W, pdfCalcInvoiceHeight(fiado)],
  });
  let y = MARGIN_X;
  const bizName = bizGet("bizname") || "SALESSTOCK PRO";
  const bizRnc = bizGet("bizrnc") || "";
  const bizPhone = bizGet("bizphone") || "";
  const bizEmail = bizGet("bizemail") || "";
  const bizAddr = bizGet("bizaddress") || "";

  doc.setFont(FONT, "bold");
  doc.setFontSize(15);
  doc.text(bizName, PAGE_W / 2, y, { align: "center" });
  y += 5;
  doc.setFont(FONT, "normal");
  doc.setFontSize(9);
  if (bizPhone) {
    doc.text("Tel: " + bizPhone, PAGE_W / 2, y, { align: "center" });
    y += 4;
  }
  if (bizEmail) {
    doc.text("Email: " + bizEmail, PAGE_W / 2, y, { align: "center" });
    y += 4;
  }
  if (bizAddr) {
    const lines = doc.splitTextToSize(bizAddr, INNER_W);
    doc.text(lines, PAGE_W / 2, y, { align: "center" });
    y += lines.length * 3.5;
  }
  y += 2;
  pdfLine(doc, MARGIN_X, INNER_W, y);
  y += 4;

  y = pdfTitle(doc, "FACTURA A CREDITO", y);
  doc.setFont(FONT, "normal");
  doc.setFontSize(9);
  doc.text("N° " + fiado.id, PAGE_W / 2, y, { align: "center" });
  y += 4;
  if (bizRnc) {
    doc.text("RNC: " + bizRnc, PAGE_W / 2, y, { align: "center" });
    y += 4;
  }
  doc.text(
    "Fecha: " +
      new Date(fiado.created).toLocaleDateString("es-ES") +
      " " +
      new Date(fiado.created).toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    PAGE_W / 2,
    y,
    { align: "center" },
  );
  y += 4;
  doc.text("Vendedor: " + fiado.user, PAGE_W / 2, y, { align: "center" });
  y += 4;
  if (fiado.customerPhone) {
    doc.text("Tel: " + fiado.customerPhone, PAGE_W / 2, y, { align: "center" });
    y += 4;
  }
  pdfLine(doc, MARGIN_X, INNER_W, y);
  y += 4;

  doc.setFont(FONT, "bold");
  doc.setFontSize(9);
  const colQty = MARGIN_X;
  const colDescStart = MARGIN_X + 10;
  const colUnit = MARGIN_X + INNER_W - 18;
  const colTotal = MARGIN_X + INNER_W;
  doc.text("CANT", colQty, y, { align: "left" });
  doc.text("DESCRIPCIÓN", colDescStart, y, { align: "left" });
  doc.text("P.U.", colUnit, y, { align: "right" });
  doc.text("TOTAL", colTotal, y, { align: "right" });
  y += 2;
  pdfLine(doc, MARGIN_X, INNER_W, y);
  y += 3;

  doc.setFont(FONT, "normal");
  doc.setFontSize(8);
  fiado.items.forEach((item) => {
    const name = abbreviateText(doc, item.name, INNER_W - 22);
    const lineH = 7;
    const pu = "$" + Math.round(item.price);
    const tot = "$" + Math.round(item.subtotal);
    doc.text(String(item.quantity), colQty, y + 1.2, { align: "left" });
    doc.text(name, colDescStart, y + 1.2, { align: "left" });
    doc.text(pu, colUnit, y + 1.2, { align: "right" });
    doc.text(tot, colTotal, y + 1.2, { align: "right" });
    y += lineH + 2;
  });

  y += 1;
  pdfLine(doc, MARGIN_X, INNER_W, y);
  y += 4;

  doc.setFont(FONT, "normal");
  doc.setFontSize(10);
  doc.text("Subtotal: " + fmtMoneyInvoice(fiado.subtotal), colTotal, y, {
    align: "right",
  });
  y += 4;
  doc.text("ITBIS (18%): " + fmtMoneyInvoice(fiado.itbis), colTotal, y, {
    align: "right",
  });
  y += 4;
  doc.setFont(FONT, "bold");
  doc.setFontSize(12);
  doc.text("TOTAL: " + fmtMoneyInvoice(fiado.total), colTotal, y, {
    align: "right",
  });
  y += 6;

  if (fiado.payments && fiado.payments.length > 0) {
    doc.setFont(FONT, "bold");
    doc.setFontSize(10);
    doc.text("HISTORIAL DE PAGOS", MARGIN_X, y, { align: "left" });
    y += 5;

    doc.setFont(FONT, "normal");
    doc.setFontSize(9);
    fiado.payments.forEach((payment) => {
      doc.text(
        new Date(payment.date).toLocaleDateString("es-ES") +
          " - " +
          fmtMoneyInvoice(payment.amount),
        MARGIN_X,
        y,
        { align: "left" },
      );
      y += 4;
    });

    pdfLine(doc, MARGIN_X, INNER_W, y);
    y += 4;
    doc.text("Total Pagado: " + fmtMoneyInvoice(fiado.paid || 0), MARGIN_X, y, {
      align: "left",
    });
    y += 4;
    doc.text(
      "Saldo Pendiente: " + fmtMoneyInvoice(fiado.balance || fiado.total),
      MARGIN_X,
      y,
      { align: "left" },
    );
    y += 4;
  }

  y += 2;
  pdfLine(doc, MARGIN_X, INNER_W, y);
  y += 3;
  doc.text("*** PAGO A CRÉDITO ***", PAGE_W / 2, y, { align: "center" });

  return doc;
}

function pdfCalcInvoiceHeight(data) {
  const base = 80;
  const items = data.items || [];
  const lines = Math.max(0, items.length - 3);
  const header = 20;
  const payments =
    data.payments && data.payments.length > 0
      ? 20 + data.payments.length * 4
      : 0;
  const total = 30;
  return base + lines * 8 + header + payments + total;
}

function renderNewFiadoModal() {
  const html = `
    <div class="modal-overlay" onclick="state.modal=null;render()">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header"><h2 class="modal-title">Nuevo Credito</h2><button class="btn btn-secondary" onclick="state.modal=null;render()">✕</button></div>
        <div class="modal-body">
          <form onsubmit="event.preventDefault();const name=this.n.value;const phone=this.p.value;const notes=this.not.value;if(!name){alert('Nombre requerido');return}createFiadoFromCart(name,phone,notes)">
            <div class="form-group">
              <label>Nombre del Cliente *</label>
              <input type="text" name="n" class="form-control" autocomplete="off" placeholder="Nombre completo" required>
            </div>
            <div class="form-group">
              <label>Teléfono</label>
              <input type="text" name="p" class="form-control" autocomplete="off" placeholder="(000) 000-0000">
            </div>
            <div class="form-group">
              <label>Notas</label>
              <textarea name="not" class="form-control" rows="2" autocomplete="off" placeholder="Información adicional..."></textarea>
            </div>
            <div style="background:#f8fafc;padding:16px;border-radius:8px;margin-bottom:20px">
              <div style="display:flex;flex-direction:column;gap:6px">
                <div style="display:flex;justify-content:space-between"><span>Productos en carrito:</span><span>${state.cart.length}</span></div>
                <div style="display:flex;justify-content:space-between"><span>Subtotal:</span><span>${fmtMoneyInvoice(getCartTotal())}</span></div>
                <div style="display:flex;justify-content:space-between"><span>ITBIS (18%):</span><span>${fmtMoneyInvoice(getCartTotal() * ITBIS_RATE)}</span></div>
                <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:700;color:#10b981;border-top:1px solid #e2e8f0;padding-top:8px;margin-top:4px"><span>Total:</span><span>${fmtMoneyInvoice(getCartTotal() * (1 + ITBIS_RATE))}</span></div>
              </div>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">Crear Credito</button>
          </form>
        </div>
      </div>
    </div>
  `;
  return html;
}

function renderPage() {
  switch (state.page) {
    case "dashboard":
      return renderDashboard();
    case "products":
      return renderProducts();
    case "sales":
      return renderSales();
    case "users":
      if (state.user.role !== "ADMIN")
        return '<div class="empty">Acceso denegado</div>';
      return renderUsers();
    case "licenses":
      if (String(state.user.id) !== "1" || state.user.username !== "Sistemapro")
        return '<div class="empty">Acceso denegado</div>';
      return renderLicenses();
    case "reports":
      return renderReports();
    case "fiados":
      return renderFiados();
    default:
      return renderDashboard();
  }
}

function renderDashboard() {
  const stats = getStats();
  const sales = [...getVisibleSales()].sort(
    (a, b) => new Date(b.created) - new Date(a.created),
  );
  return `
    <div class="header"><h1>Dashboard</h1></div>
    <div class="stats">
      <div class="stat"><div class="stat-icon blue">📦</div><div class="stat-info"><h3>Total Productos</h3><div class="stat-value">${stats.totalProducts}</div></div></div>
      <div class="stat"><div class="stat-icon green">💰</div><div class="stat-info"><h3>Ventas de Hoy</h3><div class="stat-value">${fmtMoneyInvoice(stats.todaySales)}</div></div></div>
      <div class="stat"><div class="stat-icon purple">👥</div><div class="stat-info"><h3>Total Usuarios</h3><div class="stat-value">${stats.totalUsers}</div></div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Facturas <span style="color:#64748b;font-weight:500;font-size:14px">(${sales.length})</span></h2>
      </div>
      <div style="padding:20px">
        <div style="margin-bottom:16px">
          <input type="text" class="form-control" id="sales-search" placeholder="Buscar por cliente, usuario o ID..." value="${escapeHtml(state.salesSearch || "")}" oninput="filterSalesTable(this.value)">
        </div>
        ${
          sales.length
            ? `
        <div style="overflow-x:auto">
          <table id="sales-table" class="tabla-dashboard">
            <colgroup>
              <col style="width:20%"><col style="width:16%"><col style="width:12%"><col style="width:11%"><col style="width:12%"><col style="width:12%"><col style="width:8%"><col style="width:9%">
            </colgroup>
            <thead>
              <tr><th>Cliente / ID</th><th>Fecha</th><th>Subtotal</th><th>ITBIS</th><th>Total</th><th>Usuario</th><th>Tipo</th><th></th></tr>
            </thead>
            <tbody>
              ${sales
                .map(
                  (s) => `
                <tr>
                  <td title="${escapeHtml(s.customerName || "#" + s.id)}"><strong>${escapeHtml(s.customerName || "#" + s.id)}</strong></td>
                  <td class="col-monto">${fmtDate(s.created)}</td>
                  <td class="col-monto">${fmtMoneyInvoice(s.subtotal || 0)}</td>
                  <td class="col-monto">${fmtMoneyInvoice(s.itbis || 0)}</td>
                  <td class="col-monto text-success" style="font-weight:600">${fmtMoneyInvoice(s.total)}</td>
                  <td>${escapeHtml(s.user || "")}</td>
                  <td class="col-monto">${s.receiptType === "fiscal" ? '<span style="color:#3b82f6;font-weight:600">Fiscal</span>' : '<span style="color:#64748b">Normal</span>'}</td>
                  <td class="col-acciones">
                    <div class="acciones-fila">
                      <button class="btn btn-info btn-sm" onclick="previewSaleInvoice(${s.id})" title="Ver factura">👁️</button>
                      <button class="btn btn-danger btn-sm" onclick="promptDeleteSale(${s.id})" title="Eliminar">🗑️</button>
                    </div>
                  </td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <div id="sales-empty" class="empty" style="display:none">No se encontraron facturas</div>
        `
            : '<div class="empty">No hay ventas registradas</div>'
        }
      </div>
    </div>
  `;
}
function filterSalesTable(query) {
  state.salesSearch = query;
  const q = String(query || "")
    .toLowerCase()
    .trim();
  const rows = document.querySelectorAll("#sales-table tbody tr");
  let visible = 0;
  rows.forEach((row) => {
    const show = row.innerText.toLowerCase().includes(q);
    row.style.display = show ? "" : "none";
    if (show) visible++;
  });
  const empty = document.getElementById("sales-empty");
  if (empty) empty.style.display = visible ? "none" : "block";
}

window.filterSalesTable = filterSalesTable;
function previewSaleInvoice(saleId) {
  try {
    const sale = getVisibleSales().find((s) => s.id === saleId);
    if (!sale) {
      alert("Venta no encontrada o no autorizada");
      return;
    }
    const printWin = window.open("", "_blank", "width=800,height=600");
    const doc = buildInvoiceDocument(sale);
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    state.previewInvoicePdfUrl = url;
    render();
    printWin.location.href = url;
    setTimeout(() => {
      try {
        printWin.focus();
        printWin.print();
      } catch (e) {}
    }, 300);
  } catch (e) {
    alert("Error al cargar la previsualización: " + e.message);
    console.error(e);
  }
}

function closeInvoicePreview() {
  if (state.previewInvoicePdfUrl) {
    URL.revokeObjectURL(state.previewInvoicePdfUrl);
    state.previewInvoicePdfUrl = "";
  }
  render();
}

function printPreviewInvoice() {
  if (!state.previewInvoicePdfUrl) return;
  const printWin = window.open("", "_blank", "width=800,height=600");
  printWin.location.href = state.previewInvoicePdfUrl;
  setTimeout(() => {
    try {
      printWin.focus();
      printWin.print();
    } catch (e) {}
  }, 300);
}

function showAllSalesModal() {
  state.salesListHtml = buildSalesListHtml(getVisibleSales());
  render();
}

function buildSalesListHtml(sales) {
  const rows = sales
    .map(
      (s) => `
    <tr>
      <td><strong>${s.customerName ? s.customerName : "#" + s.id}</strong></td>
      <td>${fmtDate(s.created)}</td>
      <td>${fmtMoneyInvoice(s.subtotal || 0)}</td>
      <td>${fmtMoneyInvoice(s.itbis || 0)}</td>
      <td class="text-success" style="font-weight:600">${fmtMoneyInvoice(s.total)}</td>
      <td>${s.user}</td>
      <td>${s.receiptType === "fiscal" ? '<span style="color:#3b82f6;font-weight:600">Fiscal</span>' : '<span style="color:#64748b">Normal</span>'}</td>
      <td>
        <button class="btn btn-info btn-sm" onclick="previewSaleInvoice(${s.id}); state.salesListHtml=''; render();" title="Ver factura">👁️</button>
        <button class="btn btn-danger btn-sm" onclick="promptDeleteSale(${s.id})">🗑️</button>
      </td>
    </tr>
  `,
    )
    .join("");

  return `
    <div style="margin-bottom:16px">
      <input type="text" class="form-control" id="sales-search" placeholder="Buscar por cliente, usuario o ID..." oninput="filterSalesTable(this.value)" />
    </div>
    <div style="overflow-x:auto">
      <table id="sales-table">
        <thead>
          <tr>
            <th>Cliente / ID</th>
            <th>Fecha</th>
            <th>Subtotal</th>
            <th>ITBIS</th>
            <th>Total</th>
            <th>Usuario</th>
            <th>Tipo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <script>
      function filterSalesTable(query) {
        const q = query.toLowerCase();
        const rows = document.querySelectorAll('#sales-table tbody tr');
        rows.forEach(row => {
          const text = row.innerText.toLowerCase();
          row.style.display = text.includes(q) ? '' : 'none';
        });
      }
    <\/script>
  `;
}

function renderSaleInvoiceHtml(sale) {
  const bizName = bizGet("bizname") || "SALESSTOCK PRO";
  const bizRnc = bizGet("bizrnc") || "";
  const bizPhone = bizGet("bizphone") || "";
  const bizEmail = bizGet("bizemail") || "";
  const bizAddr = bizGet("bizaddress") || "";

  const itemsHtml = sale.items
    .map(
      (item) => `
    <tr>
      <td>${item.quantity}</td>
      <td>${item.name}</td>
      <td>${fmtMoneyInvoice(item.price)}</td>
      <td>${fmtMoneyInvoice(item.subtotal)}</td>
    </tr>
  `,
    )
    .join("");

  const clientHtml =
    sale.customerName || sale.customerPhone
      ? `
    <div class="inv-section">
      <h3>Cliente</h3>
      <div><strong>Nombre:</strong> ${sale.customerName || "-"}</div>
      <div><strong>Teléfono:</strong> ${sale.customerPhone || "-"}</div>
    </div>
  `
      : "";

  const notesHtml = sale.notes
    ? `
    <div class="inv-section">
      <h3>Notas</h3>
      <div>${sale.notes}</div>
    </div>
  `
    : "";

  const creditHtml =
    sale.paymentType === "credito"
      ? `
    <div class="inv-section">
      <div><strong>Interés (5%):</strong> ${fmtMoneyInvoice(sale.interest)}</div>
    </div>
  `
      : "";

  const itbisHtml = sale.itbis
    ? `
    <div class="inv-section">
      <div><strong>Subtotal:</strong> ${fmtMoneyInvoice(sale.subtotal)}</div>
      <div><strong>ITBIS (18%):</strong> ${fmtMoneyInvoice(sale.itbis)}</div>
    </div>
  `
    : "";

  return `
    <div class="inv-header">
      <h1>${bizName}</h1>
      <div>${bizPhone ? "Tel: " + bizPhone + "<br>" : ""}${bizEmail ? "Email: " + bizEmail + "<br>" : ""}${bizAddr ? "Dir: " + bizAddr : ""}</div>
    </div>
    <div class="inv-meta">
      <div><strong>Factura N°:</strong> ${sale.id}</div>
      ${sale.receiptType === "fiscal" && bizRnc ? "<div><strong>RNC:</strong> " + bizRnc + "</div>" : ""}
      <div><strong>Fecha:</strong> ${new Date(sale.created).toLocaleDateString("es-ES")} ${new Date(sale.created).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</div>
      <div><strong>Cajero:</strong> ${sale.user}</div>
      <div><strong>Pago:</strong> ${sale.paymentType === "credito" ? "Crédito" : "Contado"}</div>
    </div>
    <hr />
    ${clientHtml}
    ${notesHtml}
    <div class="inv-section">
      <h3>Productos</h3>
      <table>
        <thead>
          <tr>
            <th>Cant</th>
            <th>Producto</th>
            <th>P.U.</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
    </div>
    ${itbisHtml}
    ${creditHtml}
    <div class="inv-total">TOTAL: ${fmtMoneyInvoice(sale.total)}</div>
    ${
      sale.paidAmount > 0 || sale.change !== undefined
        ? `
    <div class="inv-payments">
      <div class="inv-payment-row"><span class="inv-label">Pagado:</span><span class="inv-value">${fmtMoneyInvoice(sale.paidAmount || 0)}</span></div>
      <div class="inv-payment-row"><span class="inv-label">Cambio:</span><span class="inv-value">${fmtMoneyInvoice(Math.max(0, sale.change || 0))}</span></div>
    </div>
    `
        : ""
    }
    <div class="inv-footer">
      ${sale.paymentType === "credito" ? "*** PAGO A CRÉDITO ***<br>Se cobrará 5% extra en 30 días" : "¡GRACIAS POR SU COMPRA!"}
    </div>
  `;
}

let productSearchTimer = null;
function onProductSearch(v) {
  state.search = v;
  clearTimeout(productSearchTimer);
  productSearchTimer = setTimeout(() => {
    render();
    const i = document.querySelector(".search-input");
    if (i) {
      i.focus();
      i.setSelectionRange(v.length, v.length);
    }
  }, 150);
}
window.onProductSearch = onProductSearch;

function renderProducts() {
  const products = getProducts();
  return `
    <div class="header"><h1>Productos</h1><button class="btn btn-primary" onclick="state.modal={type:'product'};render()">+ Nuevo Producto</button></div>
    <div class="card" style="background:#1e293b;color:#fff;padding:20px;margin-bottom:20px">
      <div style="font-size:13px;margin-bottom:8px;color:#94a3b8">ESCANER DE PRODUCTOS</div>
      <div style="display:flex;gap:10px">
        <input id="scanner-prod" class="form-control" style="font-size:20px;padding:16px;text-align:center;font-weight:700;background:#fff;color:#1e293b" placeholder="Escanear codigo de barras..." onkeydown="if(event.key==='Enter'){scanProductBarcode(this.value);this.value=''}">
        <button class="btn btn-primary" onclick="startCameraScan()" style="padding:16px 20px;font-size:18px">📷</button>
      </div>
    </div>
    <div class="search">
      <input class="search-input" placeholder="Buscar productos..." value="${escapeHtml(state.search)}" oninput="onProductSearch(this.value)">
    </div>
    <div class="card">
      <table>
      <thead><tr><th>Nombre</th><th>Precio</th><th>Stock</th><th>Mín.</th><th>Barcode</th><th>Acciones</th></tr></thead>
        <tbody>
          ${
            products.length
              ? products
                  .map(
                    (p) => `
            <tr class="${p.stock <= p.minStock ? "low-stock" : ""}">
              <td><strong>${p.name}</strong></td>
              <td>${fmtMoney(p.price)}</td>
              <td>${p.stock}</td>
              <td>${p.minStock}</td>
              <td style="font-family:monospace;font-size:12px">${p.barcode || "-"}</td>
              <td>
                <div class="flex gap-2">
                  <button class="btn btn-secondary btn-sm" onclick="showBarcode('${p.barcode}','${p.name}')">📱</button>
                  <button class="btn btn-primary btn-sm" onclick="state.modal={type:'barcodePrint',product:${JSON.stringify(p).replace(/"/g, "&quot;")}};render()">🏷️</button>
                  <button class="btn btn-secondary btn-sm" onclick="state.modal={type:'product',product:${JSON.stringify(p).replace(/"/g, "&quot;")}};render()">✏️</button>
                  <button class="btn btn-danger btn-sm" onclick="deleteProduct(${p.id});render()">🗑️</button>
                </div>
              </td>
            </tr>
          `,
                  )
                  .join("")
              : '<tr><td colspan="6"><div class="empty">No se encontraron productos</div></td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderSales() {
  const products = getProducts().filter((p) => p.stock > 0);
  return `
    <div class="header"><h1>Punto de Venta</h1><div style="color:#64748b">${new Date().toLocaleDateString("es-ES")}</div></div>
    <div style="display:grid;grid-template-columns:1fr 350px;gap:20px;height:calc(100vh - 160px)">
      <div style="display:flex;flex-direction:column;gap:16px">
         <div class="card" style="background:#1e293b;color:#fff;padding:20px;overflow:visible">
           <div style="font-size:13px;margin-bottom:8px;color:#94a3b8">BUSCADOR DE PRODUCTOS</div>
           <div style="position:relative;display:flex;gap:10px">
             <input id="scanner-input" class="form-control" style="font-size:18px;padding:14px 16px;text-align:left;font-weight:500;background:#fff;color:#1e293b;width:100%;border-radius:8px;border:2px solid #e2e8f0;transition:all .2s;min-width:0" placeholder="Escribe el nombre del producto..." autocomplete="off" oninput="onScannerInput(this.value)" onkeydown="onScannerKey(event)">
             <button class="btn btn-primary" onclick="startCameraScan()" style="padding:14px 18px;font-size:18px;border-radius:8px;flex-shrink:0">📷</button>
              <div id="scanner-dropdown" style="display:none;position:absolute;left:0;right:90px;top:56px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 20px 40px rgba(0,0,0,.15);z-index:100;max-height:320px;overflow-y:auto"></div>
           </div>
         </div>
        <div class="card" style="flex:1;overflow:hidden">
          <div class="card-header"><h2 class="card-title">Productos</h2></div>
          <div style="padding:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;max-height:400px;overflow-y:auto">
            ${products
              .map(
                (p) =>
                  '<div style="padding:14px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer" onclick="addProdById(' +
                  p.id +
                  ')"><div style="font-weight:600;font-size:13px">' +
                  p.name +
                  '</div><div style="font-size:11px;color:#64748b">Cod:' +
                  (p.barcode || "-") +
                  " | Stock:" +
                  p.stock +
                  '</div><div style="font-size:12px;color:#10b981">' +
                  fmtMoney(p.price) +
                  "</div></div>",
              )
              .join("")}
          </div>
        </div>
      </div>
      <div class="card" style="display:flex;flex-direction:column;height:100%;position:relative;z-index:901">
        <div class="card-header" style="background:#f8fafc"><h2 class="card-title">Carrito</h2></div>
        <div style="flex:1;overflow-y:auto;padding:12px">
           ${
             state.cart.length
               ? state.cart
                   .map((item) => {
                     const rawLine = item.price * item.quantity;
                     const discount = item.hiddenDiscountPct || 0;
                     const lineTotal = rawLine * (1 - discount);
                     return (
                       '<div style="display:flex;flex-direction:column;gap:8px;padding:10px 0;border-bottom:1px solid #e2e8f0"><div style="display:flex; justify-content:space-between; align-items:center"><div style="flex:1; min-width:0"><div style="font-weight:600;font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">' +
                       item.name +
                       '</div><div style="font-size:11px;color:#64748b">Cod:' +
                       (item.barcode || "-") +
                       " | " +
                       fmtMoney(item.price) +
                       " x" +
                       item.quantity +
                       '</div></div><div style="display:flex; align-items:center; gap:4px; flex-shrink:0; margin-left:8px"><button class="btn btn-secondary btn-sm" style="padding:4px" onclick="updateCartQty(' +
                       item.id +
                       "," +
                       (item.quantity - 1) +
                       ');render()">-</button><span style="font-size:13px; font-weight:600; min-width:16px; text-align:center">' +
                       item.quantity +
                       '</span><button class="btn btn-secondary btn-sm" style="padding:4px" onclick="updateCartQty(' +
                       item.id +
                       "," +
                       (item.quantity + 1) +
                       ');render()">+</button></div></div><div style="display:flex; gap:8px; align-items:center"><button class="btn btn-warning btn-sm" style="padding:6px 10px; font-size:11px" onclick="promptHiddenDiscount(' +
                       item.id +
                       ')">Desc %</button><span style="margin-left:auto; color:#10b981; font-weight:700; font-size:13px">' +
                       fmtMoneyInvoice(lineTotal) +
                       "</span></div></div>"
                     );
                   })
                   .join("")
               : '<div class="empty"><div>Carrito vacio</div></div>'
           }
        </div>
         <div style="padding:20px;border-top:2px solid #e2e8f0;background:#f8fafc">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
              <span style="font-size:14px;color:#64748b;font-weight:500">Total del carrito</span>
              <span style="font-size:22px;font-weight:700;color:#10b981">${fmtMoneyInvoice(getCartTotal())}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px">
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
                <button class="btn btn-primary" style="padding:18px;font-size:15px;font-weight:600;border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,.06)" onclick="if(state.cart.length){showPaymentOptions('quote')}">📄 Cotizar</button>
                <button class="btn btn-success" style="padding:18px;font-size:15px;font-weight:600;border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,.06)" onclick="if(state.cart.length){showPaymentOptions('sale')}">💵 Cobrar</button>
                 <button class="btn btn-warning" style="padding:18px;font-size:15px;font-weight:600;border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,.06)" onclick="if(state.cart.length){state.modal={type:'newFiado'};render()}">📝 Credito</button>
              </div>
              <button class="btn btn-danger" style="padding:14px;font-size:14px;font-weight:600;border-radius:10px;width:100%;border:1px solid rgba(239,68,68,.2)" onclick="cancelCart()">Cancelar</button>
            </div>
          </div>
      </div>
    </div>
  `;
}

function addProdById(id) {
  const products = getProducts();
  const p = products.find((x) => x.id === id);
  if (!p) return;
  if (
    String(p.createdBy) !== String(state.user.id) &&
    !getVisibleOwners(state.user.id).has(String(p.createdBy))
  )
    return;
  addToCart(p);
  render();
}

function onScannerInput(value) {
  const dropdown = document.getElementById("scanner-dropdown");
  const input = document.getElementById("scanner-input");
  if (!dropdown || !input) return;
  if (state.page !== "sales" || state.modal) {
    dropdown.style.display = "none";
    return;
  }
  const q = value.toLowerCase().trim();
  if (!q) {
    dropdown.style.display = "none";
    return;
  }
  const products = getProducts().filter(
    (p) => p.stock > 0 && p.name.toLowerCase().includes(q),
  );
  if (!products.length) {
    dropdown.style.display = "none";
    return;
  }
  dropdown.innerHTML = products
    .slice(0, 20)
    .map(
      (p) => `
    <div class="scanner-dropdown-item" data-id="${p.id}" onmousedown="event.preventDefault();selectScannerProduct(${p.id})" style="display:flex;align-items:center;padding:12px 18px;border-bottom:1px solid #f1f5f9;cursor:pointer;transition:background .15s">
      <span style="font-weight:600;color:#0f172a;font-size:14px">${escapeHtml(p.name)}</span>
      <span style="margin-left:auto;color:#ffffff;font-size:12px;background:#1e293b;padding:2px 8px;border-radius:999px">${fmtMoneyInvoice(p.price)}</span>
    </div>
  `,
    )
    .join("");
  dropdown.style.display = "block";
  input._selectedScannerId = null;
}

function selectScannerProduct(id) {
  addProdById(id);
  const input = document.getElementById("scanner-input");
  const dropdown = document.getElementById("scanner-dropdown");
  if (input) input.value = "";
  if (dropdown) dropdown.style.display = "none";
}

function hideScannerDropdown() {
  const dropdown = document.getElementById("scanner-dropdown");
  if (dropdown) dropdown.style.display = "none";
}

function onScannerKey(event) {
  const dropdown = document.getElementById("scanner-dropdown");
  if (!dropdown || dropdown.style.display === "none") {
    if (event.key === "Enter") {
      const input = document.getElementById("scanner-input");
      if (!input) return;
      const q = input.value.trim();
      const products = getProducts().filter(
        (p) =>
          p.stock > 0 &&
          (p.barcode === q ||
            (p.barcode && p.barcode.includes(q)) ||
            p.name.toLowerCase().includes(q.toLowerCase())),
      );
      if (products.length === 1) {
        addProdById(products[0].id);
        input.value = "";
      } else if (products.length > 1) {
        onScannerInput(q);
      }
    }
    return;
  }
  const items = dropdown.querySelectorAll(".scanner-dropdown-item");
  let idx = -1;
  items.forEach((el, i) => {
    if (el.style.background === "rgb(241, 245, 249)") idx = i;
  });
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (items.length) {
      const next = idx < items.length - 1 ? idx + 1 : 0;
      items.forEach((el) => (el.style.background = "transparent"));
      items[next].style.background = "#f1f5f9";
      items[next].scrollIntoView({ block: "nearest" });
    }
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (items.length) {
      const prev = idx > 0 ? idx - 1 : items.length - 1;
      items.forEach((el) => (el.style.background = "transparent"));
      items[prev].style.background = "#f1f5f9";
      items[prev].scrollIntoView({ block: "nearest" });
    }
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (idx >= 0 && items[idx]) {
      const id = parseInt(items[idx].getAttribute("data-id"));
      selectScannerProduct(id);
    } else if (items.length) {
      selectScannerProduct(parseInt(items[0].getAttribute("data-id")));
    }
  } else if (event.key === "Escape") {
    hideScannerDropdown();
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function findProduct(query) {
  const products = DB.get("products");
  const companyId = getCompanyId();
  if (companyId) {
    const filtered = products.filter((p) => String(p.companyId) === companyId);
    query = query.toLowerCase().trim();
    if (!query) return null;

    // 1. Búsqueda EXACTA por código de barras
    let product = filtered.find((p) => p.barcode === query);
    if (product) return product;

    // 2. Búsqueda PARCIAL por código de barras
    product = filtered.find(
      (p) => p.barcode && p.barcode.toLowerCase().includes(query),
    );
    if (product) return product;

    // 3. Búsqueda por nombre (parcial, sin distinción de mayúsculas)
    product = filtered.find((p) => p.name.toLowerCase().includes(query));
    if (product) return product;

    return null;
  }
  const q = query.toLowerCase().trim();
  if (!q) return null;

  // 1. Búsqueda EXACTA por código de barras
  let product = products.find((p) => p.barcode === query);
  if (product) return product;

  // 2. Búsqueda PARCIAL por código de barras
  product = products.find(
    (p) => p.barcode && p.barcode.toLowerCase().includes(q),
  );
  if (product) return product;

  // 3. Búsqueda por nombre (parcial, sin distinción de mayúsculas)
  product = products.find((p) => p.name.toLowerCase().includes(q));
  if (product) return product;

  return null;
}

function scanBarcode(code) {
  code = code.trim();
  if (!code) return;

  const product = findProduct(code);

  if (product) {
    if (
      String(product.createdBy) === String(state.user.id) ||
      getVisibleOwners(state.user.id).has(String(product.createdBy))
    ) {
      addToCart(product);
    } else {
      alert("Producto no autorizado: " + code);
    }
  } else {
    alert("Producto no encontrado: " + code);
  }
  render();
  setTimeout(function () {
    var inp = document.getElementById("scanner-input");
    if (inp) {
      inp.value = "";
      inp.focus();
    }
  }, 100);
}

function scanProductBarcode(code) {
  code = code.trim();
  if (!code) return;

  const product = findProduct(code);

  if (product) {
    if (
      String(product.createdBy) === String(state.user.id) ||
      getVisibleOwners(state.user.id).has(String(product.createdBy))
    ) {
      if (product.stock > 0) {
        addToCart(product);
        alert("Agregado: " + product.name + " - " + fmtMoney(product.price));
      } else {
        alert("Sin stock: " + product.name);
      }
    } else {
      alert("Producto no autorizado: " + product.name);
    }
  } else {
    state.modal = { type: "quickAddProduct", barcode: code };
  }
  render();
  setTimeout(function () {
    var inp = document.getElementById("scanner-prod");
    if (inp) {
      inp.value = "";
      inp.focus();
    }
  }, 100);
}

function renderLicenses() {
  if (String(state.user.id) !== "1")
    return '<div class="empty">Acceso denegado</div>';
  const licenses = DB.get("licenses") || [];
  const companyId = getCompanyId();
  const visibleLicenses = companyId
    ? licenses.filter((l) => String(l.companyId) === companyId)
    : licenses;
  const users = getUsers();
  return `
    <div class="header"><h1>Licencias</h1><button class="btn btn-primary" onclick="generateLicense()">+ Nueva Licencia</button></div>
    <div class="card">
      <table>
        <thead><tr><th>Clave</th><th>Estado</th><th>Usada por</th><th>Fecha</th><th>Acciones</th></tr></thead>
        <tbody>
          ${visibleLicenses
            .map((l) => {
              const usedByUser = l.usedBy
                ? users.find((u) => String(u.id) === String(l.usedBy))
                : null;
              const statusBadge = l.used
                ? '<span class="badge badge-danger">Usada</span>'
                : '<span class="badge badge-success">Disponible</span>';
              return `
              <tr>
                <td><strong>${l.key}</strong></td>
                <td>${statusBadge}</td>
                <td>${usedByUser ? usedByUser.username : l.used ? "Desconocido" : "-"}</td>
                <td>${l.usedAt ? fmtDate(l.usedAt) : "-"}</td>
                <td>
                  <button class="btn btn-danger btn-sm" data-license-key="${l.key.replace(/"/g, "&quot;")}" onclick="deleteLicenseFromBtn(this)" title="${l.used ? "Eliminar licencia y todos los datos asociados" : "Eliminar licencia"}">🗑️</button>
                </td>
              </tr>
            `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function generateLicense() {
  const prefix = "PRO-" + new Date().getFullYear();
  const randomPart =
    Math.random().toString(36).substring(2, 6).toUpperCase() +
    "-" +
    Math.random().toString(36).substring(2, 6).toUpperCase();
  const key = prefix + "-" + randomPart;
  const licenses = DB.get("licenses") || [];
  licenses.push({ key, used: false, companyId: getCompanyId() || "1" });
  DB.set("licenses", licenses);
  alert("Licencia generada: " + key);
  render();
}

async function deleteLicense(key) {
  const licenses = DB.get("licenses");
  const license = licenses.find((l) => l.key === key);
  if (!license) return;

  // Empresa asociada a la licencia (solo si ya fue usada). Nunca la de Sistemapro ('1').
  let companyId = "";
  if (license.used) {
    companyId = String(
      license.companyId && String(license.companyId) !== "1"
        ? license.companyId
        : license.usedBy || "",
    );
    if (companyId === "1") companyId = "";
  }

  const message = companyId
    ? "¿Eliminar la licencia " +
      key +
      "?\n\nSe borrarán PERMANENTEMENTE todos los datos de esta empresa: usuarios, productos, ventas, facturas y créditos.\n\nEsta acción no se puede deshacer."
    : "¿Eliminar la licencia " + key + "?";
  const ok = await showConfirm(message, {
    title: "Eliminar licencia",
    icon: "🗑️",
    confirmText: "Eliminar",
    danger: true,
  });
  if (!ok) return;

  if (companyId) {
    try {
      await window.App.Services.DB.deleteCompany(companyId);
    } catch (e) {
      console.error("[deleteLicense]", e);
      alert(
        "No se pudieron eliminar los datos de la empresa.\nMotivo: " +
          ((e && (e.code || e.message)) || "desconocido") +
          "\nLa licencia no fue eliminada.",
      );
      return;
    }
  }

  await DB.set(
    "licenses",
    DB.get("licenses").filter((l) => l.key !== key),
  );
  render();
}

function deleteLicenseFromBtn(btn) {
  const key = btn.getAttribute("data-license-key");
  if (key) {
    deleteLicense(key);
  }
}

const COMPANY_FIELDS = [
  {
    id: "bizname",
    key: "salesstock_bizname",
    icon: "📛",
    label: "Nombre de la empresa",
    hint: "Aparece en facturas, cotizaciones y reportes",
    ph: "Nombre de la empresa",
    def: "SalesStock Pro",
    full: true,
  },
  {
    id: "bizrnc",
    key: "salesstock_bizrnc",
    icon: "🪪",
    label: "RNC / NIT",
    hint: "Necesario para los comprobantes fiscales",
    ph: "000-0000000-0",
  },
  {
    id: "bizphone",
    key: "salesstock_bizphone",
    icon: "📞",
    label: "Teléfono",
    hint: "Contacto principal",
    ph: "(809) 000-0000",
  },
  {
    id: "bizemail",
    key: "salesstock_bizemail",
    icon: "📧",
    label: "Email",
    hint: "Correo electrónico de contacto",
    ph: "contacto@empresa.com",
  },
  {
    id: "bizaddress",
    key: "salesstock_bizaddress",
    icon: "📍",
    label: "Dirección",
    hint: "Dirección física del negocio",
    ph: "Calle, ciudad, país",
  },
];

function companyStatusHtml(values, dirty) {
  const missing = COMPANY_FIELDS.filter(
    (f) => !String(values[f.id] || "").trim(),
  );
  const dirtyHtml = dirty
    ? '<div class="empresa-dirty">● Tienes cambios sin guardar</div>'
    : "";

  if (!missing.length) {
    return `
      <div class="empresa-status ok">
        <div class="empresa-status-title">✅ Estado del sistema: <span>Todo configurado</span></div>
        <p>Los datos de la empresa se imprimen automáticamente en facturas, cotizaciones, reportes y etiquetas.</p>
        ${dirtyHtml}
      </div>`;
  }
  return `
    <div class="empresa-status warn">
      <div class="empresa-status-title">⚠️ Estado del sistema: <span>Faltan ${missing.length} dato(s) por configurar</span></div>
      <div class="empresa-chips">
        ${missing.map((f) => `<span class="empresa-chip">${f.icon} ${f.label}</span>`).join("")}
      </div>
      ${dirtyHtml}
    </div>`;
}

// Lee lo que hay escrito en los campos (guardado o no)
function readCompanyForm() {
  const v = {};
  COMPANY_FIELDS.forEach((f) => {
    const el = document.getElementById(f.id);
    v[f.id] = el ? el.value : "";
  });
  return v;
}

// Se llama cada vez que escribes: actualiza el estado sin redibujar la página
function updateCompanyStatus() {
  const box = document.getElementById("empresa-status-box");
  if (!box) return;
  const values = readCompanyForm();
  const dirty = COMPANY_FIELDS.some(
    (f) => String(values[f.id]).trim() !== (bizGet(f.id) || f.def || "").trim(),
  );
  box.innerHTML = companyStatusHtml(values, dirty);
  const btn = document.getElementById("empresa-save");
  if (btn) btn.classList.toggle("pulse", dirty);
}

async function saveCompanyData() {
  const cid = getCompanyId() || "1";
  const entry = { companyId: cid };
  COMPANY_FIELDS.forEach((f) => {
    const el = document.getElementById(f.id);
    entry[f.id] = el ? el.value.trim() : bizGet(f.id);
  });
  const list = DB.get("settings").filter((s) => String(s.companyId) !== cid);
  list.push(entry);
  const res = await DB.set("settings", list);
  if (res === null) return; // db.js ya mostró el motivo del error
  alert("Datos de la empresa guardados");
  render(); // actualiza el logo del menú y el estado
}

function renderUsers() {
  if (state.user.role !== "ADMIN")
    return '<div class="empty">Acceso denegado</div>';
  const users = getVisibleUsers();
  const saved = {};
  COMPANY_FIELDS.forEach((f) => {
    saved[f.id] = bizGet(f.id) || f.def || "";
  });

  return `
    <div class="header"><h1>Usuarios</h1><button class="btn btn-primary" onclick="state.modal={type:'user'};render()">+ Nuevo</button></div>

    <div class="card">
      <div class="card-header"><h2 class="card-title">🏢 Datos de la Empresa</h2></div>
      <form class="empresa-form" onsubmit="event.preventDefault();saveCompanyData()" oninput="updateCompanyStatus()" autocomplete="off">
        <div class="empresa-grid">
          ${COMPANY_FIELDS.map(
            (f) => `
            <div class="empresa-field ${f.full ? "full" : ""}">
              <label for="${f.id}"><span class="empresa-ico">${f.icon}</span>${f.label}</label>
              <input id="${f.id}" class="form-control" type="text" value="${escapeHtml(saved[f.id])}" placeholder="${f.ph}">
              <small>${f.hint}</small>
            </div>
          `,
          ).join("")}
        </div>

        <div id="empresa-status-box">${companyStatusHtml(saved, false)}</div>

        <div class="empresa-footer">
          <button id="empresa-save" type="submit" class="btn btn-primary">💾 Guardar cambios</button>
        </div>
      </form>
    </div>

    <div class="card">
      <div class="card-header"><h2 class="card-title">👥 Usuarios <span style="color:#64748b;font-weight:500;font-size:14px">(${users.length})</span></h2></div>
      <div style="overflow-x:auto">
        <table class="tabla-usuarios">
          <colgroup><col style="width:30%"><col style="width:16%"><col style="width:20%"><col style="width:20%"><col style="width:14%"></colgroup>
          <thead><tr><th>Usuario</th><th>Rol</th><th>Fecha</th><th>Creado por</th><th>Acciones</th></tr></thead>
          <tbody>
            ${users
              .map(
                (u) => `
              <tr>
                <td>
                  <div style="display:flex;align-items:center;gap:10px;min-width:0">
                    <div class="avatar" style="width:32px;height:32px;font-size:13px;flex-shrink:0">${escapeHtml((u.username || "?")[0].toUpperCase())}</div>
                    <strong>${escapeHtml(u.username || "")}</strong>
                  </div>
                </td>
                <td><span class="badge ${u.role === "ADMIN" ? "badge-warning" : "badge-info"}">${u.role === "ADMIN" ? "Administrador" : "Usuario"}</span></td>
                <td class="col-monto">${fmtDate(u.created)}</td>
                <td>${escapeHtml(getUserCreator(u.id))}</td>
                <td class="col-acciones">
                  <div class="acciones-fila">
                    <button class="btn btn-secondary btn-sm" onclick="state.modal={type:'user',user:${JSON.stringify(u).replace(/"/g, "&quot;")}};render()" title="Editar">✏️</button>
                    <button class="btn btn-danger btn-sm" onclick="confirmDeleteUser('${u.id}')" title="Eliminar">🗑️</button>
                  </div>
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

window.saveCompanyData = saveCompanyData;
window.updateCompanyStatus = updateCompanyStatus;

function renderReports() {
  const today = localDateStr(new Date());
  const selectedDate = state.reportDate || today;
  const sales = getSalesByDate(selectedDate);
  const total = sales.reduce((s, s2) => s + s2.total, 0);
  const displayDate = fmtDateStr(selectedDate);
  return `
    <div class="header"><h1>Reportes</h1><button class="btn btn-primary" onclick="exportPDF('${selectedDate}')">📥 Exportar PDF</button></div>
    <div class="card" style="margin-bottom:20px">
      <div class="card-header">
        <h2 class="card-title">Seleccionar Fecha</h2>
        <input type="date" id="report-date" class="form-control" style="width:200px;display:inline-block" value="${selectedDate}" onchange="state.reportDate=this.value;render()" />
        <button class="btn btn-secondary btn-sm" onclick="state.reportDate='${today}';render()" style="margin-left:8px">Hoy</button>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-icon blue">🧾</div><div class="stat-info"><h3>Transacciones</h3><div class="stat-value">${sales.length}</div></div></div>
      <div class="stat"><div class="stat-icon green">📦</div><div class="stat-info"><h3>Artículos</h3><div class="stat-value">${sales.reduce((s, s2) => s + s2.items.reduce((ss, i) => ss + i.quantity, 0), 0)}</div></div></div>
      <div class="stat"><div class="stat-icon orange">💰</div><div class="stat-info"><h3>Ingresos</h3>        <div class="stat-value">${fmtMoneyInvoice(total)}</div></div></div>
    </div>
    <div class="card">
      <div class="card-header"><h2 class="card-title">Detalle - ${displayDate}</h2></div>
      ${sales.length ? `<table><thead><tr><th>Cliente / ID</th><th>Hora</th><th>Productos</th><th>Total</th><th></th></tr></thead><tbody>${sales.map((s) => `<tr><td><strong>${s.customerName ? s.customerName : "#" + s.id}</strong></td><td>${new Date(s.created).toLocaleTimeString("es-ES")}</td><td>${s.items.map((i) => i.name).join(", ")}</td><td class="text-success" style="font-weight:600">${fmtMoneyInvoice(s.total)}</td><td><button class="btn btn-danger btn-sm" onclick="promptDeleteSale(${s.id})">🗑️</button></td></tr>`).join("")}</tbody><tfoot><tr style="background:#f8fafc"><td colspan="3" style="text-align:right;font-weight:600">TOTAL:</td><td class="text-success" style="font-weight:700;font-size:16px">${fmtMoneyInvoice(total)}</td><td></td></tr></tfoot></table>` : '<div class="empty">No hay ventas para esta fecha</div>'}
    </div>
  `;
}

function renderModal() {
  const m = state.modal;
  if (!m) return "";
  let html = "";
  if (m.type === "product") {
    const p = m.product || {};
    html = `
      <div class="modal-overlay" onclick="state.modal=null;render()">
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-header"><h2 class="modal-title">${p.id ? "Editar" : "Nuevo"} Producto</h2><button class="btn btn-secondary" onclick="state.modal=null;render()">✕</button></div>
          <form onsubmit="event.preventDefault();saveProduct({id:${p.id || "null"},name:this.n.value,price:parseFloat(this.pr.value),stock:parseInt(this.s.value),minStock:parseInt(this.m.value),barcode:this.b.value});state.modal=null;render()">
            <div class="modal-body">
              <div class="form-group"><label>Nombre *</label><input class="form-control" name="n" value="${p.name || ""}" required></div>
              <div class="form-row">
                <div class="form-group"><label>Precio *</label><input class="form-control" name="pr" type="number" step="0.01" value="${p.price || ""}" required></div>
                <div class="form-group"><label>Stock</label><input class="form-control" name="s" type="number" value="${p.stock || ""}"></div>
              </div>
              <div class="form-row">
                <div class="form-group"><label>Stock Mínimo</label><input class="form-control" name="m" type="number" value="${p.minStock || 10}"></div>
                <div class="form-group"><label>Barcode</label><input class="form-control" name="b" value="${p.barcode || ""}"></div>
              </div>
            </div>
            <div class="modal-footer"><button type="button" class="btn btn-secondary" onclick="state.modal=null;render()">Cancelar</button><button type="submit" class="btn btn-primary">${p.id ? "Actualizar" : "Crear"}</button></div>
          </form>
        </div>
      </div>
    `;
  } else if (m.type === "user") {
    const u = m.user || {};
    html = `
      <div class="modal-overlay" onclick="state.modal=null;render()">
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-header"><h2 class="modal-title">${u.id ? "Editar" : "Nuevo"} Usuario</h2><button class="btn btn-secondary" onclick="state.modal=null;render()">✕</button></div>
          <form onsubmit="event.preventDefault();saveUser({id:${u.id ? "'" + u.id + "'" : "null"},username:this.u.value,email:this.e?this.e.value:'',password:this.p?this.p.value:'',role:this.r.value}).then(ok=>{if(ok!==false){state.modal=null;render()}})">
            <div class="modal-body">
              <div class="form-group"><label>Usuario *</label><input class="form-control" name="u" value="${escapeHtml(u.username || "")}" ${u.id ? 'readonly style="background:#f1f5f9"' : ""} required></div>
              ${!u.id ? `<div class="form-group"><label>Correo (opcional)</label><input class="form-control" name="e" type="email" autocomplete="off" placeholder="correo@ejemplo.com"><small style="display:block;color:#64748b;margin-top:4px">Si lo escribes, esta persona entrará con ese correo y podrá recuperar su contraseña. Si lo dejas vacío, entra con su usuario.</small></div>` : ""}
              ${!u.id ? `<div class="form-group"><label>Contraseña * (mínimo 8 caracteres)</label><input class="form-control" name="p" type="password" autocomplete="new-password" minlength="8" required></div>` : ""}
              <div class="form-group"><label>Rol</label><select class="form-control" name="r"><option value="USER" ${u.role === "USER" ? "selected" : ""}>Usuario</option><option value="ADMIN" ${u.role === "ADMIN" ? "selected" : ""}>Administrador</option></select></div>
            </div>
            <div class="modal-footer"><button type="button" class="btn btn-secondary" onclick="state.modal=null;render()">Cancelar</button><button type="submit" class="btn btn-primary">${u.id ? "Actualizar" : "Crear"}</button></div>
          </form>
        </div>
      </div>
    `;
  } else if (m.type === "barcode") {
    html = `
      <div class="modal-overlay" onclick="state.modal=null;render()">
        <div class="modal" onclick="event.stopPropagation()" style="max-width:350px">
          <div class="modal-header"><h2 class="modal-title">Código de Barras</h2><button class="btn btn-secondary" onclick="state.modal=null;render()">✕</button></div>
          <div class="modal-body" style="text-align:center">
            <h3 style="margin-bottom:16px">${m.name}</h3>
            <svg id="barcode"></svg>
            <p style="margin-top:16px;font-family:monospace;color:#64748b">${m.barcode}</p>
          </div>
        </div>
      </div>
    `;
  } else if (m.type === "payment") {
    html = `
      <div class="modal-overlay" onclick="state.modal=null;render()">
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-header"><h2 class="modal-title">Datos del Cliente y Facturación</h2><button class="btn btn-secondary" onclick="state.modal=null;render()">✕</button></div>
          <div class="modal-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
              <div class="form-group" style="margin-bottom:0">
                <label>Nombre del Cliente</label>
                <input type="text" id="customer-name" class="form-control" autocomplete="off" placeholder="Nombre completo">
              </div>
              <div class="form-group" style="margin-bottom:0">
                <label>Teléfono del Cliente</label>
                <input type="text" id="customer-phone" class="form-control" autocomplete="off" placeholder="(000) 000-0000">
              </div>
            </div>
            <div class="form-group" style="margin-bottom:20px">
              <label>Notas</label>
              <textarea id="sale-notes" class="form-control" rows="2" autocomplete="off" placeholder="Información adicional, instrucciones especiales..."></textarea>
            </div>

            <div class="receipt-type-section">
              <label class="receipt-type-label">Tipo de Comprobante</label>
              <select id="receipt-type" class="form-control" onchange="updateReceiptType()">
                <option value="normal" ${m.receiptType === "normal" ? "selected" : ""}>💵 Comprobante Normal</option>
                <option value="fiscal" ${m.receiptType === "fiscal" ? "selected" : ""}>🧾 Comprobante Fiscal</option>
              </select>
              ${m.receiptType === "fiscal" ? `<div class="receipt-rnc-display" style="margin-top:10px">RNC: ${bizGet("bizrnc") || '<span style="color:#94a3b8">Sin RNC configurado</span>'}</div>` : ""}
            </div>

            ${
              m.paymentMode === "sale"
                ? `
              <div class="form-group" style="margin-bottom:20px">
                <label>Monto pagado por el cliente</label>
                <input type="number" id="paid-amount" class="form-control" placeholder="0.00" step="0.01" oninput="updateChange()">
              </div>
              <div id="change-display" style="background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;padding:12px;border-radius:8px;margin-bottom:20px;display:none;text-align:center;font-weight:700;font-size:16px">
                Cambio: RD$ 0.00
              </div>
            `
                : ""
            }
            <div style="background:#f8fafc;padding:16px;border-radius:8px;margin-bottom:20px">
              <div style="display:flex;flex-direction:column;gap:6px">
                 <div style="display:flex;justify-content:space-between">
                   <span>Subtotal:</span>
                   <span>${fmtMoneyInvoice(m.subtotal)}</span>
                 </div>
                 <div style="display:flex;justify-content:space-between">
                   <span>ITBIS (18%):</span>
                   <span>${fmtMoneyInvoice(m.itbis)}</span>
                 </div>
                 <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:700;color:#10b981;border-top:1px solid #e2e8f0;padding-top:8px;margin-top:4px">
                   <span>Total:</span>
                   <span>${fmtMoneyInvoice(m.total)}</span>
                 </div>
              </div>
            </div>
            <p style="margin-bottom:20px;color:#64748b;font-size:12px">
              ${m.paymentMode === "sale" ? "Seleccione la forma de pago:" : "Generar cotización sin pago:"}
            </p>
            <div style="display:flex;flex-direction:column;gap:12px">
               ${
                 m.paymentMode === "sale"
                   ? `
                 <button class="btn btn-success" style="padding:14px;font-size:15px" onclick="submitSale('contado')">
                   💵 Cobrar
                   <div style="font-size:12px;font-weight:normal;margin-top:4px">Total: ${fmtMoneyInvoice(m.subtotal + m.itbis)}</div>
                 </button>
              `
                   : ""
               }
              ${
                m.paymentMode === "quote"
                  ? `
                <button class="btn btn-secondary" style="padding:14px;font-size:15px" onclick="submitQuote()">
                  📄 Generar Cotización
                  <div style="font-size:12px;font-weight:normal;margin-top:4px">Guardar como borrador sin pago</div>
                </button>
              `
                  : ""
              }
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (m.type === "quickAddProduct") {
    html = `
      <div class="modal-overlay" onclick="state.modal=null;render()">
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-header"><h2 class="modal-title">Agregar Producto</h2><button class="btn btn-secondary" onclick="state.modal=null;render()">✕</button></div>
          <form onsubmit="event.preventDefault();saveQuickProduct(this.n.value,this.pr.value,this.s.value,this.m.value,this.b.value)">
            <div class="modal-body">
              <div class="alert-box" style="background:#dbeafe;color:#1e40af;border-color:#93c5fd;margin-bottom:15px">
                Código detectado: <strong>${m.barcode}</strong>
              </div>
              <div class="form-group"><label>Nombre *</label><input class="form-control" name="n" placeholder="Nombre del producto" required></div>
              <div class="form-row">
                <div class="form-group"><label>Precio *</label><input class="form-control" name="pr" type="number" step="0.01" placeholder="0.00" required></div>
                <div class="form-group"><label>Stock</label><input class="form-control" name="s" type="number" value="0"></div>
              </div>
              <div class="form-row">
                <div class="form-group"><label>Stock Mínimo</label><input class="form-control" name="m" type="number" value="5"></div>
                <div class="form-group"><label>Código</label><input class="form-control" name="b" value="${m.barcode}" readonly style="background:#f3f4f6"></div>
              </div>
            </div>
            <div class="modal-footer"><button type="button" class="btn btn-secondary" onclick="state.modal=null;render()">Cancelar</button><button type="submit" class="btn btn-primary">Agregar</button></div>
          </form>
        </div>
      </div>
    `;
  } else if (m.type === "barcodePrint") {
    const p = m.product || {};
    html = `
      <div class="modal-overlay" onclick="state.modal=null;render()">
        <div class="modal" onclick="event.stopPropagation()" style="max-width:400px">
          <div class="modal-header"><h2 class="modal-title">Imprimir Etiqueta</h2><button class="btn btn-secondary" onclick="state.modal=null;render()">✕</button></div>
          <div class="modal-body" style="text-align:center">
            <h3 style="margin-bottom:16px">${p.name}</h3>
            <p style="margin-bottom:20px;color:#64748b">Codigo: <strong>${p.barcode || "-"}</strong></p>
            <div class="form-group" style="text-align:left">
              <label>Cantidad de etiquetas</label>
              <input id="label-qty" class="form-control" type="number" min="1" max="500" value="1" style="font-size:18px;text-align:center;font-weight:600">
            </div>
            <p style="color:#64748b;font-size:12px">Formato: 60 x 25 mm</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="state.modal=null;render()">Cancelar</button>
            <button type="button" class="btn btn-success" onclick="printSingleLabel(state.modal.product, parseInt(document.getElementById('label-qty').value))">🖨️ Imprimir</button>
          </div>
        </div>
      </div>
    `;
  } else if (m.type === "camera") {
    html = `
      <div class="modal-overlay" onclick="stopCameraScan();state.modal=null;render()">
        <div class="modal" onclick="event.stopPropagation()" style="max-width:500px">
          <div class="modal-header">
            <h2 class="modal-title">Escáner de Código</h2>
            <button class="btn btn-secondary" onclick="event.stopPropagation();stopCameraScan();state.modal=null;render()">✕</button>
          </div>
          <div class="modal-body" style="text-align:center">
            <p style="margin-bottom:15px;color:#64748b">Apunta el código de barras o QR con la cámara</p>
            <div id="camera-reader" style="width:100%;max-width:400px;margin:0 auto;border:2px solid #e2e8f0;border-radius:8px;overflow:hidden"></div>
          </div>
        </div>
      </div>
     `;
  } else if (m.type === "terms") {
    html = `
      <div class="modal-overlay" onclick="state.modal=null;render()">
        <div class="modal" onclick="event.stopPropagation()" style="max-width:600px;max-height:80vh">
          <div class="modal-header">
            <h2 class="modal-title">Términos y Condiciones</h2>
            <button class="btn btn-secondary" onclick="state.modal=null;render()">✕</button>
          </div>
          <div class="modal-body" style="max-height:60vh;overflow-y:auto">
            <div style="font-size:13px;line-height:1.6;color:#333">
              <h3 style="color:#2563eb">1. Aceptación de los términos</h3>
              <p>Al acceder y utilizar SalesStock Pro, usted acepta estar vinculado por estos Términos y Condiciones. Si no está de acuerdo con alguna parte de estos términos, no utilice el servicio.</p>
              
              <h3 style="color:#2563eb">2. Descripción del servicio</h3>
              <p>SalesStock Pro es un sistema de gestión de ventas e inventario que permite administrar productos, realizar ventas, gestionar créditos y generar reportes.</p>
              
              <h3 style="color:#2563eb">3. Cuentas de usuario</h3>
              <p><strong>3.1 Registro:</strong> Debe proporcionar información verdadera y precisa. Es responsable de mantener la confidencialidad de su contraseña.</p>
              <p><strong>3.2 Licencias:</strong> Cada empresa opera bajo una licencia única. No se permite el uso compartido de licencias. La licencia se vincula a un único usuario administrador.</p>
              
              <h3 style="color:#2563eb">4. Uso aceptable</h3>
              <p><strong>Permitido:</strong> Uso del sistema para gestión comercial legítima, acceso a datos de su propia empresa, generación de reportes.</p>
              <p><strong>Prohibido:</strong> Acceso no autorizado a datos de otras empresas, modificación de controles de seguridad, distribución de credenciales, uso para actividades ilegales.</p>
              
              <h3 style="color:#2563eb">5. Propiedad intelectual</h3>
              <p>SalesStock Pro, su código fuente, base de datos, diseños y marca son propiedad de su propietario. Queda prohibida la reproducción, distribución o modificación sin autorización por escrito.</p>
              
              <h3 style="color:#2563eb">6. Limitación de responsabilidad</h3>
              <p>El sistema se proporciona "tal cual" sin garantías. No nos hacemos responsables por pérdida de datos, interrupciones del servicio o daños indirectos del uso del sistema.</p>
              
              <h3 style="color:#2563eb">7. Terminación</h3>
              <p>Nos reservamos el derecho de suspender o terminar cuentas que violen estos términos, realicen actividades fraudulentas o no cumplan con los pagos de licencia.</p>
              
              <h3 style="color:#2563eb">8. Modificaciones</h3>
              <p>Estos términos pueden ser actualizados. Se notificará a los usuarios sobre cambios significativos.</p>
              
              <h3 style="color:#2563eb">9. Ley aplicable</h3>
              <p>Estos términos se rigen por las leyes de la jurisdicción del propietario del sistema.</p>
              
              <h3 style="color:#2563eb">10. Contacto</h3>
              <p>Para consultas: legal@salesstock.local</p>
              
              <hr style="margin:10px 0;border-color:#e2e8f0">
              <p style="font-size:11px;color:#64748b">Última actualización: 2026-10-08 | Versión: 1.0</p>
            </div>
          </div>
          <div class="modal-footer" style="text-align:center;padding:10px;border-top:1px solid #e2e8f0">
            <button class="btn btn-primary" onclick="state.modal=null;render()">Entendido</button>
          </div>
        </div>
      </div>
    `;
  }
  return html;
}

function showBarcode(barcode, name) {
  state.modal = { type: "barcode", barcode, name };
  render();
  setTimeout(() => {
    JsBarcode("#barcode", barcode, {
      format: "CODE128",
      width: 2,
      height: 80,
      displayValue: true,
      fontSize: 14,
    });
  }, 100);
}

function exportPDF(dateStr) {
  dateStr = dateStr || localDateStr(new Date());
  const sales = [...getSalesByDate(dateStr)].sort(
    (a, b) => new Date(a.created) - new Date(b.created),
  );

  const total = sales.reduce((s, x) => s + (x.total || 0), 0);
  const subtotal = sales.reduce((s, x) => s + (x.subtotal || 0), 0);
  const itbis = sales.reduce((s, x) => s + (x.itbis || 0), 0);
  const itemCount = sales.reduce(
    (s, x) => s + x.items.reduce((ss, i) => ss + i.quantity, 0),
    0,
  );

  const money = (v) =>
    "RD$ " +
    Number(v || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const customName = bizCustomName();
  const bizName = (customName || DEFAULT_BRAND).trim();
  const bizRnc = bizGet("bizrnc") || "";
  const bizPhone = bizGet("bizphone") || "";
  const bizEmail = bizGet("bizemail") || "";
  const bizAddr = bizGet("bizaddress") || "";
  const logoWord = customName || "SalesStock";
  const reportDate = dateStr
    ? fmtDateStr(dateStr)
    : fmtDateStr(localDateStr(new Date()));
  const generatedBy = state.user ? state.user.username : "Sistema";

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PW = 210,
    PH = 297,
    M = 12,
    IW = PW - M * 2;
  const DARK = [30, 41, 59],
    BLUE = [37, 99, 235],
    GREEN = [16, 185, 129],
    AMBER = [245, 158, 11];
  const GRAY = [100, 116, 139],
    BORDER = [226, 232, 240],
    SOFT = [248, 250, 252],
    WHITE = [255, 255, 255];

  // ===== Encabezado oscuro =====
  doc.setFillColor(...DARK);
  doc.rect(0, 0, PW, 34, "F");

  doc.setFont(FONT, "bold");
  let repLogoSize = 22;
  doc.setFontSize(repLogoSize);
  while (
    repLogoSize > 11 &&
    doc.getTextWidth(logoWord + (customName ? "" : "Pro")) > 105
  ) {
    repLogoSize -= 1;
    doc.setFontSize(repLogoSize);
  }
  const logoShown = customName ? abbreviateText(doc, logoWord, 105) : logoWord;
  const w1 = doc.getTextWidth(logoShown);
  doc.setTextColor(...BLUE);
  doc.text(logoShown, M, 15);
  if (!customName) {
    doc.setTextColor(...WHITE);
    doc.text("Pro", M + w1, 15);
  }

  doc.setFont(FONT, "normal");
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  const info = [bizPhone && "Tel: " + bizPhone, bizEmail, bizAddr]
    .filter(Boolean)
    .join("   |   ");
  if (info) doc.text(abbreviateText(doc, info, 110), M, 22);
  if (bizRnc) doc.text("RNC: " + bizRnc, M, 27);

  doc.setFont(FONT, "bold");
  doc.setFontSize(14);
  doc.setTextColor(...WHITE);
  doc.text("REPORTE DE VENTAS", PW - M, 13, { align: "right" });
  doc.setFont(FONT, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text("Fecha: " + reportDate, PW - M, 20, { align: "right" });
  doc.text("Generado por: " + generatedBy, PW - M, 25, { align: "right" });
  doc.text("Emitido: " + new Date().toLocaleString("es-ES"), PW - M, 30, {
    align: "right",
  });

  // ===== Tarjetas de resumen =====
  const cards = [
    { label: "TRANSACCIONES", value: String(sales.length), color: BLUE },
    { label: "ARTÍCULOS VENDIDOS", value: String(itemCount), color: AMBER },
    { label: "ITBIS (18%)", value: money(itbis), color: DARK },
    { label: "INGRESOS", value: money(total), color: GREEN },
  ];
  const gap = 4;
  const cw = (IW - gap * 3) / 4;
  const cy = 42,
    ch = 20;
  cards.forEach((c, i) => {
    const x = M + i * (cw + gap);
    doc.setFillColor(...SOFT);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, cy, cw, ch, 2.5, 2.5, "FD");
    doc.setFillColor(...c.color);
    doc.roundedRect(x, cy, 1.8, ch, 0.9, 0.9, "F");
    doc.setFont(FONT, "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...GRAY);
    doc.text(c.label, x + 5, cy + 7);
    let fs = 13;
    doc.setFontSize(fs);
    while (fs > 8 && doc.getTextWidth(c.value) > cw - 8) {
      fs -= 0.5;
      doc.setFontSize(fs);
    }
    doc.setTextColor(...c.color);
    doc.text(c.value, x + 5, cy + 15.5);
  });

  // ===== Tabla =====
  const colHora = M + 3;
  const colCli = M + 20;
  const colProd = M + 66;
  const colTipo = M + 134;
  const colTotal = PW - M - 3;
  const prodW = colTipo - colProd - 4;
  const cliW = colProd - colCli - 4;
  const BOTTOM = PH - 18;

  let y = 70;
  doc.setFont(FONT, "bold");
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.text("DETALLE DE VENTAS", M, y);
  y += 4;

  function tableHeader() {
    doc.setFillColor(...DARK);
    doc.roundedRect(M, y, IW, 8, 1.5, 1.5, "F");
    doc.setFont(FONT, "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...WHITE);
    doc.text("HORA", colHora, y + 5.3);
    doc.text("CLIENTE / FACTURA", colCli, y + 5.3);
    doc.text("PRODUCTOS", colProd, y + 5.3);
    doc.text("TIPO", colTipo, y + 5.3);
    doc.text("TOTAL", colTotal, y + 5.3, { align: "right" });
    y += 10;
  }
  tableHeader();

  if (sales.length === 0) {
    doc.setFont(FONT, "italic");
    doc.setFontSize(10);
    doc.setTextColor(...GRAY);
    doc.text("No hay ventas registradas para esta fecha", PW / 2, y + 12, {
      align: "center",
    });
    y += 24;
  }

  sales.forEach((s, idx) => {
    const time = new Date(s.created).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const cliente = s.customerName || "Sin nombre";

    doc.setFont(FONT, "bold");
    doc.setFontSize(8.5);
    let cliLines = doc.splitTextToSize(cliente, cliW);
    if (cliLines.length > 2) cliLines = cliLines.slice(0, 2);
    cliLines = cliLines.map((l) => abbreviateText(doc, l, cliW));

    doc.setFont(FONT, "normal");
    doc.setFontSize(7.5);
    const prodLines = doc.splitTextToSize(
      s.items.map((i) => i.name + " (" + i.quantity + ")").join(", "),
      prodW,
    );

    const leftH = cliLines.length * 3.8 + 3.5;
    const rowH = Math.max(leftH, prodLines.length * 3.5) + 4;

    if (y + rowH > BOTTOM) {
      doc.addPage();
      y = M;
      tableHeader();
    }

    if (idx % 2 === 0) {
      doc.setFillColor(...SOFT);
      doc.rect(M, y - 1, IW, rowH, "F");
    }

    doc.setFont(FONT, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...DARK);
    doc.text(time, colHora, y + 3.5);

    doc.setFont(FONT, "bold");
    doc.setFontSize(8.5);
    doc.text(cliLines, colCli, y + 3.5);
    doc.setFont(FONT, "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...GRAY);
    doc.text("N° " + s.id, colCli, y + 3.5 + cliLines.length * 3.8);

    doc.setFontSize(7.5);
    doc.setTextColor(...DARK);
    doc.text(prodLines, colProd, y + 3.5);

    const fiscal = s.receiptType === "fiscal";
    doc.setFont(FONT, "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...(fiscal ? BLUE : GRAY));
    doc.text(fiscal ? "Fiscal" : "Normal", colTipo, y + 3.5);

    doc.setFontSize(9);
    doc.setTextColor(...GREEN);
    doc.text(money(s.total), colTotal, y + 3.5, { align: "right" });

    y += rowH;
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.2);
    doc.line(M, y - 1, M + IW, y - 1);
  });

  // ===== Totales =====
  y += 4;
  if (y + 32 > BOTTOM) {
    doc.addPage();
    y = M;
  }
  const bw = 84,
    bx = PW - M - bw;
  doc.setFillColor(...SOFT);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.roundedRect(bx, y, bw, 30, 2.5, 2.5, "FD");

  doc.setFont(FONT, "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...GRAY);
  doc.text("Subtotal", bx + 5, y + 8);
  doc.text("ITBIS (18%)", bx + 5, y + 14.5);
  doc.setTextColor(...DARK);
  doc.text(money(subtotal), bx + bw - 5, y + 8, { align: "right" });
  doc.text(money(itbis), bx + bw - 5, y + 14.5, { align: "right" });

  doc.setFillColor(...GREEN);
  doc.roundedRect(bx + 3, y + 18.5, bw - 6, 9, 2, 2, "F");
  doc.setFont(FONT, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...WHITE);
  doc.text("TOTAL", bx + 7, y + 24.8);
  doc.text(money(total), bx + bw - 7, y + 24.8, { align: "right" });

  // ===== Pie de página en todas las páginas =====
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.3);
    doc.line(M, PH - 12, PW - M, PH - 12);
    doc.setFont(FONT, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(bizName + " · Reporte de ventas " + reportDate, M, PH - 7);
    doc.text("Página " + p + " de " + pages, PW - M, PH - 7, {
      align: "right",
    });
  }

  doc.save("reporte-" + dateStr + ".pdf");
}
function printBarcodeLabels() {
  const products = getProducts();
  generateLabelPDF(products);
}

function printSingleLabel(product, quantity) {
  if (!quantity || quantity < 1) quantity = 1;
  const list = [];
  for (let i = 0; i < quantity; i++) list.push(product);
  generateLabelPDF(list);
}

function generateLabelPDF(products) {
  if (!products.length) {
    alert("No hay productos para imprimir");
    return;
  }

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // ===== Medidas de la etiqueta (puedes ajustarlas) =====
  const W = 95; // ancho
  const H = 60; // alto
  const cols = 2;
  const gapX = 4;
  const gapY = 5;
  const marginY = 12;
  const marginX = (210 - (cols * W + (cols - 1) * gapX)) / 2;
  const rowsPerPage = Math.floor((297 - marginY * 2 + gapY) / (H + gapY));
  const R = 3; // radio de las esquinas
  const HEADER_H = 12;
  const FOOTER_H = 14;

  // ===== Colores del sistema =====
  const DARK = [30, 41, 59]; // --secondary
  const BLUE = [37, 99, 235]; // --primary
  const GREEN = [16, 185, 129]; // --success
  const GRAY = [100, 116, 139]; // --text-sec
  const BORDER = [226, 232, 240];
  const SOFT = [248, 250, 252];
  const WHITE = [255, 255, 255];

  // Logo igual al del menú lateral: primera palabra en azul + "Pro" en blanco
  const labelCustom = bizCustomName();
  const logoWord = labelCustom || "SalesStock";
  const proSuffix = labelCustom ? "" : "Pro";

  let col = 0,
    row = 0;

  products.forEach((p) => {
    if (row >= rowsPerPage) {
      doc.addPage();
      row = 0;
      col = 0;
    }

    const x = marginX + col * (W + gapX);
    const y = marginY + row * (H + gapY);
    const cx = x + W / 2;
    const code = String(p.barcode || "S" + p.id);

    // ----- Fondo blanco -----
    doc.setFillColor(...WHITE);
    doc.roundedRect(x, y, W, H, R, R, "F");

    // ----- Encabezado oscuro (solo esquinas superiores redondeadas) -----
    doc.setFillColor(...DARK);
    doc.roundedRect(x, y, W, HEADER_H, R, R, "F");
    doc.rect(x, y + HEADER_H / 2, W, HEADER_H / 2, "F");

    // Logo: se reduce la letra si el nombre es muy largo
    let logoSize = 13;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(logoSize);
    while (logoSize > 8 && doc.getTextWidth(logoWord + proSuffix) > W - 10) {
      logoSize -= 0.5;
      doc.setFontSize(logoSize);
    }
    const logoShown = proSuffix
      ? logoWord
      : abbreviateText(doc, logoWord, W - 10);
    const w1 = doc.getTextWidth(logoShown);
    const w2 = doc.getTextWidth(proSuffix);
    const logoX = cx - (w1 + w2) / 2;
    doc.setTextColor(...BLUE);
    doc.text(logoShown, logoX, y + 8.2);
    if (proSuffix) {
      doc.setTextColor(...WHITE);
      doc.text(proSuffix, logoX + w1, y + 8.2);
    }

    // ----- Nombre del producto (máx. 2 líneas) -----
    doc.setTextColor(...DARK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    let lines = doc.splitTextToSize((p.name || "").toUpperCase(), W - 10);
    if (lines.length > 2) {
      lines = lines.slice(0, 2);
      lines[1] = abbreviateText(doc, lines[1] + "...", W - 10);
    }
    if (lines.length === 1) {
      doc.text(lines[0], cx, y + 20, { align: "center" });
    } else {
      doc.text(lines[0], cx, y + 18.5, { align: "center" });
      doc.text(lines[1], cx, y + 23, { align: "center" });
    }

    // ----- Código de barras (con proporción correcta) -----
    const canvas = document.createElement("canvas");
    try {
      JsBarcode(canvas, code, {
        format: "CODE128",
        lineColor: "#1e293b",
        width: 2,
        height: 60,
        margin: 4,
        displayValue: false,
      });
      const ratio = canvas.width / canvas.height;
      let drawH = 13;
      let drawW = drawH * ratio;
      if (drawW > W - 16) {
        drawW = W - 16;
        drawH = drawW / ratio;
      }
      doc.addImage(
        canvas.toDataURL("image/png"),
        "PNG",
        cx - drawW / 2,
        y + 26,
        drawW,
        drawH,
      );
    } catch (e) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...DARK);
      doc.text(code, cx, y + 34, { align: "center" });
    }

    // ----- Código en texto -----
    doc.setFont("courier", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(code, cx, y + 43, { align: "center" });

    // ----- Pie claro (solo esquinas inferiores redondeadas) -----
    const fy = y + H - FOOTER_H;
    doc.setFillColor(...SOFT);
    doc.roundedRect(x, fy, W, FOOTER_H, R, R, "F");
    doc.rect(x, fy, W, FOOTER_H / 2, "F");
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.3);
    doc.line(x, fy, x + W, fy);

    // "PRECIO" a la izquierda
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text("PRECIO", x + 6, fy + 8.3);

    // Monto en píldora verde a la derecha
    const priceText = fmtMoneyInvoice(p.price);
    doc.setFontSize(13);
    const pillW = doc.getTextWidth(priceText) + 9;
    const pillH = 9;
    const pillX = x + W - 5 - pillW;
    const pillY = fy + (FOOTER_H - pillH) / 2;
    doc.setFillColor(...GREEN);
    doc.roundedRect(pillX, pillY, pillW, pillH, 2.5, 2.5, "F");
    doc.setTextColor(...WHITE);
    doc.text(priceText, pillX + pillW / 2, pillY + 6.4, { align: "center" });

    // ----- Borde exterior (al final, para que quede encima) -----
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, y, W, H, R, R, "S");

    col++;
    if (col >= cols) {
      col = 0;
      row++;
    }
  });

  doc.save("etiquetas.pdf");
}
// Exponer al window para que el HTML pueda acceder
window.state = state;
window.logout = logout;
window.loginWithGoogle = loginWithGoogle;
window.registerUser = registerUser;
window.validateRegisterLicense = validateRegisterLicense;
window.activateLicense = activateLicense;
window.generateLicense = generateLicense;
window.deleteLicense = deleteLicense;
window.deleteLicenseFromBtn = deleteLicenseFromBtn;
window.showPaymentOptions = showPaymentOptions;
window.updateChange = updateChange;
window.updateReceiptType = updateReceiptType;
window.submitSale = submitSale;
window.submitQuote = submitQuote;
window.previewSaleInvoice = previewSaleInvoice;
window.showAllSalesModal = showAllSalesModal;
window.isDirty = false;

// Marcar changes cuando el carrito cambia
const originalAddToCart = addToCart;
addToCart = function (product) {
  originalAddToCart(product);
  window.isDirty = true;
};

const originalUpdateCartQty = updateCartQty;
updateCartQty = function (id, qty) {
  originalUpdateCartQty(id, qty);
  window.isDirty = true;
};

const originalRemoveFromCart = removeFromCart;
removeFromCart = function (id) {
  originalRemoveFromCart(id);
  window.isDirty = true;
};

const originalCancelCart = cancelCart;
cancelCart = async function () {
  await originalCancelCart();
  // Solo se limpia la marca si el carrito realmente se vació (el usuario pudo decir "No")
  if (!state.cart.length) window.isDirty = false;
};

const originalCompleteSale = completeSale;
completeSale = function (paymentType, customerData) {
  originalCompleteSale(paymentType, customerData);
  window.isDirty = false;
};

const originalMakeQuote = makeQuote;
makeQuote = function (customerData) {
  originalMakeQuote(customerData);
  window.isDirty = false;
};

// Confirmar antes de recargar/cerrar pestaña
window.addEventListener("beforeunload", (e) => {
  if (window.isDirty && state.cart && state.cart.length > 0) {
    e.preventDefault();
    e.returnValue =
      "Tienes productos en el carrito. ¿Seguro que quieres salir?";
    return "Tienes productos en el carrito. ¿Seguro que quieres salir?";
  }
});

// ===== INICIALIZACIÓN CON FIREBASE =====
(async function bootstrap() {
  if (typeof firebase === "undefined" || !window.FB_DB) {
    state.loading = false;
    state.loginError =
      "No se pudo cargar Firebase. Verifica tu conexión y firebase-config.js";
    render();
    return;
  }

  window.App.Services.FirebaseAuth.onAuthChange(async (user) => {
    if (sessionLoading) return; // se está creando una cuenta: registerUser se encarga
    if (user) {
      try {
        await loadSession(user);
      } catch (e) {
        console.error("Error cargando la sesión", e);
        state.user = null;
        state.page = "login";
        state.loginError =
          "No se pudo cargar tu sesión. Verifica tu conexión e inténtalo de nuevo.";
      }
    } else {
      state.user = null;
      state.page = "login";
    }
    state.loading = false;
    render();
  });
})();
