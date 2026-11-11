/**
 * Capa de Persistencia con Separación de Seguridad:
 * 1. Modo Portafolio / Demo Público (Datos ficticios aislados para visitantes del portafolio)
 * 2. Modo Rancho Privado (Protegido por Clave/PIN y sincronizado con la Nube real)
 */

const STORAGE_KEY_REAL = 'rancho_fh_privado_real_v1';
const STORAGE_KEY_DEMO = 'rancho_fh_demo_portfolio_v1';
const STORAGE_KEY_CLOUD = 'rancho_fh_cloud_config_v1';
const STORAGE_KEY_AUTH = 'rancho_fh_auth_config_v1';
const STORAGE_KEY_CLOUD_AUTH = 'rancho_fh_cloud_auth_v1';

window.RanchoDB = {
  // 'DEMO' (visitantes del portafolio) | 'REAL' (propietarios autenticados)
  sessionMode: 'DEMO',

  // El PIN nunca se guarda en texto plano: solo su hash PBKDF2-SHA256 con sal aleatoria.
  // Nota: esto protege el PIN guardado, pero la protección real de los datos en la nube
  // requiere autenticación del lado del servidor (Firebase Auth + reglas de Firestore).
  authConfig: {
    pinSalt: '',
    pinHashV2: '',
    pinIterations: 150000,
    rememberSession: false
  },

  state: {
    config: {
      nombreRancho: 'Rancho Demostración (Vista Portafolio)',
      fierros: [],
      edadDesteteMeses: 7,
      updatedAt: new Date().toISOString()
    },
    animales: [],
    eventosSanitarios: []
  },

  cloudConfig: {
    enabled: false,
    provider: 'firebase',
    projectId: '',
    apiKey: '',
    ranchoCode: 'RANCHO-FH-PRIVADO',
    customEndpoint: '',
    pendingSync: false,
    lastSyncAt: null,
    statusText: 'Modo Portafolio (Datos de prueba)'
  },

  // Sesión de Firebase Authentication (correo y contraseña). La contraseña NUNCA se guarda:
  // solo el token de refresco que Firebase entrega, igual que hace el SDK oficial.
  cloudAuth: { email: '', uid: '', idToken: '', refreshToken: '', expiresAt: 0 },

  listeners: [],

  init() {
    this.loadAuthConfig();
    this.loadCloudConfig();
    this.loadCloudAuth();

    // Revisar si la URL pide explícitamente ?modo=portafolio o ?demo=1
    const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    const forceDemo = params && (params.get('modo') === 'portafolio' || params.get('demo') === '1');

    const savedSession =
      typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('rancho_active_mode') : null;

    if (!forceDemo && (savedSession === 'REAL' || this.authConfig.rememberSession)) {
      this.activarModoReal();
    } else {
      this.activarModoDemo();
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => {
        this.updateNetworkStatus();
        if (this.sessionMode === 'REAL' && this.cloudConfig.enabled && this.cloudConfig.pendingSync) {
          this.syncToCloud();
        }
      });
      window.addEventListener('offline', () => {
        this.updateNetworkStatus();
      });
    }
  },

  loadAuthConfig() {
    const raw = localStorage.getItem(STORAGE_KEY_AUTH);
    if (raw) {
      try {
        this.authConfig = { ...this.authConfig, ...JSON.parse(raw) };
      } catch (e) {
        console.warn('Error leyendo auth config:', e);
      }
    }
  },

  saveAuthConfig(newAuth) {
    this.authConfig = { ...this.authConfig, ...newAuth };
    localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(this.authConfig));
  },

  /** true si existe un PIN (hasheado o heredado en texto plano de versiones anteriores). */
  tienePinConfigurado() {
    return !!(this.authConfig.pinHashV2 || this.authConfig.pinHash);
  },

  async _derivarHashPin(pin, saltB64, iterations) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('Este navegador no permite cifrar el PIN (se requiere HTTPS).');
    }
    const enc = new TextEncoder();
    const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, [
      'deriveBits'
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
  },

  _compararSeguro(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  },

  /** Guarda un PIN nuevo como hash con sal aleatoria y elimina cualquier PIN en texto plano. */
  async establecerPin(pinNuevo) {
    const limpio = String(pinNuevo || '').trim();
    if (limpio.length < 4) {
      throw new Error('El PIN debe tener al menos 4 caracteres.');
    }
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const pinSalt = btoa(String.fromCharCode(...saltBytes));
    const pinIterations = 150000;
    const pinHashV2 = await this._derivarHashPin(limpio, pinSalt, pinIterations);
    const { pinHash, ...resto } = this.authConfig; // descartar PIN heredado en texto plano
    this.authConfig = { ...resto, pinSalt, pinHashV2, pinIterations };
    localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(this.authConfig));
  },

  /**
   * Verifica el PIN. Devuelve { ok, pinDebil }.
   * Si el PIN estaba guardado en texto plano (versiones anteriores), lo migra a hash.
   */
  async verificarPinPropietario(pinIngresado) {
    const limpio = String(pinIngresado || '').trim();
    if (!limpio) return { ok: false };

    if (this.authConfig.pinHashV2 && this.authConfig.pinSalt) {
      const calculado = await this._derivarHashPin(
        limpio,
        this.authConfig.pinSalt,
        this.authConfig.pinIterations || 150000
      );
      return { ok: this._compararSeguro(calculado, this.authConfig.pinHashV2), pinDebil: false };
    }

    // Migración desde PIN en texto plano (incluye el antiguo valor por defecto "1234")
    const legado = this.authConfig.pinHash !== undefined ? String(this.authConfig.pinHash).trim() : '';
    if (legado && this._compararSeguro(limpio, legado)) {
      const pinDebil = legado === '1234' || legado.length < 4;
      if (legado.length >= 4) {
        await this.establecerPin(legado);
      }
      return { ok: true, pinDebil };
    }
    return { ok: false };
  },

  /**
   * Tonos para distinguir a cada dueño. Deben coincidir con las clases .tono-N de css/styles.css
   * (aquí se usan para el PDF y para nombrar el color en la configuración).
   */
  TONOS: [
    { nombre: 'Verde potrero', texto: '#1e5631', fondo: '#e7f2ea' },
    { nombre: 'Cuero', texto: '#9a411b', fondo: '#f9ece6' },
    { nombre: 'Añil', texto: '#2f4a8a', fondo: '#ebeff9' },
    { nombre: 'Ciruela', texto: '#6d2d6b', fondo: '#f5ecf5' },
    { nombre: 'Ocre', texto: '#7a5a00', fondo: '#fbf3dc' },
    { nombre: 'Aguamarina', texto: '#10625e', fondo: '#e3f3f1' },
    { nombre: 'Pizarra', texto: '#3f4a54', fondo: '#eef0f2' },
    { nombre: 'Vino', texto: '#8f1d2c', fondo: '#fbeaec' }
  ],
  TOTAL_TONOS: 8,

  /** Normaliza un código de fierro: 1 a 3 letras o números en mayúscula. */
  normalizarCodigoFierro(valor) {
    return String(valor == null ? '' : valor)
      .toUpperCase()
      .replace(/[ÁÀÄÂ]/g, 'A')
      .replace(/[ÉÈËÊ]/g, 'E')
      .replace(/[ÍÌÏÎ]/g, 'I')
      .replace(/[ÓÒÖÔ]/g, 'O')
      .replace(/[ÚÙÜÛ]/g, 'U')
      .replace(/[^A-Z0-9Ñ]/g, '')
      .slice(0, 3);
  },

  /**
   * Devuelve la lista limpia de fierros. Migra el formato anterior (propietarioF / propietarioH)
   * y agrega cualquier fierro usado por animales que no esté en la lista, para no perder datos.
   */
  normalizarFierros(lista, cfgAnterior = {}, animales = []) {
    const vistos = new Set();
    const fierros = [];
    const agregar = (codigoRaw, propietario, tono) => {
      const codigo = this.normalizarCodigoFierro(codigoRaw);
      if (!codigo || vistos.has(codigo)) return;
      vistos.add(codigo);
      const t = parseInt(tono, 10);
      fierros.push({
        codigo,
        propietario:
          String(propietario == null ? '' : propietario).trim().slice(0, 80) ||
          `Propietario ${codigo}`,
        tono:
          Number.isInteger(t) && t >= 0 && t < this.TOTAL_TONOS
            ? t
            : fierros.length % this.TOTAL_TONOS
      });
    };

    if (Array.isArray(lista)) {
      lista.forEach((f) => {
        if (f && typeof f === 'object') agregar(f.codigo, f.propietario, f.tono);
      });
    }

    if (fierros.length === 0) {
      // Formato anterior: solo Fierro F y Fierro H
      agregar('F', cfgAnterior.propietarioF || 'Propietario Fierro F', 0);
      agregar('H', cfgAnterior.propietarioH || 'Propietario Fierro H', 1);
    }

    (Array.isArray(animales) ? animales : []).forEach((a) => {
      if (a && typeof a === 'object' && a.fierro) agregar(a.fierro, '', undefined);
    });

    return fierros;
  },

  getFierros() {
    return Array.isArray(this.state.config.fierros) ? this.state.config.fierros : [];
  },

  getFierro(codigo) {
    return this.getFierros().find((f) => f.codigo === codigo) || null;
  },

  /** Cuenta animales (de cualquier estatus) registrados con ese fierro. */
  contarAnimalesDeFierro(codigo) {
    return this.state.animales.filter((a) => a.fierro === codigo).length;
  },

  /**
   * Reemplaza la lista de fierros validando códigos únicos y que no se elimine
   * un fierro que todavía tiene animales registrados. Lanza Error con mensaje para el usuario.
   */
  guardarFierros(nuevaLista) {
    const codigos = new Set();
    const limpia = [];
    nuevaLista.forEach((f, i) => {
      const codigo = this.normalizarCodigoFierro(f.codigo);
      if (!codigo) {
        throw new Error(`El fierro #${i + 1} necesita un código (1 a 3 letras o números).`);
      }
      if (codigos.has(codigo)) throw new Error(`El código de fierro "${codigo}" está repetido.`);
      codigos.add(codigo);
      const propietario = String(f.propietario || '').trim().slice(0, 80);
      if (!propietario) throw new Error(`Escribe el nombre del dueño del Fierro ${codigo}.`);
      const t = parseInt(f.tono, 10);
      limpia.push({
        codigo,
        propietario,
        tono: Number.isInteger(t) && t >= 0 && t < this.TOTAL_TONOS ? t : i % this.TOTAL_TONOS
      });
    });

    if (limpia.length === 0) throw new Error('Debe existir al menos un fierro.');

    const enUso = [...new Set(this.state.animales.map((a) => a.fierro))].filter(
      (c) => c && !codigos.has(c)
    );
    if (enUso.length > 0) {
      throw new Error(
        `No se puede quitar el Fierro ${enUso.join(', ')}: todavía tiene animales registrados.`
      );
    }

    this.state.config.fierros = limpia;
  },

  /**
   * Limpia y normaliza un estado proveniente de localStorage, la nube o un respaldo importado.
   * Garantiza IDs seguros (solo letras, números, guion y guion bajo) y tipos correctos,
   * para que datos manipulados no puedan inyectar código en la interfaz.
   */
  normalizarEstado(raw, configBase = {}) {
    const safeId = (v) => String(v == null ? '' : v).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
    const str = (v) => (v == null ? '' : typeof v === 'string' ? v : String(v));
    const esObjeto = (o) => o && typeof o === 'object' && !Array.isArray(o);

    const fuente = esObjeto(raw) ? raw : {};
    const cfg = esObjeto(fuente.config) ? fuente.config : {};

    const config = { ...configBase };
    Object.keys(cfg).forEach((k) => {
      const v = cfg[k];
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        config[k] = v;
      }
    });
    config.edadDesteteMeses = parseInt(config.edadDesteteMeses, 10) || 7;
    config.fierros = this.normalizarFierros(cfg.fierros, cfg, fuente.animales);
    delete config.propietarioF;
    delete config.propietarioH;

    const camposNumericos = ['pesoActual'];
    const animales = (Array.isArray(fuente.animales) ? fuente.animales : [])
      .filter(esObjeto)
      .map((a) => {
        const limpio = {};
        Object.keys(a).forEach((k) => {
          const v = a[k];
          if (k === 'aretesAnteriores') {
            limpio[k] = Array.isArray(v) ? v.map(str) : [];
          } else if (camposNumericos.includes(k)) {
            limpio[k] = v === '' || v == null || isNaN(parseFloat(v)) ? '' : parseFloat(v);
          } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            limpio[k] = typeof v === 'boolean' ? v : str(v);
          }
        });
        limpio.id = safeId(a.id) || 'ANM-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
        limpio.madreId = a.madreId ? safeId(a.madreId) : '';
        if (!Array.isArray(limpio.aretesAnteriores)) limpio.aretesAnteriores = [];
        if (!limpio.estatus) limpio.estatus = 'Activo';
        return limpio;
      });

    const eventosSanitarios = (Array.isArray(fuente.eventosSanitarios) ? fuente.eventosSanitarios : [])
      .filter(esObjeto)
      .map((e) => {
        const limpio = {};
        Object.keys(e).forEach((k) => {
          const v = e[k];
          if (typeof v === 'string' || typeof v === 'number') limpio[k] = v;
        });
        limpio.id = safeId(e.id) || 'SAN-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
        limpio.animalId = safeId(e.animalId);
        return limpio;
      });

    return { config, animales, eventosSanitarios };
  },

  /** localStorage.setItem con manejo de cuota llena. Devuelve true si se guardó. */
  _guardarSeguro(key, valor) {
    try {
      localStorage.setItem(key, valor);
      return true;
    } catch (e) {
      console.error('No se pudo guardar en el dispositivo:', e);
      const app = window.RanchoApp;
      if (app && typeof app.mostrarToast === 'function') {
        app.mostrarToast(
          'Almacenamiento del dispositivo lleno: el último cambio NO se guardó. Descarga un respaldo y libera espacio.',
          'error'
        );
      }
      return false;
    }
  },

  activarModoDemo() {
    this.sessionMode = 'DEMO';
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('rancho_active_mode', 'DEMO');
    }

    const rawDemo = localStorage.getItem(STORAGE_KEY_DEMO);
    if (rawDemo) {
      try {
        const parsed = JSON.parse(rawDemo);
        this.state = this.normalizarEstado(parsed, this.state.config);
      } catch (e) {
        this.seedDemoData();
      }
    } else {
      this.seedDemoData();
    }

    this.updateNetworkStatus();
    this.notify();
  },

  activarModoReal() {
    this.sessionMode = 'REAL';
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('rancho_active_mode', 'REAL');
    }

    const rawReal = localStorage.getItem(STORAGE_KEY_REAL);
    if (rawReal) {
      try {
        const parsed = JSON.parse(rawReal);
        this.state = this.normalizarEstado(parsed, {
          nombreRancho: 'Mi Rancho Ganadero',
          edadDesteteMeses: 7
        });
      } catch (e) {
        this.inicializarRanchoRealVacio();
      }
    } else {
      this.inicializarRanchoRealVacio();
    }

    this.updateNetworkStatus();
    if (this.cloudConfig.enabled && navigator.onLine) {
      this.pullFromCloud();
    }
    this.notify();
  },

  inicializarRanchoRealVacio() {
    this.state = {
      config: {
        nombreRancho: 'Rancho Ganadero (Privado)',
        fierros: [
          { codigo: 'F', propietario: 'Propietario Fierro F', tono: 0 },
          { codigo: 'H', propietario: 'Propietario Fierro H', tono: 1 }
        ],
        edadDesteteMeses: 7,
        updatedAt: new Date().toISOString()
      },
      animales: [],
      eventosSanitarios: []
    };
    this.saveLocal();
  },

  cerrarSesionPrivada() {
    this.saveAuthConfig({ rememberSession: false });
    this.activarModoDemo();
  },

  loadCloudConfig() {
    const raw = localStorage.getItem(STORAGE_KEY_CLOUD);
    if (raw) {
      try {
        this.cloudConfig = { ...this.cloudConfig, ...JSON.parse(raw) };
      } catch (e) {
        console.warn('Error cargando config de nube', e);
      }
    }
  },

  saveCloudConfig(newCfg) {
    this.cloudConfig = { ...this.cloudConfig, ...newCfg };
    localStorage.setItem(STORAGE_KEY_CLOUD, JSON.stringify(this.cloudConfig));
    this.updateNetworkStatus();
    this.notify();
  },

  updateNetworkStatus() {
    if (this.sessionMode === 'DEMO') {
      this.cloudConfig.statusText = 'Vista Portafolio (Datos Demo)';
      this.notify();
      return;
    }

    const isOnline = navigator.onLine;
    if (!isOnline) {
      this.cloudConfig.statusText = 'Sin señal en corral (Guardado local)';
    } else if (this.cloudConfig.enabled && this.cloudConfig.provider === 'firebase' && !this.estaConectadoNube()) {
      this.cloudConfig.statusText = 'Inicia sesión en la nube para sincronizar';
    } else if (this.cloudConfig.enabled) {
      this.cloudConfig.statusText = this.cloudConfig.pendingSync
        ? 'Sincronizando con la nube...'
        : 'Rancho privado sincronizado';
    } else {
      this.cloudConfig.statusText = 'Sesión privada activa (Configurar nube)';
    }
    this.notify();
  },

  subscribe(fn) {
    this.listeners.push(fn);
  },

  notify() {
    this.listeners.forEach((fn) => fn(this.state, this.cloudConfig, this.sessionMode));
  },

  saveLocal() {
    this.state.config.updatedAt = new Date().toISOString();
    const targetKey = this.sessionMode === 'REAL' ? STORAGE_KEY_REAL : STORAGE_KEY_DEMO;
    this._guardarSeguro(targetKey, JSON.stringify(this.state));

    // Solo sincronizar con la nube real si estamos en la sesión privada REAL del propietario
    if (this.sessionMode === 'REAL' && this.cloudConfig.enabled) {
      this.cloudConfig.pendingSync = true;
      localStorage.setItem(STORAGE_KEY_CLOUD, JSON.stringify(this.cloudConfig));
      if (navigator.onLine) {
        this.syncToCloud();
      }
    }
    this.updateNetworkStatus();
    this.notify();
  },

  /* ------------------------------------------------------------------
   * FIREBASE AUTHENTICATION (REST, sin SDK)
   * ------------------------------------------------------------------ */
  loadCloudAuth() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CLOUD_AUTH);
      if (raw) this.cloudAuth = { ...this.cloudAuth, ...JSON.parse(raw) };
    } catch (e) {
      console.warn('Error leyendo la sesión de la nube:', e);
    }
  },

  _guardarCloudAuth() {
    this._guardarSeguro(STORAGE_KEY_CLOUD_AUTH, JSON.stringify(this.cloudAuth));
  },

  estaConectadoNube() {
    return !!(this.cloudAuth.refreshToken && this.cloudAuth.uid);
  },

  _mensajeErrorAuth(data) {
    const codigo = String((data && data.error && data.error.message) || '').split(' ')[0];
    const mensajes = {
      EMAIL_NOT_FOUND: 'Correo o contraseña incorrectos.',
      INVALID_PASSWORD: 'Correo o contraseña incorrectos.',
      INVALID_LOGIN_CREDENTIALS: 'Correo o contraseña incorrectos.',
      INVALID_EMAIL: 'El correo no tiene un formato válido.',
      MISSING_PASSWORD: 'Escribe la contraseña.',
      USER_DISABLED: 'Esta cuenta está deshabilitada en Firebase.',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Demasiados intentos. Espera unos minutos y vuelve a intentar.',
      OPERATION_NOT_ALLOWED:
        'Activa el proveedor "Correo electrónico/contraseña" en Firebase › Authentication › Método de acceso.',
      CONFIGURATION_NOT_FOUND:
        'Firebase Authentication no está activado en este proyecto (Authentication › Comenzar).',
      API_KEY_INVALID: 'La Web API Key no es válida para este proyecto.'
    };
    if (mensajes[codigo]) return mensajes[codigo];
    if (/API key not valid/i.test(String(data && data.error && data.error.message))) {
      return mensajes.API_KEY_INVALID;
    }
    return `No se pudo iniciar sesión (${codigo || 'error desconocido'}).`;
  },

  /** Inicia sesión con correo y contraseña. La contraseña solo se envía a Google, no se guarda. */
  async iniciarSesionNube(email, password, apiKey) {
    const key = String(apiKey || this.cloudConfig.apiKey || '').trim();
    if (!key) throw new Error('Primero escribe la Web API Key de Firebase.');
    if (!navigator.onLine) throw new Error('Necesitas internet para iniciar sesión en la nube.');

    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: String(email || '').trim(), password, returnSecureToken: true })
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(this._mensajeErrorAuth(data));

    this.cloudAuth = {
      email: data.email,
      uid: data.localId,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + (parseInt(data.expiresIn, 10) || 3600) * 1000
    };
    this._guardarCloudAuth();
    this.updateNetworkStatus();
    return { email: data.email, uid: data.localId };
  },

  cerrarSesionNube() {
    this.cloudAuth = { email: '', uid: '', idToken: '', refreshToken: '', expiresAt: 0 };
    localStorage.removeItem(STORAGE_KEY_CLOUD_AUTH);
    this.updateNetworkStatus();
  },

  /** Devuelve un ID token vigente; lo renueva con el token de refresco cuando caduca (cada hora). */
  async _obtenerTokenNube() {
    if (!this.estaConectadoNube()) return null;
    if (this.cloudAuth.idToken && Date.now() < this.cloudAuth.expiresAt - 60000) {
      return this.cloudAuth.idToken;
    }
    const key = this.cloudConfig.apiKey;
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(this.cloudAuth.refreshToken)}`
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 400) {
        // Token revocado, usuario borrado/deshabilitado o contraseña cambiada
        this.cerrarSesionNube();
        throw new Error('La sesión de la nube expiró. Vuelve a iniciar sesión.');
      }
      throw new Error(`No se pudo renovar la sesión de la nube (${res.status}).`);
    }
    this.cloudAuth = {
      ...this.cloudAuth,
      idToken: data.id_token,
      refreshToken: data.refresh_token || this.cloudAuth.refreshToken,
      uid: data.user_id || this.cloudAuth.uid,
      expiresAt: Date.now() + (parseInt(data.expires_in, 10) || 3600) * 1000
    };
    this._guardarCloudAuth();
    return this.cloudAuth.idToken;
  },

  _rutasFirestore() {
    const proyecto = encodeURIComponent(this.cloudConfig.projectId);
    const docId = encodeURIComponent(this.cloudConfig.ranchoCode || 'RANCHO-FH-PRIVADO');
    const coleccion = `https://firestore.googleapis.com/v1/projects/${proyecto}/databases/(default)/documents/ranchos`;
    return { coleccion, documento: `${coleccion}/${docId}`, docId };
  },

  /** fetch a Firestore con el token del usuario (las reglas de seguridad lo exigen). */
  async _fetchFirestore(url, opciones = {}) {
    const token = await this._obtenerTokenNube();
    if (!token) throw new Error('Inicia sesión en la nube (Dueños, fierros y nube › Cuenta de la nube).');
    return fetch(url, {
      ...opciones,
      headers: {
        'Content-Type': 'application/json',
        ...(opciones.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });
  },

  async syncToCloud() {
    if (this.sessionMode !== 'REAL' || !this.cloudConfig.enabled || !navigator.onLine) {
      return { ok: false, reason: 'not_real_or_offline' };
    }

    try {
      const payload = JSON.stringify(this.state);

      if (this.cloudConfig.provider === 'firebase' && this.cloudConfig.projectId) {
        if (!this.estaConectadoNube()) {
          this.cloudConfig.pendingSync = true;
          this.updateNetworkStatus();
          return { ok: false, reason: 'sin_sesion' };
        }

        const { coleccion, documento, docId } = this._rutasFirestore();
        const campos = {
          ranchoCode: { stringValue: this.cloudConfig.ranchoCode || 'RANCHO-FH-PRIVADO' },
          updatedAt: { stringValue: new Date().toISOString() },
          payloadJson: { stringValue: payload }
        };
        // Solo se actualizan estos campos: "miembros" nunca se toca desde la app
        const mascara = Object.keys(campos)
          .map((f) => `updateMask.fieldPaths=${f}`)
          .join('&');

        let res = await this._fetchFirestore(`${documento}?${mascara}&currentDocument.exists=true`, {
          method: 'PATCH',
          body: JSON.stringify({ fields: campos })
        });

        if (res.status === 404 || res.status === 403) {
          // El documento aún no existe: se crea con esta cuenta como primer miembro.
          // Si ya existe y la cuenta no es miembro, Firestore lo rechaza (403/409).
          const crear = await this._fetchFirestore(`${coleccion}?documentId=${docId}`, {
            method: 'POST',
            body: JSON.stringify({
              fields: {
                ...campos,
                miembros: { arrayValue: { values: [{ stringValue: this.cloudAuth.uid }] } }
              }
            })
          });
          if (crear.ok) {
            res = crear;
          } else if (crear.status === 409 || crear.status === 403) {
            throw new Error(
              'Tu cuenta no es miembro de este rancho en la nube. Pide que agreguen tu UID al campo "miembros".'
            );
          } else {
            throw new Error(`Error Firestore (${crear.status})`);
          }
        }

        if (!res.ok) {
          throw new Error(`Error Firestore (${res.status})`);
        }
      } else if (this.cloudConfig.customEndpoint) {
        const res = await fetch(this.cloudConfig.customEndpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        });
        if (!res.ok) {
          throw new Error(`Error Servidor Nube (${res.status})`);
        }
      } else {
        return { ok: false, reason: 'missing_config' };
      }

      this.cloudConfig.pendingSync = false;
      this.cloudConfig.lastSyncAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY_CLOUD, JSON.stringify(this.cloudConfig));
      this.updateNetworkStatus();
      return { ok: true };
    } catch (err) {
      console.warn('Pendiente subir a nube:', err);
      this.cloudConfig.pendingSync = true;
      this.cloudConfig.statusText = 'Guardado local (Pendiente subir a nube)';
      this.notify();
      return { ok: false, error: err.message };
    }
  },

  async pullFromCloud() {
    if (this.sessionMode !== 'REAL' || !this.cloudConfig.enabled || !navigator.onLine) {
      return { ok: false };
    }

    try {
      let remoteState = null;

      if (this.cloudConfig.provider === 'firebase' && this.cloudConfig.projectId) {
        if (!this.estaConectadoNube()) return { ok: false, reason: 'sin_sesion' };
        const res = await this._fetchFirestore(this._rutasFirestore().documento, { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          if (data.fields && data.fields.payloadJson && data.fields.payloadJson.stringValue) {
            remoteState = JSON.parse(data.fields.payloadJson.stringValue);
          }
        } else if (res.status !== 404 && res.status !== 403) {
          // 404/403: el rancho todavía no existe en la nube (se creará al sincronizar)
          throw new Error(`Error Firestore (${res.status})`);
        }
      } else if (this.cloudConfig.customEndpoint) {
        const res = await fetch(this.cloudConfig.customEndpoint);
        if (res.ok) {
          remoteState = await res.json();
        }
      }

      if (remoteState && Array.isArray(remoteState.animales)) {
        const localTime = new Date(this.state.config?.updatedAt || 0).getTime();
        const remoteTime = new Date(remoteState.config?.updatedAt || 0).getTime();

        if (remoteTime >= localTime || this.state.animales.length === 0) {
          this.state = this.normalizarEstado(remoteState, this.state.config);
          this._guardarSeguro(STORAGE_KEY_REAL, JSON.stringify(this.state));
          this.cloudConfig.lastSyncAt = new Date().toISOString();
          this.cloudConfig.pendingSync = false;
          localStorage.setItem(STORAGE_KEY_CLOUD, JSON.stringify(this.cloudConfig));
          this.updateNetworkStatus();
          return { ok: true, updated: true };
        }
      }
      return { ok: true, updated: false };
    } catch (err) {
      console.warn('Error descargando desde la nube:', err);
      return { ok: false, error: err.message };
    }
  },

  guardarAnimal(animalData) {
    const idx = animalData.id
      ? this.state.animales.findIndex((a) => a.id === animalData.id)
      : -1;
    if (idx >= 0) {
      const previo = this.state.animales[idx];
      let aretesAnteriores = Array.isArray(previo.aretesAnteriores)
        ? [...previo.aretesAnteriores]
        : [];
      if (
        previo.arete &&
        previo.arete !== 'S/N' &&
        animalData.arete &&
        previo.arete.trim().toUpperCase() !== animalData.arete.trim().toUpperCase()
      ) {
        if (!aretesAnteriores.includes(previo.arete)) {
          aretesAnteriores.push(previo.arete);
        }
      }

      this.state.animales[idx] = {
        ...previo,
        ...animalData,
        id: previo.id,
        aretesAnteriores,
        updatedAt: new Date().toISOString()
      };

      this.state.animales.forEach((cria) => {
        if (cria.madreId === previo.id) {
          cria.madreFierro = animalData.fierro;
          cria.madreNumero = animalData.numero;
          cria.madreArete = animalData.arete;
        }
      });
    } else {
      const nuevo = {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        aretesAnteriores: [],
        estatus: 'Activo',
        ...animalData,
        id: animalData.id || 'ANM-' + Date.now() + '-' + Math.floor(Math.random() * 1000)
      };
      this.state.animales.unshift(nuevo);
    }

    this.saveLocal();
  },

  registrarBaja(animalId, datosBaja) {
    const animal = this.state.animales.find((a) => a.id === animalId);
    if (!animal) return false;

    animal.estatus = datosBaja.tipoBaja;
    animal.fechaBaja = datosBaja.fechaBaja;
    animal.motivoBaja = datosBaja.motivoBaja || '';
    animal.compradorDestino = datosBaja.compradorDestino || '';
    animal.guiaReemo = datosBaja.guiaReemo || '';
    animal.pesoVenta = datosBaja.pesoVenta || '';
    animal.precioVenta = datosBaja.precioVenta || '';
    animal.notasBaja = datosBaja.notasBaja || '';
    animal.updatedAt = new Date().toISOString();

    this.saveLocal();
    return true;
  },

  reactivarAnimal(animalId) {
    const animal = this.state.animales.find((a) => a.id === animalId);
    if (!animal) return false;

    animal.estatus = 'Activo';
    animal.fechaBaja = '';
    animal.motivoBaja = '';
    animal.compradorDestino = '';
    animal.guiaReemo = '';
    animal.pesoVenta = '';
    animal.precioVenta = '';
    animal.notasBaja = '';
    animal.updatedAt = new Date().toISOString();

    this.saveLocal();
    return true;
  },

  eliminarAnimalDefinitivo(animalId) {
    this.state.animales = this.state.animales.filter((a) => a.id !== animalId);
    this.state.eventosSanitarios = this.state.eventosSanitarios.filter(
      (e) => e.animalId !== animalId
    );
    this.saveLocal();
  },

  registrarEventoSanitario(evento) {
    const nuevoEvento = {
      id: 'SAN-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      createdAt: new Date().toISOString(),
      ...evento
    };
    this.state.eventosSanitarios.unshift(nuevoEvento);

    if (evento.pesoKg && !isNaN(parseFloat(evento.pesoKg))) {
      const animal = this.state.animales.find((a) => a.id === evento.animalId);
      if (animal) {
        animal.pesoActual = parseFloat(evento.pesoKg);
      }
    }

    if (evento.tipo === 'Destete') {
      const animal = this.state.animales.find((a) => a.id === evento.animalId);
      if (animal) {
        if (animal.sexo === 'Hembra' && animal.categoria === 'Becerra (Lactante)') {
          animal.categoria = 'Becerra Destetada';
        } else if (animal.sexo === 'Macho' && animal.categoria === 'Becerro (Lactante)') {
          animal.categoria = 'Becerro Destetado';
        }
      }
    }

    this.saveLocal();
  },

  eliminarEventoSanitario(eventoId) {
    this.state.eventosSanitarios = this.state.eventosSanitarios.filter((e) => e.id !== eventoId);
    this.saveLocal();
  },

  seedDemoData() {
    this.state.config = {
      nombreRancho: 'Rancho Demostración (Vista Portafolio)',
      fierros: [
        { codigo: 'F', propietario: 'Productor A', tono: 0 },
        { codigo: 'H', propietario: 'Productor B', tono: 1 },
        { codigo: 'R', propietario: 'Productora C', tono: 2 }
      ],
      edadDesteteMeses: 7,
      updatedAt: new Date().toISOString()
    };

    this.state.animales = [
      {
        id: 'ANM-F-001',
        fierro: 'F',
        numero: '15',
        arete: 'MX-260015',
        colorArete: 'Amarillo SINIIGA',
        estadoArete: 'Correcto',
        aretesAnteriores: [],
        sexo: 'Hembra',
        categoria: 'Vaca de Cría',
        razaColor: 'Suizo Pardo / Cebú',
        fechaNacimiento: '2021-04-12',
        origen: 'Nacido en rancho',
        pesoActual: 465,
        madreId: '',
        madreFierro: 'F',
        madreNumero: '03',
        madreArete: 'MX-180003',
        estatus: 'Activo',
        notas: 'Registro de demostración para portafolio.'
      },
      {
        id: 'ANM-H-001',
        fierro: 'H',
        numero: '15',
        arete: 'MX-260089',
        colorArete: 'Amarillo SINIIGA',
        estadoArete: 'Correcto',
        aretesAnteriores: [],
        sexo: 'Hembra',
        categoria: 'Vaca de Cría',
        razaColor: 'Brahman Rojo',
        fechaNacimiento: '2022-02-18',
        origen: 'Comprado',
        pesoActual: 440,
        madreId: '',
        madreFierro: '',
        madreNumero: '',
        madreArete: '',
        estatus: 'Activo',
        notas: 'Mismo número #15 en el Fierro H (propiedad separada).'
      },
      {
        id: 'ANM-F-002',
        fierro: 'F',
        numero: '28',
        arete: 'MX-260104',
        colorArete: 'Amarillo SINIIGA',
        estadoArete: 'Correcto',
        aretesAnteriores: [],
        sexo: 'Macho',
        categoria: 'Becerro (Lactante)',
        razaColor: 'Suizo Pardo',
        fechaNacimiento: '2026-03-01',
        origen: 'Nacido en rancho',
        pesoActual: 195,
        madreId: 'ANM-F-001',
        madreFierro: 'F',
        madreNumero: '15',
        madreArete: 'MX-260015',
        estatus: 'Activo',
        notas: 'Cría vinculada a la vaca #15 del Fierro F.'
      },
      {
        id: 'ANM-H-002',
        fierro: 'H',
        numero: '22',
        arete: 'S/N',
        colorArete: 'Sin arete',
        estadoArete: 'Pendiente colocar',
        aretesAnteriores: ['MX-250911'],
        sexo: 'Hembra',
        categoria: 'Becerra (Lactante)',
        razaColor: 'Brahman / Charolais',
        fechaNacimiento: '2026-07-15',
        origen: 'Nacido en rancho',
        pesoActual: 115,
        madreId: 'ANM-H-001',
        madreFierro: 'H',
        madreNumero: '15',
        madreArete: 'MX-260089',
        estatus: 'Activo',
        notas: 'Ejemplo de alerta por reposición de arete.'
      },
      {
        id: 'ANM-F-003',
        fierro: 'F',
        numero: '09',
        arete: 'MX-230041',
        colorArete: 'Amarillo SINIIGA',
        estadoArete: 'Correcto',
        aretesAnteriores: [],
        sexo: 'Macho',
        categoria: 'Torete / Engorda',
        razaColor: 'Charolais',
        fechaNacimiento: '2024-11-10',
        origen: 'Nacido en rancho',
        pesoActual: 380,
        madreId: 'ANM-F-001',
        madreFierro: 'F',
        madreNumero: '15',
        madreArete: 'MX-260015',
        estatus: 'Vendido',
        fechaBaja: '2026-10-15',
        motivoBaja: 'Venta de engorda',
        compradorDestino: 'Comercializadora Agropecuaria Demo',
        guiaReemo: 'REEMO-00418',
        pesoVenta: '380',
        precioVenta: '24700',
        notasBaja: 'Ejemplo de venta para portafolio.'
      },
      {
        id: 'ANM-H-003',
        fierro: 'H',
        numero: '04',
        arete: 'MX-200012',
        colorArete: 'Amarillo SINIIGA',
        estadoArete: 'Correcto',
        aretesAnteriores: [],
        sexo: 'Hembra',
        categoria: 'Vaca de Cría',
        razaColor: 'Cebú Comercial',
        fechaNacimiento: '2019-06-20',
        origen: 'Nacido en rancho',
        pesoActual: 410,
        madreId: '',
        madreFierro: '',
        madreNumero: '',
        madreArete: '',
        estatus: 'Muerto',
        fechaBaja: '2026-09-02',
        motivoBaja: 'Causa natural registrada en bitácora',
        compradorDestino: '',
        guiaReemo: '',
        pesoVenta: '',
        precioVenta: '',
        notasBaja: 'Ejemplo de baja para portafolio.'
      },
      {
        id: 'ANM-R-001',
        fierro: 'R',
        numero: '15',
        arete: 'MX-260230',
        colorArete: 'Amarillo SINIIGA',
        estadoArete: 'Correcto',
        aretesAnteriores: [],
        sexo: 'Hembra',
        categoria: 'Novillona',
        razaColor: 'Simmental / Beefmaster',
        fechaNacimiento: '2024-08-03',
        origen: 'Comprado',
        pesoActual: 352,
        madreId: '',
        madreFierro: '',
        madreNumero: '',
        madreArete: '',
        estatus: 'Activo',
        notas: 'Tercer dueño en el mismo terreno: el #15 también existe en F y H.'
      }
    ];

    this.state.eventosSanitarios = [
      {
        id: 'SAN-001',
        animalId: 'ANM-F-001',
        fecha: '2026-09-15',
        tipo: 'Vacunación',
        producto: 'Bacterina Triple / Carbón Sintomático',
        dosis: '5 ml subcutáneo',
        pesoKg: 465,
        proximaFecha: '2027-03-15',
        notas: 'Campaña sanitaria de demostración'
      },
      {
        id: 'SAN-002',
        animalId: 'ANM-H-001',
        fecha: '2026-09-15',
        tipo: 'Desparasitación',
        producto: 'Ivermectina 1% + Vitamina ADE',
        dosis: '9 ml',
        pesoKg: 440,
        proximaFecha: '2027-01-15',
        notas: 'Control antiparasitario'
      }
    ];

    this.saveLocal();
  },

  limpiarTodoElRancho() {
    this.state.animales = [];
    this.state.eventosSanitarios = [];
    this.saveLocal();
  }
};
