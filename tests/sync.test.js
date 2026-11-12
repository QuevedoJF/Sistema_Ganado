/**
 * Pruebas del motor de sincronización del dispositivo (js/sync.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../js/sync.js', import.meta.url), 'utf8'), ctx);
const S = ctx.RanchoSync;

const cfg = { nombreRancho: 'R', edadDesteteMeses: 7, fierros: [{ codigo: 'F', propietario: 'A', tono: 0 }] };
const vaca = (id, extra = {}) => ({ id, fierro: 'F', numero: '15', sexo: 'Hembra', estatus: 'Activo', arete: 'S/N', aretesAnteriores: [], ...extra });
const copia = (x) => JSON.parse(JSON.stringify(x));

test('sin cambios no hay operaciones (465 = "465", "" = null)', () => {
  const base = { config: cfg, animales: { A: vaca('A', { pesoActual: 465, notas: null }) }, eventos: {} };
  const estado = { config: copia(cfg), animales: [vaca('A', { pesoActual: '465', notas: '', createdAt: 'x' })], eventosSanitarios: [] };
  assert.equal(S.calcularOps(estado, base).length, 0);
});

test('solo se envían los campos que cambiaron', () => {
  const base = { config: cfg, animales: { A: vaca('A', { pesoActual: 400 }) }, eventos: {} };
  const estado = { config: cfg, animales: [vaca('A', { pesoActual: 420 })], eventosSanitarios: [] };
  const ops = S.calcularOps(estado, base);
  assert.equal(ops.length, 1);
  assert.deepEqual(copia(ops[0].cambios), { pesoActual: 420 });
});

test('registros nuevos, borrados y cambios de configuración', () => {
  const base = { config: cfg, animales: { A: vaca('A'), B: vaca('B', { numero: '16' }) }, eventos: {} };
  const estado = {
    config: { ...cfg, nombreRancho: 'Nuevo' },
    animales: [vaca('A'), vaca('C', { numero: '17' })],
    eventosSanitarios: [{ id: 'E', animalId: 'A', tipo: 'Pesaje', producto: 'Báscula' }]
  };
  const ops = S.calcularOps(estado, base);
  const resumen = ops.map((o) => `${o.entidad}:${o.id}:${o.eliminado ? 'borrar' : o.nuevo ? 'nuevo' : 'cambio'}`);
  assert.deepEqual(copia(resumen.sort()), ['animal:B:borrar', 'animal:C:nuevo', 'config:rancho:cambio', 'evento:E:nuevo'].sort());
});

test('rebase: un cambio hecho durante la petición no se pierde', () => {
  const baseAnt = { config: cfg, animales: { A: vaca('A', { pesoActual: 400, version: 1 }) }, eventos: {} };
  const estadoEnviado = { config: cfg, animales: [vaca('A', { pesoActual: 420 })], eventosSanitarios: [] };
  const ops = S.calcularOps(estadoEnviado, baseAnt);
  const foto = S.fotoDe(estadoEnviado, ops);
  // Mientras viajaba la petición el usuario escribió una nota
  const estadoAhora = { ...estadoEnviado, animales: [vaca('A', { pesoActual: 420, notas: 'Nueva nota' })] };
  // El servidor confirma el peso y además otro dispositivo cambió la raza
  const respuesta = {
    cursor: 10,
    config: null,
    animales: [vaca('A', { pesoActual: 420, razaColor: 'Brahman', version: 3 })],
    eventosSanitarios: [],
    rechazos: []
  };
  const r = S.aplicarRespuesta(estadoAhora, baseAnt, { ops, foto }, respuesta);
  const a = r.estado.animales[0];
  assert.equal(a.pesoActual, 420);
  assert.equal(a.razaColor, 'Brahman', 'llega el cambio del otro dispositivo');
  assert.equal(a.notas, 'Nueva nota', 'se conserva la nota escrita durante la petición');
  assert.equal(r.base.animales.A.version, 3);
  // Lo único pendiente es la nota
  const pendientes = S.calcularOps(r.estado, r.base);
  assert.deepEqual(copia(pendientes[0].cambios), { notas: 'Nueva nota' });
});

test('cambios hechos sin señal sobreviven a cambios de otro dispositivo en el mismo animal', () => {
  const baseAnt = { config: cfg, animales: { A: vaca('A', { pesoActual: 400 }) }, eventos: {} };
  const estado = { config: cfg, animales: [vaca('A', { pesoActual: 450 })], eventosSanitarios: [] };
  // Solo se descargan cambios (no se envió nada todavía)
  const respuesta = { cursor: 5, animales: [vaca('A', { pesoActual: 400, categoria: 'Novillona' })], eventosSanitarios: [], rechazos: [] };
  const r = S.aplicarRespuesta(estado, baseAnt, { ops: [], foto: {} }, respuesta);
  assert.equal(r.estado.animales[0].pesoActual, 450);
  assert.equal(r.estado.animales[0].categoria, 'Novillona');
});

test('rechazo: no se reintenta hasta que el usuario edite el registro', () => {
  const baseAnt = { config: cfg, animales: {}, eventos: {} };
  const estado = { config: cfg, animales: [vaca('N', { numero: '15' })], eventosSanitarios: [] };
  const ops = S.calcularOps(estado, baseAnt);
  const respuesta = {
    cursor: 7, animales: [], eventosSanitarios: [],
    rechazos: [{ entidad: 'animal', id: 'N', codigo: 'NUMERO_DUPLICADO', motivo: 'El número #15 ya lo tiene otro animal' }]
  };
  const r = S.aplicarRespuesta(estado, baseAnt, { ops, foto: S.fotoDe(estado, ops) }, respuesta);
  assert.ok(r.estado.animales.find((a) => a.id === 'N'), 'el registro local no se pierde');
  assert.equal(r.rechazos['animal:N'].codigo, 'NUMERO_DUPLICADO');
  assert.equal(S.calcularOps(r.estado, r.base, r.rechazos).length, 0, 'no se reintenta igual');
  const editado = { ...r.estado, animales: [vaca('N', { numero: '29' })] };
  assert.equal(S.calcularOps(editado, r.base, r.rechazos).length, 1, 'al corregirlo se reintenta');
});

test('descartar un cambio rechazado devuelve la versión del servidor', () => {
  const base = { config: cfg, animales: { A: vaca('A', { numero: '15' }) }, eventos: {} };
  const estado = { config: cfg, animales: [vaca('A', { numero: '16' }), vaca('N', { numero: '30' })], eventosSanitarios: [] };
  let e = S.descartarCambio(estado, base, 'animal:A');
  assert.equal(e.animales.find((a) => a.id === 'A').numero, '15');
  e = S.descartarCambio(e, base, 'animal:N');
  assert.ok(!e.animales.find((a) => a.id === 'N'), 'un registro nuevo rechazado se quita');
});

test('borrado remoto quita el registro; carga completa limpia lo que ya no existe', () => {
  const baseAnt = { config: cfg, animales: { A: vaca('A'), B: vaca('B', { numero: '2' }) }, eventos: {} };
  const estado = { config: cfg, animales: [vaca('A'), vaca('B', { numero: '2' }), vaca('LOCAL', { numero: '9' })], eventosSanitarios: [] };
  let r = S.aplicarRespuesta(estado, baseAnt, { ops: [], foto: {} }, { cursor: 3, animales: [{ id: 'B', eliminado: true }], eventosSanitarios: [], rechazos: [] });
  assert.deepEqual(copia(r.estado.animales.map((a) => a.id).sort()), ['A', 'LOCAL']);
  r = S.aplicarRespuesta(estado, baseAnt, { ops: [], foto: {} }, { cursor: 3, completo: true, config: cfg, animales: [vaca('A')], eventosSanitarios: [], rechazos: [] });
  assert.deepEqual(copia(r.estado.animales.map((a) => a.id).sort()), ['A', 'LOCAL'], 'B desapareció del servidor; LOCAL es nuevo y se conserva');
});
