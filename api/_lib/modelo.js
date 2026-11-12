/**
 * Modelo de datos: validación (zod) y conversión entre el formato de la app (camelCase)
 * y las columnas de PostgreSQL (snake_case).
 */
import { z } from 'zod';

const vacioANull = (v) => (v === '' || v === undefined ? null : v);
const texto = (max) =>
  z.preprocess(
    (v) => (v == null ? null : String(v).trim() === '' ? null : String(v).trim()),
    z.string().max(max).nullable()
  );
const fecha = z.preprocess(
  vacioANull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato AAAA-MM-DD')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha inválida')
    .nullable()
);
const numero = (max) =>
  z.preprocess(
    (v) => (v === '' || v == null ? null : typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : v),
    z.number().min(0).max(max).nullable()
  );
const idSeguro = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/, 'Identificador inválido');

export const esquemaAnimal = z.object({
  id: idSeguro,
  fierro: z.string().regex(/^[A-Z0-9Ñ]{1,3}$/, 'Código de fierro inválido'),
  numero: z.preprocess((v) => String(v ?? '').trim(), z.string().min(1, 'Falta el número').max(20)),
  arete: z.preprocess((v) => String(v ?? '').trim().toUpperCase() || 'S/N', z.string().max(40)),
  aretesAnteriores: z.preprocess(
    (v) => (Array.isArray(v) ? v.map((x) => String(x).trim().toUpperCase()).filter(Boolean) : []),
    z.array(z.string().max(40)).max(50)
  ),
  colorArete: texto(40),
  estadoArete: texto(40),
  sexo: z.enum(['Hembra', 'Macho']),
  categoria: texto(60),
  razaColor: texto(120),
  fechaNacimiento: fecha,
  origen: texto(60),
  pesoActual: numero(5000),
  madreId: z.preprocess(vacioANull, idSeguro.nullable()),
  madreFierro: texto(3),
  madreNumero: texto(20),
  madreArete: texto(40),
  estatus: z.enum(['Activo', 'Vendido', 'Muerto']),
  fechaBaja: fecha,
  motivoBaja: texto(200),
  compradorDestino: texto(120),
  guiaReemo: texto(60),
  pesoVenta: numero(5000),
  precioVenta: numero(100000000),
  notasBaja: texto(1000),
  notas: texto(2000)
});

export const esquemaEvento = z.object({
  id: idSeguro,
  animalId: idSeguro,
  fecha: fecha,
  tipo: z.preprocess((v) => String(v ?? '').trim(), z.string().min(1, 'Falta el tipo de manejo').max(60)),
  producto: z.preprocess((v) => String(v ?? '').trim(), z.string().min(1, 'Falta el producto').max(160)),
  dosis: texto(80),
  pesoKg: numero(5000),
  proximaFecha: fecha,
  notas: texto(1000)
});

export const esquemaFierro = z.object({
  codigo: z.preprocess(
    (v) => String(v ?? '').trim().toUpperCase(),
    z.string().regex(/^[A-Z0-9Ñ]{1,3}$/, 'Código de fierro de 1 a 3 letras o números')
  ),
  propietario: z.preprocess(
    (v) => String(v ?? '').trim(),
    z.string().min(1, 'Falta el nombre del dueño').max(80)
  ),
  tono: z.preprocess((v) => Number(v), z.number().int().min(0).max(7))
});

export const esquemaConfig = z.object({
  nombreRancho: z.preprocess((v) => String(v ?? '').trim(), z.string().min(1).max(120)).optional(),
  edadDesteteMeses: z.preprocess((v) => Number(v), z.number().int().min(1).max(36)).optional(),
  fierros: z.array(esquemaFierro).min(1, 'Debe existir al menos un fierro').max(50).optional()
});

/** Columnas de la tabla animales y su nombre en la app. */
export const CAMPOS_ANIMAL = {
  fierro: 'fierro',
  numero: 'numero',
  arete: 'arete',
  aretesAnteriores: 'aretes_anteriores',
  colorArete: 'color_arete',
  estadoArete: 'estado_arete',
  sexo: 'sexo',
  categoria: 'categoria',
  razaColor: 'raza_color',
  fechaNacimiento: 'fecha_nacimiento',
  origen: 'origen',
  pesoActual: 'peso_actual',
  madreId: 'madre_id',
  madreFierro: 'madre_fierro',
  madreNumero: 'madre_numero',
  madreArete: 'madre_arete',
  estatus: 'estatus',
  fechaBaja: 'fecha_baja',
  motivoBaja: 'motivo_baja',
  compradorDestino: 'comprador_destino',
  guiaReemo: 'guia_reemo',
  pesoVenta: 'peso_venta',
  precioVenta: 'precio_venta',
  notasBaja: 'notas_baja',
  notas: 'notas'
};

export const CAMPOS_EVENTO = {
  animalId: 'animal_id',
  fecha: 'fecha',
  tipo: 'tipo',
  producto: 'producto',
  dosis: 'dosis',
  pesoKg: 'peso_kg',
  proximaFecha: 'proxima_fecha',
  notas: 'notas'
};

const FECHAS = new Set(['fecha_nacimiento', 'fecha_baja', 'fecha', 'proxima_fecha']);
const NUMEROS = new Set(['peso_actual', 'peso_venta', 'precio_venta', 'peso_kg']);

/** Lista de columnas para SELECT con fechas como texto y números como float (sin sorpresas de zona horaria). */
export function columnasSelect(mapa) {
  return Object.values(mapa)
    .map((c) => (FECHAS.has(c) ? `${c}::text AS ${c}` : NUMEROS.has(c) ? `${c}::float8 AS ${c}` : c))
    .join(', ');
}

/** Fila de la base -> objeto de la app. Los nulos se devuelven como '' como espera la interfaz. */
export function filaACliente(fila, mapa) {
  const obj = { id: fila.id };
  for (const [campo, columna] of Object.entries(mapa)) {
    const v = fila[columna];
    if (columna === 'aretes_anteriores') obj[campo] = Array.isArray(v) ? v : [];
    else obj[campo] = v == null ? '' : v;
  }
  obj.version = Number(fila.version);
  if (fila.eliminado) obj.eliminado = true;
  return obj;
}

/** Normaliza el número de animal: "15", "#15" y "015" son el mismo número. */
export function normalizarNumero(valor) {
  const limpio = String(valor ?? '')
    .trim()
    .toUpperCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '');
  return /^\d+$/.test(limpio) ? String(parseInt(limpio, 10)) : limpio;
}

/** Normaliza un arete; devuelve '' si no es un arete real (S/N, vacío). */
export function normalizarArete(valor) {
  const a = String(valor ?? '').trim().toUpperCase();
  return a === '' || a === 'S/N' || a === 'PENDIENTE' ? '' : a;
}

/** Primer mensaje legible de un error de zod. */
export function mensajeZod(err) {
  const primero = err.issues && err.issues[0];
  if (!primero) return 'Datos inválidos.';
  const campo = primero.path && primero.path.length ? `${primero.path.join('.')}: ` : '';
  return `${campo}${primero.message}`;
}
