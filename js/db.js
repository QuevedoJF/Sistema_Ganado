/**
 * Capa de Persistencia con Separación de Seguridad:
 * 1. Modo Portafolio / Demo Público (Datos ficticios aislados para visitantes del portafolio)
 * 2. Modo Rancho Privado (Protegido por Clave/PIN y sincronizado con la Nube real)
 */

const STORAGE_KEY_REAL = 'rancho_fh_privado_real_v1';
const STORAGE_KEY_DEMO = 'rancho_fh_demo_portfolio_v1';
const STORAGE_KEY_CLOUD = 'rancho_fh_cloud_config_v1';
const STORAGE_KEY_AUTH = 'rancho_fh_auth_config_v1';

window.RanchoDB = {
  // 'DEMO' (visitantes del portafolio) | 'REAL' (propietarios autenticados)
  sessionMode: 'DEMO',

  authConfig: {
    pinHash: '1234', // Clave inicial que el dueño puede cambiar en Configuración
    rememberSession: false
  },

  state: {
    config: {
      nombreRancho: 'Rancho Demostración (Vista Portafolio)',
      propietarioF: 'Productor A (Fierro F)',
      propietarioH: 'Productor B (Fierro H)',
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

  listeners: [],

  init() {
    this.loadAuthConfig();
    this.loadCloudConfig();

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

  verificarPinPropietario(pinIngresado) {
    const limpio = String(pinIngresado || '').trim();
    return limpio.length > 0 && limpio === String(this.authConfig.pinHash).trim();
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
        this.state = {
          config: { ...this.state.config, ...(parsed.config || {}) },
          animales: Array.isArray(parsed.animales) ? parsed.animales : [],
          eventosSanitarios: Array.isArray(parsed.eventosSanitarios) ? parsed.eventosSanitarios : []
        };
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
        this.state = {
          config: {
            nombreRancho: 'Mi Rancho Ganadero',
            propietarioF: 'Propietario Fierro F',
            propietarioH: 'Propietario Fierro H',
            edadDesteteMeses: 7,
            ...(parsed.config || {})
          },
          animales: Array.isArray(parsed.animales) ? parsed.animales : [],
          eventosSanitarios: Array.isArray(parsed.eventosSanitarios) ? parsed.eventosSanitarios : []
        };
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
        propietarioF: 'Propietario Fierro F',
        propietarioH: 'Propietario Fierro H',
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
    localStorage.setItem(targetKey, JSON.stringify(this.state));

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

  async syncToCloud() {
    if (this.sessionMode !== 'REAL' || !this.cloudConfig.enabled || !navigator.onLine) {
      return { ok: false, reason: 'not_real_or_offline' };
    }

    try {
      const payload = JSON.stringify(this.state);
      let url = '';

      if (this.cloudConfig.provider === 'firebase' && this.cloudConfig.projectId) {
        const docId = encodeURIComponent(this.cloudConfig.ranchoCode || 'RANCHO-FH-PRIVADO');
        const keyParam = this.cloudConfig.apiKey
          ? `?key=${encodeURIComponent(this.cloudConfig.apiKey)}`
          : '';
        url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
          this.cloudConfig.projectId
        )}/databases/(default)/documents/ranchos/${docId}${keyParam}`;

        const firestoreBody = {
          fields: {
            ranchoCode: { stringValue: this.cloudConfig.ranchoCode || 'RANCHO-FH-PRIVADO' },
            updatedAt: { stringValue: new Date().toISOString() },
            payloadJson: { stringValue: payload }
          }
        };

        const res = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(firestoreBody)
        });

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
        const docId = encodeURIComponent(this.cloudConfig.ranchoCode || 'RANCHO-FH-PRIVADO');
        const keyParam = this.cloudConfig.apiKey
          ? `?key=${encodeURIComponent(this.cloudConfig.apiKey)}`
          : '';
        const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
          this.cloudConfig.projectId
        )}/databases/(default)/documents/ranchos/${docId}${keyParam}`;

        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.fields && data.fields.payloadJson && data.fields.payloadJson.stringValue) {
            remoteState = JSON.parse(data.fields.payloadJson.stringValue);
          }
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
          this.state = remoteState;
          localStorage.setItem(STORAGE_KEY_REAL, JSON.stringify(this.state));
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
      propietarioF: 'Productor A (Fierro F)',
      propietarioH: 'Productor B (Fierro H)',
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
