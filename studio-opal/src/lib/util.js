export const uid = () => Math.random().toString(36).slice(2, 10);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const errText = (e) => String(e?.message || e || "Unknown error");

export function randomSecret(len = 32) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/* ---------- Markdown ---------- */
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function inlineMd(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return t;
}
export function mdToHtml(src) {
  const lines = (src || "").replace(/\r/g, "").split("\n");
  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
  const isBullet = (l) => /^\s*[-*+•]\s+/.test(l);
  const isNum = (l) => /^\s*\d+[.)]\s+/.test(l);
  const isHead = (l) => /^#{1,6}\s+/.test(l);
  const isHr = (l) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l);
  const isFence = (l) => /^\s*```/.test(l);
  const tableStart = (i) => isTableRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1]);
  const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  let html = "";
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (isFence(l)) {
      const buf = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) buf.push(lines[i++]);
      i++;
      html += `<pre><code>${esc(buf.join("\n"))}</code></pre>`;
      continue;
    }
    if (isHead(l)) {
      const m = l.match(/^(#{1,6})\s+(.*)$/);
      const lv = Math.min(6, m[1].length + 2);
      html += `<h${lv}>${inlineMd(m[2])}</h${lv}>`;
      i++;
      continue;
    }
    if (isHr(l)) { html += "<hr/>"; i++; continue; }
    if (tableStart(i)) {
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      html += `<div class="tbl"><table><thead><tr>${head.map((c) => `<th>${inlineMd(c)}</th>`).join("")}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`;
      continue;
    }
    if (isBullet(l)) {
      html += "<ul>";
      while (i < lines.length && isBullet(lines[i])) {
        html += `<li>${inlineMd(lines[i].replace(/^\s*[-*+•]\s+/, ""))}</li>`;
        i++;
      }
      html += "</ul>";
      continue;
    }
    if (isNum(l)) {
      const start = parseInt(l.trim(), 10) || 1;
      html += `<ol start="${start}">`;
      while (i < lines.length && isNum(lines[i])) {
        html += `<li>${inlineMd(lines[i].replace(/^\s*\d+[.)]\s+/, ""))}</li>`;
        i++;
      }
      html += "</ol>";
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const buf = [];
    while (
      i < lines.length && lines[i].trim() && !isFence(lines[i]) && !isHead(lines[i]) &&
      !isHr(lines[i]) && !isBullet(lines[i]) && !isNum(lines[i]) && !tableStart(i)
    ) buf.push(lines[i++]);
    html += `<p>${buf.map(inlineMd).join("<br/>")}</p>`;
  }
  return html;
}

export function plainForSpeech(t) {
  return (t || "")
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/[#*_`>|]/g, " ")
    .replace(/^\s*[-+•]\s+/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/* ---------- Files & images ---------- */
export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = () => rej(new Error("Could not read the file"));
    r.readAsDataURL(blob);
  });
}

export function compressImage(file, maxDim = 1280) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const data = c.toDataURL("image/jpeg", 0.85).split(",")[1];
      URL.revokeObjectURL(url);
      resolve({ name: file.name || "image.jpg", mime: "image/jpeg", data, size: Math.round(data.length * 0.75) });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image")); };
    img.src = url;
  });
}

export function isTextFile(f) {
  return (f.type || "").startsWith("text/") || /\.(txt|md|csv|tsv|json)$/i.test(f.name || "");
}

export const imgSrc = (f) => `data:${f.mime};base64,${f.data}`;

/* ---------- Audio ---------- */
export function audioBlob(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (/wav|mpeg|mp3|ogg|webm|aac/i.test(mime || "")) return new Blob([bytes], { type: mime });
  const rate = Number(((mime || "").match(/rate=(\d+)/) || [])[1]) || 24000;
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + bytes.length, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, bytes.length, true);
  return new Blob([header, bytes], { type: "audio/wav" });
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
