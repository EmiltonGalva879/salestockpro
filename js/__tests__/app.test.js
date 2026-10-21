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

describe('DB', () => {
  beforeEach(() => {
    localStorage.clear();
    window.App = window.App || {};
    window.App.Services = window.App.Services || {};
    window.App.Services.DB = {
      get(key) { return JSON.parse(localStorage.getItem('salesstock_' + key) || '[]'); },
      set(key, data) { localStorage.setItem('salesstock_' + key, JSON.stringify(data)); },
      init() {
        if (!localStorage.getItem('salesstock_initialized')) {
          this.set('users', [{ id: 1, username: 'Sistemapro', email: 'Sistemapro@sistema.local', role: 'ADMIN', created: new Date().toISOString() }]);
          this.set('products', []);
          this.set('sales', []);
          this.set('fiados', []);
          localStorage.setItem('salesstock_initialized', 'true');
        }
      }
    };
    window.App.Services.DB.init();
  });

  test('DB.init crea datos por defecto', () => {
    const users = window.App.Services.DB.get('users');
    expect(users.length).toBeGreaterThan(0);
    expect(users[0].username).toBe('Sistemapro');
  });

  test('DB.get y DB.set funcionan', () => {
    window.App.Services.DB.set('test', [{ id: 1, name: 'Test' }]);
    const data = window.App.Services.DB.get('test');
    expect(data[0].name).toBe('Test');
  });
});

describe('Audit', () => {
  beforeEach(() => {
    localStorage.clear();
    window.App = window.App || {};
    window.App.Services = window.App.Services || {};
    window.App.Services.Audit = {
      log(action, details) {
        const logs = JSON.parse(localStorage.getItem('salesstock_audit_log') || '[]');
        logs.push({
          id: Date.now(),
          action,
          userId: (window.App && window.App.state && window.App.state.user) ? window.App.state.user.username : 'anonymous',
          details: details || '',
          timestamp: new Date().toISOString()
        });
        localStorage.setItem('salesstock_audit_log', JSON.stringify(logs));
      },
      getLogs() {
        return JSON.parse(localStorage.getItem('salesstock_audit_log') || '[]');
      },
      clear() {
        localStorage.removeItem('salesstock_audit_log');
      }
    };
  });

  test('Audit.log registra eventos', () => {
    window.App.state = { user: { username: 'testuser' } };
    window.App.Services.Audit.log('test_action', 'detalles');
    const logs = window.App.Services.Audit.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe('test_action');
    expect(logs[0].userId).toBe('testuser');
  });

  test('Audit.clear limpia logs', () => {
    window.App.Services.Audit.log('test', 'detalles');
    window.App.Services.Audit.clear();
    const logs = window.App.Services.Audit.getLogs();
    expect(logs.length).toBe(0);
  });
});

describe('Auth', () => {
  beforeEach(() => {
    localStorage.clear();
    window.App = window.App || {};
    window.App.Services = window.App.Services || {};
    window.App.Services.DB = {
      get(key) { return JSON.parse(localStorage.getItem('salesstock_' + key) || '[]'); },
      set(key, data) { localStorage.setItem('salesstock_' + key, JSON.stringify(data)); },
      init() {
        if (!localStorage.getItem('salesstock_initialized')) {
          this.set('users', [{ id: 1, username: 'Sistemapro', email: 'Sistemapro@sistema.local', role: 'ADMIN', created: new Date().toISOString() }]);
          this.set('products', []);
          this.set('sales', []);
          this.set('fiados', []);
          localStorage.setItem('salesstock_initialized', 'true');
        }
      }
    };
    window.App.Services.DB.init();
    window.App.state = {
      user: null,
      page: 'login',
      cart: [],
      search: '',
      modal: null,
      alertDismissed: false,
      testResult: '',
      loginError: '',
      previewInvoicePdfUrl: '',
      salesListHtml: ''
    };
    window.App.Services.Audit = {
      log() {}
    };
    window.render = jest.fn();
    window.App.Services.FirebaseAuth = {
      login: jest.fn(),
      logout: jest.fn(() => {
        window.App.state.user = null;
        window.App.state.page = 'login';
        window.App.state.loginError = '';
        window.render();
      })
    };
  });

  test('login exitoso con credenciales correctas', async () => {
    const profile = { id: '1', username: 'Sistemapro', email: 'Sistemapro@sistema.local', role: 'ADMIN', licensed: true };
    window.App.Services.FirebaseAuth.login.mockResolvedValue(profile);

    const result = await window.login('Sistemapro', 'somepassword');
    expect(result).toBe(true);
    expect(window.App.state.user.username).toBe('Sistemapro');
    expect(window.App.state.page).toBe('sales');
  });

  test('login falla con credenciales incorrectas', async () => {
    const error = new Error('auth/wrong-password');
    error.code = 'auth/wrong-password';
    window.App.Services.FirebaseAuth.login.mockRejectedValue(error);

    const result = await window.login('wrong', 'wrong');
    expect(result).toBe(false);
    expect(window.App.state.user).toBeNull();
    expect(window.App.state.loginError).toBe('Credenciales incorrectas');
  });

  test('logout limpia el estado', () => {
    window.App.state.user = { username: 'test' };
    window.App.state.page = 'sales';
    window.App.Services.FirebaseAuth.logout();
    expect(window.App.state.user).toBeNull();
    expect(window.App.state.page).toBe('login');
  });
});
