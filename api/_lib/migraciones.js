/**
 * Migraciones versionadas de la base de datos. Se aplican solas (una vez por arranque del servidor).
 * Nunca edites una migración ya publicada: agrega una nueva al final de la lista.
 */

export const MIGRACIONES = [
  {
    version: 1,
    nombre: 'esquema inicial',
    sql: `
      -- Contador global: cada cambio recibe un número mayor; los dispositivos piden "lo nuevo desde X".
      CREATE SEQUENCE cambios_seq;

      CREATE TABLE usuarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL,
        nombre text NOT NULL,
        password_hash text NOT NULL,
        activo boolean NOT NULL DEFAULT true,
        creado timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT usuarios_email_key UNIQUE (email),
        CONSTRAINT usuarios_email_minusculas CHECK (email = lower(email))
      );

      CREATE TABLE sesiones (
        token_hash text PRIMARY KEY,
        usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        creada timestamptz NOT NULL DEFAULT now(),
        expira timestamptz NOT NULL
      );
      CREATE INDEX sesiones_usuario ON sesiones (usuario_id);

      CREATE TABLE intentos_login (
        id bigserial PRIMARY KEY,
        email text NOT NULL,
        ip text,
        exito boolean NOT NULL,
        fecha timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX intentos_login_email ON intentos_login (email, fecha);
      CREATE INDEX intentos_login_ip ON intentos_login (ip, fecha);

      CREATE TABLE ranchos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre text NOT NULL,
        edad_destete_meses int NOT NULL DEFAULT 7 CHECK (edad_destete_meses BETWEEN 1 and 36),
        version int NOT NULL DEFAULT 1,
        seq bigint NOT NULL DEFAULT nextval('cambios_seq'),
        creado timestamptz NOT NULL DEFAULT now(),
        actualizado timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE miembros (
        rancho_id uuid NOT NULL REFERENCES ranchos(id) ON DELETE CASCADE,
        usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        rol text NOT NULL CHECK (rol IN ('admin', 'editor', 'lector')),
        creado timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (rancho_id, usuario_id)
      );

      CREATE TABLE fierros (
        rancho_id uuid NOT NULL REFERENCES ranchos(id) ON DELETE CASCADE,
        codigo text NOT NULL CHECK (codigo ~ '^[A-Z0-9Ñ]{1,3}$'),
        propietario text NOT NULL CHECK (length(propietario) BETWEEN 1 AND 80),
        tono int NOT NULL DEFAULT 0 CHECK (tono BETWEEN 0 AND 7),
        orden int NOT NULL DEFAULT 0,
        PRIMARY KEY (rancho_id, codigo)
      );

      CREATE TABLE animales (
        rancho_id uuid NOT NULL REFERENCES ranchos(id) ON DELETE CASCADE,
        id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,80}$'),
        fierro text NOT NULL,
        numero text NOT NULL CHECK (length(numero) BETWEEN 1 AND 20),
        numero_norm text NOT NULL,
        arete text NOT NULL DEFAULT 'S/N',
        aretes_anteriores text[] NOT NULL DEFAULT '{}',
        color_arete text,
        estado_arete text,
        sexo text NOT NULL CHECK (sexo IN ('Hembra', 'Macho')),
        categoria text,
        raza_color text,
        fecha_nacimiento date,
        origen text,
        peso_actual numeric(7,1) CHECK (peso_actual IS NULL OR peso_actual >= 0),
        madre_id text,
        madre_fierro text,
        madre_numero text,
        madre_arete text,
        estatus text NOT NULL DEFAULT 'Activo' CHECK (estatus IN ('Activo', 'Vendido', 'Muerto')),
        fecha_baja date,
        motivo_baja text,
        comprador_destino text,
        guia_reemo text,
        peso_venta numeric(7,1),
        precio_venta numeric(12,2),
        notas_baja text,
        notas text,
        eliminado boolean NOT NULL DEFAULT false,
        version int NOT NULL DEFAULT 1,
        seq bigint NOT NULL DEFAULT nextval('cambios_seq'),
        creado timestamptz NOT NULL DEFAULT now(),
        actualizado timestamptz NOT NULL DEFAULT now(),
        actualizado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
        PRIMARY KEY (rancho_id, id),
        CONSTRAINT animales_fierro_fk FOREIGN KEY (rancho_id, fierro) REFERENCES fierros (rancho_id, codigo)
      );
      -- Un número no se repite entre animales ACTIVOS del mismo fierro.
      -- Al vender o morir, el número queda libre y el registro viejo se conserva.
      CREATE UNIQUE INDEX animales_numero_activo_unico
        ON animales (rancho_id, fierro, numero_norm)
        WHERE estatus = 'Activo' AND NOT eliminado;
      CREATE INDEX animales_cambios ON animales (rancho_id, seq);
      CREATE INDEX animales_numero ON animales (rancho_id, numero_norm);

      -- Cada arete usado (actual o anterior) pertenece a un solo animal en todo el rancho.
      CREATE TABLE aretes (
        rancho_id uuid NOT NULL,
        arete_norm text NOT NULL,
        animal_id text NOT NULL,
        PRIMARY KEY (rancho_id, arete_norm),
        FOREIGN KEY (rancho_id, animal_id) REFERENCES animales (rancho_id, id) ON DELETE CASCADE
      );

      CREATE TABLE eventos_sanitarios (
        rancho_id uuid NOT NULL REFERENCES ranchos(id) ON DELETE CASCADE,
        id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,80}$'),
        animal_id text NOT NULL,
        fecha date,
        tipo text NOT NULL,
        producto text NOT NULL,
        dosis text,
        peso_kg numeric(7,1),
        proxima_fecha date,
        notas text,
        eliminado boolean NOT NULL DEFAULT false,
        version int NOT NULL DEFAULT 1,
        seq bigint NOT NULL DEFAULT nextval('cambios_seq'),
        creado timestamptz NOT NULL DEFAULT now(),
        actualizado timestamptz NOT NULL DEFAULT now(),
        actualizado_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
        PRIMARY KEY (rancho_id, id),
        FOREIGN KEY (rancho_id, animal_id) REFERENCES animales (rancho_id, id)
      );
      CREATE INDEX eventos_cambios ON eventos_sanitarios (rancho_id, seq);

      CREATE TABLE auditoria (
        id bigserial PRIMARY KEY,
        rancho_id uuid NOT NULL REFERENCES ranchos(id) ON DELETE CASCADE,
        usuario_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
        entidad text NOT NULL,
        entidad_id text NOT NULL,
        accion text NOT NULL,
        cambios jsonb,
        fecha timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX auditoria_rancho_fecha ON auditoria (rancho_id, fecha DESC);
    `
  }
];

