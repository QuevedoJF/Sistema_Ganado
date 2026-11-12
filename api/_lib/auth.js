/**
 * Autenticación: contraseñas con scrypt, sesiones en la base con cookie httpOnly,
 * límite de intentos y protección CSRF.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { ErrorApi, noAutorizado, prohibido } from './errores.js';

const scrypt = promisify(crypto.scrypt);

// Parámetros recomendados por OWASP para scrypt (N=2^17, r=8, p=1). Se guardan junto al hash.
const SCRYPT_N = Number(process.env.SCRYPT_N) || 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const LARGO_CLAVE = 64;

const DURACION_SESION_DIAS = 30;
const COOKIE = 'rancho_sesion';

export async function cifrarContrasena(contrasena) {
  const sal = crypto.randomBytes(16);
  const hash = await scrypt(contrasena, sal, LARGO_CLAVE, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 256 * SCRYPT_N * SCRYPT_R
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export async function verificarContrasena(contrasena, guardado) {
  const partes = String(guardado || '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, salB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, 'base64');
  const calculado = await scrypt(contrasena, Buffer.from(salB64, 'base64'), esperado.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * Number(n) * Number(r)
  });
  return crypto.timingSafeEqual(esperado, calculado);
}

export function validarContrasenaNueva(contrasena) {
  const c = String(contrasena || '');
  if (c.length < 8) throw new ErrorApi(400, 'CONTRASENA_DEBIL', 'La contraseña debe tener al menos 8 caracteres.');
  if (c.length > 200) throw new ErrorApi(400, 'CONTRASENA_LARGA', 'La contraseña es demasiado larga.');
}

export function normalizarEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) {
    throw new ErrorApi(400, 'CORREO_INVALIDO', 'El correo no tiene un formato válido.');
  }
  return e;
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** Crea una sesión y devuelve el valor de la cabecera Set-Cookie. */
export async function crearSesion(db, usuarioId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sesiones (token_hash, usuario_id, expira)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), usuarioId, DURACION_SESION_DIAS]
  );
  return cookieSesion(token, DURACION_SESION_DIAS * 86400);
}

export function cookieSesion(token, maxAge) {
  const segura = process.env.COOKIE_INSEGURA === '1' ? '' : '; Secure';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${segura}`;
}

function leerCookie(req, nombre) {
  const cabecera = req.headers.cookie || '';
  for (const parte of cabecera.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return v.join('=');
  }
  return null;
}

/** Devuelve el usuario de la sesión o null. Renueva la sesión si le quedan menos de 15 días. */
export async function usuarioDeSesion(db, req) {
  const token = leerCookie(req, COOKIE);
  if (!token) return null;
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.nombre, s.expira < now() + interval '15 days' AS renovar
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1 AND s.expira > now() AND u.activo`,
    [hashToken(token)]
  );
  if (!rows.length) return null;
  if (rows[0].renovar) {
    await db.query(
      `UPDATE sesiones SET expira = now() + make_interval(days => $2) WHERE token_hash = $1`,
      [hashToken(token), DURACION_SESION_DIAS]
    );
  }
  return { id: rows[0].id, email: rows[0].email, nombre: rows[0].nombre, token };
}

export async function exigirUsuario(db, req) {
  const usuario = await usuarioDeSesion(db, req);
  if (!usuario) throw noAutorizado();
  return usuario;
}

export async function cerrarSesion(db, req) {
  const token = leerCookie(req, COOKIE);
  if (token) await db.query('DELETE FROM sesiones WHERE token_hash = $1', [hashToken(token)]);
  return cookieSesion('', 0);
}

/** Rol del usuario en el rancho, o error 403 si no es miembro. */
export async function exigirRol(db, usuarioId, ranchoId, rolesPermitidos = ['admin', 'editor', 'lector']) {
  if (!/^[0-9a-f-]{36}$/i.test(String(ranchoId))) throw prohibido();
  const { rows } = await db.query(
    'SELECT rol FROM miembros WHERE rancho_id = $1 AND usuario_id = $2',
    [ranchoId, usuarioId]
  );
  if (!rows.length) throw prohibido();
  if (!rolesPermitidos.includes(rows[0].rol)) {
    throw prohibido(
      rows[0].rol === 'lector'
        ? 'Tu cuenta es de solo lectura en este rancho.'
        : 'Solo un administrador del rancho puede hacer esto.'
    );
  }
  return rows[0].rol;
}

/** Bloquea fuerza bruta: 8 fallos por correo o 30 por IP en 15 minutos. */
export async function revisarLimiteIntentos(db, email, ip) {
  const { rows } = await db.query(
    `SELECT
        count(*) FILTER (WHERE email = $1 AND NOT exito)::int AS por_email,
        count(*) FILTER (WHERE ip = $2 AND NOT exito)::int AS por_ip
       FROM intentos_login
      WHERE fecha > now() - interval '15 minutes' AND (email = $1 OR ip = $2)`,
    [email, ip]
  );
  if (rows[0].por_email >= 8 || rows[0].por_ip >= 30) {
    throw new ErrorApi(
      429,
      'DEMASIADOS_INTENTOS',
      'Demasiados intentos fallidos. Espera 15 minutos y vuelve a intentar.'
    );
  }
}

export async function registrarIntento(db, email, ip, exito) {
  await db.query('INSERT INTO intentos_login (email, ip, exito) VALUES ($1, $2, $3)', [email, ip, exito]);
  if (exito) {
    await db.query(`DELETE FROM intentos_login WHERE fecha < now() - interval '1 day'`);
  }
}

/**
 * Protección CSRF: las peticiones que modifican datos deben ser JSON y, si el navegador
 * manda Origin, debe ser el mismo sitio. Un formulario de otro sitio no puede cumplir ambas.
 */
export function revisarOrigen(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const tipo = String(req.headers['content-type'] || '');
  if (!tipo.includes('application/json')) {
    throw new ErrorApi(415, 'TIPO_NO_SOPORTADO', 'Las peticiones deben enviarse como JSON.');
  }
  const origen = req.headers.origin;
  if (origen) {
    let host;
    try {
      host = new URL(origen).host;
    } catch {
      host = '';
    }
    const esperado = req.headers['x-forwarded-host'] || req.headers.host;
    if (host !== esperado) throw prohibido('Petición de un origen no permitido.');
  }
}

export function ipDe(req) {
  const reenviada = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return reenviada || (req.socket && req.socket.remoteAddress) || 'desconocida';
}
