/**
 * Controlador Principal de la Aplicación Ganadera (varios dueños / fierros en un terreno)
 */

/**
 * Escapa texto para insertarlo de forma segura en plantillas HTML (innerHTML).
 * Todo dato capturado por el usuario, importado o descargado del servidor debe pasar por aquí.
 */
/** Sello visual de un fierro con el color de su dueño. */
function sello(codigo, claseExtra = '') {
  const f = window.RanchoDB.getFierro(codigo);
  const tono = f ? f.tono : 6;
  const titulo = f ? `Fierro ${f.codigo} — ${f.propietario}` : `Fierro ${codigo}`;
  return `<span class="stamp-fierro tono-${tono} ${claseExtra}" title="${esc(titulo)}">${esc(codigo)}</span>`;
}

function esc(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.RanchoApp = {
  filtroFierro: 'TODOS', // 'TODOS' o el código de un fierro (ej. 'F', 'H', 'R')
  tabActiva: 'inventario', // 'inventario' | 'buscar' | 'bajas' | 'sanidad' | 'genealogia'
  busquedaTexto: '',
  busquedaHistorial: '',
  filtroSexo: 'TODOS',
  filtroCategoria: 'TODAS',
  filtroAreteEstado: 'TODOS',

  formAnimalActual: {
    id: null,
    fierro: '',
    sexo: 'Hembra'
  },

  async init() {
    window.RanchoDB.subscribe(() => {
      this.renderTodo();
    });
    this.registrarServiceWorker();
    this.registrarAtajosModales();
    await window.RanchoDB.init();
    this.renderTodo();
  },

  registrarAtajosModales() {
    document.addEventListener('keydown', (e) => {
      const escribiendo = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
      if (e.key === '/' && !escribiendo && !document.querySelector('.modal-backdrop.open')) {
        e.preventDefault();
        this.abrirBuscador();
        return;
      }
      if (e.key !== 'Escape') return;
      const abierto = [...document.querySelectorAll('.modal-backdrop.open')].pop();
      if (abierto) {
        this.cerrarModal(abierto.id);
      } else {
        this.toggleSidebar(false);
      }
    });
    document.querySelectorAll('.modal-backdrop').forEach((bd) => {
      bd.addEventListener('mousedown', (e) => {
        if (e.target === bd) this.cerrarModal(bd.id);
      });
    });
  },

  registrarServiceWorker() {
    if (
      'serviceWorker' in navigator &&
      (location.protocol === 'https:' ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1')
    ) {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          reg.update();
        })
        .catch((err) => {
          console.warn('SW no registrado en modo archivo local:', err);
        });
    }
  },

  mostrarToast(mensaje, tipo = 'ok') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${tipo === 'error' ? 'error' : ''}`;
    toast.textContent = mensaje;
    toast.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    container.appendChild(toast);
    // Máximo 3 avisos a la vista: se quitan los más viejos
    while (container.children.length > 3) container.firstElementChild.remove();
    setTimeout(() => {
      toast.remove();
    }, 4000);
  },

  cambiarFiltroFierro(fierro) {
    this.filtroFierro = fierro;
    this.toggleSidebar(false);
    this.renderTodo();
  },

  cambiarTab(tab) {
    this.tabActiva = tab;
    this.toggleSidebar(false);
    this.renderTodo();
  },

  toggleSidebar(abrir = null) {
    const sb = document.getElementById('mainSidebar');
    const bd = document.getElementById('sidebarBackdrop');
    if (!sb) return;
    const estaAbierto = sb.classList.contains('open');
    const nuevoEstado = abrir !== null ? abrir : !estaAbierto;
    sb.classList.toggle('open', nuevoEstado);
    if (bd) bd.classList.toggle('open', nuevoEstado);
    document.body.classList.toggle('sidebar-open', nuevoEstado);
  },

  obtenerAnimalesFiltrados(forzarEstatus = null) {
    const todos = window.RanchoDB.state.animales;
    const q = this.busquedaTexto.trim().toUpperCase();

    return todos.filter((a) => {
      if (this.filtroFierro !== 'TODOS' && a.fierro !== this.filtroFierro) {
        return false;
      }

      if (forzarEstatus === 'Activo' && a.estatus !== 'Activo') return false;
      if (forzarEstatus === 'Bajas' && a.estatus === 'Activo') return false;

      if (this.filtroSexo !== 'TODOS' && a.sexo !== this.filtroSexo) return false;
      if (this.filtroCategoria !== 'TODAS' && a.categoria !== this.filtroCategoria) return false;

      if (this.filtroAreteEstado === 'SIN_ARETE') {
        const sinArete = !a.arete || a.arete === 'S/N' || a.estadoArete !== 'Correcto';
        if (!sinArete) return false;
      }

      if (q) {
        const campos = [
          `#${a.numero}`,
          a.numero,
          a.arete,
          a.fierro,
          a.categoria,
          a.razaColor,
          a.madreNumero ? `MADRE #${a.madreNumero}` : '',
          a.madreArete || '',
          a.compradorDestino || '',
          a.guiaReemo || '',
          a.motivoBaja || '',
          a.notas || ''
        ]
          .join(' ')
          .toUpperCase();
        if (!campos.includes(q)) return false;
      }

      return true;
    });
  },

  renderTodo() {
    this.renderEncabezadoYNube();
    this.renderAvisosSync();
    this.renderBotonesFierro();
    this.renderKPIs();
    this.renderAlertasCorral();
    this.renderTabsContadores();
    this.renderVistaPrincipal();
  },

  renderEncabezadoYNube() {
    const { config } = window.RanchoDB.state;
    const cloudCfg = window.RanchoDB.cloudConfig;

    const titleEl = document.getElementById('ranchoNombreHeader');
    if (titleEl) titleEl.textContent = config.nombreRancho;

    const fierros = window.RanchoDB.getFierros();
    const subEl = document.getElementById('ranchoPropietariosHeader');
    if (subEl) {
      subEl.textContent =
        fierros.length === 1
          ? `1 dueño · Fierro ${fierros[0].codigo}`
          : `${fierros.length} dueños · Fierros ${fierros.map((f) => f.codigo).join(', ')}`;
    }
    this.renderEmblemas(fierros);

    const syncDot = document.getElementById('syncStatusDot');
    const syncText = document.getElementById('syncStatusText');
    const sessionBanner = document.getElementById('sessionModeBanner');
    const btnSwitch = document.getElementById('btnToggleSessionMode');
    const esReal = window.RanchoDB.sessionMode === 'REAL';

    if (sessionBanner) {
      sessionBanner.className = `session-mode-box ${esReal ? 'mode-real' : 'mode-demo'}`;
    }
    if (btnSwitch) {
      btnSwitch.textContent = esReal
        ? 'Ver vista portafolio'
        : window.RanchoDB.sesion
        ? 'Volver a mi rancho'
        : 'Entrar al rancho privado';
    }

    const mobTitle = document.getElementById('mobileRanchoNombre');
    const mobStatus = document.getElementById('mobileSessionStatus');
    if (mobTitle) mobTitle.textContent = config.nombreRancho;
    if (mobStatus) mobStatus.textContent = cloudCfg.statusText;
    const mobDot = document.getElementById('mobileSyncDot');
    if (mobDot) {
      mobDot.className = 'sync-dot';
      if (!esReal) mobDot.classList.add('demo');
      else if (!navigator.onLine) mobDot.classList.add('offline');
      else if (window.RanchoDB.sesionVencida || window.RanchoDB.syncError) mobDot.classList.add('offline');
      else if (cloudCfg.enabled && !cloudCfg.pendingSync) mobDot.classList.add('cloud');
    }

    if (syncDot && syncText) {
      syncText.textContent = cloudCfg.statusText;
      syncDot.className = 'sync-dot';
      if (!esReal) {
        syncDot.classList.add('demo');
      } else if (!navigator.onLine) {
        syncDot.classList.add('offline');
      } else if (window.RanchoDB.sesionVencida || window.RanchoDB.syncError) {
        syncDot.classList.add('offline');
      } else if (cloudCfg.enabled && !cloudCfg.pendingSync) {
        syncDot.classList.add('cloud');
      }
    }

    // Actualizar título dinámico del área de trabajo
    const titulos = {
      inventario: 'Padrón de Ganado Activo',
      buscar: 'Buscar en todo el historial',
      genealogia: 'Registro Genealógico (Madres y Crías)',
      sanidad: 'Bitácora de Sanidad, Pesajes y Destetes',
      bajas: 'Registro Histórico de Ventas y Bajas'
    };
    const fActivo = window.RanchoDB.getFierro(this.filtroFierro);
    const subFierro = fActivo
      ? `Fierro ${fActivo.codigo} — ${fActivo.propietario}`
      : fierros.length > 1
      ? `Todos los fierros del terreno (${fierros.length} dueños)`
      : 'Todo el ganado del terreno';

    const vistaTit = document.getElementById('vistaTituloPrincipal');
    const vistaSub = document.getElementById('vistaSubtitulo');
    if (vistaTit) vistaTit.textContent = titulos[this.tabActiva] || 'Padrón de Ganado';
    if (vistaSub) vistaSub.textContent = subFierro;
  },

  renderEmblemas(fierros) {
    const visibles = fierros.slice(0, 3);
    const extra = fierros.length - visibles.length;
    const html =
      visibles
        .map((f) => `<span class="emblem-code tono-${f.tono}">${esc(f.codigo)}</span>`)
        .join('<span class="emblem-divider"></span>') +
      (extra > 0 ? `<span class="emblem-more">+${extra}</span>` : '');
    ['brandEmblem', 'mobileEmblem'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = html;
        el.dataset.count = String(Math.min(fierros.length, 4));
      }
    });
  },

  renderBotonesFierro() {
    const { animales } = window.RanchoDB.state;
    const fierros = window.RanchoDB.getFierros();

    // Si el filtro apunta a un fierro que ya no existe, volver a "todos"
    if (this.filtroFierro !== 'TODOS' && !fierros.some((f) => f.codigo === this.filtroFierro)) {
      this.filtroFierro = 'TODOS';
    }

    const activosDe = (codigo) =>
      animales.filter((a) => a.fierro === codigo && a.estatus === 'Activo').length;
    const totalActivos = animales.filter((a) => a.estatus === 'Activo').length;
    const todosActivo = this.filtroFierro === 'TODOS';

    const selector = document.getElementById('fierroSelector');
    if (selector) {
      selector.innerHTML =
        `<button type="button" class="fierro-option ${todosActivo ? 'is-active' : ''}" aria-pressed="${todosActivo}" onclick="RanchoApp.cambiarFiltroFierro('TODOS')">
          <span class="fierro-option-mark mark-all" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="6" height="6" rx="1.2"/><rect x="11" y="3" width="6" height="6" rx="1.2"/><rect x="3" y="11" width="6" height="6" rx="1.2"/><rect x="11" y="11" width="6" height="6" rx="1.2"/></svg>
          </span>
          <span class="fierro-option-info">
            <span class="fierro-option-title">Todo el terreno</span>
            <span class="fierro-option-sub">${fierros.length} ${fierros.length === 1 ? 'dueño' : 'dueños'}</span>
          </span>
          <span class="fierro-option-count">${totalActivos}</span>
        </button>` +
        fierros
          .map((f) => {
            const activo = this.filtroFierro === f.codigo;
            return `<button type="button" class="fierro-option tono-${f.tono} ${activo ? 'is-active' : ''}" aria-pressed="${activo}" onclick="RanchoApp.cambiarFiltroFierro('${esc(f.codigo)}')">
              <span class="fierro-option-mark" aria-hidden="true">${esc(f.codigo)}</span>
              <span class="fierro-option-info">
                <span class="fierro-option-title">Fierro ${esc(f.codigo)}</span>
                <span class="fierro-option-sub">${esc(f.propietario)}</span>
              </span>
              <span class="fierro-option-count">${activosDe(f.codigo)}</span>
            </button>`;
          })
          .join('');
    }

    const chips = document.getElementById('mobileFierroChips');
    if (chips) {
      chips.innerHTML =
        `<button type="button" class="m-chip ${todosActivo ? 'is-active' : ''}" aria-pressed="${todosActivo}" onclick="RanchoApp.cambiarFiltroFierro('TODOS')">
          Todos <span class="m-chip-count">${totalActivos}</span>
        </button>` +
        fierros
          .map((f) => {
            const activo = this.filtroFierro === f.codigo;
            return `<button type="button" class="m-chip tono-${f.tono} ${activo ? 'is-active' : ''}" aria-pressed="${activo}" onclick="RanchoApp.cambiarFiltroFierro('${esc(f.codigo)}')">
              <span class="m-chip-code">${esc(f.codigo)}</span>
              <span class="m-chip-owner">${esc(f.propietario)}</span>
              <span class="m-chip-count">${activosDe(f.codigo)}</span>
            </button>`;
          })
          .join('');
      const activoEl = chips.querySelector('.m-chip.is-active');
      if (activoEl && typeof activoEl.scrollIntoView === 'function' && !todosActivo) {
        activoEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
  },

  renderKPIs() {
    const animales = window.RanchoDB.state.animales;
    const fierros = window.RanchoDB.getFierros();
    const enFiltro = (a) => this.filtroFierro === 'TODOS' || a.fierro === this.filtroFierro;

    const activos = animales.filter((a) => a.estatus === 'Activo');
    const totalHembras = activos.filter((a) => a.sexo === 'Hembra').length;
    const totalMachos = activos.filter((a) => a.sexo === 'Macho').length;

    const vendidos = animales.filter((a) => a.estatus === 'Vendido' && enFiltro(a)).length;
    const muertos = animales.filter((a) => a.estatus === 'Muerto' && enFiltro(a)).length;
    const sinArete = animales.filter(
      (a) =>
        a.estatus === 'Activo' &&
        enFiltro(a) &&
        (!a.arete || a.arete === 'S/N' || a.estadoArete !== 'Correcto')
    ).length;

    const kpiContainer = document.getElementById('kpiGrid');
    if (!kpiContainer) return;

    const celdasFierro = fierros
      .map((f) => {
        const delFierro = activos.filter((a) => a.fierro === f.codigo);
        const h = delFierro.filter((a) => a.sexo === 'Hembra').length;
        const m = delFierro.filter((a) => a.sexo === 'Macho').length;
        const activo = this.filtroFierro === f.codigo;
        return `
          <button type="button" class="summary-cell summary-cell-interactive summary-fierro tono-${f.tono} ${activo ? 'is-active' : ''}" aria-pressed="${activo}" onclick="RanchoApp.cambiarFiltroFierro('${esc(f.codigo)}')">
            <span class="summary-label">
              <span class="summary-owner">${esc(f.propietario)}</span>
              ${sello(f.codigo, 'stamp-sm')}
            </span>
            <span class="summary-number">${delFierro.length} <small>activos</small></span>
            <span class="summary-breakdown">
              <span>Hembras <strong>${h}</strong></span>
              <span>Machos <strong>${m}</strong></span>
            </span>
          </button>`;
      })
      .join('');

    const todos = this.filtroFierro === 'TODOS';
    kpiContainer.innerHTML = `
      <button type="button" class="summary-cell summary-cell-interactive ${todos ? 'is-active' : ''}" aria-pressed="${todos}" onclick="RanchoApp.cambiarFiltroFierro('TODOS')">
        <span class="summary-label"><span>Padrón activo total</span></span>
        <span class="summary-number">${activos.length} <small>cabezas</small></span>
        <span class="summary-breakdown">
          <span>Hembras <strong>${totalHembras}</strong></span>
          <span>Machos <strong>${totalMachos}</strong></span>
        </span>
      </button>

      ${celdasFierro}

      <button type="button" class="summary-cell summary-cell-interactive" onclick="RanchoApp.cambiarTab('bajas')">
        <span class="summary-label"><span>Salidas registradas</span></span>
        <span class="summary-number">${vendidos + muertos} <small>bajas</small></span>
        <span class="summary-breakdown">
          <span>Ventas <strong>${vendidos}</strong></span>
          <span>Muertes <strong>${muertos}</strong></span>
        </span>
      </button>

      <button type="button" class="summary-cell summary-cell-interactive ${sinArete > 0 ? 'summary-alert' : ''}" onclick="RanchoApp.filtrarSinArete()">
        <span class="summary-label"><span>Aretes por revisar</span></span>
        <span class="summary-number">${sinArete} <small>pendientes</small></span>
        <span class="summary-breakdown"><span>Sin arete o caídos</span></span>
      </button>
    `;
  },

  filtrarSinArete() {
    this.tabActiva = 'inventario';
    this.filtroAreteEstado = 'SIN_ARETE';
    this.renderTodo();
  },

  renderAlertasCorral() {
    const panel = document.getElementById('alertsPanel');
    if (!panel) return;

    const { animales, config, eventosSanitarios } = window.RanchoDB.state;
    const activos = animales.filter(
      (a) =>
        a.estatus === 'Activo' &&
        (this.filtroFierro === 'TODOS' || a.fierro === this.filtroFierro)
    );

    const alertas = [];

    activos.forEach((a) => {
      if (a.categoria && a.categoria.includes('Lactante') && a.fechaNacimiento) {
        const edad = window.RanchoValidations.calcularEdad(a.fechaNacimiento);
        if (edad.mesesTotales !== null && edad.mesesTotales >= (config.edadDesteteMeses || 7)) {
          alertas.push({
            id: a.id,
            texto: `Destete pendiente: Fierro ${a.fierro} #${a.numero} (${edad.texto})`
          });
        }
      }

      if (!a.arete || a.arete === 'S/N' || a.estadoArete !== 'Correcto') {
        alertas.push({
          id: a.id,
          texto: `Arete pendiente: Fierro ${a.fierro} #${a.numero} (${a.estadoArete || 'Sin arete'})`
        });
      }

      if (
        a.origen === 'Nacido en rancho' &&
        (a.categoria.includes('Becerr') || a.categoria.includes('Lactante')) &&
        !a.madreNumero &&
        !a.madreArete
      ) {
        alertas.push({
          id: a.id,
          texto: `Sin madre asignada: Fierro ${a.fierro} #${a.numero}`
        });
      }
    });

    const hoyStr = new Date().toISOString().slice(0, 10);
    eventosSanitarios.forEach((ev) => {
      if (ev.proximaFecha && ev.proximaFecha <= hoyStr) {
        const anm = activos.find((x) => x.id === ev.animalId);
        if (anm) {
          alertas.push({
            id: anm.id,
            texto: `Refuerzo sanitario (${ev.producto}): Fierro ${anm.fierro} #${anm.numero}`
          });
        }
      }
    });

    if (alertas.length === 0) {
      panel.style.display = 'none';
      return;
    }

    panel.style.display = 'flex';
    panel.innerHTML = `
      <div class="alerts-bar-label">
        <span>Pendientes de revisión en corral (${alertas.length}):</span>
      </div>
      <div class="alerts-list">
        ${alertas
          .map(
            (al) =>
              `<span class="alert-chip" onclick="RanchoApp.abrirFichaAnimal('${esc(al.id)}')">${esc(al.texto)}</span>`
          )
          .join('')}
      </div>
    `;
  },

  renderTabsContadores() {
    const activos = this.obtenerAnimalesFiltrados('Activo').length;
    const bajas = this.obtenerAnimalesFiltrados('Bajas').length;
    const sanidadCount = window.RanchoDB.state.eventosSanitarios.length;
    const hembrasMadres = window.RanchoDB.state.animales.filter(
      (a) =>
        a.sexo === 'Hembra' &&
        !(a.categoria || '').includes('Becerr') &&
        (this.filtroFierro === 'TODOS' || a.fierro === this.filtroFierro)
    ).length;

    const setBadge = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setBadge('badgeCountInventario', activos);
    setBadge('badgeCountBajas', bajas);
    setBadge('badgeCountSanidad', sanidadCount);
    setBadge('badgeCountGenealogia', hembrasMadres);

    document.querySelectorAll('.nav-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === this.tabActiva);
    });

    document.querySelectorAll('.m-bottom-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === this.tabActiva);
    });
  },

  renderVistaPrincipal() {
    const container = document.getElementById('mainViewContainer');
    if (!container) return;

    // Conservar el foco y la posición del cursor del campo de búsqueda al volver a pintar
    const activo = document.activeElement;
    const focoId = activo && container.contains(activo) && activo.id ? activo.id : null;
    const cursor = focoId && typeof activo.selectionStart === 'number' ? activo.selectionStart : null;

    container.dataset.vista = this.tabActiva;
    if (this.tabActiva === 'buscar') {
      this.renderVistaBuscador(container);
    } else if (this.tabActiva === 'inventario') {
      this.renderTablaInventario(container, 'Activo');
    } else if (this.tabActiva === 'bajas') {
      this.renderTablaInventario(container, 'Bajas');
    } else if (this.tabActiva === 'sanidad') {
      this.renderVistaSanidad(container);
    } else if (this.tabActiva === 'genealogia') {
      this.renderVistaGenealogia(container);
    }

    if (focoId) {
      const el = document.getElementById(focoId);
      if (el) {
        el.focus();
        if (cursor !== null && typeof el.setSelectionRange === 'function') {
          el.setSelectionRange(cursor, cursor);
        }
      }
    }
  },

  /**
   * BUSCADOR DE HISTORIAL: activos, vendidos y muertos.
   * El campo se pinta una sola vez; al escribir solo se actualizan los resultados.
   */
  abrirBuscador(texto = null) {
    if (texto !== null) this.busquedaHistorial = String(texto);
    this.tabActiva = 'buscar';
    this.toggleSidebar(false);
    this.renderTodo();
    const input = document.getElementById('inputHistorial');
    if (input) {
      input.focus();
      const fin = input.value.length;
      input.setSelectionRange(fin, fin);
    }
  },

  renderVistaBuscador(container) {
    if (!document.getElementById('inputHistorial')) {
      container.innerHTML = `
        <div class="ledger-card history-card">
          <div class="history-search">
            <label class="form-label" for="inputHistorial">Número, arete, comprador o nota</label>
            <div class="search-box search-box-lg">
              <svg class="search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="5.5" />
                <path d="M13 13l4 4" stroke-linecap="round" />
              </svg>
              <input type="search" id="inputHistorial" inputmode="search" autocomplete="off"
                placeholder="Ej. 15, #15, MX-260015, Comercializadora…"
                oninput="RanchoApp.actualizarBusquedaHistorial(this.value)" />
            </div>
            <p class="form-help-text">Incluye animales vendidos y muertos. Un número dado de baja se puede volver a usar; aquí se ven todos los animales que lo han llevado.</p>
          </div>
          <div id="historialResultados" class="history-results" aria-live="polite"></div>
        </div>`;
    }
    const input = document.getElementById('inputHistorial');
    if (input.value !== this.busquedaHistorial) input.value = this.busquedaHistorial;
    this.renderResultadosHistorial();
  },

  actualizarBusquedaHistorial(valor) {
    this.busquedaHistorial = valor;
    this.renderResultadosHistorial();
  },

  renderResultadosHistorial() {
    const destino = document.getElementById('historialResultados');
    if (!destino) return;

    const todos = window.RanchoDB.state.animales;
    const fFiltro = window.RanchoDB.getFierro(this.filtroFierro);
    const universo = fFiltro ? todos.filter((a) => a.fierro === fFiltro.codigo) : todos;
    const r = window.RanchoValidations.buscarHistorial(universo, this.busquedaHistorial);

    const notaFiltro = fFiltro
      ? `<p class="history-filter-note">Buscando solo en el Fierro ${esc(fFiltro.codigo)} (${esc(fFiltro.propietario)}).
          <button type="button" class="btn-link-action" onclick="RanchoApp.cambiarFiltroFierro('TODOS')">Buscar en todos los fierros</button></p>`
      : '';

    if (!r.consulta) {
      destino.innerHTML = `${notaFiltro}
        <div class="history-empty">
          <p><strong>${universo.length}</strong> animales en el historial:
          ${universo.filter((a) => a.estatus === 'Activo').length} activos,
          ${universo.filter((a) => a.estatus === 'Vendido').length} vendidos y
          ${universo.filter((a) => a.estatus === 'Muerto').length} muertos.</p>
          <p>Escribe un número para ver todos los animales que lo han llevado.</p>
        </div>`;
      return;
    }

    const grupo = (titulo, lista) =>
      lista.length === 0
        ? ''
        : `<section class="history-group">
            <h3 class="history-group-title">${titulo} <span class="history-count">${lista.length}</span></h3>
            <ul class="history-list">${lista.map((a) => this.htmlItemHistorial(a)).join('')}</ul>
          </section>`;

    let resumen = '';
    if (r.numero) {
      const n = r.porNumero;
      const activos = n.filter((a) => a.estatus === 'Activo');
      const bajas = n.length - activos.length;
      const fierros = window.RanchoDB.getFierros().filter((f) => !fFiltro || f.codigo === fFiltro.codigo);
      const libres = fierros.filter(
        (f) => !activos.some((a) => a.fierro === f.codigo)
      );
      resumen =
        n.length === 0
          ? `<div class="history-summary">Ningún animal ha llevado el <strong>#${esc(r.numero)}</strong>. Está libre en ${fierros.length === 1 ? 'el fierro' : 'todos los fierros'}.</div>`
          : `<div class="history-summary">
              El <strong>#${esc(r.numero)}</strong> aparece en <strong>${n.length}</strong> ${n.length === 1 ? 'registro' : 'registros'}:
              ${activos.length} ${activos.length === 1 ? 'activo' : 'activos'} · ${bajas} ${bajas === 1 ? 'dado de baja' : 'dados de baja'}.
              ${
                libres.length > 0
                  ? `<span class="history-free">Libre en: ${libres.map((f) => sello(f.codigo, 'stamp-sm')).join(' ')}</span>`
                  : ''
              }
            </div>`;
    }

    const cuerpo =
      grupo(r.numero ? `Animales con el número #${esc(r.numero)}` : 'Por número', r.porNumero) +
      grupo('Por arete (actual o anterior)', r.porArete) +
      grupo('Por raza, comprador, guía o notas', r.porTexto);

    destino.innerHTML =
      notaFiltro +
      resumen +
      (r.total === 0 && !r.numero
        ? `<div class="history-empty"><p>No hay ningún animal que coincida con «${esc(r.consulta)}».</p></div>`
        : cuerpo);
  },

  htmlItemHistorial(a) {
    const edad = window.RanchoValidations.calcularEdad(a.fechaNacimiento, a.fechaBaja || null);
    const activo = a.estatus === 'Activo';
    const fierro = window.RanchoDB.getFierro(a.fierro);
    const salida = activo
      ? ''
      : a.estatus === 'Vendido'
      ? `Vendido el ${esc(a.fechaBaja || 'fecha sin registrar')}${a.compradorDestino ? ` a ${esc(a.compradorDestino)}` : ''}`
      : `Murió el ${esc(a.fechaBaja || 'fecha sin registrar')}${a.motivoBaja ? ` · ${esc(a.motivoBaja)}` : ''}`;
    const aretesPrevios =
      Array.isArray(a.aretesAnteriores) && a.aretesAnteriores.length > 0
        ? ` · antes: ${esc(a.aretesAnteriores.join(', '))}`
        : '';

    return `
      <li class="history-item ${activo ? '' : 'is-baja'}">
        <div class="history-id">
          ${sello(a.fierro)}
          <span class="history-num">#${esc(a.numero)}</span>
          <span class="badge-status badge-status-${esc(a.estatus)}">${esc(a.estatus)}</span>
        </div>
        <div class="history-info">
          <div class="history-line">
            <strong>${esc(a.sexo)}</strong> · ${esc(a.categoria || 'Sin categoría')}${a.razaColor ? ` · ${esc(a.razaColor)}` : ''}
          </div>
          <div class="history-meta">
            Arete <span class="arete-code">${esc(a.arete || 'S/N')}</span>${aretesPrevios}
            · Nac. ${esc(a.fechaNacimiento || 'sin fecha')} (${esc(edad.texto)})
            ${fierro ? `· ${esc(fierro.propietario)}` : ''}
          </div>
          ${salida ? `<div class="history-exit">${salida}</div>` : ''}
        </div>
        <div class="history-actions">
          <button type="button" class="btn btn-outline btn-sm" onclick="RanchoApp.abrirFichaAnimal('${esc(a.id)}')">Expediente</button>
          ${
            activo
              ? `<button type="button" class="btn btn-outline btn-sm" onclick="RanchoApp.abrirModalAnimal('${esc(a.id)}')">Editar</button>`
              : `<button type="button" class="btn btn-outline btn-sm" onclick="RanchoApp.abrirModalBaja('${esc(a.id)}')">Datos de salida</button>`
          }
        </div>
      </li>`;
  },

  renderTablaInventario(container, modoEstatus) {
    const lista = this.obtenerAnimalesFiltrados(modoEstatus);
    const esBajas = modoEstatus === 'Bajas';

    const filasHTML =
      lista.length === 0
        ? `<tr>
            <td colspan="8" style="text-align:center;padding:2.5rem;color:#66726a;">
              No hay registros que coincidan con los filtros seleccionados.
            </td>
          </tr>`
        : lista
            .map((a) => {
              const edad = window.RanchoValidations.calcularEdad(
                a.fechaNacimiento,
                a.fechaBaja || null
              );
              const tieneMadre = a.madreNumero || a.madreArete;
              const madreBadge = tieneMadre
                ? `<span class="madre-pill" onclick="RanchoApp.verMadreDeAnimal('${esc(a.id)}')" title="Ver expediente de la madre">
                    <span>Fierro ${a.madreFierro || a.fierro} · #${esc(a.madreNumero || '?')}</span>
                    <small style="color:#66726a;">(${esc(a.madreArete || 'S/A')})</small>
                   </span>`
                : `<span style="color:#66726a;font-size:0.78rem;">Sin registro</span>`;

              const areteMal = !a.arete || a.arete === 'S/N' || a.estadoArete !== 'Correcto';

              const numCrias =
                a.sexo === 'Hembra'
                  ? window.RanchoDB.state.animales.filter(
                      (c) =>
                        c.madreId === a.id ||
                        (c.madreFierro === a.fierro &&
                          c.madreNumero &&
                          String(c.madreNumero).toUpperCase() === String(a.numero).toUpperCase())
                    ).length
                  : 0;

              return `
                <tr>
                  <td>
                    <div class="identity-cell">
                      ${sello(a.fierro)}
                      <div>
                        <span class="numero-vaca">#${esc(a.numero)}</span>
                        <span class="fierro-Inline-label">Fierro ${esc(a.fierro)}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="arete-code ${areteMal ? 'sin-arete' : ''}">${esc(a.arete || 'S/N')}</span>
                    <div class="arete-sub">${esc(a.estadoArete || 'Correcto')}</div>
                  </td>
                  <td>
                    <span class="badge-sexo badge-sexo-${esc(a.sexo)}">
                      ${a.sexo === 'Hembra' ? '♀ Hembra' : '♂ Macho'}
                    </span>
                    <div class="categoria-sub">
                      ${esc(a.categoria || '')}${a.razaColor ? ` · ${esc(a.razaColor)}` : ''}
                    </div>
                  </td>
                  <td>
                    <div style="font-weight:600;">${edad.texto}</div>
                    <div class="arete-sub">Nac: ${esc(a.fechaNacimiento || 'No reg.')}</div>
                  </td>
                  <td>
                    ${madreBadge}
                    ${
                      numCrias > 0
                        ? `<div class="crias-count-note">
                            ${numCrias} ${numCrias === 1 ? 'cría registrada' : 'crías registradas'}
                           </div>`
                        : ''
                    }
                  </td>
                  <td>
                    <span style="font-family:var(--font-mono);font-weight:600;">
                      ${a.pesoActual ? esc(a.pesoActual) + ' kg' : '—'}
                    </span>
                  </td>
                  <td>
                    <span class="badge-status badge-status-${esc(a.estatus)}">
                      ${esc(a.estatus)}
                    </span>
                    ${
                      a.estatus !== 'Activo'
                        ? `<div style="font-size:0.76rem;color:#525e56;margin-top:4px;line-height:1.35;">
                            <div><strong>Fecha:</strong> ${esc(a.fechaBaja || '-')}</div>
                            ${
                              a.estatus === 'Vendido'
                                ? `<div><strong>Comprador:</strong> ${esc(a.compradorDestino || 'Sin registrar')}</div>
                                   ${a.guiaReemo ? `<div><strong>Guía REEMO:</strong> ${esc(a.guiaReemo)}</div>` : ''}
                                   ${a.pesoVenta ? `<div><strong>Peso venta:</strong> ${esc(a.pesoVenta)} kg</div>` : ''}
                                   ${a.precioVenta ? `<div><strong>Monto:</strong> $${esc(a.precioVenta)}</div>` : ''}`
                                : `<div><strong>Causa:</strong> ${esc(a.motivoBaja || '-')}</div>`
                            }
                           </div>`
                        : ''
                    }
                  </td>
                  <td>
                    <div class="row-actions">
                      <button class="btn btn-outline btn-sm" onclick="RanchoApp.abrirFichaAnimal('${esc(a.id)}')">
                        Expediente
                      </button>
                      <button class="btn btn-outline btn-sm" onclick="RanchoApp.abrirModalAnimal('${esc(a.id)}')">
                        Editar
                      </button>
                      ${
                        a.sexo === 'Hembra' &&
                        a.estatus === 'Activo' &&
                        !(a.categoria || '').includes('Becerr')
                          ? `<button class="btn btn-primary btn-sm" onclick="RanchoApp.abrirModalPartoDeVaca('${esc(a.id)}')">
                              + Cría
                             </button>`
                          : ''
                      }
                      ${
                        a.estatus === 'Activo'
                          ? `<button class="btn btn-danger-soft btn-sm" onclick="RanchoApp.abrirModalBaja('${esc(a.id)}')">
                              Vender / Baja
                             </button>`
                          : `<button class="btn btn-outline btn-sm" onclick="RanchoApp.abrirModalBaja('${esc(a.id)}')">
                              Datos venta
                             </button>
                             <button class="btn btn-outline btn-sm" onclick="RanchoApp.confirmarReactivar('${esc(a.id)}')">
                              Reactivar
                             </button>`
                      }
                    </div>
                  </td>
                </tr>
              `;
            })
            .join('');

    const cardsMobileHTML =
      lista.length === 0
        ? `<div class="empty-state-card">No hay registros con los filtros seleccionados.</div>`
        : lista
            .map((a) => {
              const edad = window.RanchoValidations.calcularEdad(
                a.fechaNacimiento,
                a.fechaBaja || null
              );
              const tieneMadre = a.madreNumero || a.madreArete;
              const areteMal = !a.arete || a.arete === 'S/N' || a.estadoArete !== 'Correcto';
              const numCrias =
                a.sexo === 'Hembra'
                  ? window.RanchoDB.state.animales.filter(
                      (c) =>
                        c.madreId === a.id ||
                        (c.madreFierro === a.fierro &&
                          c.madreNumero &&
                          String(c.madreNumero).toUpperCase() === String(a.numero).toUpperCase())
                    ).length
                  : 0;

              return `
                <div class="animal-card-mobile ${a.estatus !== 'Activo' ? 'card-baja' : ''}">
                  <div class="acm-header">
                    <div class="acm-identity">
                      ${sello(a.fierro)}
                      <span class="acm-num">#${esc(a.numero)}</span>
                      <span class="badge-sexo badge-sexo-${esc(a.sexo)}">${a.sexo === 'Hembra' ? '♀ Hembra' : '♂ Macho'}</span>
                    </div>
                    <span class="arete-code ${areteMal ? 'sin-arete' : ''}">${esc(a.arete || 'S/N')}</span>
                  </div>

                  <div class="acm-body">
                    <div class="acm-row">
                      <span class="acm-cat">${esc(a.categoria || '')}${a.razaColor ? ' · ' + esc(a.razaColor) : ''}</span>
                      <span class="acm-weight">${a.pesoActual ? esc(a.pesoActual) + ' kg' : '—'}</span>
                    </div>
                    <div class="acm-row acm-sub">
                      <span><strong>Edad:</strong> ${edad.texto}</span>
                      ${tieneMadre ? `<button type="button" class="acm-madre-tag" onclick="RanchoApp.verMadreDeAnimal('${esc(a.id)}')">Madre: Fierro ${esc(a.madreFierro || a.fierro)} #${esc(a.madreNumero || '?')}</button>` : '<span class="acm-muted">Sin madre registrada</span>'}
                    </div>
                    ${numCrias > 0 ? `<div class="crias-count-note">${numCrias} ${numCrias === 1 ? 'cría registrada' : 'crías registradas'}</div>` : ''}
                    ${a.estatus !== 'Activo' ? `
                      <div class="acm-baja-info">
                        <strong>${esc(a.estatus)}:</strong> ${esc(a.fechaBaja || '')}
                        ${a.estatus === 'Vendido' ? ` · Comprador: <strong>${esc(a.compradorDestino || 'No reg.')}</strong> ${a.precioVenta ? '($' + esc(a.precioVenta) + ')' : ''}` : ` · Causa: ${esc(a.motivoBaja || '')}`}
                      </div>
                    ` : ''}
                  </div>

                  <div class="acm-actions">
                    <button class="btn btn-outline btn-sm" onclick="RanchoApp.abrirFichaAnimal('${esc(a.id)}')">Expediente</button>
                    <button class="btn btn-outline btn-sm" onclick="RanchoApp.abrirModalAnimal('${esc(a.id)}')">Editar</button>
                    ${a.sexo === 'Hembra' && a.estatus === 'Activo' && !(a.categoria || '').includes('Becerr') ? `
                      <button class="btn btn-primary btn-sm" onclick="RanchoApp.abrirModalPartoDeVaca('${esc(a.id)}')">+ Cría</button>
                    ` : ''}
                    ${a.estatus === 'Activo' ? `
                      <button class="btn btn-danger-soft btn-sm" onclick="RanchoApp.abrirModalBaja('${esc(a.id)}')">Vender / Baja</button>
                    ` : `
                      <button class="btn btn-outline btn-sm" onclick="RanchoApp.abrirModalBaja('${esc(a.id)}')">Datos venta</button>
                      <button class="btn btn-outline btn-sm" onclick="RanchoApp.confirmarReactivar('${esc(a.id)}')">Reactivar</button>
                    `}
                  </div>
                </div>
              `;
            })
            .join('');

    container.innerHTML = `
      <div class="ledger-card">
        <div class="ledger-toolbar">
          <div class="search-box">
            <svg class="search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="8.5" cy="8.5" r="5.5" />
              <path d="M13 13l4 4" stroke-linecap="round" />
            </svg>
            <input
              type="text"
              id="inputBusqueda"
              placeholder="Buscar por número (#15), arete SINIIGA, madre, raza o comprador..."
              value="${esc(this.busquedaTexto)}"
              oninput="RanchoApp.actualizarBusqueda(this.value)"
            />
          </div>
          <div class="filter-group">
            <select id="filterSelectSexo" aria-label="Filtrar por sexo" class="filter-select" onchange="RanchoApp.cambiarFiltroSexo(this.value)">
              <option value="TODOS" ${this.filtroSexo === 'TODOS' ? 'selected' : ''}>Todos los sexos</option>
              <option value="Hembra" ${this.filtroSexo === 'Hembra' ? 'selected' : ''}>Solo hembras (♀)</option>
              <option value="Macho" ${this.filtroSexo === 'Macho' ? 'selected' : ''}>Solo machos (♂)</option>
            </select>

            <select id="filterSelectArete" aria-label="Filtrar por estado de arete" class="filter-select" onchange="RanchoApp.cambiarFiltroArete(this.value)">
              <option value="TODOS" ${this.filtroAreteEstado === 'TODOS' ? 'selected' : ''}>Todos los aretes</option>
              <option value="SIN_ARETE" ${this.filtroAreteEstado === 'SIN_ARETE' ? 'selected' : ''}>Sin arete o caído</option>
            </select>
          </div>
        </div>

        ${
          this.busquedaTexto.trim()
            ? `<div class="history-hint">
                <button type="button" class="btn-link-action" onclick="RanchoApp.abrirBuscador(RanchoApp.busquedaTexto)">
                  Buscar «${esc(this.busquedaTexto.trim())}» en todo el historial (incluye vendidos y muertos)
                </button>
              </div>`
            : ''
        }

        <div class="table-scroll desktop-only">
          <table class="ganado-table">
            <thead>
              <tr>
                <th>Fierro y Núm.</th>
                <th>Arete oficial</th>
                <th>Sexo y etapa</th>
                <th>Edad y nac.</th>
                <th>Madre (Núm. y arete)</th>
                <th>Peso</th>
                <th>${esBajas ? 'Detalle de salida' : 'Estatus'}</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${filasHTML}
            </tbody>
          </table>
        </div>

        <div class="mobile-cards-container mobile-only">
          ${cardsMobileHTML}
        </div>
      </div>
    `;
  },

  renderVistaSanidad(container) {
    const { eventosSanitarios, animales } = window.RanchoDB.state;
    const eventosFiltrados = eventosSanitarios.filter((ev) => {
      if (this.filtroFierro === 'TODOS') return true;
      const anm = animales.find((a) => a.id === ev.animalId);
      return anm && anm.fierro === this.filtroFierro;
    });

    const filas =
      eventosFiltrados.length === 0
        ? `<tr><td colspan="8" style="text-align:center;padding:2.5rem;color:#66726a;">No hay manejos sanitarios ni pesajes registrados.</td></tr>`
        : eventosFiltrados
            .map((ev) => {
              const anm = animales.find((a) => a.id === ev.animalId);
              return `
                <tr>
                  <td style="font-family:var(--font-mono);">${esc(ev.fecha)}</td>
                  <td>
                    ${
                      anm
                        ? `<div class="identity-cell">
                             ${sello(anm.fierro)}
                             <div>
                               <span class="numero-vaca">#${esc(anm.numero)}</span>
                               <span class="fierro-Inline-label">Arete: ${esc(anm.arete || 'S/N')}</span>
                             </div>
                           </div>`
                        : 'Registro eliminado'
                    }
                  </td>
                  <td><span class="badge-status badge-status-Activo">${esc(ev.tipo)}</span></td>
                  <td><strong>${esc(ev.producto)}</strong></td>
                  <td>${esc(ev.dosis || '—')}</td>
                  <td style="font-family:var(--font-mono);">${ev.pesoKg ? esc(ev.pesoKg) + ' kg' : '—'}</td>
                  <td style="font-family:var(--font-mono);">${esc(ev.proximaFecha || '—')}</td>
                  <td>
                    <button class="btn btn-danger-soft btn-sm" onclick="RanchoApp.borrarEventoSanitario('${esc(ev.id)}')">Eliminar</button>
                  </td>
                </tr>
              `;
            })
            .join('');

    const cardsSanidadMobileHTML =
      eventosFiltrados.length === 0
        ? `<div class="empty-state-card">No hay manejos sanitarios ni pesajes registrados.</div>`
        : eventosFiltrados
            .map((ev) => {
              const anm = animales.find((a) => a.id === ev.animalId);
              return `
                <div class="animal-card-mobile">
                  <div class="acm-header">
                    <div class="acm-identity">
                      ${
                        anm
                          ? `${sello(anm.fierro)}
                             <span class="acm-num">#${esc(anm.numero)}</span>`
                          : '<span>Eliminado</span>'
                      }
                      <span class="badge-status badge-status-Activo">${esc(ev.tipo)}</span>
                    </div>
                    <span style="font-family:var(--font-mono);font-size:0.78rem;color:#525e56;">${esc(ev.fecha)}</span>
                  </div>
                  <div class="acm-body">
                    <div style="font-weight:700;font-size:0.9rem;">${esc(ev.producto)}</div>
                    <div class="acm-row acm-sub" style="margin-top:4px;">
                      <span>Dosis: ${esc(ev.dosis || '—')}</span>
                      <span>Peso: ${ev.pesoKg ? esc(ev.pesoKg) + ' kg' : '—'}</span>
                      <span>Refuerzo: ${esc(ev.proximaFecha || '—')}</span>
                    </div>
                    ${ev.notas ? `<div style="font-size:0.76rem;color:#66726a;margin-top:4px;">${esc(ev.notas)}</div>` : ''}
                  </div>
                  <div class="acm-actions" style="justify-content:flex-end;">
                    <button class="btn btn-danger-soft btn-sm" onclick="RanchoApp.borrarEventoSanitario('${esc(ev.id)}')">Eliminar</button>
                  </div>
                </div>
              `;
            })
            .join('');

    container.innerHTML = `
      <div class="ledger-card">
        <div class="ledger-toolbar">
          <div>
            <strong style="font-size:0.88rem;">Control de vacunación, desparasitación, pesajes y destetes</strong>
            <span style="font-size:0.78rem;color:#525e56;margin-left:0.5rem;">Registro individual o por lote de fierro</span>
          </div>
          <div class="filter-group">
            <button class="btn btn-primary btn-sm" onclick="RanchoApp.abrirModalSanidad()">
              + Registrar manejo o pesaje
            </button>
          </div>
        </div>

        <div class="table-scroll desktop-only">
          <table class="ganado-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Animal (Fierro y Núm.)</th>
                <th>Tipo de manejo</th>
                <th>Vacuna / Producto / Concepto</th>
                <th>Dosis</th>
                <th>Peso</th>
                <th>Próximo refuerzo</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              ${filas}
            </tbody>
          </table>
        </div>

        <div class="mobile-cards-container mobile-only">
          ${cardsSanidadMobileHTML}
        </div>
      </div>
    `;
  },

  renderVistaGenealogia(container) {
    const { animales } = window.RanchoDB.state;
    const hembras = animales.filter(
      (a) =>
        a.sexo === 'Hembra' &&
        !(a.categoria || '').includes('Becerr') &&
        (this.filtroFierro === 'TODOS' || a.fierro === this.filtroFierro)
    );

    const filas =
      hembras.length === 0
        ? `<tr><td colspan="5" style="text-align:center;padding:2.5rem;color:#66726a;">No hay vacas reproductoras registradas en este filtro.</td></tr>`
        : hembras
            .map((vaca) => {
              const crias = animales.filter(
                (c) =>
                  c.madreId === vaca.id ||
                  (c.madreFierro === vaca.fierro &&
                    c.madreNumero &&
                    String(c.madreNumero).toUpperCase() === String(vaca.numero).toUpperCase())
              );

              const listaCriasHTML =
                crias.length === 0
                  ? `<span style="color:#66726a;font-size:0.8rem;">Sin crías registradas</span>`
                  : crias
                      .map(
                        (c) => `
                        <div style="margin:2px 6px 2px 0;padding:4px 8px;background:var(--bg-subtle);border:1px solid var(--border-line);border-radius:4px;display:inline-flex;align-items:center;gap:6px;">
                          <strong style="font-family:var(--font-mono);">#${esc(c.numero)}</strong>
                          <span class="badge-sexo badge-sexo-${esc(c.sexo)}" style="font-size:0.68rem;padding:1px 5px;">${c.sexo === 'Hembra' ? '♀' : '♂'}</span>
                          <small style="font-family:var(--font-mono);">Arete: ${esc(c.arete || 'S/N')}</small>
                          <small style="color:#525e56;">(${esc(c.fechaNacimiento || 'S/F')})</small>
                          <span class="badge-status badge-status-${esc(c.estatus)}" style="font-size:0.68rem;padding:1px 5px;">${esc(c.estatus)}</span>
                        </div>
                      `
                      )
                      .join('');

              return `
                <tr>
                  <td>
                    <div class="identity-cell">
                      ${sello(vaca.fierro)}
                      <div>
                        <span class="numero-vaca">#${esc(vaca.numero)}</span>
                        <span class="fierro-Inline-label">Fierro ${esc(vaca.fierro)}</span>
                      </div>
                    </div>
                  </td>
                  <td><span class="arete-code">${esc(vaca.arete || 'S/N')}</span></td>
                  <td>
                    <strong>${esc(vaca.categoria)}</strong>
                    <div class="arete-sub">Estatus: ${esc(vaca.estatus)}</div>
                  </td>
                  <td>${listaCriasHTML}</td>
                  <td>
                    <button class="btn btn-primary btn-sm" onclick="RanchoApp.abrirModalPartoDeVaca('${esc(vaca.id)}')">
                      + Registrar parto / cría
                    </button>
                  </td>
                </tr>
              `;
            })
            .join('');

    const cardsGenealogiaMobileHTML =
      hembras.length === 0
        ? `<div class="empty-state-card">No hay vacas reproductoras registradas en este filtro.</div>`
        : hembras
            .map((vaca) => {
              const crias = animales.filter(
                (c) =>
                  c.madreId === vaca.id ||
                  (c.madreFierro === vaca.fierro &&
                    c.madreNumero &&
                    String(c.madreNumero).toUpperCase() === String(vaca.numero).toUpperCase())
              );

              const criasHTML =
                crias.length === 0
                  ? `<span style="color:#66726a;font-size:0.78rem;">Sin crías registradas aún</span>`
                  : `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">` +
                    crias
                      .map(
                        (c) => `
                        <div style="padding:3px 7px;background:var(--bg-subtle);border:1px solid var(--border-line);border-radius:4px;display:inline-flex;align-items:center;gap:5px;font-size:0.75rem;">
                          <strong style="font-family:var(--font-mono);">#${esc(c.numero)}</strong>
                          <span class="badge-sexo badge-sexo-${esc(c.sexo)}" style="font-size:0.65rem;padding:0 3px;">${c.sexo === 'Hembra' ? '♀' : '♂'}</span>
                          <span style="font-family:var(--font-mono);font-size:0.7rem;color:#525e56;">${esc(c.arete || 'S/N')}</span>
                          <span class="badge-status badge-status-${esc(c.estatus)}" style="font-size:0.65rem;padding:0 3px;">${esc(c.estatus)}</span>
                        </div>
                      `
                      )
                      .join('') +
                    `</div>`;

              return `
                <div class="animal-card-mobile">
                  <div class="acm-header">
                    <div class="acm-identity">
                      ${sello(vaca.fierro)}
                      <span class="acm-num">#${esc(vaca.numero)}</span>
                      <span class="badge-sexo badge-sexo-Hembra">♀ Vaca Madre</span>
                    </div>
                    <span class="badge-status badge-status-${esc(vaca.estatus)}">${esc(vaca.estatus)}</span>
                  </div>

                  <div class="acm-body">
                    <div class="acm-row">
                      <span>Arete: <strong class="arete-code" style="font-size:0.78rem;">${esc(vaca.arete || 'S/N')}</strong></span>
                      <span>Raza: <strong>${esc(vaca.raza || 'Común')}</strong></span>
                    </div>
                    <div class="acm-row acm-sub">
                      <span>Etapa: ${esc(vaca.categoria || 'Vaca')}</span>
                      <span>Total crías: <strong>${crias.length}</strong></span>
                    </div>
                    <div style="margin-top:6px;">
                      <div style="font-size:0.74rem;font-weight:600;color:var(--ink-secondary);">Historial de partos:</div>
                      ${criasHTML}
                    </div>
                  </div>

                  <div class="acm-actions">
                    <button class="btn btn-outline btn-sm" onclick="RanchoApp.abrirFichaAnimal('${esc(vaca.id)}')">Expediente</button>
                    <button class="btn btn-primary btn-sm" onclick="RanchoApp.abrirModalPartoDeVaca('${esc(vaca.id)}')">+ Registrar parto / cría</button>
                  </div>
                </div>
              `;
            })
            .join('');

    container.innerHTML = `
      <div class="ledger-card">
        <div class="ledger-toolbar">
          <div>
            <strong style="font-size:0.88rem;">Relación de vacas madres y sus crías</strong>
            <span style="font-size:0.78rem;color:#525e56;margin-left:0.5rem;">Trazabilidad por número y arete materno</span>
          </div>
        </div>

        <div class="table-scroll desktop-only">
          <table class="ganado-table">
            <thead>
              <tr>
                <th>Vaca madre (Fierro y Núm.)</th>
                <th>Arete madre</th>
                <th>Etapa y estatus</th>
                <th>Crías registradas de esta madre</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              ${filas}
            </tbody>
          </table>
        </div>

        <div class="mobile-cards-container mobile-only">
          ${cardsGenealogiaMobileHTML}
        </div>
      </div>
    `;
  },

  actualizarBusqueda(val) {
    this.busquedaTexto = val;
    this.renderVistaPrincipal();
  },

  cambiarFiltroSexo(val) {
    this.filtroSexo = val;
    this.renderVistaPrincipal();
  },

  cambiarFiltroArete(val) {
    this.filtroAreteEstado = val;
    this.renderVistaPrincipal();
  },

  /**
   * MODAL ALTA / EDICIÓN DE ANIMAL
   */
  abrirModalAnimal(animalId = null, prefillMadre = null) {
    if (!this.exigirEdicion()) return;
    const modal = document.getElementById('modalAnimal');
    if (!modal) return;

    const { animales } = window.RanchoDB.state;
    const existente = animalId ? animales.find((a) => a.id === animalId) : null;

    const fierroDefault = existente
      ? existente.fierro
      : prefillMadre
      ? prefillMadre.fierro
      : this.filtroFierro !== 'TODOS'
      ? this.filtroFierro
      : (window.RanchoDB.getFierros()[0] || {}).codigo || '';

    const sexoDefault = existente ? existente.sexo : 'Hembra';

    this.formAnimalActual = {
      id: existente ? existente.id : null,
      fierro: fierroDefault,
      sexo: sexoDefault
    };

    document.getElementById('modalAnimalTitulo').textContent = existente
      ? `Editar registro: Fierro ${existente.fierro} #${existente.numero}`
      : prefillMadre
      ? `Registrar cría de la vaca #${prefillMadre.numero} (Fierro ${prefillMadre.fierro})`
      : 'Registrar nueva cabeza de ganado';

    const sugerencia = window.RanchoValidations.sugerirSiguienteNumero(animales, fierroDefault);

    document.getElementById('fieldNumero').value = existente
      ? existente.numero
      : sugerencia.sugerido;
    const areteInicial = existente && existente.arete !== 'S/N' ? existente.arete : '';
    document.getElementById('fieldArete').value = areteInicial;
    document.getElementById('fieldColorArete').value = existente
      ? existente.colorArete || 'Amarillo SINIIGA'
      : 'Sin arete';
    document.getElementById('fieldEstadoArete').value = existente
      ? existente.estadoArete || 'Correcto'
      : 'Pendiente colocar';
    document.getElementById('fieldRaza').value = existente
      ? existente.razaColor || ''
      : prefillMadre
      ? prefillMadre.razaColor || ''
      : '';
    document.getElementById('fieldFechaNac').value = existente
      ? existente.fechaNacimiento || ''
      : prefillMadre
      ? new Date().toISOString().slice(0, 10)
      : '';
    document.getElementById('fieldOrigen').value = existente
      ? existente.origen || 'Nacido en rancho'
      : 'Nacido en rancho';
    document.getElementById('fieldPesoActual').value = existente
      ? existente.pesoActual || ''
      : '';
    document.getElementById('fieldNotas').value = existente ? existente.notas || '' : '';

    this.actualizarBotonesVisualesModal();
    this.poblarCategoriasModal(
      existente
        ? existente.categoria
        : prefillMadre
        ? 'Becerra (Lactante)'
        : 'Vaca de Cría'
    );
    this.poblarSelectorMadreModal(
      existente ? existente.madreId : prefillMadre ? prefillMadre.id : '',
      existente ? existente.madreFierro : prefillMadre ? prefillMadre.fierro : fierroDefault,
      existente ? existente.madreNumero : prefillMadre ? prefillMadre.numero : '',
      existente ? existente.madreArete : prefillMadre ? prefillMadre.arete : ''
    );

    this.validarFormularioEnVivo();
    modal.classList.add('open');
  },

  abrirModalPartoDeVaca(madreId) {
    const madre = window.RanchoDB.state.animales.find((a) => a.id === madreId);
    if (!madre) return;
    this.abrirModalAnimal(null, madre);
  },

  seleccionarFierroModal(fierro) {
    this.formAnimalActual.fierro = fierro;
    this.actualizarBotonesVisualesModal();
    if (!this.formAnimalActual.id) {
      const sug = window.RanchoValidations.sugerirSiguienteNumero(
        window.RanchoDB.state.animales,
        fierro
      );
      document.getElementById('fieldNumero').value = sug.sugerido;
    }
    this.validarFormularioEnVivo();
  },

  seleccionarSexoModal(sexo) {
    this.formAnimalActual.sexo = sexo;
    this.actualizarBotonesVisualesModal();
    this.poblarCategoriasModal();
  },

  actualizarBotonesVisualesModal() {
    const { fierro, sexo } = this.formAnimalActual;
    const cont = document.getElementById('fierroOptions');
    if (cont) {
      cont.innerHTML = window.RanchoDB.getFierros()
        .map((f) => {
          const sel = f.codigo === fierro;
          return `<button type="button" role="radio" aria-checked="${sel}" class="fierro-pick tono-${f.tono} ${sel ? 'is-selected' : ''}" onclick="RanchoApp.seleccionarFierroModal('${esc(f.codigo)}')">
            ${sello(f.codigo)}
            <span class="fierro-pick-owner">${esc(f.propietario)}</span>
          </button>`;
        })
        .join('');
    }

    const btnHembra = document.getElementById('optSexoHembra');
    const btnMacho = document.getElementById('optSexoMacho');
    if (btnHembra && btnMacho) {
      btnHembra.className = `visual-radio-option ${sexo === 'Hembra' ? 'selected-sexo-Hembra' : ''}`;
      btnMacho.className = `visual-radio-option ${sexo === 'Macho' ? 'selected-sexo-Macho' : ''}`;
      btnHembra.setAttribute('aria-checked', String(sexo === 'Hembra'));
      btnMacho.setAttribute('aria-checked', String(sexo === 'Macho'));
    }
  },

  poblarCategoriasModal(categoriaSeleccionada = null) {
    const select = document.getElementById('fieldCategoria');
    if (!select) return;
    const opciones =
      window.RanchoValidations.CATEGORIAS_POR_SEXO[this.formAnimalActual.sexo] || [];
    select.innerHTML = opciones
      .map(
        (cat) =>
          `<option value="${esc(cat)}" ${cat === categoriaSeleccionada ? 'selected' : ''}>${esc(cat)}</option>`
      )
      .join('');
  },

  poblarSelectorMadreModal(madreId = '', madreFierro = '', madreNumero = '', madreArete = '') {
    const selectMadre = document.getElementById('fieldMadreSelect');
    if (!selectMadre) return;

    const hembras = window.RanchoDB.state.animales.filter(
      (a) =>
        a.sexo === 'Hembra' &&
        a.id !== this.formAnimalActual.id &&
        !a.categoria.includes('Lactante')
    );

    let html = `<option value="">— Seleccionar de vacas registradas (o escribir abajo) —</option>`;
    hembras.forEach((h) => {
      const sel = h.id === madreId ? 'selected' : '';
      html += `<option value="${esc(h.id)}" ${sel}>[Fierro ${esc(h.fierro)}] Vaca #${esc(h.numero)} — Arete: ${esc(
        h.arete || 'S/N'
      )} (${esc(h.estatus)})</option>`;
    });

    selectMadre.innerHTML = html;
    const selFierroMadre = document.getElementById('fieldMadreFierro');
    selFierroMadre.innerHTML = window.RanchoDB.getFierros()
      .map((f) => `<option value="${esc(f.codigo)}">Fierro ${esc(f.codigo)} — ${esc(f.propietario)}</option>`)
      .join('');
    selFierroMadre.value = madreFierro || this.formAnimalActual.fierro;
    document.getElementById('fieldMadreNumero').value = madreNumero || '';
    document.getElementById('fieldMadreArete').value = madreArete || '';
  },

  alCambiarSelectMadre(madreId) {
    if (!madreId) return;
    const madre = window.RanchoDB.state.animales.find((a) => a.id === madreId);
    if (madre) {
      document.getElementById('fieldMadreFierro').value = madre.fierro;
      document.getElementById('fieldMadreNumero').value = madre.numero;
      document.getElementById('fieldMadreArete').value = madre.arete || '';
    }
  },

  usarNumeroSugerido() {
    const sug = window.RanchoValidations.sugerirSiguienteNumero(
      window.RanchoDB.state.animales,
      this.formAnimalActual.fierro
    );
    document.getElementById('fieldNumero').value = sug.huecoMenor || sug.sugerido;
    this.validarFormularioEnVivo();
  },

  alEscribirArete() {
    const val = document.getElementById('fieldArete').value.trim();
    const colorEl = document.getElementById('fieldColorArete');
    const estadoEl = document.getElementById('fieldEstadoArete');
    if (val && val.toUpperCase() !== 'S/N') {
      if (colorEl.value === 'Sin arete') colorEl.value = 'Amarillo SINIIGA';
      if (estadoEl.value === 'Pendiente colocar') estadoEl.value = 'Correcto';
    } else {
      colorEl.value = 'Sin arete';
      estadoEl.value = 'Pendiente colocar';
    }
    this.validarFormularioEnVivo();
  },

  validarFormularioEnVivo() {
    const { animales } = window.RanchoDB.state;
    const { id, fierro } = this.formAnimalActual;
    const numero = document.getElementById('fieldNumero').value;
    const arete = document.getElementById('fieldArete').value;

    const resNum = window.RanchoValidations.validarNumeroPorFierro(animales, fierro, numero, id);
    const msgNumEl = document.getElementById('msgValidacionNumero');
    const inputNumEl = document.getElementById('fieldNumero');

    if (!resNum.valido) {
      msgNumEl.className = 'validation-msg error';
      msgNumEl.textContent = resNum.mensaje;
      inputNumEl.classList.add('input-error');
    } else {
      msgNumEl.className = 'validation-msg ok';
      msgNumEl.textContent = resNum.aviso || resNum.mensaje;
      inputNumEl.classList.remove('input-error');
    }

    const resArete = window.RanchoValidations.validarAreteUnico(animales, arete, id);
    const msgAreteEl = document.getElementById('msgValidacionArete');
    const inputAreteEl = document.getElementById('fieldArete');

    if (!resArete.valido) {
      msgAreteEl.className = 'validation-msg error';
      msgAreteEl.textContent = resArete.mensaje;
      inputAreteEl.classList.add('input-error');
    } else if (resArete.sinArete) {
      msgAreteEl.className = 'validation-msg warn';
      msgAreteEl.textContent = resArete.mensaje;
      inputAreteEl.classList.remove('input-error');
    } else {
      msgAreteEl.className = 'validation-msg ok';
      msgAreteEl.textContent = resArete.mensaje;
      inputAreteEl.classList.remove('input-error');
    }

    return resNum.valido && resArete.valido;
  },

  guardarFormularioAnimal(event) {
    event.preventDefault();
    if (!this.exigirEdicion()) return;
    if (!this.validarFormularioEnVivo()) {
      this.mostrarToast(
        'Corrige el número o arete repetido antes de guardar el registro.',
        'error'
      );
      return;
    }

    const numero = document.getElementById('fieldNumero').value.trim();
    const areteRaw = document.getElementById('fieldArete').value.trim().toUpperCase();
    const arete = areteRaw || 'S/N';
    const estadoArete =
      arete === 'S/N'
        ? 'Pendiente colocar'
        : document.getElementById('fieldEstadoArete').value;

    const payload = {
      id: this.formAnimalActual.id,
      fierro: this.formAnimalActual.fierro,
      numero,
      arete,
      colorArete: document.getElementById('fieldColorArete').value,
      estadoArete,
      sexo: this.formAnimalActual.sexo,
      categoria: document.getElementById('fieldCategoria').value,
      razaColor: document.getElementById('fieldRaza').value.trim(),
      fechaNacimiento: document.getElementById('fieldFechaNac').value,
      origen: document.getElementById('fieldOrigen').value,
      pesoActual: document.getElementById('fieldPesoActual').value
        ? parseFloat(document.getElementById('fieldPesoActual').value)
        : '',
      madreId: document.getElementById('fieldMadreSelect').value || '',
      madreFierro: document.getElementById('fieldMadreFierro').value || '',
      madreNumero: document.getElementById('fieldMadreNumero').value.trim(),
      madreArete: document.getElementById('fieldMadreArete').value.trim().toUpperCase(),
      notas: document.getElementById('fieldNotas').value.trim()
    };

    window.RanchoDB.guardarAnimal(payload);
    this.cerrarModal('modalAnimal');
    this.mostrarToast(
      `Registro guardado: Fierro ${payload.fierro} #${payload.numero} (${payload.sexo})`
    );
  },

  /**
   * MODAL DE BAJA POR VENTA O MUERTE
   */
  abrirModalBaja(animalId) {
    const animal = window.RanchoDB.state.animales.find((a) => a.id === animalId);
    if (!animal) return;

    const tipoInicial = animal.estatus === 'Muerto' ? 'Muerto' : 'Vendido';

    document.getElementById('bajaAnimalId').value = animal.id;
    document.getElementById('bajaAnimalInfo').innerHTML = `
      ${sello(animal.fierro)}
      <strong>Fierro ${esc(animal.fierro)} · Número #${esc(animal.numero)}</strong>
      <span style="color:#525e56;">— Arete: ${esc(animal.arete || 'S/N')} (${esc(animal.sexo)} · ${esc(animal.categoria)})</span>
    `;
    document.getElementById('bajaTipo').value = tipoInicial;
    document.getElementById('bajaFecha').value =
      animal.fechaBaja || new Date().toISOString().slice(0, 10);
    document.getElementById('bajaMotivo').value = animal.motivoBaja || '';
    document.getElementById('bajaComprador').value = animal.compradorDestino || '';
    document.getElementById('bajaGuiaReemo').value = animal.guiaReemo || '';
    document.getElementById('bajaPeso').value = animal.pesoVenta || animal.pesoActual || '';
    document.getElementById('bajaPrecio').value = animal.precioVenta || '';
    document.getElementById('bajaNotas').value = animal.notasBaja || '';

    this.toggleCamposVentaBaja(tipoInicial);
    document.getElementById('modalBaja').classList.add('open');
  },

  toggleCamposVentaBaja(tipo) {
    const bloqueVenta = document.getElementById('bloqueCamposVenta');
    const labelMotivo = document.getElementById('labelMotivoBaja');
    const inputComprador = document.getElementById('bajaComprador');
    if (tipo === 'Vendido') {
      bloqueVenta.style.display = 'block';
      labelMotivo.textContent = 'Concepto de venta (Ej. Venta de destete, engorda, cría) *';
      if (inputComprador) inputComprador.required = true;
    } else {
      bloqueVenta.style.display = 'none';
      labelMotivo.textContent = 'Causa de muerte (Ej. Enfermedad, parto, accidente) *';
      if (inputComprador) inputComprador.required = false;
    }
  },

  confirmarBajaAnimal(event) {
    event.preventDefault();
    if (!this.exigirEdicion()) return;
    const animalId = document.getElementById('bajaAnimalId').value;
    const tipoBaja = document.getElementById('bajaTipo').value;
    const fechaBaja = document.getElementById('bajaFecha').value;
    const comprador = document.getElementById('bajaComprador').value.trim();

    if (tipoBaja === 'Vendido' && !comprador) {
      this.mostrarToast('Indica el nombre del comprador.', 'error');
      document.getElementById('bajaComprador').focus();
      return;
    }

    window.RanchoDB.registrarBaja(animalId, {
      tipoBaja,
      fechaBaja,
      motivoBaja: document.getElementById('bajaMotivo').value.trim(),
      compradorDestino: comprador,
      guiaReemo: document.getElementById('bajaGuiaReemo').value.trim(),
      pesoVenta: document.getElementById('bajaPeso').value.trim(),
      precioVenta: document.getElementById('bajaPrecio').value.trim(),
      notasBaja: document.getElementById('bajaNotas').value.trim()
    });

    this.cerrarModal('modalBaja');
    const animalBaja = window.RanchoDB.state.animales.find((a) => a.id === animalId);
    const libre = animalBaja
      ? ` El #${animalBaja.numero} del Fierro ${animalBaja.fierro} queda libre; el registro se conserva en el historial.`
      : '';
    this.mostrarToast(
      (tipoBaja === 'Vendido' ? `Venta registrada a ${comprador}.` : 'Baja por muerte registrada.') + libre
    );
  },

  confirmarReactivar(animalId) {
    if (!this.exigirEdicion()) return;
    const animal = window.RanchoDB.state.animales.find((a) => a.id === animalId);
    if (!animal) return;

    const check = window.RanchoValidations.validarNumeroPorFierro(
      window.RanchoDB.state.animales,
      animal.fierro,
      animal.numero,
      animal.id
    );

    if (!check.valido) {
      this.mostrarToast(check.mensaje, 'error');
      return;
    }

    window.RanchoDB.reactivarAnimal(animalId);
    this.mostrarToast(`Fierro ${animal.fierro} #${animal.numero} reactivado en el padrón.`);
  },

  /**
   * EXPEDIENTE INDIVIDUAL DEL ANIMAL
   */
  abrirFichaAnimal(animalId) {
    const { animales, eventosSanitarios } = window.RanchoDB.state;
    const a = animales.find((x) => x.id === animalId);
    if (!a) return;

    const edad = window.RanchoValidations.calcularEdad(a.fechaNacimiento, a.fechaBaja || null);
    const crias = animales.filter(
      (c) =>
        c.madreId === a.id ||
        (a.sexo === 'Hembra' &&
          c.madreFierro === a.fierro &&
          c.madreNumero &&
          String(c.madreNumero).toUpperCase() === String(a.numero).toUpperCase())
    );
    const sanidad = eventosSanitarios.filter((e) => e.animalId === a.id);

    const contenedor = document.getElementById('fichaAnimalBody');
    contenedor.innerHTML = `
      <div class="selected-animal-banner" style="justify-content:space-between;">
        <div class="identity-cell">
          ${sello(a.fierro)}
          <div>
            <span class="numero-vaca" style="font-size:1.15rem;">Fierro ${esc(a.fierro)} · #${esc(a.numero)}</span>
            <span class="badge-sexo badge-sexo-${esc(a.sexo)}" style="margin-left:0.4rem;">${a.sexo === 'Hembra' ? '♀ Hembra' : '♂ Macho'}</span>
            <span class="badge-status badge-status-${esc(a.estatus)}" style="margin-left:0.35rem;">${esc(a.estatus)}</span>
          </div>
        </div>
        <div style="display:flex;gap:0.4rem;">
          <button class="btn btn-outline btn-sm" onclick="RanchoApp.cerrarModal('modalFicha');RanchoApp.abrirModalAnimal('${esc(a.id)}')">Editar datos</button>
          <button class="btn btn-danger-soft btn-sm" onclick="RanchoApp.eliminarRegistroDefinitivo('${esc(a.id)}')">Eliminar</button>
        </div>
      </div>

      <div class="detail-grid">
        <div class="detail-box">
          <div class="detail-box-label">Arete oficial (SINIIGA)</div>
          <div class="detail-box-value" style="font-family:var(--font-mono);">${esc(a.arete || 'S/N')}</div>
          <div class="arete-sub">${esc(a.colorArete || '')} · ${esc(a.estadoArete || 'Correcto')}</div>
          ${
            a.aretesAnteriores && a.aretesAnteriores.length > 0
              ? `<div style="font-size:0.74rem;color:var(--warning);margin-top:3px;">Aretes previos: ${esc(a.aretesAnteriores.join(', '))}</div>`
              : ''
          }
        </div>

        <div class="detail-box">
          <div class="detail-box-label">Categoría y características</div>
          <div class="detail-box-value">${esc(a.categoria || '—')}</div>
          <div class="arete-sub">Raza / Señas: ${esc(a.razaColor || 'No especificado')} · Peso: ${a.pesoActual ? esc(a.pesoActual) + ' kg' : '—'}</div>
        </div>

        <div class="detail-box">
          <div class="detail-box-label">Nacimiento y edad</div>
          <div class="detail-box-value">${edad.texto}</div>
          <div class="arete-sub">Fecha: ${esc(a.fechaNacimiento || 'Sin fecha')} (${esc(a.origen || 'Rancho')})</div>
        </div>

        <div class="detail-box">
          <div class="detail-box-label">Madre (Fierro, número y arete)</div>
          <div class="detail-box-value">
            ${
              a.madreNumero || a.madreArete
                ? `Fierro ${a.madreFierro || a.fierro} · #${esc(a.madreNumero || '?')} (${esc(a.madreArete || 'S/N')})`
                : 'Sin registro materno'
            }
          </div>
        </div>
      </div>

      ${
        a.estatus !== 'Activo'
          ? `<div class="fieldset-card sale-fieldset" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
              <div style="font-size:0.83rem;line-height:1.45;">
                <strong>${a.estatus === 'Vendido' ? 'Datos de venta' : 'Registro de baja por muerte'}</strong><br>
                <span>Fecha: <strong>${esc(a.fechaBaja || '-')}</strong></span> ·
                <span>Concepto: <strong>${esc(a.motivoBaja || '-')}</strong></span>
                ${
                  a.estatus === 'Vendido'
                    ? `<br><span>Comprador: <strong>${esc(a.compradorDestino || 'Sin registrar')}</strong></span>
                       ${a.guiaReemo ? ` · <span>Guía REEMO: <strong>${esc(a.guiaReemo)}</strong></span>` : ''}
                       ${a.pesoVenta ? ` · <span>Peso venta: <strong>${esc(a.pesoVenta)} kg</strong></span>` : ''}
                       ${a.precioVenta ? ` · <span>Monto: <strong>$${esc(a.precioVenta)}</strong></span>` : ''}`
                    : ''
                }
              </div>
              <button class="btn btn-outline btn-sm" onclick="RanchoApp.cerrarModal('modalFicha');RanchoApp.abrirModalBaja('${esc(a.id)}')">
                Editar datos de salida
              </button>
             </div>`
          : ''
      }

      ${
        a.sexo === 'Hembra'
          ? `<div class="fieldset-card">
              <div class="fieldset-header">Crías registradas de esta vaca (${crias.length})</div>
              ${
                crias.length === 0
                  ? `<p style="font-size:0.82rem;color:#66726a;">No tiene crías registradas.</p>`
                  : `<ul style="list-style:none;display:grid;gap:0.35rem;">
                      ${crias
                        .map(
                          (c) =>
                            `<li style="padding:0.45rem 0.65rem;background:var(--bg-subtle);border:1px solid var(--border-line);border-radius:4px;font-size:0.82rem;">
                              <strong>Fierro ${esc(c.fierro)} #${esc(c.numero)}</strong> (${esc(c.sexo)}) — Arete: <span style="font-family:var(--font-mono);">${esc(c.arete || 'S/N')}</span> — Nac: ${esc(c.fechaNacimiento || '?')} — Estatus: <strong>${esc(c.estatus)}</strong>
                             </li>`
                        )
                        .join('')}
                     </ul>`
              }
             </div>`
          : ''
      }

      <div class="fieldset-card">
        <div class="fieldset-header">Historial sanitario y pesajes (${sanidad.length})</div>
        ${
          sanidad.length === 0
            ? `<p style="font-size:0.82rem;color:#66726a;">Sin registros sanitarios individuales.</p>`
            : `<ul style="list-style:none;display:grid;gap:0.35rem;">
                ${sanidad
                  .map(
                    (s) =>
                      `<li style="padding:0.45rem 0.65rem;background:var(--bg-subtle);border:1px solid var(--border-line);border-radius:4px;font-size:0.82rem;">
                        <strong style="font-family:var(--font-mono);">${esc(s.fecha)}</strong> — <strong>${esc(s.tipo)}:</strong> ${esc(s.producto)} ${s.dosis ? `(${esc(s.dosis)})` : ''} ${s.pesoKg ? `· Peso: ${esc(s.pesoKg)} kg` : ''}
                       </li>`
                  )
                  .join('')}
               </ul>`
        }
      </div>
    `;

    document.getElementById('modalFicha').classList.add('open');
  },

  verMadreDeAnimal(criaId) {
    const { animales } = window.RanchoDB.state;
    const cria = animales.find((a) => a.id === criaId);
    if (!cria) return;

    let madre = null;
    if (cria.madreId) {
      madre = animales.find((a) => a.id === cria.madreId);
    }
    if (!madre && cria.madreNumero) {
      madre = animales.find(
        (a) =>
          a.fierro === (cria.madreFierro || cria.fierro) &&
          String(a.numero).toUpperCase() === String(cria.madreNumero).toUpperCase()
      );
    }

    if (madre) {
      this.abrirFichaAnimal(madre.id);
    } else {
      this.mostrarToast(
        `Madre registrada: Fierro ${cria.madreFierro || cria.fierro} #${
          cria.madreNumero || 'S/N'
        } (Arete: ${cria.madreArete || 'S/N'})`
      );
    }
  },

  eliminarRegistroDefinitivo(animalId) {
    if (!this.exigirEdicion()) return;
    if (
      !confirm(
        '¿Confirmas eliminar este registro permanentemente? Si el animal se vendió o murió, usa "Vender / Baja" para conservar su historial.'
      )
    ) {
      return;
    }
    window.RanchoDB.eliminarAnimalDefinitivo(animalId);
    this.cerrarModal('modalFicha');
    this.mostrarToast('Registro eliminado.');
  },

  /**
   * MODAL DE SANIDAD, VACUNACIÓN Y PESAJES
   */
  abrirModalSanidad() {
    if (!this.exigirEdicion()) return;
    const select = document.getElementById('sanidadAlcance');
    const activos = window.RanchoDB.state.animales.filter((a) => a.estatus === 'Activo');

    let html = `
      <optgroup label="Lote completo por fierro">
      ${window.RanchoDB.getFierros()
        .map(
          (f) =>
            `<option value="LOTE:${esc(f.codigo)}">Todo el Fierro ${esc(f.codigo)} — ${esc(f.propietario)} (activos)</option>`
        )
        .join('')}
      </optgroup>
      <option value="LOTE_BECERROS">Lote: Todos los becerros y becerras lactantes</option>
      <optgroup label="Seleccionar animal individual">
    `;
    activos.forEach((a) => {
      html += `<option value="${esc(a.id)}">[Fierro ${esc(a.fierro)}] #${esc(a.numero)} — Arete: ${esc(
        a.arete || 'S/N'
      )} (${esc(a.categoria)})</option>`;
    });
    html += `</optgroup>`;

    select.innerHTML = html;
    document.getElementById('sanidadFecha').value = new Date().toISOString().slice(0, 10);
    document.getElementById('sanidadTipo').value = 'Vacunación';
    document.getElementById('sanidadProducto').value = '';
    document.getElementById('sanidadDosis').value = '';
    document.getElementById('sanidadPeso').value = '';
    document.getElementById('sanidadProxima').value = '';
    document.getElementById('sanidadNotas').value = '';

    document.getElementById('modalSanidad').classList.add('open');
  },

  guardarEventoSanidad(event) {
    event.preventDefault();
    if (!this.exigirEdicion()) return;
    const alcance = document.getElementById('sanidadAlcance').value;
    const fecha = document.getElementById('sanidadFecha').value;
    const tipo = document.getElementById('sanidadTipo').value;
    const producto = document.getElementById('sanidadProducto').value.trim();
    const dosis = document.getElementById('sanidadDosis').value.trim();
    const pesoKg = document.getElementById('sanidadPeso').value.trim();
    const proximaFecha = document.getElementById('sanidadProxima').value;
    const notas = document.getElementById('sanidadNotas').value.trim();

    const activos = window.RanchoDB.state.animales.filter((a) => a.estatus === 'Activo');
    let destinatarios = [];

    if (alcance.startsWith('LOTE:')) {
      const codigo = alcance.slice(5);
      destinatarios = activos.filter((a) => a.fierro === codigo);
    } else if (alcance === 'LOTE_BECERROS') {
      destinatarios = activos.filter((a) => a.categoria && a.categoria.includes('Lactante'));
    } else {
      const ind = activos.find((a) => a.id === alcance);
      if (ind) destinatarios = [ind];
    }

    if (destinatarios.length === 0) {
      this.mostrarToast('No hay animales activos en el grupo seleccionado.', 'error');
      return;
    }

    destinatarios.forEach((anm) => {
      window.RanchoDB.registrarEventoSanitario({
        animalId: anm.id,
        fecha,
        tipo,
        producto,
        dosis,
        pesoKg,
        proximaFecha,
        notas
      });
    });

    this.cerrarModal('modalSanidad');
    this.mostrarToast(
      `Se registró "${tipo}: ${producto}" en ${destinatarios.length} ${
        destinatarios.length === 1 ? 'cabeza' : 'cabezas'
      }.`
    );
  },

  borrarEventoSanitario(id) {
    if (!this.exigirEdicion()) return;
    window.RanchoDB.eliminarEventoSanitario(id);
    this.mostrarToast('Registro sanitario eliminado.');
  },

  /**
   * ACCESO AL RANCHO PRIVADO (cuenta del servidor) Y VISTA PORTAFOLIO
   */
  async accionBotonSesion() {
    this.toggleSidebar(false);
    const db = window.RanchoDB;
    if (db.sessionMode === 'REAL') {
      db.verPortafolio();
      this.mostrarToast('Vista de portafolio: se muestran solo datos de ejemplo. Tu sesión sigue abierta.');
      return;
    }
    if (db.sesion) {
      await db.volverAlRancho();
      this.mostrarToast(`Rancho privado: ${db.ranchoActual.nombre}`);
      return;
    }
    await this.mostrarFormularioAcceso();
  },

  /** Abre el inicio de sesión, o la configuración inicial si el servidor aún no tiene cuentas. */
  async mostrarFormularioAcceso(aviso = '') {
    const modal = document.getElementById('modalAccesoPrivado');
    const formEntrar = document.getElementById('formEntrar');
    const formConfigurar = document.getElementById('formConfigurar');
    const avisoEl = document.getElementById('accesoAviso');
    formEntrar.reset();
    formConfigurar.reset();
    formEntrar.hidden = false;
    formConfigurar.hidden = true;
    document.getElementById('accesoTitulo').textContent = 'Entrar al rancho privado';
    avisoEl.hidden = !aviso;
    avisoEl.textContent = aviso;
    modal.classList.add('open');

    try {
      const estado = await window.RanchoDB.estadoServidor();
      if (estado.necesitaConfiguracion) {
        formEntrar.hidden = true;
        formConfigurar.hidden = false;
        document.getElementById('accesoTitulo').textContent = 'Configuración inicial del rancho';
        setTimeout(() => document.getElementById('setupToken').focus(), 60);
        return;
      }
    } catch (err) {
      if (!aviso) {
        avisoEl.hidden = false;
        avisoEl.textContent = err.sinRed
          ? 'Sin conexión: necesitas internet para iniciar sesión.'
          : err.message;
      }
    }
    setTimeout(() => document.getElementById('inputEmailAcceso').focus(), 60);
  },

  async _conBotonOcupado(boton, texto, fn) {
    const original = boton.textContent;
    boton.disabled = true;
    boton.textContent = texto;
    try {
      return await fn();
    } finally {
      boton.disabled = false;
      boton.textContent = original;
    }
  },

  async confirmarAccesoPrivado(event) {
    event.preventDefault();
    const email = document.getElementById('inputEmailAcceso').value.trim();
    const password = document.getElementById('inputPasswordAcceso').value;
    try {
      await this._conBotonOcupado(document.getElementById('btnSubmitAcceso'), 'Entrando…', () =>
        window.RanchoDB.entrar(email, password)
      );
    } catch (err) {
      this.mostrarToast(err.message || 'No se pudo iniciar sesión.', 'error');
      return;
    }
    this.cerrarModal('modalAccesoPrivado');
    this.mostrarToast(`Bienvenido. Rancho: ${window.RanchoDB.ranchoActual.nombre}`);
    if (window.RanchoDB.debeCambiarContrasena()) {
      this.pedirCambioDeContrasena();
      return;
    }
    this.ofrecerSubirDatosAntiguos();
  },

  async confirmarConfiguracionInicial(event) {
    event.preventDefault();
    const val = (id) => document.getElementById(id).value;
    if (val('setupPassword') !== val('setupPassword2')) {
      this.mostrarToast('Las contraseñas no coinciden.', 'error');
      return;
    }
    try {
      await this._conBotonOcupado(document.getElementById('btnSubmitConfigurar'), 'Creando…', () =>
        window.RanchoDB.configurarInicial({
          token: val('setupToken').trim(),
          nombreRancho: val('setupRancho').trim(),
          nombre: val('setupNombre').trim(),
          email: val('setupEmail').trim(),
          password: val('setupPassword')
        })
      );
    } catch (err) {
      this.mostrarToast(err.message || 'No se pudo completar la configuración.', 'error');
      return;
    }
    this.cerrarModal('modalAccesoPrivado');
    this.mostrarToast('Cuenta de administrador creada. Ya estás dentro de tu rancho.');
    this.ofrecerSubirDatosAntiguos();
  },

  /** Abre la cuenta con el formulario de contraseña listo (contraseña temporal). */
  pedirCambioDeContrasena() {
    this.abrirModalConfiguracion('cfgSeccionCuenta');
    const det = document.querySelector('#cfgCuenta .account-password');
    if (det) det.open = true;
    this.mostrarToast('Estás usando una contraseña temporal: cámbiala por una tuya.', 'error');
    setTimeout(() => {
      const el = document.getElementById('cfgPassActual');
      if (el) el.focus();
    }, 120);
  },

  /** Si este navegador tiene datos de la versión anterior (con PIN), ofrece subirlos al servidor. */
  ofrecerSubirDatosAntiguos() {
    const db = window.RanchoDB;
    const antiguos = db.datosAntiguosDelDispositivo();
    if (!antiguos || !db.puedeEditar()) return;
    const n = antiguos.animales.length;
    if (
      confirm(
        `Este dispositivo tiene ${n} animales guardados de la versión anterior (con PIN).\n\n` +
          `¿Subirlos ahora al servidor? Los registros del servidor se reemplazarán por estos.\n` +
          `(Si eliges "Cancelar" podrás hacerlo después desde "Rancho, dueños y cuenta".)`
      )
    ) {
      this.subirDatosAntiguos(true);
    }
  },

  subirDatosAntiguos(yaConfirmado = false) {
    const db = window.RanchoDB;
    const antiguos = db.datosAntiguosDelDispositivo();
    if (!antiguos) return;
    if (!this.exigirEdicion()) return;
    if (
      !yaConfirmado &&
      !confirm(`¿Subir los ${antiguos.animales.length} animales de la versión anterior? Los registros actuales se reemplazarán.`)
    ) {
      return;
    }
    this.descargarRespaldoJSON('Antes_de_subir_datos_anteriores');
    db.importarEstado(antiguos, { marcarAntiguos: true });
    this.cerrarModal('modalConfig');
    this.mostrarToast('Subiendo los datos de la versión anterior al servidor…');
  },

  /** true si la cuenta puede modificar datos; si no, avisa. */
  exigirEdicion() {
    if (window.RanchoDB.puedeEditar()) return true;
    this.mostrarToast('Tu cuenta es de solo lectura en este rancho.', 'error');
    return false;
  },

  /**
   * MODAL DE CONFIGURACIÓN: RANCHO, DUEÑOS, CUENTA, MIEMBROS Y SINCRONIZACIÓN
   */
  abrirModalConfiguracion(seccion = null) {
    this.toggleSidebar(false);
    const db = window.RanchoDB;
    if (db.sessionMode !== 'REAL') {
      this.mostrarToast('Entra a tu rancho privado para configurar los dueños y la cuenta.');
      this.accionBotonSesion();
      return;
    }

    const { config } = db.state;
    const admin = db.esAdmin();
    document.getElementById('cfgNombreRancho').value = config.nombreRancho || '';
    document.getElementById('cfgEdadDestete').value = config.edadDesteteMeses || 7;
    this.renderListaFierrosConfig(db.getFierros());

    // Solo el admin cambia nombre, destete, dueños y fierros
    document.getElementById('cfgAvisoSoloAdmin').hidden = admin;
    document.getElementById('btnGuardarConfig').hidden = !admin;
    document.getElementById('btnAgregarDueno').hidden = !admin;
    ['cfgNombreRancho', 'cfgEdadDestete'].forEach((id) => (document.getElementById(id).disabled = !admin));
    document.querySelectorAll('#cfgFierrosList input, #cfgFierrosList select, #cfgFierrosList button').forEach((el) => {
      el.disabled = el.disabled || !admin;
    });

    this.renderCuentaConfig();
    this.renderSyncConfig();
    this.renderMiembrosConfig();
    this.renderDatosAntiguosConfig();
    document.getElementById('modalConfig').classList.add('open');
    if (seccion) {
      const el = document.getElementById(seccion);
      if (el) setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
    }
  },

  async guardarConfiguracion(event) {
    event.preventDefault();
    const db = window.RanchoDB;
    if (!db.esAdmin()) {
      this.cerrarModal('modalConfig');
      return;
    }
    try {
      db.guardarFierros(this.leerListaFierrosConfig());
    } catch (err) {
      this.mostrarToast(err.message, 'error');
      return;
    }
    db.state.config.nombreRancho = document.getElementById('cfgNombreRancho').value.trim() || 'Mi rancho';
    db.state.config.edadDesteteMeses = parseInt(document.getElementById('cfgEdadDestete').value, 10) || 7;
    db.saveLocal();
    this.cerrarModal('modalConfig');
    this.mostrarToast('Cambios guardados. Se subirán al servidor automáticamente.');
  },

  /** Pinta el editor de dueños/fierros en la configuración (solo DOM; se guarda al enviar). */
  renderListaFierrosConfig(fierros) {
    const lista = document.getElementById('cfgFierrosList');
    if (!lista) return;
    lista.innerHTML = fierros.map((f) => this.htmlFilaFierro(f)).join('');
  },

  htmlFilaFierro(f) {
    const enUso = f.codigo ? window.RanchoDB.contarAnimalesDeFierro(f.codigo) : 0;
    const tonos = window.RanchoDB.TONOS.map(
      (t, i) => `<option value="${i}" ${i === f.tono ? 'selected' : ''}>${esc(t.nombre)}</option>`
    ).join('');
    return `
      <div class="owner-row tono-${f.tono}" data-original="${esc(f.codigo)}">
        <span class="stamp-fierro tono-${f.tono} owner-stamp" aria-hidden="true">${esc(f.codigo || '?')}</span>
        <label class="owner-field owner-code">
          <span class="form-label">Fierro</span>
          <input type="text" class="form-input input-mono" data-campo="codigo" maxlength="3" value="${esc(f.codigo)}"
            placeholder="Ej. R" autocapitalize="characters" ${enUso ? 'readonly' : ''}
            oninput="RanchoApp.previsualizarFilaFierro(this)" />
        </label>
        <label class="owner-field owner-name">
          <span class="form-label">Dueño</span>
          <input type="text" class="form-input" data-campo="propietario" maxlength="80" value="${esc(f.propietario)}" placeholder="Nombre del dueño" />
        </label>
        <label class="owner-field owner-tone">
          <span class="form-label">Color</span>
          <select class="form-select" data-campo="tono" onchange="RanchoApp.previsualizarFilaFierro(this)">${tonos}</select>
        </label>
        <button type="button" class="btn-icon btn-icon-danger owner-remove" onclick="RanchoApp.quitarFilaFierro(this)"
          ${enUso ? 'disabled' : ''} aria-label="Quitar Fierro ${esc(f.codigo)}"
          title="${enUso ? `No se puede quitar: tiene ${enUso} ${enUso === 1 ? 'animal' : 'animales'}` : 'Quitar este fierro'}">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <path d="M4 6h12M8 6V4h4v2M6 6l.8 10h6.4L14 6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        ${
          enUso
            ? `<p class="owner-note">${enUso} ${enUso === 1 ? 'animal registrado' : 'animales registrados'} · el código no se puede cambiar</p>`
            : ''
        }
      </div>`;
  },

  leerListaFierrosConfig() {
    return [...document.querySelectorAll('#cfgFierrosList .owner-row')].map((row) => ({
      codigo: row.querySelector('[data-campo="codigo"]').value,
      propietario: row.querySelector('[data-campo="propietario"]').value,
      tono: row.querySelector('[data-campo="tono"]').value
    }));
  },

  agregarFilaFierro() {
    const lista = document.getElementById('cfgFierrosList');
    if (!lista) return;
    const actuales = this.leerListaFierrosConfig();
    const usados = new Set(actuales.map((f) => window.RanchoDB.normalizarCodigoFierro(f.codigo)));
    const sugerido = 'ABCDEGJKLMNPQRSTUVWXYZ'.split('').find((l) => !usados.has(l)) || '';
    const tonosUsados = new Set(actuales.map((f) => parseInt(f.tono, 10)));
    let tono = [...Array(window.RanchoDB.TOTAL_TONOS).keys()].find((t) => !tonosUsados.has(t));
    if (tono === undefined) tono = actuales.length % window.RanchoDB.TOTAL_TONOS;

    lista.insertAdjacentHTML('beforeend', this.htmlFilaFierro({ codigo: sugerido, propietario: '', tono }));
    const nueva = lista.lastElementChild;
    const inputDueno = nueva.querySelector('[data-campo="propietario"]');
    if (inputDueno) inputDueno.focus();
  },

  quitarFilaFierro(boton) {
    const row = boton.closest('.owner-row');
    if (!row) return;
    if (document.querySelectorAll('#cfgFierrosList .owner-row').length <= 1) {
      this.mostrarToast('Debe quedar al menos un fierro en el terreno.', 'error');
      return;
    }
    row.remove();
  },

  previsualizarFilaFierro(el) {
    const row = el.closest('.owner-row');
    if (!row) return;
    const inputCodigo = row.querySelector('[data-campo="codigo"]');
    const codigo = window.RanchoDB.normalizarCodigoFierro(inputCodigo.value);
    if (el === inputCodigo && inputCodigo.value !== codigo) inputCodigo.value = codigo;
    const tono = parseInt(row.querySelector('[data-campo="tono"]').value, 10) || 0;
    const stamp = row.querySelector('.owner-stamp');
    stamp.textContent = codigo || '?';
    stamp.className = `stamp-fierro tono-${tono} owner-stamp`;
    row.className = `owner-row tono-${tono}`;
  },

  /* ---------------------------------------------------------------- cuenta */
  renderCuentaConfig() {
    const cont = document.getElementById('cfgCuenta');
    if (!cont) return;
    const db = window.RanchoDB;
    const u = (db.sesion && db.sesion.usuario) || {};
    const nombresRol = { admin: 'Administrador', editor: 'Editor', lector: 'Solo lectura' };
    cont.innerHTML = `
      <div class="account-summary">
        <div>
          <div class="account-name">${esc(u.nombre || u.email || '')}</div>
          <div class="account-meta">${esc(u.email || '')} · ${esc(nombresRol[db.rol()] || db.rol())} en ${esc(db.ranchoActual ? db.ranchoActual.nombre : '')}</div>
        </div>
        <button type="button" class="btn btn-outline btn-sm" onclick="RanchoApp.cerrarSesion()">Cerrar sesión</button>
      </div>
      <details class="account-password">
        <summary>Cambiar contraseña</summary>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label" for="cfgPassActual">Contraseña actual</label>
            <input type="password" id="cfgPassActual" class="form-input" autocomplete="current-password" />
          </div>
          <div class="form-group">
            <label class="form-label" for="cfgPassNueva">Nueva contraseña (mínimo 8)</label>
            <input type="password" id="cfgPassNueva" class="form-input" autocomplete="new-password" minlength="8" />
          </div>
        </div>
        <button type="button" id="btnCambiarPass" class="btn btn-outline btn-sm" onclick="RanchoApp.cambiarContrasena()">Cambiar contraseña</button>
        <p class="form-help-text">Al cambiarla se cierran las sesiones de tus otros dispositivos.</p>
      </details>`;
  },

  async cambiarContrasena() {
    const actual = document.getElementById('cfgPassActual').value;
    const nueva = document.getElementById('cfgPassNueva').value;
    if (nueva.length < 8) {
      this.mostrarToast('La nueva contraseña debe tener al menos 8 caracteres.', 'error');
      return;
    }
    try {
      await this._conBotonOcupado(document.getElementById('btnCambiarPass'), 'Cambiando…', () =>
        window.RanchoDB.cambiarContrasena(actual, nueva)
      );
      document.getElementById('cfgPassActual').value = '';
      document.getElementById('cfgPassNueva').value = '';
      this.mostrarToast('Contraseña cambiada. Las sesiones de tus otros dispositivos se cerraron.');
      this.renderAvisosSync();
    } catch (err) {
      this.mostrarToast(err.message, 'error');
    }
  },

  async cerrarSesion() {
    const db = window.RanchoDB;
    try {
      await db.salir();
    } catch (err) {
      if (err.codigo !== 'PENDIENTES') {
        this.mostrarToast(err.message, 'error');
        return;
      }
      if (
        !confirm(
          `${err.message}\n\nSi cierras sesión ahora esos cambios se perderán en este dispositivo. ` +
            `Conéctate a internet y espera a que se sincronicen, o pulsa "Aceptar" para cerrar de todos modos.`
        )
      ) {
        return;
      }
      await db.salir({ forzar: true });
    }
    this.cerrarModal('modalConfig');
    this.mostrarToast('Sesión cerrada. Los datos del rancho se borraron de este dispositivo.');
  },

  /* ---------------------------------------------------------------- sincronización */
  renderSyncConfig() {
    const cont = document.getElementById('cfgSync');
    if (!cont) return;
    const db = window.RanchoDB;
    const pendientes = db.contarPendientes();
    const rechazos = db.listaRechazos();
    const ultima = db.ultimaSync
      ? new Date(db.ultimaSync).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
      : 'todavía no';
    cont.innerHTML = `
      <div class="sync-summary">
        <span class="sync-dot ${!navigator.onLine ? 'offline' : pendientes || rechazos.length ? '' : 'cloud'}" aria-hidden="true"></span>
        <span>${esc(db.cloudConfig.statusText)}</span>
      </div>
      <p class="form-help-text">Última sincronización: ${esc(ultima)} · Puedes trabajar sin señal: los cambios se guardan en el dispositivo y se suben solos al volver la conexión.</p>
      ${
        rechazos.length
          ? `<div class="rejected-list">
              <p class="rejected-title">Estos cambios no se pudieron subir:</p>
              <ul>
                ${rechazos
                  .map(
                    (r) => `<li>
                      <div><strong>${esc(r.titulo)}</strong><span>${esc(r.motivo)}</span></div>
                      <div class="rejected-actions">
                        ${
                          r.entidad === 'animal' && db.state.animales.some((a) => a.id === r.id)
                            ? `<button type="button" class="btn btn-outline btn-sm" onclick="RanchoApp.cerrarModal('modalConfig');RanchoApp.abrirModalAnimal('${esc(r.id)}')">Corregir</button>`
                            : ''
                        }
                        <button type="button" class="btn btn-outline btn-sm" onclick="RanchoApp.descartarRechazo('${esc(r.clave)}')">Descartar mi cambio</button>
                      </div>
                    </li>`
                  )
                  .join('')}
              </ul>
            </div>`
          : ''
      }
      <button type="button" id="btnSyncAhora" class="btn btn-outline btn-sm" onclick="RanchoApp.sincronizarAhora()">Sincronizar ahora</button>`;
  },

  async sincronizarAhora() {
    const db = window.RanchoDB;
    if (db.sesionVencida) {
      this.cerrarModal('modalConfig');
      this.mostrarFormularioAcceso('Tu sesión venció. Vuelve a entrar para sincronizar.');
      return;
    }
    if (!navigator.onLine) {
      this.mostrarToast('Sin señal: los cambios siguen guardados en el dispositivo.', 'error');
      return;
    }
    const boton = document.getElementById('btnSyncAhora');
    const res = await (boton
      ? this._conBotonOcupado(boton, 'Sincronizando…', () => db.sincronizar({ esperar: true }))
      : db.sincronizar({ esperar: true }));
    this.renderSyncConfig();
    if (res && res.ok && !res.rechazos) this.mostrarToast('Rancho sincronizado.');
    else if (res && res.ok) this.mostrarToast(`${res.rechazos} cambio(s) no se pudieron subir. Revisa la lista.`, 'error');
    else this.mostrarToast(db.syncError || 'No se pudo sincronizar. Intenta más tarde.', 'error');
  },

  descartarRechazo(clave) {
    if (!confirm('¿Descartar este cambio? El registro volverá a como está en el servidor.')) return;
    window.RanchoDB.descartarRechazo(clave);
    this.renderSyncConfig();
    this.mostrarToast('Cambio descartado.');
  },

  /** Aviso arriba del padrón: sesión vencida, cambios rechazados o cuenta de solo lectura. */
  renderAvisosSync() {
    const el = document.getElementById('syncAvisos');
    if (!el) return;
    const db = window.RanchoDB;
    if (db.sessionMode !== 'REAL') {
      el.hidden = true;
      return;
    }
    const rechazos = Object.keys(db.rechazos || {}).length;
    let html = '';
    if (db.debeCambiarContrasena() && !db.sesionVencida) {
      html = `<span>Estás usando una contraseña temporal. Cámbiala por una que solo tú conozcas.</span>
        <button type="button" class="btn btn-outline btn-sm" onclick="RanchoApp.pedirCambioDeContrasena()">Cambiar ahora</button>`;
    } else if (db.sesionVencida) {
      html = `<span>Tu sesión venció. Los cambios se guardan en este dispositivo, pero no se suben hasta que vuelvas a entrar.</span>
        <button type="button" class="btn btn-outline btn-sm" onclick="RanchoApp.mostrarFormularioAcceso('Tu sesión venció. Vuelve a entrar para sincronizar.')">Entrar de nuevo</button>`;
    } else if (rechazos) {
      html = `<span>${rechazos} ${rechazos === 1 ? 'cambio no se pudo' : 'cambios no se pudieron'} subir al servidor (por ejemplo, un número o arete que ya existe).</span>
        <button type="button" class="btn btn-outline btn-sm" onclick="RanchoApp.abrirModalConfiguracion('cfgSeccionSync')">Revisar</button>`;
    } else if (!db.puedeEditar()) {
      html = '<span>Tu cuenta es de solo lectura en este rancho: puedes consultar y exportar, pero no modificar.</span>';
    }
    el.hidden = !html;
    el.innerHTML = html;
  },

  /* ---------------------------------------------------------------- miembros */
  async renderMiembrosConfig() {
    const seccion = document.getElementById('cfgSeccionMiembros');
    const cont = document.getElementById('cfgMiembros');
    if (!seccion || !cont) return;
    const db = window.RanchoDB;
    seccion.hidden = !db.esAdmin();
    if (!db.esAdmin()) return;

    cont.innerHTML = '<p class="form-help-text">Cargando…</p>';
    let miembros = [];
    try {
      miembros = (await db.listarMiembros()).miembros;
    } catch (err) {
      cont.innerHTML = `<p class="form-help-text">${esc(err.sinRed ? 'Sin conexión: la lista de personas necesita internet.' : err.message)}</p>`;
      return;
    }
    this._miembros = miembros;
    const yo = db.sesion.usuario.id;
    const opcion = (valor, texto, actual) => `<option value="${valor}" ${valor === actual ? 'selected' : ''}>${texto}</option>`;
    cont.innerHTML = `
      <ul class="members-list">
        ${miembros
          .map(
            (m) => `<li>
              <div class="member-who">
                <strong>${esc(m.nombre)}${m.id === yo ? ' (tú)' : ''}</strong>
                <span>${esc(m.email)}</span>
              </div>
              <select class="form-select member-role" aria-label="Rol de ${esc(m.nombre)}"
                onchange="RanchoApp.cambiarRolMiembro('${esc(m.id)}', this.value, this)" ${m.id === yo ? 'disabled' : ''}>
                ${opcion('admin', 'Administrador', m.rol)}${opcion('editor', 'Editor', m.rol)}${opcion('lector', 'Solo lectura', m.rol)}
              </select>
              <button type="button" class="btn-icon" onclick="RanchoApp.restablecerContrasenaMiembro('${esc(m.id)}')"
                ${m.id === yo ? 'disabled' : ''} aria-label="Restablecer la contraseña de ${esc(m.nombre)}" title="Restablecer contraseña">
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="7" cy="12" r="3.2" /><path d="M9.3 9.7L16 3M13.5 5.5l2 2M11.8 7.2l1.5 1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="btn-icon btn-icon-danger" onclick="RanchoApp.quitarMiembro('${esc(m.id)}')"
                ${m.id === yo ? 'disabled' : ''} aria-label="Quitar acceso a ${esc(m.nombre)}" title="Quitar acceso">
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l.8 10h6.4L14 6" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
            </li>`
          )
          .join('')}
      </ul>
      <details class="member-add">
        <summary>Dar acceso a otra persona</summary>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label" for="nuevoMiembroNombre">Nombre</label>
            <input type="text" id="nuevoMiembroNombre" class="form-input" maxlength="80" />
          </div>
          <div class="form-group">
            <label class="form-label" for="nuevoMiembroEmail">Correo</label>
            <input type="email" id="nuevoMiembroEmail" class="form-input" autocomplete="off" />
          </div>
          <div class="form-group">
            <label class="form-label" for="nuevoMiembroPassword">Contraseña inicial (mínimo 8)</label>
            <input type="text" id="nuevoMiembroPassword" class="form-input input-mono" autocomplete="off" minlength="8" value="${this.generarContrasenaTemporal()}" />
          </div>
          <div class="form-group">
            <label class="form-label" for="nuevoMiembroRol">Permiso</label>
            <select id="nuevoMiembroRol" class="form-select">
              <option value="editor">Editor: registra y modifica ganado</option>
              <option value="lector">Solo lectura: consulta y exporta</option>
              <option value="admin">Administrador: además dueños y personas</option>
            </select>
          </div>
        </div>
        <button type="button" id="btnAgregarMiembro" class="btn btn-primary btn-sm" onclick="RanchoApp.agregarMiembro()">Dar acceso</button>
        <p class="form-help-text">Comparte el correo y la contraseña inicial con la persona por un medio privado; al entrar se le pedirá cambiarla. Si ya tiene cuenta, su contraseña no se cambia.</p>
      </details>`;
  },

  async agregarMiembro() {
    const val = (id) => document.getElementById(id).value.trim();
    const datos = {
      nombre: val('nuevoMiembroNombre'),
      email: val('nuevoMiembroEmail'),
      password: document.getElementById('nuevoMiembroPassword').value,
      rol: val('nuevoMiembroRol')
    };
    if (!datos.email) {
      this.mostrarToast('Escribe el correo de la persona.', 'error');
      return;
    }
    try {
      const r = await this._conBotonOcupado(document.getElementById('btnAgregarMiembro'), 'Agregando…', () =>
        window.RanchoDB.agregarMiembro(datos)
      );
      this.mostrarToast(r.cuentaNueva ? `Cuenta creada para ${datos.email}.` : `${datos.email} ya tenía cuenta: ahora tiene acceso.`);
      this.renderMiembrosConfig();
    } catch (err) {
      this.mostrarToast(err.message, 'error');
    }
  },

  async cambiarRolMiembro(usuarioId, rol, select) {
    try {
      await window.RanchoDB.cambiarRolMiembro(usuarioId, rol);
      this.mostrarToast('Permiso actualizado.');
    } catch (err) {
      this.mostrarToast(err.message, 'error');
      this.renderMiembrosConfig();
    }
  },

  async restablecerContrasenaMiembro(usuarioId) {
    const m = (this._miembros || []).find((x) => x.id === usuarioId);
    const nombre = m ? m.nombre : 'esta persona';
    const sugerida = this.generarContrasenaTemporal();
    const nueva = prompt(
      `Nueva contraseña temporal para ${nombre} (mínimo 8 caracteres).\n` +
        `Se cerrarán sus sesiones abiertas y deberá cambiarla al entrar.`,
      sugerida
    );
    if (nueva === null) return;
    if (nueva.length < 8) {
      this.mostrarToast('La contraseña temporal debe tener al menos 8 caracteres.', 'error');
      return;
    }
    try {
      await window.RanchoDB.restablecerContrasenaMiembro(usuarioId, nueva);
      alert(`Contraseña temporal de ${nombre}:\n\n${nueva}\n\nCompártela en persona o por un medio privado.`);
    } catch (err) {
      this.mostrarToast(err.message, 'error');
    }
  },

  /** Contraseña temporal aleatoria y fácil de dictar (sin 0/O ni 1/l). */
  generarContrasenaTemporal() {
    const letras = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    const s = [...bytes].map((b) => letras[b % letras.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  },

  async quitarMiembro(usuarioId) {
    const m = (this._miembros || []).find((x) => x.id === usuarioId);
    const nombre = m ? m.nombre : 'esta persona';
    if (!confirm(`¿Quitar el acceso de ${nombre} a este rancho?`)) return;
    try {
      await window.RanchoDB.quitarMiembro(usuarioId);
      this.mostrarToast(`${nombre} ya no tiene acceso.`);
      this.renderMiembrosConfig();
    } catch (err) {
      this.mostrarToast(err.message, 'error');
    }
  },

  renderDatosAntiguosConfig() {
    const cont = document.getElementById('cfgDatosAntiguos');
    if (!cont) return;
    const antiguos = window.RanchoDB.datosAntiguosDelDispositivo();
    cont.innerHTML =
      antiguos && window.RanchoDB.puedeEditar()
        ? `<div class="legacy-data">
            <span>Este dispositivo tiene <strong>${antiguos.animales.length}</strong> animales de la versión anterior (con PIN) que aún no están en el servidor.</span>
            <button type="button" class="btn btn-primary btn-sm" onclick="RanchoApp.subirDatosAntiguos()">Subir al servidor</button>
          </div>`
        : '';
  },

  descargarRespaldoJSON(prefijo = '') {
    const dataStr = JSON.stringify(window.RanchoDB.state, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    const etiqueta = typeof prefijo === 'string' && prefijo ? `${prefijo}_` : '';
    link.download = `Respaldo_Rancho_FH_${etiqueta}${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  importarRespaldoJSON(inputEl) {
    const file = inputEl.files && inputEl.files[0];
    if (!file) return;
    if (!this.exigirEdicion()) {
      inputEl.value = '';
      return;
    }
    inputEl.value = ''; // permitir volver a elegir el mismo archivo

    if (file.size > 4 * 1024 * 1024) {
      this.mostrarToast('El respaldo es demasiado grande (máx. 4 MB).', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      let parsed;
      try {
        parsed = JSON.parse(e.target.result);
      } catch (err) {
        this.mostrarToast('Error al leer el archivo de respaldo (JSON inválido).', 'error');
        return;
      }

      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.animales)) {
        this.mostrarToast('El archivo seleccionado no tiene un formato válido.', 'error');
        return;
      }

      const db = window.RanchoDB;
      const limpio = db.normalizarEstado(parsed, db.state.config);
      const actual = db.state;

      if (
        !confirm(
          `¿Restaurar este respaldo?\n\n` +
            `Respaldo: ${limpio.animales.length} animales, ${limpio.eventosSanitarios.length} registros sanitarios.\n` +
            `Actual: ${actual.animales.length} animales, ${actual.eventosSanitarios.length} registros sanitarios.\n\n` +
            `Los datos actuales se REEMPLAZARÁN. Antes se descargará una copia de seguridad de lo que tienes ahora.`
        )
      ) {
        return;
      }

      this.descargarRespaldoJSON('Antes_de_restaurar');
      db.importarEstado(parsed);
      this.cerrarModal('modalConfig');
      this.mostrarToast('Respaldo restaurado. Se descargó una copia de los datos anteriores.');
    };
    reader.onerror = () => {
      this.mostrarToast('No se pudo leer el archivo de respaldo.', 'error');
    };
    reader.readAsText(file);
  },

  vaciarDatosDeEjemplo() {
    if (!this.exigirEdicion()) return;
    const real = window.RanchoDB.sessionMode === 'REAL';
    if (
      !confirm(
        real
          ? '¿Eliminar TODOS los animales y registros sanitarios del rancho? También se borrarán del servidor. Antes se descargará un respaldo.'
          : '¿Deseas eliminar los animales de ejemplo?'
      )
    ) {
      return;
    }
    if (real) this.descargarRespaldoJSON('Antes_de_vaciar');
    window.RanchoDB.limpiarTodoElRancho();
    this.cerrarModal('modalConfig');
    this.mostrarToast('Padrón limpio y listo para registrar.');
  },

  descargarTablaActualExcel(etiqueta = 'Inventario') {
    const modo = this.tabActiva === 'bajas' ? 'Bajas' : 'Activo';
    const lista = this.obtenerAnimalesFiltrados(modo);
    window.RanchoExports.exportarExcel(lista, etiqueta);
    this.mostrarToast('Descargando tabla Excel (.xlsx)...');
  },

  descargarTablaActualPDF(titulo = 'Padrón de Ganado') {
    const modo = this.tabActiva === 'bajas' ? 'Bajas' : 'Activo';
    const lista = this.obtenerAnimalesFiltrados(modo);
    const sufijoFierro =
      this.filtroFierro === 'TODOS'
        ? 'Todos los fierros'
        : `Fierro ${this.filtroFierro}`;
    window.RanchoExports.exportarPDF(lista, `${titulo} (${sufijoFierro})`);
    this.mostrarToast('Generando tabla PDF...');
  },

  cerrarModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('open');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.RanchoApp.init();
});
