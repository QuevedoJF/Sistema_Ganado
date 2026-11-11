/**
 * Motor de Validaciones Anti-Errores del Rancho (Fierro F y Fierro H)
 */

window.RanchoValidations = {
  CATEGORIAS_POR_SEXO: {
    Hembra: [
      'Becerra (Lactante)',
      'Becerra Destetada',
      'Novillona',
      'Vaca de Cría',
      'Vaca de Engorda / Desecho'
    ],
    Macho: [
      'Becerro (Lactante)',
      'Becerro Destetado',
      'Torete / Engorda',
      'Toro Semental',
      'Buey / Trabajo'
    ]
  },

  normalizarTexto(val) {
    return String(val || '').trim().toUpperCase();
  },

  /** Limpia un número de animal tecleado: quita "#" y espacios, mayúsculas. */
  normalizarNumero(val) {
    return this.normalizarTexto(val).replace(/^#+/, '').replace(/\s+/g, '');
  },

  /** Compara números de animal: "15", "#15" y "015" se consideran el mismo número. */
  mismoNumero(a, b) {
    const x = this.normalizarNumero(a);
    const y = this.normalizarNumero(b);
    if (!x || !y) return false;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) return parseInt(x, 10) === parseInt(y, 10);
    return x === y;
  },

  /**
   * Busca en TODO el historial (activos, vendidos y muertos).
   * Devuelve grupos: coincidencias exactas por número, por arete (actual o anterior) y por texto.
   * Cada grupo viene ordenado: primero los activos, luego las bajas más recientes.
   */
  buscarHistorial(animales, consulta) {
    const q = String(consulta || '').trim();
    const vacio = { consulta: q, numero: '', porNumero: [], porArete: [], porTexto: [], total: 0 };
    if (!q) return vacio;

    const qNum = this.normalizarNumero(q);
    const qTexto = this.normalizarTexto(q);
    const usados = new Set();

    const ordenar = (lista) =>
      lista.sort((a, b) => {
        const activoA = a.estatus === 'Activo' ? 0 : 1;
        const activoB = b.estatus === 'Activo' ? 0 : 1;
        if (activoA !== activoB) return activoA - activoB;
        const fa = a.fechaBaja || a.fechaNacimiento || '';
        const fb = b.fechaBaja || b.fechaNacimiento || '';
        if (fa !== fb) return String(fb).localeCompare(String(fa));
        return String(a.fierro).localeCompare(String(b.fierro));
      });

    const porNumero = qNum ? animales.filter((a) => this.mismoNumero(a.numero, qNum)) : [];
    porNumero.forEach((a) => usados.add(a.id));

    const porArete =
      qTexto.length >= 3
        ? animales.filter((a) => {
            if (usados.has(a.id)) return false;
            const aretes = [a.arete, ...(Array.isArray(a.aretesAnteriores) ? a.aretesAnteriores : [])];
            return aretes.some((ar) => this.normalizarTexto(ar).includes(qTexto));
          })
        : [];
    porArete.forEach((a) => usados.add(a.id));

    const porTexto =
      qTexto.length >= 3
        ? animales.filter((a) => {
            if (usados.has(a.id)) return false;
            return [
              a.razaColor,
              a.categoria,
              a.compradorDestino,
              a.guiaReemo,
              a.motivoBaja,
              a.notas,
              a.notasBaja,
              a.madreArete
            ]
              .map((v) => this.normalizarTexto(v))
              .some((v) => v && v.includes(qTexto));
          })
        : [];

    return {
      consulta: q,
      numero: porNumero.length > 0 || /^#?\s*\d+$/.test(q) ? qNum : '',
      porNumero: ordenar(porNumero),
      porArete: ordenar(porArete),
      porTexto: ordenar(porTexto),
      total: porNumero.length + porArete.length + porTexto.length
    };
  },

  /**
   * Regla 1: Número único por Fierro (F o H) entre animales Activos.
   * Permite que exista el #15 en Fierro F y el #15 en Fierro H,
   * pero NUNCA dos #15 activos en el mismo Fierro.
   */
  validarNumeroPorFierro(animales, fierro, numero, excludeId = null) {
    const numNorm = this.normalizarTexto(numero);
    const fierroNorm = this.normalizarTexto(fierro);

    if (!numNorm) {
      return {
        valido: false,
        mensaje: 'Debes ingresar el número económico / de rancho del animal.'
      };
    }

    // Buscar si ya existe activo en el mismo fierro
    const conflictoActivo = animales.find(
      (a) =>
        a.id !== excludeId &&
        this.normalizarTexto(a.fierro) === fierroNorm &&
        this.mismoNumero(a.numero, numNorm) &&
        a.estatus === 'Activo'
    );

    if (conflictoActivo) {
      return {
        valido: false,
        conflicto: conflictoActivo,
        mensaje: `¡NÚMERO REPETIDO BLOQUEADO! El número #${numNorm} ya lo tiene una cabeza ACTIVA en el Fierro ${fierroNorm} (${conflictoActivo.sexo} - ${conflictoActivo.categoria}, Arete: ${conflictoActivo.arete || 'S/N'}).`
      };
    }

    // Revisar si existió en animales dados de baja (solo informativo: el número se puede reutilizar)
    const antecedentes = animales
      .filter(
        (a) =>
          a.id !== excludeId &&
          this.normalizarTexto(a.fierro) === fierroNorm &&
          this.mismoNumero(a.numero, numNorm) &&
          a.estatus !== 'Activo'
      )
      .sort((a, b) => String(b.fechaBaja || '').localeCompare(String(a.fechaBaja || '')));

    if (antecedentes.length > 0) {
      const ultimo = antecedentes[0];
      const veces = antecedentes.length === 1 ? 'un animal' : `${antecedentes.length} animales`;
      return {
        valido: true,
        aviso: `Disponible en el Fierro ${fierroNorm}. Este número lo usó antes ${veces} dado de baja (el último: ${ultimo.estatus.toLowerCase()} el ${ultimo.fechaBaja || 'fecha sin registrar'}). Su historial se conserva en el buscador.`
      };
    }

    return {
      valido: true,
      mensaje: `Número #${numNorm} libre y disponible en el Fierro ${fierroNorm}.`
    };
  },

  /**
   * Sugiere el siguiente número libre para el Fierro seleccionado (F o H)
   */
  sugerirSiguienteNumero(animales, fierro) {
    const fierroNorm = this.normalizarTexto(fierro);
    const usadosActivos = new Set();
    let maxNum = 0;

    animales.forEach((a) => {
      if (this.normalizarTexto(a.fierro) === fierroNorm && a.estatus === 'Activo') {
        const parsed = parseInt(String(a.numero).replace(/\D/g, ''), 10);
        if (!isNaN(parsed) && parsed > 0) {
          usadosActivos.add(parsed);
          if (parsed > maxNum) maxNum = parsed;
        }
      }
    });

    // Buscar el primer hueco libre desde 1 o el consecutivo mayor
    let primerHueco = 1;
    while (usadosActivos.has(primerHueco)) {
      primerHueco++;
    }

    const consecutivo = maxNum + 1;
    return {
      sugerido: consecutivo,
      huecoMenor: primerHueco < consecutivo ? primerHueco : null
    };
  },

  /**
   * Regla 2: El número de Arete (SINIIGA / Oficial) es único en TODO el rancho
   * (no puede repetirse ni entre Fierro F y Fierro H).
   */
  validarAreteUnico(animales, arete, excludeId = null) {
    const areteNorm = this.normalizarTexto(arete);

    if (!areteNorm || areteNorm === 'S/N' || areteNorm === 'PENDIENTE') {
      return {
        valido: true,
        sinArete: true,
        mensaje: 'Animal registrado sin número de arete oficial (se marcará como Pendiente de Aretear).'
      };
    }

    const conflicto = animales.find((a) => {
      if (a.id === excludeId) return false;
      const actualMatch = this.normalizarTexto(a.arete) === areteNorm;
      const historialMatch = Array.isArray(a.aretesAnteriores)
        ? a.aretesAnteriores.some((ant) => this.normalizarTexto(ant) === areteNorm)
        : false;
      return actualMatch || historialMatch;
    });

    if (conflicto) {
      return {
        valido: false,
        conflicto,
        mensaje: `¡ARETE DUPLICADO! El arete "${areteNorm}" ya está registrado en el Fierro ${conflicto.fierro}, Número #${conflicto.numero} (${conflicto.sexo}, Estatus: ${conflicto.estatus}).`
      };
    }

    return {
      valido: true,
      mensaje: `Arete "${areteNorm}" verificado y único en todo el rancho.`
    };
  },

  /**
   * Calcula la edad exacta a partir de la fecha de nacimiento
   */
  calcularEdad(fechaNacimiento, fechaReferencia = null) {
    if (!fechaNacimiento) {
      return { texto: 'Sin fecha', mesesTotales: null, requiereDestete: false };
    }

    const inicio = new Date(fechaNacimiento + 'T00:00:00');
    const fin = fechaReferencia ? new Date(fechaReferencia + 'T00:00:00') : new Date();

    if (isNaN(inicio.getTime()) || inicio > fin) {
      return { texto: 'Fecha inválida', mesesTotales: 0, requiereDestete: false };
    }

    let years = fin.getFullYear() - inicio.getFullYear();
    let months = fin.getMonth() - inicio.getMonth();
    let days = fin.getDate() - inicio.getDate();

    if (days < 0) {
      months -= 1;
      const prevMonth = new Date(fin.getFullYear(), fin.getMonth(), 0);
      days += prevMonth.getDate();
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }

    const mesesTotales = years * 12 + months;
    let texto = '';
    if (years > 0) {
      texto = `${years} ${years === 1 ? 'año' : 'años'}${months > 0 ? `, ${months} m` : ''}`;
    } else if (months > 0) {
      texto = `${months} ${months === 1 ? 'mes' : 'meses'}${days > 0 ? `, ${days} d` : ''}`;
    } else {
      texto = `${ Math.max(0, days) } días (Recién nacido)`;
    }

    return {
      texto,
      mesesTotales,
      years,
      months,
      days
    };
  }
};
