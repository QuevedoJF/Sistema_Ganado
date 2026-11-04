/**
 * Módulo de Exportación en Tabla para Excel (.xlsx) y PDF Profesional
 */

window.RanchoExports = {
  formatearMadreTexto(animal) {
    if (!animal.madreNumero && !animal.madreArete) return 'Sin registro';
    const f = animal.madreFierro ? `Fierro ${animal.madreFierro} ` : '';
    const n = animal.madreNumero ? `#${animal.madreNumero}` : '';
    const ar = animal.madreArete ? ` (Arete: ${animal.madreArete})` : '';
    return `${f}${n}${ar}`.trim();
  },

  prepararFilasTabla(animales, config) {
    return animales.map((a) => {
      const edadInfo = window.RanchoValidations.calcularEdad(a.fechaNacimiento, a.fechaBaja || null);
      const prop = a.fierro === 'F' ? config.propietarioF : config.propietarioH;
      return {
        Fierro: `Fierro ${a.fierro}`,
        Propietario: prop,
        Numero_Rancho: `#${a.numero}`,
        Arete_Oficial: a.arete || 'S/N',
        Estado_Arete: a.estadoArete || 'Correcto',
        Sexo: a.sexo === 'Hembra' ? 'Hembra (♀)' : 'Macho (♂)',
        Categoria: a.categoria || '',
        Raza_Color: a.razaColor || '',
        Fecha_Nacimiento: a.fechaNacimiento || 'Sin fecha',
        Edad: edadInfo.texto,
        Peso_Kg: a.pesoActual ? `${a.pesoActual} kg` : '-',
        Madre_Numero_y_Arete: this.formatearMadreTexto(a),
        Estatus: a.estatus,
        Fecha_Venta_o_Baja: a.fechaBaja || '-',
        Comprador: a.estatus === 'Vendido' ? a.compradorDestino || '-' : '-',
        Guia_REEMO: a.estatus === 'Vendido' ? a.guiaReemo || '-' : '-',
        Peso_Venta_Kg: a.estatus === 'Vendido' && a.pesoVenta ? `${a.pesoVenta} kg` : '-',
        Monto_Venta: a.estatus === 'Vendido' && a.precioVenta ? `$${a.precioVenta}` : '-',
        Motivo_o_Causa_Baja: a.motivoBaja || '-',
        Notas: a.notas || a.notasBaja || ''
      };
    });
  },

  /**
   * Descarga un archivo Excel (.xlsx) con tablas separadas por Fierro F, Fierro H, Bajas y Sanidad
   */
  exportarExcel(animalesFiltrados, etiquetaFiltro = 'General') {
    const state = window.RanchoDB.state;
    const config = state.config;
    const todos = state.animales;
    const fechaHoy = new Date().toISOString().slice(0, 10);

    if (typeof window.XLSX === 'undefined') {
      // Fallback CSV para abrir en Excel si no cargó CDN
      this.exportarCSVFallback(animalesFiltrados, config, fechaHoy);
      return;
    }

    const wb = window.XLSX.utils.book_new();

    // 1. Hoja de la vista actual filtrada
    const filasVista = this.prepararFilasTabla(animalesFiltrados, config);
    const wsVista = window.XLSX.utils.json_to_sheet(
      filasVista.length > 0 ? filasVista : [{ Mensaje: 'Sin registros en este filtro' }]
    );
    this.ajustarAnchoColumnas(wsVista);
    window.XLSX.utils.book_append_sheet(wb, wsVista, `Tabla_${etiquetaFiltro}`.slice(0, 31));

    // 2. Hoja exclusiva Fierro F (Activos)
    const activosF = todos.filter((a) => a.fierro === 'F' && a.estatus === 'Activo');
    const wsF = window.XLSX.utils.json_to_sheet(
      activosF.length > 0
        ? this.prepararFilasTabla(activosF, config)
        : [{ Mensaje: 'Sin animales activos en Fierro F' }]
    );
    this.ajustarAnchoColumnas(wsF);
    window.XLSX.utils.book_append_sheet(wb, wsF, 'Fierro_F_Activos');

    // 3. Hoja exclusiva Fierro H (Activos)
    const activosH = todos.filter((a) => a.fierro === 'H' && a.estatus === 'Activo');
    const wsH = window.XLSX.utils.json_to_sheet(
      activosH.length > 0
        ? this.prepararFilasTabla(activosH, config)
        : [{ Mensaje: 'Sin animales activos en Fierro H' }]
    );
    this.ajustarAnchoColumnas(wsH);
    window.XLSX.utils.book_append_sheet(wb, wsH, 'Fierro_H_Activos');

    // 4. Hoja de Ventas y Bajas por Muerte
    const bajas = todos.filter((a) => a.estatus !== 'Activo');
    const wsBajas = window.XLSX.utils.json_to_sheet(
      bajas.length > 0
        ? this.prepararFilasTabla(bajas, config)
        : [{ Mensaje: 'Sin bajas registradas' }]
    );
    this.ajustarAnchoColumnas(wsBajas);
    window.XLSX.utils.book_append_sheet(wb, wsBajas, 'Ventas_y_Muertes');

    // 5. Hoja de Sanidad y Pesajes
    const filasSanidad = state.eventosSanitarios.map((ev) => {
      const animal = todos.find((a) => a.id === ev.animalId);
      return {
        Fecha: ev.fecha,
        Fierro: animal ? `Fierro ${animal.fierro}` : '-',
        Numero_Animal: animal ? `#${animal.numero}` : '-',
        Arete: animal ? animal.arete : '-',
        Tipo_Manejo: ev.tipo,
        Producto_Vacuna: ev.producto,
        Dosis: ev.dosis || '-',
        Peso_Registrado_Kg: ev.pesoKg || '-',
        Proximo_Refuerzo: ev.proximaFecha || '-',
        Observaciones: ev.notas || ''
      };
    });
    const wsSan = window.XLSX.utils.json_to_sheet(
      filasSanidad.length > 0 ? filasSanidad : [{ Mensaje: 'Sin registros sanitarios aún' }]
    );
    this.ajustarAnchoColumnas(wsSan);
    window.XLSX.utils.book_append_sheet(wb, wsSan, 'Sanidad_y_Pesajes');

    window.XLSX.writeFile(wb, `Control_Ganadero_F_y_H_${fechaHoy}.xlsx`);
  },

  ajustarAnchoColumnas(ws) {
    ws['!cols'] = [
      { wch: 11 }, // Fierro
      { wch: 22 }, // Propietario
      { wch: 14 }, // Numero
      { wch: 16 }, // Arete
      { wch: 16 }, // Estado Arete
      { wch: 13 }, // Sexo
      { wch: 20 }, // Categoria
      { wch: 18 }, // Raza
      { wch: 15 }, // Fecha Nac
      { wch: 16 }, // Edad
      { wch: 11 }, // Peso
      { wch: 28 }, // Madre
      { wch: 12 }, // Estatus
      { wch: 16 }, // Fecha Baja
      { wch: 26 }, // Motivo / Comprador
      { wch: 30 }  // Notas
    ];
  },

  exportarCSVFallback(animalesFiltrados, config, fechaHoy) {
    const filas = this.prepararFilasTabla(animalesFiltrados, config);
    if (filas.length === 0) return;
    const headers = Object.keys(filas[0]);
    const csvRows = [
      headers.join(','),
      ...filas.map((row) =>
        headers.map((h) => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(',')
      )
    ];
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Control_Ganadero_${fechaHoy}.csv`;
    link.click();
  },

  /**
   * Descarga un archivo PDF con Tabla de Ganado lista para imprimir o enviar por WhatsApp
   */
  exportarPDF(animalesFiltrados, tituloReporte = 'Inventario General de Ganado') {
    const state = window.RanchoDB.state;
    const config = state.config;
    const fechaHoy = new Date().toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    if (!window.jspdf || !window.jspdf.jsPDF) {
      window.print();
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });

    // Encabezado del Rancho
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 280, 26, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.text(`${config.nombreRancho} - ${tituloReporte}`, 14, 11);

    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    const totalF = animalesFiltrados.filter((a) => a.fierro === 'F').length;
    const totalH = animalesFiltrados.filter((a) => a.fierro === 'H').length;
    const totalHembras = animalesFiltrados.filter((a) => a.sexo === 'Hembra').length;
    const totalMachos = animalesFiltrados.filter((a) => a.sexo === 'Macho').length;

    doc.text(
      `Fecha de corte: ${fechaHoy}   |   Fierro F (${config.propietarioF}): ${totalF} cab.   |   Fierro H (${config.propietarioH}): ${totalH} cab.   |   Hembras: ${totalHembras} / Machos: ${totalMachos}   |   Total listado: ${animalesFiltrados.length}`,
      14,
      19
    );

    const tableBody = animalesFiltrados.map((a) => {
      const edad = window.RanchoValidations.calcularEdad(a.fechaNacimiento, a.fechaBaja || null);
      const detalleEstatus =
        a.estatus === 'Activo'
          ? 'ACTIVO EN RANCHO'
          : a.estatus === 'Vendido'
          ? `VENDIDO (${a.fechaBaja || ''})\nComprador: ${a.compradorDestino || 'No reg.'}${a.guiaReemo ? '\nGuía REEMO: ' + a.guiaReemo : ''}${a.pesoVenta ? '\nPeso: ' + a.pesoVenta + ' kg' : ''}${a.precioVenta ? ' | $' + a.precioVenta : ''}`
          : `BAJA MUERTE (${a.fechaBaja || ''})\nCausa: ${a.motivoBaja || ''}`;

      return [
        `Fierro ${a.fierro}`,
        `#${a.numero}`,
        `${a.arete || 'S/N'}\n(${a.estadoArete || 'Correcto'})`,
        `${a.sexo === 'Hembra' ? 'Hembra (H)' : 'Macho (M)'}\n${a.categoria || ''}`,
        `${a.fechaNacimiento || 'S/F'}\n(${edad.texto})`,
        this.formatearMadreTexto(a),
        a.pesoActual ? `${a.pesoActual} kg` : '-',
        detalleEstatus,
        a.notas || a.notasBaja || ''
      ];
    });

    doc.autoTable({
      startY: 31,
      head: [
        [
          'Fierro',
          'Núm.',
          'Arete Oficial',
          'Sexo y Categoría',
          'Nacimiento / Edad',
          'Madre (Fierro / Núm / Arete)',
          'Peso',
          'Estatus / Baja',
          'Observaciones'
        ]
      ],
      body: tableBody,
      theme: 'grid',
      styles: {
        fontSize: 8,
        cellPadding: 2.5,
        valign: 'middle',
        lineColor: [203, 213, 225],
        lineWidth: 0.2
      },
      headStyles: {
        fillColor: [21, 128, 61],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5
      },
      didParseCell: function (data) {
        if (data.section === 'body' && data.column.index === 0) {
          const val = String(data.cell.raw || '');
          if (val.includes('Fierro F')) {
            data.cell.styles.fillColor = [220, 252, 231];
            data.cell.styles.textColor = [20, 83, 45];
            data.cell.styles.fontStyle = 'bold';
          } else if (val.includes('Fierro H')) {
            data.cell.styles.fillColor = [254, 243, 199];
            data.cell.styles.textColor = [120, 53, 15];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
    });

    const fechaArchivo = new Date().toISOString().slice(0, 10);
    doc.save(`Tabla_Ganado_Rancho_FH_${fechaArchivo}.pdf`);
  }
};
