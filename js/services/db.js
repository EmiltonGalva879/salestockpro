// ===== Administrador principal =====
// Cuenta histórica + (opcional) el correo REAL del administrador, para poder recuperar
// la contraseña por correo. Debe ser el MISMO correo que está en firestore.rules.
const DB_SUPER_LEGACY_EMAIL = 'sistemapro@sistema.local';
const DB_SUPER_REAL_EMAIL = 'emiltongalva879@gmail.com';
window.SUPER_REAL_EMAIL = String(DB_SUPER_REAL_EMAIL || '').trim().toLowerCase();

// El correo real solo cuenta como administrador cuando Firebase lo marca como verificado
window.isSuperAuthUser = function (u) {
  const e = String((u && u.email) || '').toLowerCase();
  if (!e) return false;
  if (e === DB_SUPER_LEGACY_EMAIL) return true;
  return !!window.SUPER_REAL_EMAIL && e === window.SUPER_REAL_EMAIL && u.emailVerified === true;
};

// Datos separados por empresa:
//   companies/{companyId}/data/{key}   ->  { items: [...] }
// Cada empresa solo puede leer y escribir su propia ruta (lo exigen las reglas de Firestore).
// El administrador del sistema (Sistemapro) ve todas las empresas a la vez.
const DB = {
  _cache: {},
  _ready: false,
  _super: false,
  _companyId: null,
  _dataKeys: ['users', 'products', 'sales', 'sales_fiscal', 'sales_normal', 'fiados', 'settings'],
  _byCompany: {},   // solo administrador del sistema: key -> { companyId -> items }
  _written: {},     // solo administrador del sistema: key -> { companyId -> JSON ya guardado }
  _listeners: [],

  async init(companyId) {
    if (this._ready) return;
    const user = window.FB_AUTH && window.FB_AUTH.currentUser;
    if (!user) throw new Error('Debes iniciar sesión');
    this._super = window.isSuperAuthUser(user);
    this._companyId = this._super ? null : String(companyId || '');
    if (!this._super && !this._companyId) throw new Error('Tu cuenta no tiene empresa asignada');

    this._dataKeys.forEach(k => { this._cache[k] = []; });
    this._cache.licenses = [];
    await this._loadAll();
    this._subscribeAll();
    this._ready = true;
  },

  _col(companyId) {
    return window.FB_DB.collection('companies').doc(String(companyId)).collection('data');
  },

  _companyOf(doc) {
    // doc.ref.parent = colección "data"; su padre es el documento de la empresa
    const parent = doc.ref.parent && doc.ref.parent.parent;
    return parent ? parent.id : null;
  },

  _rebuild(key) {
    const groups = this._byCompany[key] || {};
    this._cache[key] = Object.keys(groups).reduce((all, cid) => all.concat(groups[cid]), []);
  },

  _ingest(doc) {
    const key = doc.id;
    const cid = this._companyOf(doc);
    if (!cid || !this._dataKeys.includes(key)) return null;
    const items = (doc.data() && doc.data().items) || [];
    (this._byCompany[key] = this._byCompany[key] || {})[cid] = items;
    (this._written[key] = this._written[key] || {})[cid] = JSON.stringify(items);
    return key;
  },

  async _loadAll() {
    // Licencias: solo las ve el administrador del sistema
    try {
      if (this._super) {
        const snap = await window.FB_DB.collection('licenseKeys').get();
        this._cache.licenses = snap.docs.map(d => ({ ...d.data(), key: d.id }));
      }
    } catch (e) {
      console.warn('[DB] No se pudieron cargar las licencias:', e.message);
    }

    try {
      if (this._super) {
        const snap = await window.FB_DB.collectionGroup('data').get();
        snap.docs.forEach(d => this._ingest(d));
        this._dataKeys.forEach(k => this._rebuild(k));
      } else {
        for (const key of this._dataKeys) {
          const doc = await this._col(this._companyId).doc(key).get();
          this._cache[key] = doc.exists ? ((doc.data() && doc.data().items) || []) : [];
        }
      }
    } catch (e) {
      console.warn('[DB] No se pudieron cargar los datos:', e.message);
    }
  },

  _subscribeAll() {
    this._unsubscribeAll();
    const refresh = () => { if (window.state) { window.state._dirty = true; render(); } };

    try {
      if (this._super) {
        this._listeners.push(window.FB_DB.collection('licenseKeys').onSnapshot(
          snap => { this._cache.licenses = snap.docs.map(d => ({ ...d.data(), key: d.id })); refresh(); },
          err => console.error('[DB] Error en licencias:', err)
        ));
        this._listeners.push(window.FB_DB.collectionGroup('data').onSnapshot(
          snap => {
            const touched = new Set();
            snap.docChanges().forEach(ch => {
              if (ch.type === 'removed') {
                const key = ch.doc.id, cid = this._companyOf(ch.doc);
                if (cid && this._byCompany[key]) { delete this._byCompany[key][cid]; delete (this._written[key] || {})[cid]; touched.add(key); }
              } else {
                const key = this._ingest(ch.doc);
                if (key) touched.add(key);
              }
            });
            touched.forEach(k => this._rebuild(k));
            if (touched.size) refresh();
          },
          err => console.error('[DB] Error en los datos:', err)
        ));
      } else {
        for (const key of this._dataKeys) {
          this._listeners.push(this._col(this._companyId).doc(key).onSnapshot(
            doc => {
              if (doc.exists) {
                this._cache[key] = (doc.data() && doc.data().items) || [];
                refresh();
              }
            },
            err => console.error('[DB] Error en ' + key + ':', err)
          ));
        }
      }
    } catch (e) {
      console.warn('[DB] No se pudo suscribir a los cambios:', e.message);
    }
  },

  _unsubscribeAll() {
    this._listeners.forEach(unsub => { try { unsub(); } catch (e) {} });
    this._listeners = [];
  },

  get(key) {
    if (!this._cache[key]) this._cache[key] = [];
    return Array.isArray(this._cache[key]) ? [...this._cache[key]] : [];
  },

  set(key, data) {
    this._cache[key] = data;
    if (window.state) { window.state._dirty = true; render(); }

    if (key === 'licenses') return this._saveLicenses(data);
    if (!this._dataKeys.includes(key)) return Promise.resolve(null);

    const onError = err => {
      console.error('[DB] No se pudo guardar ' + key + ':', err);
      const code = (err && (err.code || err.message)) || 'desconocido';
      if (window.alert) alert('No se pudo guardar "' + key + '".\nMotivo: ' + code + '\nVerifica tu conexión y tus permisos.');
      return null;
    };

    // Firestore rechaza campos con valor undefined: se eliminan antes de guardar
    try {
      data = JSON.parse(JSON.stringify(data || []));
      this._cache[key] = data;
    } catch (e) {
      return Promise.resolve(onError(e));
    }

    if (!this._super) {
      return this._col(this._companyId).doc(key).set({ items: data }).catch(onError);
    }

    // Administrador del sistema: cada elemento va a la empresa a la que pertenece
    const groups = {};
    (data || []).forEach(item => {
      const cid = String((item && item.companyId) || '1');
      (groups[cid] = groups[cid] || []).push(item);
    });
    const known = Object.keys(this._byCompany[key] || {});
    const companies = Array.from(new Set(known.concat(Object.keys(groups))));
    const writes = [];
    this._byCompany[key] = this._byCompany[key] || {};
    this._written[key] = this._written[key] || {};

    companies.forEach(cid => {
      const items = groups[cid] || [];
      const json = JSON.stringify(items);
      if (this._written[key][cid] === json) return;
      this._byCompany[key][cid] = items;
      writes.push(this._col(cid).doc(key).set({ items: items }).then(() => { this._written[key][cid] = json; }));
    });
    return Promise.all(writes).catch(onError);
  },

  // Las licencias solo las administra Sistemapro; se guarda una por documento
  async _saveLicenses(list) {
    if (!this._super) return null;
    try {
      const col = window.FB_DB.collection('licenseKeys');
      const snap = await col.get();
      const existing = {};
      snap.docs.forEach(d => { existing[d.id] = d.data(); });

      const batch = window.FB_DB.batch();
      const wanted = new Set();
      (list || []).forEach(l => {
        if (!l || !l.key) return;
        wanted.add(l.key);
        const { key, ...rest } = l;
        if (JSON.stringify(existing[key] || null) !== JSON.stringify(rest)) {
          batch.set(col.doc(key), rest);
        }
      });
      Object.keys(existing).forEach(k => { if (!wanted.has(k)) batch.delete(col.doc(k)); });
      await batch.commit();
      return true;
    } catch (err) {
      console.error('[DB] No se pudo guardar licenses:', err);
      return null;
    }
  },

  // Elimina TODOS los datos de una empresa (productos, ventas, créditos, usuarios)
  // y los perfiles de sus cuentas. Solo lo puede hacer el administrador del sistema.
  async deleteCompany(companyId) {
    if (!this._super) throw new Error('Solo el administrador del sistema puede eliminar empresas');
    const cid = String(companyId || '').trim();
    if (!cid || cid === '1' || /\//.test(cid)) throw new Error('Empresa inválida');

    const batch = window.FB_DB.batch();
    const dataSnap = await this._col(cid).get();
    dataSnap.docs.forEach(d => batch.delete(d.ref));

    const profilesCol = window.FB_DB.collection('profiles');
    const profSnap = await profilesCol.where('companyId', '==', cid).get();
    const profIds = new Set(profSnap.docs.map(d => d.id));
    profIds.add(cid); // el perfil del dueño usa el id de la empresa
    profIds.forEach(id => batch.delete(profilesCol.doc(id)));

    // Los nombres de usuario de esas cuentas también se liberan
    const namesCol = window.FB_DB.collection('usernames');
    for (const id of profIds) {
      const mapped = await namesCol.where('uid', '==', id).get();
      mapped.docs.forEach(d => batch.delete(d.ref));
    }

    await batch.commit();

    // Limpiar la copia local
    this._dataKeys.forEach(key => {
      if (this._byCompany[key]) delete this._byCompany[key][cid];
      if (this._written[key]) delete this._written[key][cid];
      this._rebuild(key);
    });
    if (window.state) { window.state._dirty = true; render(); }
    return { data: dataSnap.size, profiles: profIds.size };
  },

  destroy() {
    this._unsubscribeAll();
    this._cache = {};
    this._byCompany = {};
    this._written = {};
    this._ready = false;
    this._super = false;
    this._companyId = null;
  }
};

window.App = window.App || {};
window.App.Services = window.App.Services || {};
window.App.Services.DB = DB;
