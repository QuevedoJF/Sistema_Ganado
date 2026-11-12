/**
 * Enrutador de la API. Una sola función de Vercel atiende todas las rutas /api/*.
 */
import crypto from 'node:crypto';
import { obtenerDb } from './db.js';
import { asegurarMigraciones } from './migraciones.js';
import { ErrorApi, datosInvalidos, prohibido, traducirErrorPg } from './errores.js';
import {
  cifrarContrasena,
  verificarContrasena,
  validarContrasenaNueva,
  normalizarEmail,
  crearSesion,
  cerrarSesion,
  exigirUsuario,
  usuarioDeSesion,
  exigirRol,
  revisarLimiteIntentos,
  registrarIntento,
  revisarOrigen,
  ipDe,
  LARGO_MAXIMO_CONTRASENA
} from './auth.js';
import { sincronizar } from './sincronizar.js';

const LIMITE_CUERPO = 4 * 1024 * 1024;

const rutas = [
  ['GET', /^\/api\/estado$/, estado],
  ['POST', /^\/api\/configuracion-inicial$/, configuracionInicial],
  ['POST', /^\/api\/auth\/entrar$/, entrar],
  ['POST', /^\/api\/auth\/salir$/, salir],
  ['GET', /^\/api\/auth\/yo$/, yo],
  ['POST', /^\/api\/auth\/contrasena$/, cambiarContrasena],
  ['GET', /^\/api\/ranchos\/([^/]+)\/miembros$/, listarMiembros],
  ['POST', /^\/api\/ranchos\/([^/]+)\/miembros$/, agregarMiembro],
  ['PATCH', /^\/api\/ranchos\/([^/]+)\/miembros\/([^/]+)$/, cambiarRolMiembro],
  ['DELETE', /^\/api\/ranchos\/([^/]+)\/miembros\/([^/]+)$/, quitarMiembro],
  ['POST', /^\/api\/ranchos\/([^/]+)\/miembros\/([^/]+)\/contrasena$/, restablecerContrasena],
  ['POST', /^\/api\/ranchos\/([^/]+)\/sync$/, sincronizarRancho],
  ['GET', /^\/api\/ranchos\/([^/]+)\/auditoria$/, auditoria]
];

/** Punto de entrada común (Vercel y servidor local). */
export async function manejar(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(req.url, 'http://local');
    // En Vercel, vercel.json reescribe /api/* hacia /api?__ruta=*
    const ruta = url.searchParams.get('__ruta') !== null
      ? '/api/' + url.searchParams.get('__ruta').replace(/^\/+/, '')
      : url.pathname.replace(/\/+$/, '');
    const coincidencia = rutas.find(([m, re]) => m === req.method && re.test(ruta));
    if (!coincidencia) {
      const existe = rutas.some(([, re]) => re.test(ruta));
      throw new ErrorApi(existe ? 405 : 404, existe ? 'METODO_NO_PERMITIDO' : 'NO_ENCONTRADO', 'Ruta no encontrada.');
    }
    revisarOrigen(req);
    const db = obtenerDb();
    await asegurarMigraciones(db);
    let params;
    try {
      params = ruta.match(coincidencia[1]).slice(1).map(decodeURIComponent);
    } catch {
      throw datosInvalidos('La dirección de la petición no es válida.');
    }
    const cuerpo = req.method === 'GET' ? {} : await leerCuerpo(req);
    const ctx = { req, res, db, params, cuerpo, query: url.searchParams };
    const resultado = await coincidencia[2](ctx);
    enviar(res, ctx.status || 200, resultado ?? { ok: true });
  } catch (err) {
    const e = err instanceof ErrorApi ? err : traducirErrorPg(err);
    if (e) {
      enviar(res, e.status, { error: e.codigo, mensaje: e.message, ...e.extra });
    } else {
      console.error('Error interno de la API:', err);
      enviar(res, 500, { error: 'ERROR_INTERNO', mensaje: 'Ocurrió un error en el servidor. Intenta de nuevo.' });
    }
  }
}

