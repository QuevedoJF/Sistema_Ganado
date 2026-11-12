/** Error con código HTTP y mensaje pensado para mostrarse al usuario. */
export class ErrorApi extends Error {
  constructor(status, codigo, mensaje, extra = {}) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
    this.extra = extra;
  }
}

export const noAutorizado = () =>
  new ErrorApi(401, 'NO_AUTENTICADO', 'Tu sesión terminó. Vuelve a iniciar sesión.');

export const prohibido = (mensaje = 'No tienes permiso para hacer esto en este rancho.') =>
  new ErrorApi(403, 'SIN_PERMISO', mensaje);

export const datosInvalidos = (mensaje) => new ErrorApi(400, 'DATOS_INVALIDOS', mensaje);

/**
 * Traduce errores de PostgreSQL (restricciones) a mensajes claros.
 * Devuelve null si no es un error conocido.
 */
export function traducirErrorPg(err, contexto = {}) {
  if (!err || !err.code) return null;
  const restriccion = err.constraint || '';
  if (err.code === '23505') {
    if (restriccion === 'animales_numero_activo_unico') {
      return new ErrorApi(
        409,
        'NUMERO_DUPLICADO',
        `El número #${contexto.numero ?? ''} ya lo tiene otro animal ACTIVO en el Fierro ${contexto.fierro ?? ''}.`
      );
    }
    if (restriccion === 'usuarios_email_key') {
      return new ErrorApi(409, 'CORREO_DUPLICADO', 'Ya existe una cuenta con ese correo.');
    }
    return new ErrorApi(409, 'DUPLICADO', 'Ese registro ya existe.');
  }
  if (err.code === '23503') {
    if (/fierro/i.test(restriccion) || /fierro/i.test(err.detail || '')) {
      return new ErrorApi(
        409,
        'FIERRO_EN_USO',
        contexto.fierroEnUso
          ? `No se puede quitar el Fierro ${contexto.fierroEnUso}: todavía tiene animales registrados.`
          : `El Fierro ${contexto.fierro ?? ''} no existe en este rancho.`
      );
    }
    return new ErrorApi(409, 'REFERENCIA_INVALIDA', 'El registro relacionado ya no existe.');
  }
  if (err.code === '23514' || err.code === '22P02' || err.code === '22007' || err.code === '22008') {
    return new ErrorApi(400, 'DATOS_INVALIDOS', 'Algún dato no tiene el formato correcto.');
  }
  return null;
}
