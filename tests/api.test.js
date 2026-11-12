/**
 * Pruebas de la API contra un servidor HTTP real con PostgreSQL (PGlite en memoria).
 *   npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SCRYPT_N = '16384'; // más rápido en pruebas; producción usa 131072
process.env.COOKIE_INSEGURA = '1';
process.env.SETUP_TOKEN = 'token-de-prueba-123';

const { PGlite } = await import('@electric-sql/pglite');
const { adaptadorPglite } = await import('../api/_lib/db.js');
const { crearServidor } = await import('../scripts/servidor-local.js');

let servidor;
let base;

before(async () => {
  servidor = await crearServidor({ adaptador: adaptadorPglite(new PGlite()) });
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

/** Cliente con su propia cookie de sesión (simula un dispositivo). */
function cliente() {
  let cookie = '';
  return async function llamar(metodo, ruta, cuerpo, cabeceras = {}) {
    const res = await fetch(base + ruta, {
      method: metodo,
      headers: {
        ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...cabeceras
      },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const datos = await res.json().catch(() => ({}));
    return { status: res.status, datos };
  };
}

const admin = cliente();
const otro = cliente();
let rancho;

const animal = (id, numero, extra = {}) => ({
  opId: `op-${id}-${Math.random()}`,
  entidad: 'animal',
  id,
  cambios: { fierro: 'F', numero, sexo: 'Hembra', categoria: 'Vaca de Cría', estatus: 'Activo', ...extra }
});

test('estado: el sistema nuevo pide configuración inicial', async () => {
  const r = await admin('GET', '/api/estado');
  assert.equal(r.status, 200);
  assert.equal(r.datos.necesitaConfiguracion, true);
});

test('configuración inicial exige el código correcto', async () => {
  const r = await admin('POST', '/api/configuracion-inicial', {
    token: 'incorrecto-123', email: 'admin@rancho.mx', password: 'segura12345'
  });
  assert.equal(r.status, 403);
});

test('configuración inicial crea admin, rancho con fierros F y H, y sesión', async () => {
  const r = await admin('POST', '/api/configuracion-inicial', {
    token: 'token-de-prueba-123', email: 'Admin@Rancho.mx', nombre: 'Dueño', password: 'segura12345', nombreRancho: 'El Progreso'
  });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.usuario.email, 'admin@rancho.mx');
  assert.equal(r.datos.ranchos[0].rol, 'admin');
  rancho = r.datos.ranchos[0].id;
  const yo = await admin('GET', '/api/auth/yo');
  assert.equal(yo.datos.usuario.email, 'admin@rancho.mx');
});

test('no se puede volver a hacer la configuración inicial', async () => {
  const r = await otro('POST', '/api/configuracion-inicial', {
    token: 'token-de-prueba-123', email: 'intruso@x.mx', password: 'segura12345'
  });
  assert.equal(r.status, 403);
});

test('sin sesión no se pueden leer ni escribir datos', async () => {
  const r = await otro('POST', `/api/ranchos/${rancho}/sync`, { cursor: 0, ops: [] });
  assert.equal(r.status, 401);
});

test('peticiones que no son JSON se rechazan (protección CSRF)', async () => {
  const res = await fetch(`${base}/api/auth/entrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=a@b.mx&password=x'
  });
  assert.equal(res.status, 415);
});

test('peticiones desde otro sitio se rechazan', async () => {
  const r = await admin('POST', `/api/ranchos/${rancho}/sync`, { cursor: 0, ops: [] }, { Origin: 'https://sitio-malo.com' });
  assert.equal(r.status, 403);
});

test('primera sincronización devuelve configuración y fierros', async () => {
  const r = await admin('POST', `/api/ranchos/${rancho}/sync`, { cursor: 0, ops: [] });
  assert.equal(r.status, 200);
  assert.equal(r.datos.config.nombreRancho, 'El Progreso');
  assert.deepEqual(r.datos.config.fierros.map((f) => f.codigo), ['F', 'H']);
  assert.ok(r.datos.cursor > 0);
});

test('crear animales y evento sanitario', async () => {
  const r = await admin('POST', `/api/ranchos/${rancho}/sync`, {
    cursor: 0,
    ops: [
      animal('A1', '15', { arete: 'mx-100', pesoActual: '465', fechaNacimiento: '2021-04-12' }),
      animal('A2', '16', { arete: 'MX-101' }),
      { opId: 'e1', entidad: 'evento', id: 'E1', cambios: { animalId: 'A1', fecha: '2026-09-15', tipo: 'Vacunación', producto: 'Bacterina', pesoKg: 465 } }
    ]
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.datos.rechazos, []);
  const a1 = r.datos.animales.find((a) => a.id === 'A1');
  assert.equal(a1.arete, 'MX-100', 'el arete se guarda en mayúsculas');
  assert.equal(a1.pesoActual, 465);
  assert.equal(a1.fechaNacimiento, '2021-04-12', 'la fecha no cambia por zona horaria');
  assert.equal(r.datos.eventosSanitarios.length, 1);
});

test('número activo duplicado en el mismo fierro se rechaza (incluye 015 = 15)', async () => {
  const r = await admin('POST', `/api/ranchos/${rancho}/sync`, { cursor: 0, ops: [animal('A3', '015')] });
  assert.equal(r.datos.rechazos.length, 1);
  assert.equal(r.datos.rechazos[0].codigo, 'NUMERO_DUPLICADO');
  assert.match(r.datos.rechazos[0].motivo, /ACTIVO en el Fierro F/);
});

test('el mismo número en otro fierro sí se permite', async () => {
  const r = await admin('POST', `/api/ranchos/${rancho}/sync`, { cursor: 0, ops: [animal('A4', '15', { fierro: 'H' })] });
  assert.deepEqual(r.datos.rechazos, []);
});

test('arete repetido se rechaza, también si fue arete anterior de otro animal', async () => {
  let r = await admin('POST', `/api/ranchos/${rancho}/sync`, { cursor: 0, ops: [animal('A5', '30', { arete: 'MX-100' })] });
  assert.equal(r.datos.rechazos[0].codigo, 'ARETE_DUPLICADO');
  // A2 cambia de arete: MX-101 pasa a su historial
  r = await admin('POST', `/api/ranchos/${rancho}/sync`, {
    cursor: 0,
    ops: [{ opId: 'x', entidad: 'animal', id: 'A2', cambios: { arete: 'MX-102', aretesAnteriores: ['MX-101'] } }]
  });
  assert.deepEqual(r.datos.rechazos, []);
  r = await admin('POST', `/api/ranchos/${rancho}/sync`, { cursor: 0, ops: [animal('A6', '31', { arete: 'MX-101' })] });
  assert.equal(r.datos.rechazos[0].codigo, 'ARETE_DUPLICADO', 'el arete anterior sigue reservado');
});

test('vender un animal libera el número y conserva el registro', async () => {
  let r = await admin('POST', `/api/ranchos/${rancho}/sync`, {
    cursor: 0,
    ops: [{ opId: 'b', entidad: 'animal', id: 'A1', cambios: { estatus: 'Vendido', fechaBaja: '2026-10-01', compradorDestino: 'Los Pinos', precioVenta: '24,700' } }]
  });
  assert.deepEqual(r.datos.rechazos, []);
  r = await admin('POST', `/api/ranchos/${rancho}/sync`, { cursor: 0, ops: [animal('A7', '15', { arete: 'MX-200' })] });
  assert.deepEqual(r.datos.rechazos, [], 'el #15 se puede reutilizar');
  const con15 = r.datos.animales.filter((a) => a.fierro === 'F' && a.numero === '15');
  assert.equal(con15.length, 2);
  const vendido = con15.find((a) => a.estatus === 'Vendido');
  assert.equal(vendido.compradorDestino, 'Los Pinos');
  assert.equal(vendido.precioVenta, 24700);
});

test('reactivar un animal cuyo número ya se reutilizó se rechaza', async () => {
  const r = await admin('POST', `/api/ranchos/${rancho}/sync`, {
    cursor: 0, ops: [{ opId: 'r', entidad: 'animal', id: 'A1', cambios: { estatus: 'Activo' } }]
  });
  assert.equal(r.datos.rechazos[0].codigo, 'NUMERO_DUPLICADO');
});

test('dos dispositivos editan campos distintos del mismo animal: se conservan ambos', async () => {
  const inicio = await admin('POST', `/api/ranchos/${rancho}/sync`, { cursor: 0, ops: [] });
  const cursor = inicio.datos.cursor;
  await admin('POST', `/api/ranchos/${rancho}/sync`, { cursor, ops: [{ entidad: 'animal', id: 'A2', cambios: { pesoActual: 300 } }] });
  const r = await admin('POST', `/api/ranchos/${rancho}/sync`, { cursor, ops: [{ entidad: 'animal', id: 'A2', cambios: { notas: 'Cojea de la pata trasera' } }] });
  const a2 = r.datos.animales.find((a) => a.id === 'A2');
  assert.equal(a2.pesoActual, 300);
  assert.equal(a2.notas, 'Cojea de la pata trasera');
  assert.ok(a2.version >= 3);
});

test('sincronización incremental devuelve solo lo nuevo y los eliminados', async () => {
  const c = (await admin('POST', `/api/ranchos/${rancho}/sync`, { cursor: 0, ops: [] })).datos.cursor;
  // Simular que pasó tiempo: la ventana de seguridad devuelve cambios de los últimos 2 minutos,
  // así que se comprueba que lo eliminado venga marcado.
  const r = await admin('POST', `/api/ranchos/${rancho}/sync`, { cursor: c, ops: [{ entidad: 'animal', id: 'A4', eliminado: true }] });
  const a4 = r.datos.animales.find((a) => a.id === 'A4');
  assert.equal(a4.eliminado, true);
  assert.ok(r.datos.cursor > c);
  const completo = await admin('POST', `/api/ranchos/${rancho}/sync`, { cursor: 0, ops: [] });
  assert.ok(!completo.datos.animales.some((a) => a.id === 'A4'), 'la carga completa no incluye eliminados');
});

test('fierros: agregar uno nuevo y no permitir quitar uno con animales', async () => {
  let r = await admin('POST', `/api/ranchos/${rancho}/sync`, {
    cursor: 0,
    ops: [{ entidad: 'config', id: 'rancho', cambios: { fierros: [
      { codigo: 'F', propietario: 'Don Juan', tono: 0 },
      { codigo: 'H', propietario: 'Doña Ana', tono: 1 },
      { codigo: 'r', propietario: 'Productora C', tono: 2 }
    ] } }]
  });
  assert.deepEqual(r.datos.rechazos, []);
  assert.deepEqual(r.datos.config.fierros.map((f) => f.codigo), ['F', 'H', 'R']);
  r = await admin('POST', `/api/ranchos/${rancho}/sync`, {
    cursor: 0, ops: [{ entidad: 'config', id: 'rancho', cambios: { fierros: [{ codigo: 'R', propietario: 'C', tono: 2 }] } }]
  });
  assert.equal(r.datos.rechazos[0].codigo, 'FIERRO_EN_USO');
});

test('animal con un fierro inexistente se rechaza', async () => {
  const r = await admin('POST', `/api/ranchos/${rancho}/sync`, { cursor: 0, ops: [animal('A8', '50', { fierro: 'Z' })] });
  assert.equal(r.datos.rechazos[0].codigo, 'FIERRO_EN_USO');
  assert.match(r.datos.rechazos[0].motivo, /Fierro Z no existe/);
});

test('datos inválidos se rechazan con mensaje claro', async () => {
  const r = await admin('POST', `/api/ranchos/${rancho}/sync`, {
    cursor: 0, ops: [animal('A9', '60', { sexo: 'Otro' }), animal('<script>', '61')]
  });
  assert.equal(r.datos.rechazos.length, 2);
  assert.equal(r.datos.rechazos[0].codigo, 'DATOS_INVALIDOS');
});

test('admin agrega un editor y un lector; permisos por rol', async () => {
  let r = await admin('POST', `/api/ranchos/${rancho}/miembros`, { email: 'vaquero@rancho.mx', nombre: 'Vaquero', password: 'corral12345', rol: 'lector' });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  const lector = cliente();
  r = await lector('POST', '/api/auth/entrar', { email: 'VAQUERO@rancho.mx', password: 'corral12345' });
  assert.equal(r.status, 200);
  r = await lector('POST', `/api/ranchos/${rancho}/sync`, { cursor: 0, ops: [animal('L1', '70')] });
  assert.equal(r.status, 200, 'el lector puede leer');
  assert.ok(r.datos.animales.length > 0);
  assert.equal(r.datos.rechazos[0].codigo, 'SIN_PERMISO', 'pero no escribir');
  r = await lector('GET', `/api/ranchos/${rancho}/miembros`);
  assert.equal(r.status, 403, 'el lector no administra miembros');

  r = await admin('PATCH', `/api/ranchos/${rancho}/miembros/${(await admin('GET', `/api/ranchos/${rancho}/miembros`)).datos.miembros.find((m) => m.email === 'vaquero@rancho.mx').id}`, { rol: 'editor' });
  assert.equal(r.status, 200);
  r = await lector('POST', `/api/ranchos/${rancho}/sync`, {
    cursor: 0, ops: [animal('L1', '70'), { entidad: 'config', id: 'rancho', cambios: { nombreRancho: 'Otro' } }]
  });
  assert.equal(r.datos.rechazos.length, 1, 'el editor crea animales');
  assert.match(r.datos.rechazos[0].motivo, /administrador/, 'pero no cambia la configuración');
});

test('no se puede quitar al último administrador', async () => {
  const yo = await admin('GET', '/api/auth/yo');
  const r = await admin('DELETE', `/api/ranchos/${rancho}/miembros/${yo.datos.usuario.id}`, {});
  assert.equal(r.status, 409);
});

test('una cuenta sin acceso no ve otro rancho', async () => {
  // Crear una cuenta ajena: un admin la invita y luego la quita
  await admin('POST', `/api/ranchos/${rancho}/miembros`, { email: 'ajeno@x.mx', password: 'ajeno12345', rol: 'lector' });
  const miembros = (await admin('GET', `/api/ranchos/${rancho}/miembros`)).datos.miembros;
  await admin('DELETE', `/api/ranchos/${rancho}/miembros/${miembros.find((m) => m.email === 'ajeno@x.mx').id}`, {});
  const ajeno = cliente();
  await ajeno('POST', '/api/auth/entrar', { email: 'ajeno@x.mx', password: 'ajeno12345' });
  const r = await ajeno('POST', `/api/ranchos/${rancho}/sync`, { cursor: 0, ops: [] });
  assert.equal(r.status, 403);
});

test('contraseña incorrecta y bloqueo tras 8 intentos', async () => {
  const intruso = cliente();
  let r = await intruso('POST', '/api/auth/entrar', { email: 'admin@rancho.mx', password: 'mala' });
  assert.equal(r.status, 401);
  assert.equal(r.datos.mensaje, 'Correo o contraseña incorrectos.');
  r = await intruso('POST', '/api/auth/entrar', { email: 'noexiste@rancho.mx', password: 'mala' });
  assert.equal(r.datos.mensaje, 'Correo o contraseña incorrectos.', 'mismo mensaje: no revela si el correo existe');
  for (let i = 0; i < 7; i++) await intruso('POST', '/api/auth/entrar', { email: 'admin@rancho.mx', password: 'mala' });
  r = await intruso('POST', '/api/auth/entrar', { email: 'admin@rancho.mx', password: 'segura12345' });
  assert.equal(r.status, 429, 'bloqueado aunque ahora la contraseña sea correcta');
});

test('cambiar contraseña cierra las otras sesiones', async () => {
  const celular = cliente();
  await admin('POST', `/api/ranchos/${rancho}/miembros`, { email: 'socio@rancho.mx', password: 'socio12345', rol: 'editor' });
  const pc = cliente();
  await pc('POST', '/api/auth/entrar', { email: 'socio@rancho.mx', password: 'socio12345' });
  await celular('POST', '/api/auth/entrar', { email: 'socio@rancho.mx', password: 'socio12345' });
  let r = await pc('POST', '/api/auth/contrasena', { actual: 'socio12345', nueva: 'nueva-clave-99' });
  assert.equal(r.status, 200);
  r = await celular('GET', '/api/auth/yo');
  assert.equal(r.datos.usuario, null, 'la sesión del otro dispositivo terminó');
  r = await pc('GET', '/api/auth/yo');
  assert.equal(r.datos.usuario.email, 'socio@rancho.mx', 'la sesión actual sigue');
});

test('auditoría registra quién cambió qué', async () => {
  const r = await admin('GET', `/api/ranchos/${rancho}/auditoria?limite=100`);
  assert.equal(r.status, 200);
  const ventaA1 = r.datos.registros.find((x) => x.entidad_id === 'A1' && x.cambios && x.cambios.estatus === 'Vendido');
  assert.ok(ventaA1, 'se registró la venta');
  assert.equal(ventaA1.usuario, 'Dueño');
});

test('cerrar sesión invalida la cookie', async () => {
  await admin('POST', '/api/auth/salir', {});
  const r = await admin('GET', '/api/auth/yo');
  assert.equal(r.datos.usuario, null);
});

test('ruta inexistente responde 404 en JSON', async () => {
  const r = await admin('GET', '/api/no-existe');
  assert.equal(r.status, 404);
  assert.equal(r.datos.error, 'NO_ENCONTRADO');
});
