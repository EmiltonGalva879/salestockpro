describe('Utils', () => {
  beforeEach(() => {
    window.App = window.App || {};
    window.App.Utils = {
      fmtMoney: (v) => 'RD$' + v.toFixed(2),
      fmtMoneyInvoice: (v) => 'RD$ ' + Number(v).toFixed(2),
      round2: (n) => Math.round((Number(n) || 0) * 100) / 100,
      roundPeso: (n) => Math.round(Number(n) || 0),
      fmtDate: (d) => new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      ITBIS_RATE: 0.18
    };
  });

  test('fmtMoney formatea decimales', () => {
    expect(window.App.Utils.fmtMoney(10)).toBe('RD$10.00');
    expect(window.App.Utils.fmtMoney(10.5)).toBe('RD$10.50');
  });

  test('fmtMoneyInvoice muestra 2 decimales', () => {
    expect(window.App.Utils.fmtMoneyInvoice(10)).toBe('RD$ 10.00');
    expect(window.App.Utils.fmtMoneyInvoice(10.5)).toBe('RD$ 10.50');
  });

  test('round2 redondea a 2 decimales', () => {
    expect(window.App.Utils.round2(10.555)).toBe(11);
    expect(window.App.Utils.round2(10.554)).toBe(11);
    expect(window.App.Utils.round2(10.345)).toBe(10);
  });

  test('roundPeso redondea a entero', () => {
    expect(window.App.Utils.roundPeso(10.7)).toBe(11);
    expect(window.App.Utils.roundPeso(10.2)).toBe(10);
  });

  test('ITBIS_RATE es 0.18', () => {
    expect(window.App.Utils.ITBIS_RATE).toBe(0.18);
  });
});

describe('FirebaseAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    window.App = window.App || {};
    window.App.Services = window.App.Services || {};

    const authUsers = [{ uid: 1, email: 'admin@sistema.local', password: 'test-password-123' }];
    const firestoreUsers = [{ id: 1, username: 'Sistemapro', email: 'admin@sistema.local', role: 'ADMIN' }];
    window.App.Services.DB = {
      _cache: { users: firestoreUsers },
      get(key) { return this._cache[key] || []; },
      set(key, data) { this._cache[key] = data; }
    };

    window.FB_AUTH = {
      async createUserWithEmailAndPassword(email, password) {
        const user = { uid: 'u_' + Date.now(), email };
        authUsers.push({ uid: user.uid, email, password });
        return { user };
      },
      async signInWithEmailAndPassword(email, password) {
        const found = authUsers.find(u => u.email === email && u.password === password);
        if (!found) throw { code: 'auth/wrong-password' };
        return { user: { uid: found.uid, email: found.email } };
      },
      async signInWithPopup() {
        return { user: { uid: 'g_1', email: 'google@test.com' } };
      }
    };
  });

  test('register crea usuario y lo guarda', async () => {
    require('../js/services/firebase-auth.service.js');
    const svc = window.App.Services.FirebaseAuth;
    const before = window.App.Services.DB.get('users').length;
    const profile = await svc.register('nuevo', 'secret123');
    const after = window.App.Services.DB.get('users').length;
    expect(after).toBe(before + 1);
    expect(profile.email).toBe('nuevo@sistema.local');
  });

  test('login con credenciales correctas retorna perfil', async () => {
    const svc = window.App.Services.FirebaseAuth;
    const profile = await svc.login('admin', 'test-password-123');
    expect(profile.email).toBe('admin@sistema.local');
  });

  test('login con password incorrecta lanza error', async () => {
    const svc = window.App.Services.FirebaseAuth;
    await expect(svc.login('admin', 'bad')).rejects.toBeDefined();
  });
});
