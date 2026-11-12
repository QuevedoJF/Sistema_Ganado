/**
 * Sincronización entre dispositivos y la base de datos.
 *
 * El dispositivo envía operaciones { entidad, id, cambios, eliminado } con SOLO los campos que
 * cambió. El servidor los aplica encima del registro actual (gana el último cambio por campo, no
 * por registro completo), valida las reglas del rancho y devuelve todo lo que cambió desde el
 * cursor del dispositivo. Las operaciones que violan una regla (número o arete duplicado, etc.)
 * se rechazan una por una con un motivo legible, sin detener a las demás.
 */
import {
  esquemaAnimal,
  esquemaEvento,
  esquemaConfig,
  CAMPOS_ANIMAL,
  CAMPOS_EVENTO,
  columnasSelect,
  filaACliente,
  normalizarNumero,
  normalizarArete,
  mensajeZod
} from './modelo.js';
import { ErrorApi, datosInvalidos, prohibido, traducirErrorPg } from './errores.js';

const MAX_OPS = 500;
// Ventana de seguridad: también se reenvían cambios recientes por si una transacción
// concurrente tomó un número de secuencia menor y confirmó después.
const VENTANA_SEGURIDAD = "interval '2 minutes'";

export async function sincronizar(db, usuario, ranchoId, rol, cuerpo) {
  const cursor = Math.max(0, parseInt(cuerpo && cuerpo.cursor, 10) || 0);
  const ops = Array.isArray(cuerpo && cuerpo.ops) ? cuerpo.ops : [];
  if (ops.length > MAX_OPS) {
    throw datosInvalidos(`Demasiados cambios en una sola petición (máximo ${MAX_OPS}).`);
  }

  const aplicadas = [];
  const rechazos = [];

  // Orden seguro: configuración (fierros) → animales → eventos
  const prioridad = { config: 0, animal: 1, evento: 2 };
  const ordenadas = [...ops].sort((a, b) => (prioridad[a && a.entidad] ?? 9) - (prioridad[b && b.entidad] ?? 9));

  for (const op of ordenadas) {
    try {
      await db.tx((t) => aplicarOperacion(t, usuario, ranchoId, rol, op));
      aplicadas.push(op.opId || null);
    } catch (err) {
      const traducido = err instanceof ErrorApi ? err : traducirErrorPg(err, contextoDe(op));
      if (!traducido || traducido.status >= 500) throw err;
      rechazos.push({
        opId: op && op.opId ? String(op.opId).slice(0, 80) : null,
        entidad: op && op.entidad,
        id: op && op.id,
        codigo: traducido.codigo,
        motivo: traducido.message
      });
    }
  }

  const cambios = await leerCambios(db, ranchoId, cursor);
  return { ...cambios, aplicadas: aplicadas.length, rechazos, rol };
}

function contextoDe(op) {
  const c = (op && op.cambios) || {};
  return { numero: c.numero, fierro: c.fierro };
}

async function aplicarOperacion(t, usuario, ranchoId, rol, op) {
  if (!op || typeof op !== 'object') throw datosInvalidos('Operación inválida.');
  if (rol === 'lector') throw prohibido('Tu cuenta es de solo lectura en este rancho.');
  const cambios = op.cambios && typeof op.cambios === 'object' && !Array.isArray(op.cambios) ? op.cambios : {};

  if (op.entidad === 'config') {
    if (rol !== 'admin') throw prohibido('Solo un administrador puede cambiar los dueños, fierros o datos del rancho.');
    return aplicarConfig(t, usuario, ranchoId, cambios);
  }
  if (op.entidad === 'animal') return aplicarAnimal(t, usuario, ranchoId, op, cambios);
  if (op.entidad === 'evento') return aplicarEvento(t, usuario, ranchoId, op, cambios);
  throw datosInvalidos('Tipo de registro desconocido.');
}

