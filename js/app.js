/**
 * Controlador Principal de la Aplicación Ganadera (varios dueños / fierros en un terreno)
 */

/**
 * Escapa texto para insertarlo de forma segura en plantillas HTML (innerHTML).
 * Todo dato capturado por el usuario, importado o descargado de la nube debe pasar por aquí.
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
  tabActiva: 'inventario', // 'inventario' | 'bajas' | 'sanidad' | 'genealogia'
  busquedaTexto: '',
  filtroSexo: 'TODOS',
  filtroCategoria: 'TODAS',
  filtroAreteEstado: 'TODOS',

  formAnimalActual: {
    id: null,
    fierro: '',
    sexo: 'Hembra'
  },

  init() {
    window.RanchoDB.init();
    window.RanchoDB.subscribe(() => {
      this.renderTodo();
    });

    this.registrarServiceWorker();
    this.registrarAtajosModales();
    this.renderTodo();
  },

  registrarAtajosModales() {
    document.addEventListener('keydown', (e) => {
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
    container.appendChild(toast);
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
        ? 'Salir a vista portafolio'
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
      else if (cloudCfg.enabled && !cloudCfg.pendingSync) mobDot.classList.add('cloud');
    }

    if (syncDot && syncText) {
      syncText.textContent = cloudCfg.statusText;
      syncDot.className = 'sync-dot';
      if (!esReal) {
        syncDot.classList.add('demo');
      } else if (!navigator.onLine) {
        syncDot.classList.add('offline');
      } else if (cloudCfg.enabled && !cloudCfg.pendingSync) {
        syncDot.classList.add('cloud');
      }
    }

    // Actualizar título dinámico del área de trabajo
    const titulos = {
      inventario: 'Padrón de Ganado Activo',
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

    if (this.tabActiva === 'inventario') {
      this.renderTablaInventario(container, 'Activo');
    } else if (this.tabActiva === 'bajas') {
      this.renderTablaInventario(container, 'Bajas');
    } else if (this.tabActiva === 'sanidad') {
      this.renderVistaSanidad(container);
    } else if (this.tabActiva === 'genealogia') {
      this.renderVistaGenealogia(container);
    }
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
    this.mostrarToast(
      tipoBaja === 'Vendido'
        ? `Venta registrada a ${comprador}`
        : `Baja por muerte registrada correctamente.`
    );
  },

  confirmarReactivar(animalId) {
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
    window.RanchoDB.eliminarEventoSanitario(id);
    this.mostrarToast('Registro sanitario eliminado.');
  },

  /**
   * GESTIÓN DE ACCESO PRIVADO VS VISTA PORTAFOLIO (DEMO)
   */
  accionBotonSesion() {
    this.toggleSidebar(false);
    if (window.RanchoDB.sessionMode === 'REAL') {
      window.RanchoDB.cerrarSesionPrivada();
      this.mostrarToast('Sesión privada cerrada. Ahora se muestran solo los datos de demostración.');
    } else {
      const creando = !window.RanchoDB.tienePinConfigurado();
      document.getElementById('inputPinAcceso').value = '';
      document.getElementById('inputPinConfirmar').value = '';
      document.getElementById('inputRecordarSesion').checked = false;
      document.getElementById('grupoPinConfirmar').style.display = creando ? '' : 'none';
      document.getElementById('inputPinConfirmar').required = creando;
      document.getElementById('labelPinAcceso').textContent = creando
        ? 'Crea tu PIN de propietario (mínimo 4 caracteres) *'
        : 'Clave / PIN del rancho *';
      document.getElementById('inputPinAcceso').placeholder = creando
        ? 'Nuevo PIN'
        : 'Ingresa tu clave';
      document.getElementById('btnSubmitAcceso').textContent = creando
        ? 'Crear PIN y entrar'
        : 'Desbloquear rancho real';
      document.getElementById('modalAccesoPrivado').classList.add('open');
      setTimeout(() => {
        document.getElementById('inputPinAcceso').focus();
      }, 60);
    }
  },

  async confirmarAccesoPrivado(event) {
    event.preventDefault();
    const pin = document.getElementById('inputPinAcceso').value.trim();
    const recordar = document.getElementById('inputRecordarSesion').checked;
    const db = window.RanchoDB;
    let pinDebil = false;

    try {
      if (!db.tienePinConfigurado()) {
        const confirmacion = document.getElementById('inputPinConfirmar').value.trim();
        if (pin.length < 4) {
          this.mostrarToast('El PIN debe tener al menos 4 caracteres.', 'error');
          return;
        }
        if (pin !== confirmacion) {
          this.mostrarToast('Los PIN no coinciden.', 'error');
          return;
        }
        await db.establecerPin(pin);
      } else {
        const res = await db.verificarPinPropietario(pin);
        if (!res.ok) {
          this.mostrarToast('Clave / PIN incorrecto. Se mantiene la vista de portafolio.', 'error');
          return;
        }
        pinDebil = !!res.pinDebil;
      }
    } catch (err) {
      this.mostrarToast(err.message || 'No se pudo verificar el PIN.', 'error');
      return;
    }

    db.saveAuthConfig({ rememberSession: recordar });
    db.activarModoReal();
    this.cerrarModal('modalAccesoPrivado');
    if (pinDebil) {
      this.mostrarToast(
        'Estás usando el PIN por defecto (1234). Cámbialo en "Nube & Dueños" para proteger tu rancho.',
        'error'
      );
    } else {
      this.mostrarToast('Acceso concedido al padrón privado del rancho.');
    }
  },

  /**
   * MODAL DE CONFIGURACIÓN DEL RANCHO Y NUBE
   */
  abrirModalConfiguracion() {
    this.toggleSidebar(false);
    if (window.RanchoDB.sessionMode !== 'REAL') {
      this.mostrarToast('Desbloquea primero el acceso privado para configurar propietarios y nube.');
      this.accionBotonSesion();
      return;
    }

    const { config } = window.RanchoDB.state;
    const cloud = window.RanchoDB.cloudConfig;

    document.getElementById('cfgNombreRancho').value = config.nombreRancho || '';
    this.renderListaFierrosConfig(window.RanchoDB.getFierros());
    document.getElementById('cfgEdadDestete').value = config.edadDesteteMeses || 7;
    document.getElementById('cfgPinAcceso').value = ''; // el PIN nunca se muestra

    document.getElementById('cfgCloudEnabled').checked = !!cloud.enabled;
    document.getElementById('cfgFirebaseProjectId').value = cloud.projectId || '';
    document.getElementById('cfgFirebaseApiKey').value = cloud.apiKey || '';
    document.getElementById('cfgRanchoCode').value = cloud.ranchoCode || 'RANCHO-FH-PRIVADO';

    document.getElementById('modalConfig').classList.add('open');
  },

  async guardarConfiguracion(event) {
    event.preventDefault();

    const nuevoPin = document.getElementById('cfgPinAcceso').value.trim();
    if (nuevoPin && nuevoPin.length < 4) {
      this.mostrarToast('El PIN debe tener al menos 4 caracteres.', 'error');
      return;
    }

    try {
      window.RanchoDB.guardarFierros(this.leerListaFierrosConfig());
    } catch (err) {
      this.mostrarToast(err.message, 'error');
      return;
    }

    if (nuevoPin) {
      try {
        await window.RanchoDB.establecerPin(nuevoPin);
      } catch (err) {
        this.mostrarToast(err.message || 'No se pudo guardar el PIN.', 'error');
        return;
      }
    }

    window.RanchoDB.state.config.nombreRancho =
      document.getElementById('cfgNombreRancho').value.trim() || 'Rancho Ganadero F & H';
    window.RanchoDB.state.config.edadDesteteMeses =
      parseInt(document.getElementById('cfgEdadDestete').value, 10) || 7;

    window.RanchoDB.saveCloudConfig({
      enabled: document.getElementById('cfgCloudEnabled').checked,
      projectId: document.getElementById('cfgFirebaseProjectId').value.trim(),
      apiKey: document.getElementById('cfgFirebaseApiKey').value.trim(),
      ranchoCode: document.getElementById('cfgRanchoCode').value.trim() || 'RANCHO-FH-PRIVADO'
    });

    window.RanchoDB.saveLocal();
    this.cerrarModal('modalConfig');
    this.mostrarToast(
      nuevoPin ? 'Configuración y PIN actualizados.' : 'Configuración privada actualizada.'
    );
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

  async sincronizarAhoraConNube() {
    if (!window.RanchoDB.cloudConfig.enabled) {
      this.abrirModalConfiguracion();
      return;
    }
    this.mostrarToast('Sincronizando con la nube...');
    await window.RanchoDB.pullFromCloud();
    const res = await window.RanchoDB.syncToCloud();
    if (res.ok) {
      this.mostrarToast('Sincronización en la nube completada.');
    } else {
      this.mostrarToast(
        'Datos guardados localmente. Verifica el Project ID de Firebase o tu conexión.',
        'error'
      );
    }
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
      db.state = limpio;
      db.saveLocal();
      this.cerrarModal('modalConfig');
      this.mostrarToast('Respaldo restaurado. Se descargó una copia de los datos anteriores.');
    };
    reader.onerror = () => {
      this.mostrarToast('No se pudo leer el archivo de respaldo.', 'error');
    };
    reader.readAsText(file);
  },

  vaciarDatosDeEjemplo() {
    if (
      !confirm(
        '¿Deseas eliminar los animales de ejemplo para capturar tu padrón real desde cero?'
      )
    ) {
      return;
    }
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
