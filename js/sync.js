/**
 * Motor de sincronización del dispositivo (funciones puras, sin red ni almacenamiento).
 *
 * - "base": la última versión de cada registro confirmada por el servidor.
 * - "estado": lo que el usuario ve y edita (puede tener cambios sin subir).
 * - Cambios pendientes = diferencia campo por campo entre estado y base.
 * Al recibir la respuesta del servidor, los cambios locales que aún no se subieron se
 * vuelven a aplicar encima ("rebase"), así no se pierde nada hecho sin señal.
 */
(function (global) {
  const CAMPOS_ANIMAL = [
    'fierro', 'numero', 'arete', 'aretesAnteriores', 'colorArete', 'estadoArete', 'sexo',
    'categoria', 'razaColor', 'fechaNacimiento', 'origen', 'pesoActual', 'madreId',
    'madreFierro', 'madreNumero', 'madreArete', 'estatus', 'fechaBaja', 'motivoBaja',
    'compradorDestino', 'guiaReemo', 'pesoVenta', 'precioVenta', 'notasBaja', 'notas'
  ];
  const CAMPOS_EVENTO = ['animalId', 'fecha', 'tipo', 'producto', 'dosis', 'pesoKg', 'proximaFecha', 'notas'];
  const CAMPOS_CONFIG = ['nombreRancho', 'edadDesteteMeses', 'fierros'];
  const LOTE_MAXIMO = 200;

  /** Valor comparable: '', null y undefined son iguales; 465 y "465" también. */
  function comparable(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return JSON.stringify(v.map(comparable));
    if (typeof v === 'object') return JSON.stringify(ordenarClaves(v));
    if (typeof v === 'number') return String(v);
    const s = String(v).trim();
    return s !== '' && !Number.isNaN(Number(s)) && /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s;
  }

  function ordenarClaves(o) {
    const r = {};
    Object.keys(o).sort().forEach((k) => {
      r[k] = o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? ordenarClaves(o[k]) : o[k];
    });
    return r;
  }

  function huella(registro, campos) {
    if (!registro) return '∅';
    return campos.map((c) => comparable(registro[c])).join('|');
  }

  /** Campos de "despues" que difieren de "antes". */
  function diferencias(antes, despues, campos) {
    const cambios = {};
    campos.forEach((c) => {
      if (comparable(antes ? antes[c] : undefined) !== comparable(despues ? despues[c] : undefined)) {
        cambios[c] = despues ? (despues[c] === undefined ? '' : despues[c]) : '';
      }
    });
    return cambios;
  }

  const claveDe = (entidad, id) => (entidad === 'config' ? 'config' : `${entidad}:${id}`);

  const porId = (lista) => {
    const m = new Map();
    (lista || []).forEach((r) => r && r.id && m.set(r.id, r));
    return m;
  };

  /** Base vacía para un rancho recién conectado. */
  function baseVacia() {
    return { config: null, animales: {}, eventos: {} };
  }

  /**
   * Calcula las operaciones pendientes (estado vs base).
   * Omite los registros rechazados que no se han vuelto a editar.
   */
  function calcularOps(estado, base, rechazos = {}) {
    const ops = [];
    const omitir = (clave, registro, campos) =>
      rechazos[clave] && rechazos[clave].huella === huella(registro, campos);

    // Configuración del rancho
    const cambiosCfg = diferencias(base.config, estado.config, CAMPOS_CONFIG);
    if (Object.keys(cambiosCfg).length && !omitir('config', estado.config, CAMPOS_CONFIG)) {
      ops.push({ opId: 'config', entidad: 'config', id: 'rancho', cambios: cambiosCfg });
    }

    const recorrer = (entidad, lista, baseMapa, campos) => {
      const actuales = porId(lista);
      actuales.forEach((reg, id) => {
        const clave = `${entidad}:${id}`;
        const previo = baseMapa[id];
        const cambios = previo ? diferencias(previo, reg, campos) : diferencias(null, reg, campos);
        if (Object.keys(cambios).length && !omitir(clave, reg, campos)) {
          ops.push({ opId: clave, entidad, id, cambios, nuevo: !previo });
        }
      });
      Object.keys(baseMapa).forEach((id) => {
        if (!actuales.has(id)) ops.push({ opId: `${entidad}:${id}`, entidad, id, eliminado: true });
      });
    };
    recorrer('animal', estado.animales, base.animales, CAMPOS_ANIMAL);
    recorrer('evento', estado.eventosSanitarios, base.eventos, CAMPOS_EVENTO);
    return ops;
  }

  /**
   * Aplica la respuesta del servidor.
   * @param estadoActual  estado del dispositivo en este momento (pudo cambiar durante la petición)
   * @param baseAnterior  base antes de la petición
   * @param enviado       { ops, foto } las operaciones enviadas y una copia de los registros enviados
   * @param respuesta     { cursor, completo, config, animales, eventosSanitarios, rechazos }
   * @returns { estado, base, cursor, rechazos }
   */
  function aplicarRespuesta(estadoActual, baseAnterior, enviado, respuesta, rechazosPrevios = {}) {
    const base = {
      config: baseAnterior.config,
      animales: respuesta.completo ? {} : { ...baseAnterior.animales },
      eventos: respuesta.completo ? {} : { ...baseAnterior.eventos }
    };
    const foto = (enviado && enviado.foto) || {};
    const rechazadas = new Set((respuesta.rechazos || []).map((r) => claveDe(r.entidad, r.id)));

    // Referencia para saber qué cambió el usuario y aún no está en el servidor:
    // si el registro se envió (y no fue rechazado), la referencia es la foto enviada;
    // si no, la base anterior.
    const referencia = (clave, entidad, id) => {
      if (Object.prototype.hasOwnProperty.call(foto, clave) && !rechazadas.has(clave)) return foto[clave];
      return entidad === 'animal' ? baseAnterior.animales[id] : entidad === 'evento' ? baseAnterior.eventos[id] : baseAnterior.config;
    };

    // --- configuración
    let config = estadoActual.config;
    if (respuesta.config) {
      base.config = { ...respuesta.config };
      const ref = referencia('config', 'config');
      const locales = diferencias(ref, estadoActual.config, CAMPOS_CONFIG);
      config = { ...estadoActual.config, ...respuesta.config, ...locales };
    }

    // --- animales y eventos
    const fusionar = (entidad, listaActual, recibidos, mapaBase, campos) => {
      const actuales = porId(listaActual);
      const resultado = new Map(actuales);

      (recibidos || []).forEach((srv) => {
        const clave = `${entidad}:${srv.id}`;
        const local = actuales.get(srv.id);
        if (srv.eliminado) {
          delete mapaBase[srv.id];
          resultado.delete(srv.id);
          return;
        }
        const limpio = { ...srv };
        delete limpio.eliminado;
        mapaBase[srv.id] = limpio;
        const ref = referencia(clave, entidad, srv.id);
        const locales = local ? diferencias(ref, local, campos) : {};
        if (!local && ref) {
          // El usuario lo borró localmente y aún no se sube: respetar el borrado
          resultado.delete(srv.id);
          return;
        }
        resultado.set(srv.id, { ...(local || {}), ...limpio, ...locales });
      });

      if (respuesta.completo) {
        // Carga completa: lo que el servidor ya no tiene y no es una creación local, se quita
        const enServidor = new Set((recibidos || []).map((r) => r.id));
        actuales.forEach((reg, id) => {
          const eraDelServidor = baseAnterior[entidad === 'animal' ? 'animales' : 'eventos'][id];
          if (!enServidor.has(id) && eraDelServidor) resultado.delete(id);
        });
      }
      return [...resultado.values()];
    };

    const animales = fusionar('animal', estadoActual.animales, respuesta.animales, base.animales, CAMPOS_ANIMAL);
    const eventosSanitarios = fusionar('evento', estadoActual.eventosSanitarios, respuesta.eventosSanitarios, base.eventos, CAMPOS_EVENTO);
    const estado = { ...estadoActual, config, animales, eventosSanitarios };

    // --- rechazos: se recuerdan con la huella del registro para no reintentar sin cambios
    const rechazos = { ...rechazosPrevios };
    (enviado && enviado.ops ? enviado.ops : []).forEach((op) => {
      if (!rechazadas.has(claveDe(op.entidad, op.id))) delete rechazos[claveDe(op.entidad, op.id)];
    });
    (respuesta.rechazos || []).forEach((r) => {
      const clave = claveDe(r.entidad, r.id);
      const lista = r.entidad === 'animal' ? animales : r.entidad === 'evento' ? eventosSanitarios : null;
      const registro = r.entidad === 'config' ? config : lista && lista.find((x) => x.id === r.id);
      const campos = r.entidad === 'animal' ? CAMPOS_ANIMAL : r.entidad === 'evento' ? CAMPOS_EVENTO : CAMPOS_CONFIG;
      rechazos[clave] = { motivo: r.motivo, codigo: r.codigo, huella: huella(registro, campos), entidad: r.entidad, id: r.id };
    });

    return { estado, base, cursor: respuesta.cursor, rechazos };
  }

  /** Copia de los registros que se van a enviar (para detectar ediciones durante la petición). */
  function fotoDe(estado, ops) {
    const foto = {};
    const animales = porId(estado.animales);
    const eventos = porId(estado.eventosSanitarios);
    ops.forEach((op) => {
      if (op.eliminado) return;
      if (op.entidad === 'config') foto.config = JSON.parse(JSON.stringify(estado.config));
      else if (op.entidad === 'animal') foto[`animal:${op.id}`] = JSON.parse(JSON.stringify(animales.get(op.id)));
      else if (op.entidad === 'evento') foto[`evento:${op.id}`] = JSON.parse(JSON.stringify(eventos.get(op.id)));
    });
    return foto;
  }

  /** Descarta un cambio rechazado: el registro vuelve a la versión del servidor. */
  function descartarCambio(estado, base, clave) {
    const [entidad, id] = clave.split(':');
    if (entidad === 'config') return { ...estado, config: { ...estado.config, ...base.config } };
    const lista = entidad === 'animal' ? 'animales' : 'eventosSanitarios';
    const mapa = entidad === 'animal' ? base.animales : base.eventos;
    const sinEste = estado[lista].filter((r) => r.id !== id);
    return { ...estado, [lista]: mapa[id] ? [{ ...mapa[id] }, ...sinEste] : sinEste };
  }

  const api = {
    CAMPOS_ANIMAL, CAMPOS_EVENTO, CAMPOS_CONFIG, LOTE_MAXIMO,
    comparable, diferencias, huella, baseVacia, calcularOps, aplicarRespuesta, fotoDe, descartarCambio
  };
  global.RanchoSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