function enviar(res, status, datos) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(datos));
}

async function leerCuerpo(req) {
  // En Vercel, leer req.body lanza un error si el JSON viene mal formado
  let yaLeido;
  try {
    yaLeido = req.body;
  } catch {
    throw datosInvalidos('El cuerpo de la petición no es JSON válido.');
  }
  if (yaLeido !== undefined && yaLeido !== null) {
    req = { body: yaLeido };
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    return parsear(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body));
  }
  const trozos = [];
  let total = 0;
  for await (const trozo of req) {
    total += trozo.length;
    if (total > LIMITE_CUERPO) throw new ErrorApi(413, 'DEMASIADO_GRANDE', 'Los datos enviados son demasiado grandes.');
    trozos.push(trozo);
  }
  return parsear(Buffer.concat(trozos).toString('utf8'));
}

function parsear(texto) {
  if (!texto) return {};
  try {
    const v = JSON.parse(texto);
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw datosInvalidos('El cuerpo de la petición no es JSON válido.');
  }
}

/* ---------------------------------------------------------------- estado y configuración inicial */
async function estado({ db }) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM usuarios');
  return { ok: true, necesitaConfiguracion: rows[0].n === 0 };
}

async function ranchosDe(db, usuarioId) {
  const { rows } = await db.query(
    `SELECT r.id, r.nombre, m.rol FROM miembros m JOIN ranchos r ON r.id = m.rancho_id
      WHERE m.usuario_id = $1 ORDER BY r.creado`,
    [usuarioId]
  );
  return rows;
}

/**
 * Crea la primera cuenta (administrador) y el rancho. Solo funciona si no hay usuarios
 * y si se conoce el SETUP_TOKEN configurado en las variables de entorno de Vercel.
 */
async function configuracionInicial(ctx) {
  const { db, cuerpo, res } = ctx;
  const esperado = process.env.SETUP_TOKEN || '';
  const dado = String(cuerpo.token || '');
  if (
    esperado.length < 8 ||
    dado.length !== esperado.length ||
    !crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(esperado))
  ) {
    throw prohibido('El código de configuración no es correcto.');
  }
  const email = normalizarEmail(cuerpo.email);
  validarContrasenaNueva(cuerpo.password);
  const nombre = String(cuerpo.nombre || '').trim().slice(0, 80) || email;
  const nombreRancho = String(cuerpo.nombreRancho || '').trim().slice(0, 120) || 'Mi rancho';
  const hash = await cifrarContrasena(cuerpo.password);

  const resultado = await db.tx(async (t) => {
    await t.query('SELECT pg_advisory_xact_lock(727275)');
    const n = await t.query('SELECT count(*)::int AS n FROM usuarios');
    if (n.rows[0].n > 0) throw prohibido('El sistema ya fue configurado. Inicia sesión.');
    const u = await t.query(
      'INSERT INTO usuarios (email, nombre, password_hash) VALUES ($1, $2, $3) RETURNING id, email, nombre',
      [email, nombre, hash]
    );
    const r = await t.query('INSERT INTO ranchos (nombre) VALUES ($1) RETURNING id, nombre', [nombreRancho]);
    await t.query(`INSERT INTO miembros (rancho_id, usuario_id, rol) VALUES ($1, $2, 'admin')`, [r.rows[0].id, u.rows[0].id]);
    await t.query(
      `INSERT INTO fierros (rancho_id, codigo, propietario, tono, orden) VALUES
         ($1, 'F', 'Propietario Fierro F', 0, 0), ($1, 'H', 'Propietario Fierro H', 1, 1)`,
      [r.rows[0].id]
    );
    return u.rows[0];
  });

  res.setHeader('Set-Cookie', await crearSesion(db, resultado.id));
  ctx.status = 201;
  return { usuario: resultado, ranchos: await ranchosDe(db, resultado.id) };
}

