/**
 * Acceso a PostgreSQL.
 * - Producción (Vercel): Neon/Postgres por la variable DATABASE_URL (o POSTGRES_URL).
 * - Pruebas y desarrollo local: PGlite (Postgres real en WebAssembly) inyectado con usarBase().
 *
 * Interfaz común: { query(texto, params) -> {rows}, exec(sqlVarias), tx(async (t) => ...) }
 */
import pg from 'pg';
import { ErrorApi } from './errores.js';

let instancia = null;

/** Adaptador para node-postgres (producción). */
export function adaptadorPg(pool) {
  return {
    query: (texto, params) => pool.query(texto, params),
    exec: (sql) => pool.query(sql),
    async tx(fn) {
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        const resultado = await fn({ query: (t, p) => cliente.query(t, p) });
        await cliente.query('COMMIT');
        return resultado;
      } catch (err) {
        await cliente.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        cliente.release();
      }
    }
  };
}

/** Adaptador para PGlite (pruebas / desarrollo local). */
export function adaptadorPglite(db) {
  return {
    query: (texto, params) => db.query(texto, params),
    exec: (sql) => db.exec(sql),
    tx: (fn) => db.transaction((t) => fn({ query: (texto, params) => t.query(texto, params) }))
  };
}

/** Permite inyectar una base (pruebas o servidor local). */
export function usarBase(adaptador) {
  instancia = adaptador;
}

export function obtenerDb() {
  if (instancia) return instancia;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new ErrorApi(
      503,
      'SIN_BASE_DE_DATOS',
      'El servidor no tiene base de datos configurada (falta DATABASE_URL en Vercel).'
    );
  }
  const pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000 });
  instancia = adaptadorPg(pool);
  return instancia;
}
