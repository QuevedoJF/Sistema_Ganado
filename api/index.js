/**
 * Función de Vercel: atiende todas las rutas /api/* (ver rewrites en vercel.json).
 */
import { manejar } from './_lib/rutas.js';

export default function handler(req, res) {
  return manejar(req, res);
}