let pendiente = null;

/** Aplica las migraciones que falten. Se ejecuta una sola vez por proceso. */
export function asegurarMigraciones(db) {
  if (!pendiente) {
    pendiente = aplicar(db).catch((err) => {
      pendiente = null; // reintentar en la siguiente petición
      throw err;
    });
  }
  return pendiente;
}

/** Solo para pruebas: olvidar que ya se migró (cuando se cambia de base). */
export function reiniciarEstadoMigraciones() {
  pendiente = null;
}

async function aplicar(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migraciones (
      version int PRIMARY KEY,
      nombre text NOT NULL,
      aplicada timestamptz NOT NULL DEFAULT now()
    );
  `);
  const { rows } = await db.query('SELECT version FROM schema_migraciones');
  const hechas = new Set(rows.map((r) => Number(r.version)));

  for (const m of MIGRACIONES) {
    if (hechas.has(m.version)) continue;
    await db.tx(async (t) => {
      // Bloqueo para que dos arranques simultáneos no apliquen la misma migración
      await t.query('SELECT pg_advisory_xact_lock(727274)');
      const ya = await t.query('SELECT 1 FROM schema_migraciones WHERE version = $1', [m.version]);
      if (ya.rows.length) return;
      for (const sentencia of dividirSql(m.sql)) {
        await t.query(sentencia);
      }
      await t.query('INSERT INTO schema_migraciones (version, nombre) VALUES ($1, $2)', [
        m.version,
        m.nombre
      ]);
    });
  }
}

/** Divide un bloque SQL en sentencias (las migraciones no usan ';' dentro de cadenas). */
function dividirSql(sql) {
  return sql
    .split('\n')
    .filter((linea) => !linea.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