/* ---------------------------------------------------------------- sesión */
async function entrar({ db, cuerpo, req, res }) {
  const email = normalizarEmail(cuerpo.email);
  const ip = ipDe(req);
  await revisarLimiteIntentos(db, email, ip);
  if (String(cuerpo.password || '').length > LARGO_MAXIMO_CONTRASENA) {
    await registrarIntento(db, email, ip, false);
    throw new ErrorApi(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos.');
  }
  const { rows } = await db.query(
    'SELECT id, email, nombre, password_hash, activo, debe_cambiar_contrasena FROM usuarios WHERE email = $1',
    [email]
  );
  const u = rows[0];
  // Si el usuario no existe se verifica contra un hash falso para no revelar qué correos existen
  const valido = u
    ? await verificarContrasena(String(cuerpo.password || ''), u.password_hash)
    : (await verificarContrasena('x', await obtenerHashFalso()), false);
  if (!u || !valido || !u.activo) {
    await registrarIntento(db, email, ip, false);
    throw new ErrorApi(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos.');
  }
  await registrarIntento(db, email, ip, true);
  res.setHeader('Set-Cookie', await crearSesion(db, u.id));
  return {
    usuario: { id: u.id, email: u.email, nombre: u.nombre, debeCambiarContrasena: u.debe_cambiar_contrasena },
    ranchos: await ranchosDe(db, u.id)
  };
}

// Hash con los mismos parámetros que uno real: así el tiempo de respuesta no revela si el correo existe
let hashFalso = null;
async function obtenerHashFalso() {
  if (!hashFalso) hashFalso = await cifrarContrasena(crypto.randomUUID());
  return hashFalso;
}

async function salir({ db, req, res }) {
  res.setHeader('Set-Cookie', await cerrarSesion(db, req));
  return { ok: true };
}

async function yo({ db, req }) {
  const usuario = await usuarioDeSesion(db, req);
  if (!usuario) return { usuario: null, ranchos: [] };
  const { token, ...publico } = usuario;
  const extra = await db.query('SELECT debe_cambiar_contrasena FROM usuarios WHERE id = $1', [usuario.id]);
  return {
    usuario: { ...publico, debeCambiarContrasena: !!(extra.rows[0] && extra.rows[0].debe_cambiar_contrasena) },
    ranchos: await ranchosDe(db, usuario.id)
  };
}

async function cambiarContrasena({ db, req, cuerpo, res }) {
  const usuario = await exigirUsuario(db, req);
  const { rows } = await db.query('SELECT password_hash FROM usuarios WHERE id = $1', [usuario.id]);
  if (!(await verificarContrasena(String(cuerpo.actual || ''), rows[0].password_hash))) {
    throw new ErrorApi(400, 'CONTRASENA_INCORRECTA', 'La contraseña actual no es correcta.');
  }
  validarContrasenaNueva(cuerpo.nueva);
  if (String(cuerpo.nueva) === String(cuerpo.actual)) {
    throw new ErrorApi(400, 'CONTRASENA_REPETIDA', 'La contraseña nueva debe ser distinta de la actual.');
  }
  await db.query('UPDATE usuarios SET password_hash = $2, debe_cambiar_contrasena = false WHERE id = $1', [
    usuario.id,
    await cifrarContrasena(cuerpo.nueva)
  ]);
  // Cerrar las demás sesiones (otros dispositivos) y abrir una nueva aquí
  await db.query('DELETE FROM sesiones WHERE usuario_id = $1', [usuario.id]);
  res.setHeader('Set-Cookie', await crearSesion(db, usuario.id));
  return { ok: true };
}

/* ---------------------------------------------------------------- miembros del rancho */
async function listarMiembros({ db, req, params }) {
  const usuario = await exigirUsuario(db, req);
  await exigirRol(db, usuario.id, params[0], ['admin']);
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.nombre, m.rol, m.creado FROM miembros m JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.rancho_id = $1 ORDER BY m.creado`,
    [params[0]]
  );
  return { miembros: rows };
}

const ROLES = ['admin', 'editor', 'lector'];

async function agregarMiembro(ctx) {
  const { db, req, params, cuerpo } = ctx;
  const usuario = await exigirUsuario(db, req);
  await exigirRol(db, usuario.id, params[0], ['admin']);
  const email = normalizarEmail(cuerpo.email);
  const rol = ROLES.includes(cuerpo.rol) ? cuerpo.rol : 'editor';

  const existente = await db.query('SELECT id FROM usuarios WHERE email = $1', [email]);
  let usuarioId;
  if (existente.rows.length) {
    usuarioId = existente.rows[0].id;
  } else {
    validarContrasenaNueva(cuerpo.password);
    const nombre = String(cuerpo.nombre || '').trim().slice(0, 80) || email;
    const nuevo = await db.query(
      'INSERT INTO usuarios (email, nombre, password_hash, debe_cambiar_contrasena) VALUES ($1, $2, $3, true) RETURNING id',
      [email, nombre, await cifrarContrasena(cuerpo.password)]
    );
    usuarioId = nuevo.rows[0].id;
  }
  const ins = await db.query(
    `INSERT INTO miembros (rancho_id, usuario_id, rol) VALUES ($1, $2, $3)
     ON CONFLICT (rancho_id, usuario_id) DO NOTHING RETURNING usuario_id`,
    [params[0], usuarioId, rol]
  );
  if (!ins.rows.length) throw new ErrorApi(409, 'YA_ES_MIEMBRO', 'Esa cuenta ya tiene acceso a este rancho.');
  await auditarMiembro(db, params[0], usuario.id, usuarioId, 'acceso concedido', { email, rol });
  ctx.status = 201;
  return { ok: true, usuarioId, cuentaNueva: !existente.rows.length };
}

async function contarAdmins(db, ranchoId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM miembros WHERE rancho_id = $1 AND rol = 'admin'`,
    [ranchoId]
  );
  return rows[0].n;
}

async function cambiarRolMiembro({ db, req, params, cuerpo }) {
  const usuario = await exigirUsuario(db, req);
  const [ranchoId, usuarioId] = params;
  await exigirRol(db, usuario.id, ranchoId, ['admin']);
  if (!ROLES.includes(cuerpo.rol)) throw datosInvalidos('Rol inválido.');
  const actual = await db.query('SELECT rol FROM miembros WHERE rancho_id = $1 AND usuario_id = $2', [ranchoId, usuarioId]);
  if (!actual.rows.length) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Esa cuenta no es miembro del rancho.');
  if (actual.rows[0].rol === 'admin' && cuerpo.rol !== 'admin' && (await contarAdmins(db, ranchoId)) <= 1) {
    throw new ErrorApi(409, 'ULTIMO_ADMIN', 'El rancho debe tener al menos un administrador.');
  }
  await db.query('UPDATE miembros SET rol = $3 WHERE rancho_id = $1 AND usuario_id = $2', [ranchoId, usuarioId, cuerpo.rol]);
  await auditarMiembro(db, ranchoId, usuario.id, usuarioId, 'rol cambiado', { rol: cuerpo.rol });
  return { ok: true };
}

async function quitarMiembro({ db, req, params }) {
  const usuario = await exigirUsuario(db, req);
  const [ranchoId, usuarioId] = params;
  await exigirRol(db, usuario.id, ranchoId, ['admin']);
  const actual = await db.query('SELECT rol FROM miembros WHERE rancho_id = $1 AND usuario_id = $2', [ranchoId, usuarioId]);
  if (!actual.rows.length) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Esa cuenta no es miembro del rancho.');
  if (actual.rows[0].rol === 'admin' && (await contarAdmins(db, ranchoId)) <= 1) {
    throw new ErrorApi(409, 'ULTIMO_ADMIN', 'El rancho debe tener al menos un administrador.');
  }
  await db.query('DELETE FROM miembros WHERE rancho_id = $1 AND usuario_id = $2', [ranchoId, usuarioId]);
  // Si ya no pertenece a ningún rancho, cerrar sus sesiones
  const resto = await db.query('SELECT 1 FROM miembros WHERE usuario_id = $1 LIMIT 1', [usuarioId]);
  if (!resto.rows.length) await db.query('DELETE FROM sesiones WHERE usuario_id = $1', [usuarioId]);
  await auditarMiembro(db, ranchoId, usuario.id, usuarioId, 'acceso quitado', null);
  return { ok: true };
}

/**
 * El administrador pone una contraseña temporal a un miembro que olvidó la suya.
 * Solo se permite si TODOS los ranchos de esa persona son administrados por quien la restablece;
 * así un admin de un rancho no puede tomar la cuenta de alguien en ranchos ajenos.
 */
async function restablecerContrasena({ db, req, params, cuerpo }) {
  const usuario = await exigirUsuario(db, req);
  const [ranchoId, usuarioId] = params;
  await exigirRol(db, usuario.id, ranchoId, ['admin']);
  if (usuarioId === usuario.id) {
    throw new ErrorApi(400, 'USA_CAMBIAR_CONTRASENA', 'Para tu propia cuenta usa "Cambiar contraseña".');
  }
  const miembro = await db.query('SELECT 1 FROM miembros WHERE rancho_id = $1 AND usuario_id = $2', [ranchoId, usuarioId]);
  if (!miembro.rows.length) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Esa cuenta no es miembro del rancho.');
  const ajenos = await db.query(
    `SELECT count(*)::int AS n FROM miembros t
      WHERE t.usuario_id = $1
        AND NOT EXISTS (SELECT 1 FROM miembros r WHERE r.usuario_id = $2 AND r.rancho_id = t.rancho_id AND r.rol = 'admin')`,
    [usuarioId, usuario.id]
  );
  if (ajenos.rows[0].n > 0) {
    throw prohibido('Esta persona también tiene acceso a ranchos que tú no administras; debe recuperar su contraseña con su propio administrador.');
  }
  validarContrasenaNueva(cuerpo.nueva);
  await db.query('UPDATE usuarios SET password_hash = $2, debe_cambiar_contrasena = true WHERE id = $1', [
    usuarioId,
    await cifrarContrasena(cuerpo.nueva)
  ]);
  await db.query('DELETE FROM sesiones WHERE usuario_id = $1', [usuarioId]);
  await auditarMiembro(db, ranchoId, usuario.id, usuarioId, 'contraseña restablecida', null);
  return { ok: true };
}

async function auditarMiembro(db, ranchoId, autorId, usuarioId, accion, cambios) {
  await db.query(
    `INSERT INTO auditoria (rancho_id, usuario_id, entidad, entidad_id, accion, cambios)
     VALUES ($1, $2, 'miembro', $3, $4, $5)`,
    [ranchoId, autorId, String(usuarioId), accion, cambios ? JSON.stringify(cambios) : null]
  );
}

/* ---------------------------------------------------------------- datos del rancho */
async function sincronizarRancho({ db, req, params, cuerpo }) {
  const usuario = await exigirUsuario(db, req);
  const rol = await exigirRol(db, usuario.id, params[0]);
  return sincronizar(db, usuario, params[0], rol, cuerpo);
}

async function auditoria({ db, req, params, query }) {
  const usuario = await exigirUsuario(db, req);
  await exigirRol(db, usuario.id, params[0], ['admin']);
  const limite = Math.min(200, Math.max(1, parseInt(query.get('limite'), 10) || 50));
  const { rows } = await db.query(
    `SELECT a.fecha, a.entidad, a.entidad_id, a.accion, a.cambios, u.nombre AS usuario
       FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.rancho_id = $1 ORDER BY a.fecha DESC, a.id DESC LIMIT $2`,
    [params[0], limite]
  );
  return { registros: rows };
}