async function auditar(t, ranchoId, usuarioId, entidad, entidadId, accion, cambios) {
  await t.query(
    `INSERT INTO auditoria (rancho_id, usuario_id, entidad, entidad_id, accion, cambios)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ranchoId, usuarioId, entidad, String(entidadId), accion, cambios ? JSON.stringify(cambios) : null]
  );
}

/* ---------------------------------------------------------------- configuración y fierros */
async function aplicarConfig(t, usuario, ranchoId, cambios) {
  const r = esquemaConfig.safeParse(cambios);
  if (!r.success) throw datosInvalidos(mensajeZod(r.error));
  const cfg = r.data;

  if (cfg.fierros) {
    const codigos = cfg.fierros.map((f) => f.codigo);
    if (new Set(codigos).size !== codigos.length) {
      throw datosInvalidos('Hay códigos de fierro repetidos.');
    }
    // ¿Se quiere quitar un fierro que todavía tiene animales (aunque estén eliminados)?
    const enUso = await t.query(
      `SELECT DISTINCT fierro FROM animales
        WHERE rancho_id = $1 AND NOT (fierro = ANY($2::text[]))`,
      [ranchoId, codigos]
    );
    if (enUso.rows.length) {
      throw new ErrorApi(
        409,
        'FIERRO_EN_USO',
        `No se puede quitar el Fierro ${enUso.rows.map((x) => x.fierro).join(', ')}: todavía tiene animales registrados.`
      );
    }
    for (const [i, f] of cfg.fierros.entries()) {
      await t.query(
        `INSERT INTO fierros (rancho_id, codigo, propietario, tono, orden)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (rancho_id, codigo)
         DO UPDATE SET propietario = EXCLUDED.propietario, tono = EXCLUDED.tono, orden = EXCLUDED.orden`,
        [ranchoId, f.codigo, f.propietario, f.tono, i]
      );
    }
    await t.query(`DELETE FROM fierros WHERE rancho_id = $1 AND NOT (codigo = ANY($2::text[]))`, [
      ranchoId,
      codigos
    ]);
  }

  await t.query(
    `UPDATE ranchos SET
       nombre = COALESCE($2, nombre),
       edad_destete_meses = COALESCE($3, edad_destete_meses),
       version = version + 1,
       seq = nextval('cambios_seq'),
       actualizado = now()
     WHERE id = $1`,
    [ranchoId, cfg.nombreRancho ?? null, cfg.edadDesteteMeses ?? null]
  );
  await auditar(t, ranchoId, usuario.id, 'config', ranchoId, 'actualizado', cfg);
}

/* ---------------------------------------------------------------- animales */
async function leerAnimal(t, ranchoId, id) {
  const { rows } = await t.query(
    `SELECT id, ${columnasSelect(CAMPOS_ANIMAL)}, eliminado, version
       FROM animales WHERE rancho_id = $1 AND id = $2 FOR UPDATE`,
    [ranchoId, id]
  );
  return rows[0] ? filaACliente(rows[0], CAMPOS_ANIMAL) : null;
}

async function aplicarAnimal(t, usuario, ranchoId, op, cambios) {
  const id = String(op.id || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw datosInvalidos('Identificador de animal inválido.');
  const actual = await leerAnimal(t, ranchoId, id);

  if (op.eliminado) {
    if (!actual || actual.eliminado) return; // ya no existe: nada que hacer
    await t.query(
      `UPDATE animales SET eliminado = true, version = version + 1, seq = nextval('cambios_seq'),
              actualizado = now(), actualizado_por = $3
        WHERE rancho_id = $1 AND id = $2`,
      [ranchoId, id, usuario.id]
    );
    // Libera sus aretes para que puedan usarse en otro animal
    await t.query('DELETE FROM aretes WHERE rancho_id = $1 AND animal_id = $2', [ranchoId, id]);
    await auditar(t, ranchoId, usuario.id, 'animal', id, 'eliminado', null);
    return;
  }

  // Combinar: registro actual + solo los campos que cambió el dispositivo
  const base = actual && !actual.eliminado ? actual : { estatus: 'Activo', aretesAnteriores: [] };
  const permitido = {};
  for (const campo of Object.keys(CAMPOS_ANIMAL)) {
    if (Object.prototype.hasOwnProperty.call(cambios, campo)) permitido[campo] = cambios[campo];
  }
  const combinado = { ...base, ...permitido, id };
  if (typeof combinado.fierro === 'string') combinado.fierro = combinado.fierro.toUpperCase();

  const r = esquemaAnimal.safeParse(combinado);
  if (!r.success) throw datosInvalidos(mensajeZod(r.error));
  const a = r.data;

  const columnas = Object.values(CAMPOS_ANIMAL);
  const valores = Object.keys(CAMPOS_ANIMAL).map((campo) => a[campo]);
  const params = [ranchoId, id, normalizarNumero(a.numero), usuario.id, ...valores];
  const marcadores = columnas.map((_, i) => `$${i + 5}`).join(', ');
  const asignaciones = columnas.map((c) => `${c} = EXCLUDED.${c}`).join(', ');

  try {
    await t.query(
      `INSERT INTO animales (rancho_id, id, numero_norm, actualizado_por, ${columnas.join(', ')})
       VALUES ($1, $2, $3, $4, ${marcadores})
       ON CONFLICT (rancho_id, id) DO UPDATE SET
         ${asignaciones},
         numero_norm = EXCLUDED.numero_norm,
         actualizado_por = EXCLUDED.actualizado_por,
         eliminado = false,
         version = animales.version + 1,
         seq = nextval('cambios_seq'),
         actualizado = now()`,
      params
    );
  } catch (err) {
    throw traducirErrorPg(err, { numero: a.numero, fierro: a.fierro }) || err;
  }

  // Registrar cada arete (actual y anteriores): no puede pertenecer a otro animal del rancho
  const aretes = [a.arete, ...a.aretesAnteriores].map(normalizarArete).filter(Boolean);
  for (const arete of new Set(aretes)) {
    await t.query(
      `INSERT INTO aretes (rancho_id, arete_norm, animal_id) VALUES ($1, $2, $3)
       ON CONFLICT (rancho_id, arete_norm) DO NOTHING`,
      [ranchoId, arete, id]
    );
    const dueno = await t.query(
      `SELECT a.animal_id, x.fierro, x.numero, x.estatus
         FROM aretes a JOIN animales x ON x.rancho_id = a.rancho_id AND x.id = a.animal_id
        WHERE a.rancho_id = $1 AND a.arete_norm = $2`,
      [ranchoId, arete]
    );
    const d = dueno.rows[0];
    if (d && d.animal_id !== id) {
      throw new ErrorApi(
        409,
        'ARETE_DUPLICADO',
        `El arete ${arete} ya está registrado en el Fierro ${d.fierro} #${d.numero} (${d.estatus}).`
      );
    }
  }

  await auditar(t, ranchoId, usuario.id, 'animal', id, actual && !actual.eliminado ? 'actualizado' : 'creado', permitido);
}

