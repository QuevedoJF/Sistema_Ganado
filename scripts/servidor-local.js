/**
 * Servidor local para desarrollo y pruebas: sirve la página y la API en el mismo puerto.
 * Si no hay DATABASE_URL usa PGlite (PostgreSQL real en WebAssembly) guardado en .datos-locales/.
 *
 *   npm run dev            -> http://localhost:3000
 *   PORT=4000 npm run dev
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { manejar } from '../api/_lib/rutas.js';
import { usarBase, adaptadorPglite } from '../api/_lib/db.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};
const PROHIBIDOS = /^\/(api|scripts|tests|node_modules|\.datos-locales|\.git|\.codex|\.gemini)(\/|$)|^\/(package(-lock)?\.json|vercel\.json|\.vercelignore|\.gitignore)$/;

// Mismas cabeceras de seguridad que en Vercel (vercel.json)
const CABECERAS = JSON.parse(await fs.readFile(path.join(raiz, 'vercel.json'), 'utf8')).headers
  .filter((h) => h.source === '/(.*)')
  .flatMap((h) => h.headers);

export async function crearServidor({ adaptador } = {}) {
  if (adaptador) usarBase(adaptador);
  return http.createServer(async (req, res) => {
    for (const { key, value } of CABECERAS) res.setHeader(key, value);
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return manejar(req, res);

    let ruta;
    try {
      ruta = decodeURIComponent(url.pathname);
    } catch {
      res.statusCode = 400;
      return res.end('Dirección inválida');
    }
    if (ruta === '/') ruta = '/index.html';
    if (PROHIBIDOS.test(ruta) || ruta.includes('..')) {
      res.statusCode = 404;
      return res.end('No encontrado');
    }
    try {
      const archivo = path.join(raiz, ruta);
      const contenido = await fs.readFile(archivo);
      res.setHeader('Content-Type', TIPOS[path.extname(archivo)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(contenido);
    } catch {
      res.statusCode = 404;
      res.end('No encontrado');
    }
  });
}

// Ejecución directa: npm run dev
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.env.COOKIE_INSEGURA = '1'; // http://localhost no usa HTTPS
  if (!process.env.SETUP_TOKEN) process.env.SETUP_TOKEN = 'configuracion-local';

  let adaptador;
  if (!process.env.DATABASE_URL) {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = path.join(raiz, '.datos-locales', 'pg');
    await fs.mkdir(dir, { recursive: true });
    adaptador = adaptadorPglite(new PGlite(dir));
    console.log('Base local PGlite en .datos-locales/pg');
  }
  const servidor = await crearServidor({ adaptador });
  const puerto = Number(process.env.PORT) || 3000;
  servidor.listen(puerto, () => {
    console.log(`Servidor local en http://localhost:${puerto}`);
    console.log(`Código de configuración inicial: ${process.env.SETUP_TOKEN}`);
  });
}
