/**
 * Almacenamiento local del dispositivo en IndexedDB (sin el límite de ~5 MB de localStorage).
 * Si IndexedDB no está disponible (modo privado de algunos navegadores), usa localStorage.
 */
(function (global) {
  const NOMBRE = 'rancho-ganadero';
  const TIENDA = 'datos';
  let promesaDb = null;

  function abrir() {
    if (promesaDb) return promesaDb;
    promesaDb = new Promise((resolve) => {
      try {
        if (!global.indexedDB) return resolve(null);
        const req = global.indexedDB.open(NOMBRE, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(TIENDA);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
    return promesaDb;
  }

  function operacion(modo, fn) {
    return abrir().then(
      (db) =>
        db &&
        new Promise((resolve, reject) => {
          const tx = db.transaction(TIENDA, modo);
          const req = fn(tx.objectStore(TIENDA));
          tx.oncomplete = () => resolve(req ? req.result : undefined);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        })
    );
  }

  global.RanchoAlmacen = {
    async leer(clave) {
      const db = await abrir();
      if (!db) {
        const raw = localStorage.getItem(`almacen:${clave}`);
        return raw ? JSON.parse(raw) : null;
      }
      const v = await operacion('readonly', (s) => s.get(clave));
      return v === undefined ? null : v;
    },

    async guardar(clave, valor) {
      const db = await abrir();
      if (!db) {
        localStorage.setItem(`almacen:${clave}`, JSON.stringify(valor));
        return;
      }
      await operacion('readwrite', (s) => s.put(valor, clave));
    },

    async borrar(clave) {
      const db = await abrir();
      if (!db) {
        localStorage.removeItem(`almacen:${clave}`);
        return;
      }
      await operacion('readwrite', (s) => s.delete(clave));
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
