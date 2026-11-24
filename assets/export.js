/* Word and Excel export. The libraries load only when someone exports. */
(function () {
  var LIBS = {
    docx: 'https://unpkg.com/docx@9.15.3/dist/index.iife.js',
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
  };
  var loading = {};
  function load(name, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (!loading[name]) {
      loading[name] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = LIBS[name];
        s.onload = function () { window[globalName] ? resolve(window[globalName]) : reject(new Error('The ' + name + ' library did not load.')); };
        s.onerror = function () { delete loading[name]; reject(new Error('Could not download the ' + name + ' library. Check the internet connection.')); };
        document.head.appendChild(s);
      });
    }
    return loading[name];
  }
  function fileSafe(s) { return String(s).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'export'; }
  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function hex(c) {
    if (!c) return undefined;
    c = c.trim();
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
    if (m) { var h = m[1]; return (h.length === 3 ? h.split('').map(function (x) { return x + x; }).join('') : h).toUpperCase(); }
    m = /^rgba?\((\d+)\D+(\d+)\D+(\d+)/i.exec(c);
    if (m) return [m[1], m[2], m[3]].map(function (n) { return ('0' + (+n).toString(16)).slice(-2); }).join('').toUpperCase();
    return undefined;
  }
  var FONT_PT = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 };

  /* ---------- Process narrative -> Word ---------- */
  function narrativeToDocx(docx, title, htmlStr) {
    var P = docx.Paragraph, R = docx.TextRun;
    var dom = new DOMParser().parseFromString('<div>' + (htmlStr || '') + '</div>', 'text/html').body.firstChild;
    var out = [], listInstance = 0;

    function runs(node, fmt, acc) {
      Array.prototype.forEach.call(node.childNodes, function (ch) {
        if (ch.nodeType === 3) {
          if (ch.nodeValue) acc.push(new R(Object.assign({ text: ch.nodeValue.replace(/\s+/g, ' ') }, fmt)));
          return;
        }
        if (ch.nodeType !== 1) return;
        var t = ch.tagName, f = Object.assign({}, fmt), st = ch.style || {};
        if (t === 'BR') { acc.push(new R({ text: '', break: 1 })); return; }
        if (t === 'B' || t === 'STRONG' || /bold|[6-9]00/.test(st.fontWeight || '')) f.bold = true;
        if (t === 'I' || t === 'EM' || st.fontStyle === 'italic') f.italics = true;
        if (t === 'U' || /underline/.test(st.textDecoration || st.textDecorationLine || '')) f.underline = {};
        var col = hex(ch.getAttribute('color') || st.color); if (col) f.color = col;
        var face = ch.getAttribute('face') || (st.fontFamily || '').split(',')[0].replace(/["']/g, '').trim(); if (face) f.font = face;
        var sz = ch.getAttribute('size'); if (sz && FONT_PT[sz]) f.size = FONT_PT[sz] * 2;
        var px = /([\d.]+)px/.exec(st.fontSize || ''); if (px) f.size = Math.round(+px[1] * 0.75 * 2);
        if (/^(UL|OL|P|H1|H2|H3|DIV)$/.test(t)) { block(ch); return; }
        runs(ch, f, acc);
      });
      return acc;
    }
    function align(el) {
      var a = (el.style && el.style.textAlign) || el.getAttribute('align') || '';
      return { center: docx.AlignmentType.CENTER, justify: docx.AlignmentType.BOTH, right: docx.AlignmentType.RIGHT }[a] || undefined;
    }
    function block(el) {
      var t = el.tagName;
      if (t === 'UL' || t === 'OL') {
        listInstance += 1;
        var inst = listInstance;
        Array.prototype.forEach.call(el.children, function (li) {
          var opt = { children: runs(li, {}, []), alignment: align(li) };
          if (t === 'UL') opt.bullet = { level: 0 }; else opt.numbering = { reference: 'num', level: 0, instance: inst };
          out.push(new P(opt));
        });
        return;
      }
      var heading = { H1: docx.HeadingLevel.HEADING_1, H2: docx.HeadingLevel.HEADING_2, H3: docx.HeadingLevel.HEADING_3 }[t];
      out.push(new P({ heading: heading, alignment: align(el), children: runs(el, {}, []) }));
    }
    var loose = [];
    function flush() { if (loose.length) { out.push(new P({ children: loose })); loose = []; } }
    Array.prototype.forEach.call(dom.childNodes, function (n) {
      if (n.nodeType === 1 && /^(UL|OL|P|H1|H2|H3|DIV)$/.test(n.tagName)) { flush(); block(n); }
      else if (n.nodeType === 3 && !n.nodeValue.trim()) { /* skip whitespace */ }
      else { var wrap = document.createElement('span'); wrap.appendChild(n.cloneNode(true)); runs(wrap, {}, loose); }
    });
    flush();
    if (!out.length) out.push(new P({ children: [new R(title)] }));

    return new docx.Document({
      creator: 'ICFR Portal', title: title,
      styles: {
        default: {
          document: { run: { font: 'Arial', size: 22, color: '222222' }, paragraph: { spacing: { after: 120, line: 300 } } },
          heading1: { run: { font: 'Arial', size: 36, bold: true, color: '1F2D3D' }, paragraph: { spacing: { after: 200 } } },
          heading2: { run: { font: 'Arial', size: 28, bold: true, color: '1F3A5F' }, paragraph: { spacing: { before: 280, after: 100 } } },
          heading3: { run: { font: 'Arial', size: 24, bold: true, color: '1F3A5F' }, paragraph: { spacing: { before: 200, after: 80 } } }
        }
      },
      numbering: { config: [{ reference: 'num', levels: [{ level: 0, format: docx.LevelFormat.DECIMAL, text: '%1.', alignment: docx.AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
      sections: [{ children: out }]
    });
  }

  function narrativeDocx(proc, htmlStr) {
    return load('docx', 'docx').then(function (docx) {
      return docx.Packer.toBlob(narrativeToDocx(docx, proc.name, htmlStr));
    }).then(function (blob) { download(blob, fileSafe(proc.name) + ' - Process narrative.docx'); });
  }

  /* ---------- RCM ---------- */
  function rcmTable(rcm) {
    var head = rcm.cols.map(function (c) { return c.label; });
    var rows = rcm.rows.map(function (r) {
      return rcm.cols.map(function (c) { var v = r.values[c.key]; return Array.isArray(v) ? v.join('; ') : (v === undefined || v === null ? '' : String(v)); });
    });
    return { head: head, rows: rows };
  }

  function rcmXlsx(proc, rcm) {
    return load('xlsx', 'XLSX').then(function (XLSX) {
      var t = rcmTable(rcm);
      var ws = XLSX.utils.aoa_to_sheet([t.head].concat(t.rows));
      var wide = { riskDesc: 40, controlDesc: 50, attrs: 30, assertions: 24 };
      ws['!cols'] = rcm.cols.map(function (c) { return { wch: wide[c.key] || Math.max(12, c.label.length + 2) }; });
      if (t.rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: t.rows.length, c: t.head.length - 1 } }) };
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, (proc.code || 'RCM').slice(0, 31));
      XLSX.writeFile(wb, fileSafe(proc.name) + ' - RCM.xlsx');
    });
  }

  function rcmDocx(proc, rcm) {
    return load('docx', 'docx').then(function (docx) {
      var t = rcmTable(rcm);
      function cell(text, headRow) {
        return new docx.TableCell({
          shading: headRow ? { fill: '1F3A5F', type: docx.ShadingType.CLEAR, color: 'auto' } : undefined,
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [new docx.Paragraph({ spacing: { after: 0 }, children: [new docx.TextRun({ text: text, bold: !!headRow, color: headRow ? 'FFFFFF' : '1F2D3D', size: 16, font: 'Arial' })] })]
        });
      }
      var rows = [new docx.TableRow({ tableHeader: true, children: t.head.map(function (h) { return cell(h, true); }) })]
        .concat(t.rows.map(function (r) { return new docx.TableRow({ children: r.map(function (v) { return cell(v, false); }) }); }));
      var doc = new docx.Document({
        creator: 'ICFR Portal', title: proc.name + ' RCM',
        sections: [{
          properties: { page: { size: { orientation: docx.PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
          children: [
            new docx.Paragraph({ spacing: { after: 200 }, children: [new docx.TextRun({ text: proc.name + ': risk and control matrix', bold: true, size: 32, color: '1F3A5F', font: 'Arial' })] }),
            t.rows.length ? new docx.Table({ width: { size: 100, type: docx.WidthType.PERCENTAGE }, rows: rows })
              : new docx.Paragraph({ children: [new docx.TextRun({ text: 'No controls yet.', font: 'Arial' })] })
          ]
        }]
      });
      return docx.Packer.toBlob(doc);
    }).then(function (blob) { download(blob, fileSafe(proc.name) + ' - RCM.docx'); });
  }

  window.ICFR_EXPORT = { narrativeDocx: narrativeDocx, rcmXlsx: rcmXlsx, rcmDocx: rcmDocx };
})();
