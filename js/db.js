/**
 * Capa de datos de la app.
 * 1. Modo Portafolio / Demo: datos ficticios solo en este navegador (sin servidor).
 * 2. Modo Rancho privado: cuenta en el servidor (API propia + PostgreSQL). Los datos se guardan
 *    también en el dispositivo (IndexedDB) para trabajar sin señal y se sincronizan solos.
 */

const STORAGE_KEY_DEMO = 'rancho_fh_demo_portfolio_v1';
const STORAGE_KEY_REAL_ANTIGUO = 'rancho_fh_privado_real_v1'; // datos privados de la versión con PIN
const STORAGE_KEY_SESION = 'rancho_sesion_v2';
const CLAVE_ANTIGUOS_SUBIDOS = 'rancho_datos_antiguos_subidos';

window.RanchoDB = {
  // 'DEMO' (visitantes del portafolio) | 'REAL' (cuenta del rancho)
  sessionMode: 'DEMO',

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

  // Sesión y sincronización con el servidor
  sesion: null, // { usuario, ranchos, ranchoId }
  ranchoActual: null, // { id, nombre, rol }
  base: null, // última versión confirmada por el servidor (ver js/sync.js)
  cursor: 0,
  rechazos: {},
  sesionVencida: false,
  ultimaSync: null,
  syncError: '',
  _sincronizando: null,
  _temporizadorSync: null,

  // Compatibilidad con la interfaz: texto y punto de estado
  cloudConfig: { statusText: 'Vista Portafolio (Datos Demo)', enabled: false, pendingSync: false },

  listeners: [],

  async init() {
    const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    const forzarDemo = params && (params.get('modo') === 'portafolio' || params.get('demo') === '1');
    const vistaElegida = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('rancho_active_mode') : null;
    this.sesion = this._leerSesionGuardada();

    if (!forzarDemo && this.sesion && vistaElegida !== 'DEMO') {
      await this.activarModoReal();
      this.verificarSesion();
      this.sincronizar();
    } else {
      this.activarModoDemo();
    }

    window.addEventListener('online', () => {
      this.updateNetworkStatus();
      this.sincronizar();
    });
    window.addEventListener('offline', () => this.updateNetworkStatus());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.sincronizar();
    });
    // Traer cambios de otros dispositivos cada minuto mientras la app está abierta
    setInterval(() => {
      if (document.visibilityState === 'visible') this.sincronizar();
    }, 60000);
  },

  /* ================================================================ PERMISOS */
  rol() {
    return this.sessionMode === 'REAL' && this.ranchoActual ? this.ranchoActual.rol : 'admin';
  },
  puedeEditar() {
    return this.rol() !== 'lector';
  },
  esAdmin() {
    return this.rol() === 'admin';
  },

  /* ================================================================ API */
  async _api(metodo, ruta, cuerpo) {
    let res;
    try {
      res = await fetch(ruta, {
        method: metodo,
        credentials: 'same-origin',
        headers: cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined
      });
    } catch (e) {
      const err = new Error('Sin conexión con el servidor. Revisa tu señal e intenta de nuevo.');
      err.sinRed = true;
      throw err;
    }
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(datos.mensaje || `Error del servidor (${res.status}).`);
      err.status = res.status;
      err.codigo = datos.error;
      throw err;
    }
    return datos;
  },

  /* ================================================================ SESIÓN */
  _leerSesionGuardada() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY_SESION) || 'null');
      return s && s.usuario && Array.isArray(s.ranchos) && s.ranchos.length ? s : null;
    } catch (e) {
      return null;
    }
  },

  _guardarSesion(datos) {
    const ranchoId =
      (this.sesion && datos.ranchos.some((r) => r.id === this.sesion.ranchoId) && this.sesion.ranchoId) ||
      (datos.ranchos[0] && datos.ranchos[0].id);
    this.sesion = { usuario: datos.usuario, ranchos: datos.ranchos, ranchoId };
    localStorage.setItem(STORAGE_KEY_SESION, JSON.stringify(this.sesion));
  },

  estadoServidor() {
    return this._api('GET', '/api/estado');
  },

  async _entrarConDatos(datos) {
    if (!datos.ranchos || datos.ranchos.length === 0) {
      throw new Error('Tu cuenta todavía no tiene acceso a ningún rancho. Pide al administrador que te agregue.');
    }
    this._guardarSesion(datos);
    this.sesionVencida = false;
    sessionStorage.setItem('rancho_active_mode', 'REAL');
    await this.activarModoReal();
    await this.sincronizar({ esperar: true });
  },

  async entrar(email, password) {
    const datos = await this._api('POST', '/api/auth/entrar', { email, password });
    await this._entrarConDatos(datos);
  },

  async configurarInicial(campos) {
    const datos = await this._api('POST', '/api/configuracion-inicial', campos);
    await this._entrarConDatos(datos);
  },

  /** Comprueba en segundo plano que la sesión siga vigente y actualiza los roles. */
  async verificarSesion() {
    if (!this.sesion || !navigator.onLine) return;
    try {
      const datos = await this._api('GET', '/api/auth/yo');
      if (!datos.usuario) {
        this.sesionVencida = true;
      } else {
        this.sesionVencida = false;
        this._guardarSesion(datos);
        const r = datos.ranchos.find((x) => x.id === this.sesion.ranchoId);
        if (r && this.ranchoActual) this.ranchoActual = { ...this.ranchoActual, ...r };
      }
      this.updateNetworkStatus();
    } catch (e) {
      /* sin red: se reintenta después */
    }
  },

  /** Cambia a la vista de portafolio sin cerrar la sesión. */
  verPortafolio() {
    sessionStorage.setItem('rancho_active_mode', 'DEMO');
    this.activarModoDemo();
  },

  /** Vuelve al rancho privado si hay sesión guardada; devuelve false si hay que iniciar sesión. */
  async volverAlRancho() {
    if (!this.sesion) return false;
    sessionStorage.setItem('rancho_active_mode', 'REAL');
    await this.activarModoReal();
    this.verificarSesion();
    this.sincronizar();
    return true;
  },

  contarPendientes() {
    if (this.sessionMode !== 'REAL' || !this.base) return 0;
    return window.RanchoSync.calcularOps(this.state, this.base, this.rechazos).length;
  },

  /**
   * Cierra la sesión en este dispositivo y borra la copia local del rancho.
   * Si hay cambios sin subir, lanza un error con codigo PENDIENTES (salvo forzar).
   */
  async salir({ forzar = false } = {}) {
    const pendientes = this.contarPendientes();
    if (pendientes > 0 && !forzar) {
      const err = new Error(`Hay ${pendientes} cambio(s) sin subir al servidor.`);
      err.codigo = 'PENDIENTES';
      throw err;
    }
    try {
      await this._api('POST', '/api/auth/salir', {});
    } catch (e) {
      /* sin red: la cookie expira sola */
    }
    if (this.ranchoActual) await window.RanchoAlmacen.borrar(`rancho:${this.ranchoActual.id}`).catch(() => {});
    localStorage.removeItem(STORAGE_KEY_SESION);
    this.sesion = null;
    this.ranchoActual = null;
    this.base = null;
    sessionStorage.setItem('rancho_active_mode', 'DEMO');
    this.activarModoDemo();
  },

  cambiarContrasena(actual, nueva) {
    return this._api('POST', '/api/auth/contrasena', { actual, nueva });
  },

  listarMiembros() {
    return this._api('GET', `/api/ranchos/${this.ranchoActual.id}/miembros`);
  },
  agregarMiembro(datos) {
    return this._api('POST', `/api/ranchos/${this.ranchoActual.id}/miembros`, datos);
  },
  cambiarRolMiembro(usuarioId, rol) {
    return this._api('PATCH', `/api/ranchos/${this.ranchoActual.id}/miembros/${encodeURIComponent(usuarioId)}`, { rol });
  },
  quitarMiembro(usuarioId) {
    return this._api('DELETE', `/api/ranchos/${this.ranchoActual.id}/miembros/${encodeURIComponent(usuarioId)}`, {});
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

  /** Carga el rancho de la sesión desde la copia del dispositivo (funciona sin señal). */
  async activarModoReal() {
    this.sessionMode = 'REAL';
    const id = this.sesion.ranchoId;
    this.ranchoActual = { ...(this.sesion.ranchos.find((r) => r.id === id) || this.sesion.ranchos[0]) };

    let guardado = null;
    try {
      guardado = await window.RanchoAlmacen.leer(`rancho:${this.ranchoActual.id}`);
    } catch (e) {
      console.warn('No se pudo leer la copia local del rancho:', e);
    }

    if (guardado && guardado.state) {
      this.state = this.normalizarEstado(guardado.state, { nombreRancho: this.ranchoActual.nombre, edadDesteteMeses: 7 });
      this.base = guardado.base || window.RanchoSync.baseVacia();
      this.cursor = Number(guardado.cursor) || 0;
      this.rechazos = guardado.rechazos || {};
      this.ultimaSync = guardado.ultimaSync || null;
    } else {
      // Primera vez en este dispositivo: se llena con la primera sincronización
      this.state = {
        config: { nombreRancho: this.ranchoActual.nombre, fierros: [], edadDesteteMeses: 7 },
        animales: [],
        eventosSanitarios: []
      };
      this.base = window.RanchoSync.baseVacia();
      this.cursor = 0;
      this.rechazos = {};
      this.ultimaSync = null;
    }
    this.updateNetworkStatus();
    this.notify();
  },

  _persistir() {
    if (this.sessionMode !== 'REAL' || !this.ranchoActual) return Promise.resolve();
    return window.RanchoAlmacen.guardar(`rancho:${this.ranchoActual.id}`, {
      state: this.state,
      base: this.base,
      cursor: this.cursor,
      rechazos: this.rechazos,
      ultimaSync: this.ultimaSync
    }).catch((e) => {
      console.error('No se pudo guardar en el dispositivo:', e);
      const app = window.RanchoApp;
      if (app && app.mostrarToast) {
        app.mostrarToast('No se pudo guardar en este dispositivo. Libera espacio o descarga un respaldo.', 'error');
      }
    });
  },

  _programarSync() {
    clearTimeout(this._temporizadorSync);
    this._temporizadorSync = setTimeout(() => this.sincronizar(), 800);
  },

  /**
   * Sube los cambios pendientes y baja los de otros dispositivos.
   * Nunca lanza errores: deja el estado en syncError / sesionVencida para la interfaz.
   */
  sincronizar({ esperar = false } = {}) {
    if (this.sessionMode !== 'REAL' || !this.ranchoActual) return Promise.resolve({ ok: false });
    if (this._sincronizando) {
      this._otraVez = true;
      return esperar ? this._sincronizando : Promise.resolve({ ok: false, enCurso: true });
    }
    if (!navigator.onLine) {
      this.updateNetworkStatus();
      return Promise.resolve({ ok: false, sinRed: true });
    }

    const S = window.RanchoSync;
    const ranchoId = this.ranchoActual.id;
    this._sincronizando = (async () => {
      this.updateNetworkStatus();
      try {
        for (let vuelta = 0; vuelta < 25; vuelta++) {
          const inicial = this.cursor === 0;
          const pendientes = inicial || !this.puedeEditar() ? [] : S.calcularOps(this.state, this.base, this.rechazos);
          const lote = pendientes.slice(0, S.LOTE_MAXIMO);
          const foto = S.fotoDe(this.state, lote);
          const resp = await this._api('POST', `/api/ranchos/${ranchoId}/sync`, { cursor: this.cursor, ops: lote });
          if (this.sessionMode !== 'REAL' || !this.ranchoActual || this.ranchoActual.id !== ranchoId) break;

          if (resp.rol && resp.rol !== this.ranchoActual.rol) this.ranchoActual.rol = resp.rol;

          if (inicial) {
            // Primera descarga: el servidor manda todo; se conservan solo creaciones locales sin subir
            const locales = this.state.animales.filter((a) => !resp.animales.some((x) => x.id === a.id));
            const eventosLocales = this.state.eventosSanitarios.filter((e) => !resp.eventosSanitarios.some((x) => x.id === e.id));
            const servidor = this.normalizarEstado(
              { config: resp.config, animales: resp.animales, eventosSanitarios: resp.eventosSanitarios },
              { nombreRancho: this.ranchoActual.nombre, edadDesteteMeses: 7 }
            );
            this.base = {
              config: resp.config ? { ...resp.config } : null,
              animales: Object.fromEntries(resp.animales.map((a) => [a.id, a])),
              eventos: Object.fromEntries(resp.eventosSanitarios.map((e) => [e.id, e]))
            };
            this.state = {
              config: servidor.config,
              animales: [...locales, ...servidor.animales],
              eventosSanitarios: [...eventosLocales, ...servidor.eventosSanitarios]
            };
            this.cursor = resp.cursor;
          } else {
            const r = S.aplicarRespuesta(this.state, this.base, { ops: lote, foto }, resp, this.rechazos);
            this.state = r.estado;
            this.base = r.base;
            this.cursor = r.cursor;
            this.rechazos = r.rechazos;
          }
          if (resp.config && resp.config.nombreRancho) this.ranchoActual.nombre = resp.config.nombreRancho;

          this.ultimaSync = new Date().toISOString();
          this.syncError = '';
          this.sesionVencida = false;
          await this._persistir();
          this.notify();

          const quedan = this.puedeEditar() ? S.calcularOps(this.state, this.base, this.rechazos).length : 0;
          if (quedan === 0 || (!inicial && lote.length === 0)) break;
        }
        return { ok: true, rechazos: Object.keys(this.rechazos).length };
      } catch (err) {
        if (err.status === 401) this.sesionVencida = true;
        else if (err.status === 403) this.syncError = 'Tu cuenta ya no tiene acceso a este rancho.';
        else this.syncError = err.sinRed ? '' : err.message;
        return { ok: false, error: err.message, status: err.status };
      } finally {
        this._sincronizando = null;
        this.updateNetworkStatus();
        if (this._otraVez) {
          this._otraVez = false;
          this._programarSync();
        }
      }
    })();
    return this._sincronizando;
  },

  /** Cambios que el servidor rechazó (número/arete duplicado, permisos...). */
  listaRechazos() {
    return Object.entries(this.rechazos || {}).map(([clave, r]) => {
      let titulo = 'Datos del rancho';
      if (r.entidad === 'animal') {
        const a = this.state.animales.find((x) => x.id === r.id);
        titulo = a ? `Fierro ${a.fierro} #${a.numero}` : 'Animal';
      } else if (r.entidad === 'evento') {
        const e = this.state.eventosSanitarios.find((x) => x.id === r.id);
        titulo = e ? `Manejo sanitario: ${e.tipo} (${e.fecha || 'sin fecha'})` : 'Manejo sanitario';
      }
      return { clave, titulo, ...r };
    });
  },

  descartarRechazo(clave) {
    this.state = window.RanchoSync.descartarCambio(this.state, this.base, clave);
    delete this.rechazos[clave];
    this._persistir();
    this.updateNetworkStatus();
  },

  /** Datos privados de la versión anterior (con PIN) guardados en este navegador. */
  datosAntiguosDelDispositivo() {
    if (localStorage.getItem(CLAVE_ANTIGUOS_SUBIDOS)) return null;
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY_REAL_ANTIGUO) || 'null');
      return raw && Array.isArray(raw.animales) && raw.animales.length ? raw : null;
    } catch (e) {
      return null;
    }
  },

  /**
   * Reemplaza los datos del rancho por los de un respaldo o de la versión anterior.
   * Las diferencias se suben al servidor en la siguiente sincronización.
   */
  importarEstado(raw, { marcarAntiguos = false } = {}) {
    const limpio = this.normalizarEstado(raw, this.state.config);
    if (this.sessionMode === 'REAL' && !this.esAdmin()) {
      // Solo un admin cambia fierros y nombre: se conserva la configuración del servidor
      limpio.config = this.state.config;
    } else if (this.sessionMode === 'REAL' && this.ranchoActual) {
      limpio.config.nombreRancho = limpio.config.nombreRancho || this.ranchoActual.nombre;
    }
    this.state = limpio;
    if (marcarAntiguos) localStorage.setItem(CLAVE_ANTIGUOS_SUBIDOS, new Date().toISOString());
    this.saveLocal();
  },

  updateNetworkStatus() {
    const c = this.cloudConfig;
    if (this.sessionMode === 'DEMO') {
      c.statusText = 'Vista Portafolio (Datos Demo)';
      c.enabled = false;
      c.pendingSync = false;
      this.notify();
      return;
    }
    const pendientes = this.contarPendientes();
    const rechazos = Object.keys(this.rechazos || {}).length;
    c.enabled = true;
    c.pendingSync = pendientes > 0 || !!this._sincronizando;
    if (!navigator.onLine) {
      c.statusText = pendientes ? `Sin señal · ${pendientes} cambio(s) guardados en el dispositivo` : 'Sin señal · datos guardados en el dispositivo';
    } else if (this.sesionVencida) {
      c.statusText = 'Sesión vencida · inicia sesión para sincronizar';
    } else if (this._sincronizando) {
      c.statusText = 'Sincronizando…';
    } else if (this.syncError) {
      c.statusText = `No se pudo sincronizar: ${this.syncError}`;
    } else if (rechazos) {
      c.statusText = `${rechazos} cambio(s) no se pudieron subir · revisa`;
    } else if (pendientes) {
      c.statusText = `${pendientes} cambio(s) por subir`;
    } else {
      c.statusText = this.ultimaSync ? 'Rancho sincronizado' : 'Conectando con el servidor…';
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
    if (this.sessionMode === 'REAL') {
      this._persistir();
      this._programarSync();
    } else {
      this._guardarSeguro(STORAGE_KEY_DEMO, JSON.stringify(this.state));
    }
    this.updateNetworkStatus();
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