/* ---------------------------------------------------------------- eventos sanitarios */
async function aplicarEvento(t, usuario, ranchoId, op, cambios) {
  const id = String(op.id || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw datosInvalidos('Identificador de evento inválido.');
  const { rows } = await t.query(
    `SELECT id, ${columnasSelect(CAMPOS_EVENTO)}, eliminado, version
       FROM eventos_sanitarios WHERE rancho_id = $1 AND id = $2 FOR UPDATE`,
    [ranchoId, id]
  );
  const actual = rows[0] ? filaACliente(rows[0], CAMPOS_EVENTO) : null;

  if (op.eliminado) {
    if (!actual || actual.eliminado) return;
    await t.query(
      `UPDATE eventos_sanitarios SET eliminado = true, version = version + 1,
              seq = nextval('cambios_seq'), actualizado = now(), actualizado_por = $3
        WHERE rancho_id = $1 AND id = $2`,
      [ranchoId, id, usuario.id]
    );
    await auditar(t, ranchoId, usuario.id, 'evento', id, 'eliminado', null);
    return;
  }

  const permitido = {};
  for (const campo of Object.keys(CAMPOS_EVENTO)) {
    if (Object.prototype.hasOwnProperty.call(cambios, campo)) permitido[campo] = cambios[campo];
  }
  const r = esquemaEvento.safeParse({ ...(actual && !actual.eliminado ? actual : {}), ...permitido, id });
  if (!r.success) throw datosInvalidos(mensajeZod(r.error));
  const e = r.data;

  // El animal debe existir y no estar eliminado
  const anm = await t.query('SELECT eliminado FROM animales WHERE rancho_id = $1 AND id = $2', [ranchoId, e.animalId]);
  if (!anm.rows.length || anm.rows[0].eliminado) {
    throw new ErrorApi(409, 'ANIMAL_INEXISTENTE', 'El animal de este manejo sanitario ya no existe.');
  }

  const columnas = Object.values(CAMPOS_EVENTO);
  const valores = Object.keys(CAMPOS_EVENTO).map((campo) => e[campo]);
  await t.query(
    `INSERT INTO eventos_sanitarios (rancho_id, id, actualizado_por, ${columnas.join(', ')})
     VALUES ($1, $2, $3, ${columnas.map((_, i) => `$${i + 4}`).join(', ')})
     ON CONFLICT (rancho_id, id) DO UPDATE SET
       ${columnas.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
       actualizado_por = EXCLUDED.actualizado_por,
       eliminado = false,
       version = eventos_sanitarios.version + 1,
       seq = nextval('cambios_seq'),
       actualizado = now()`,
    [ranchoId, id, usuario.id, ...valores]
  );
  await auditar(t, ranchoId, usuario.id, 'evento', id, actual ? 'actualizado' : 'creado', permitido);
}

/* ---------------------------------------------------------------- lectura de cambios */
export async function leerCambios(db, ranchoId, cursor) {
  const inicial = cursor === 0;

  const rancho = await db.query(
    `SELECT nombre, edad_destete_meses, version, seq FROM ranchos WHERE id = $1`,
    [ranchoId]
  );
  const r = rancho.rows[0];
  let config = null;
  if (r && (inicial || Number(r.seq) > cursor)) {
    const fierros = await db.query(
      `SELECT codigo, propietario, tono FROM fierros WHERE rancho_id = $1 ORDER BY orden, codigo`,
      [ranchoId]
    );
    config = {
      nombreRancho: r.nombre,
      edadDesteteMeses: Number(r.edad_destete_meses),
      fierros: fierros.rows.map((f) => ({ codigo: f.codigo, propietario: f.propietario, tono: Number(f.tono) })),
      version: Number(r.version)
    };
  }

  const filtro = inicial
    ? 'rancho_id = $1 AND NOT eliminado'
    : `rancho_id = $1 AND (seq > $2 OR actualizado > now() - ${VENTANA_SEGURIDAD})`;
  const params = inicial ? [ranchoId] : [ranchoId, cursor];

  const animales = await db.query(
    `SELECT id, ${columnasSelect(CAMPOS_ANIMAL)}, eliminado, version, seq FROM animales WHERE ${filtro}`,
    params
  );
  const eventos = await db.query(
    `SELECT id, ${columnasSelect(CAMPOS_EVENTO)}, eliminado, version, seq FROM eventos_sanitarios WHERE ${filtro}`,
    params
  );

  const maxima = Math.max(
    cursor,
    r ? Number(r.seq) : 0,
    ...animales.rows.map((x) => Number(x.seq)),
    ...eventos.rows.map((x) => Number(x.seq))
  );

  return {
    cursor: maxima,
    completo: inicial,
    config,
    animales: animales.rows.map((f) => filaACliente(f, CAMPOS_ANIMAL)),
    eventosSanitarios: eventos.rows.map((f) => filaACliente(f, CAMPOS_EVENTO))
  };
}
