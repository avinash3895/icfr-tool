import { downloadBlob, removeFile, uploadBlob } from './db';
import { chunkPages, describeChunks, pickChunks } from './chunk';
import { pdfPages } from './docs';
import { isTextFile, uid } from './util';

// A project is a name, standing instructions and a set of knowledge files. Every chat inside it sees all three.
// Projects live inside the user's settings (no database change needed); the text of each file lives in their private storage.
export const newProject = (name) => ({ id: uid(), name: String(name || '').trim() || 'New project', description: '', instructions: '', files: [], model: '', created: Date.now() });

const cache = new Map();
export const MAX_FILES = 40;

// Reads a PDF or text file in the browser, splits it into searchable sections and keeps those in private storage.
export async function addProjectFile(db, project, file, onStatus) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  let pages;
  if (isPdf) pages = await pdfPages(file, (i, n) => onStatus?.(`Reading page ${i} of ${n}`));
  else if (isTextFile(file)) pages = [{ page: null, text: await file.text() }];
  else throw new Error(`${file.name}: use PDF, text, Markdown, CSV or JSON files.`);
  const chars = pages.reduce((t, p) => t + String(p.text || '').length, 0);
  if (chars < 20) throw new Error(`${file.name}: no readable text found. A scanned PDF needs OCR first.`);
  onStatus?.('Saving');
  const chunks = chunkPages(pages);
  const path = await uploadBlob(db, `projects/${project.id}`, `${file.name}.chunks.json`, new Blob([JSON.stringify({ v: 1, chunks })], { type: 'application/json' }), 'application/json');
  cache.set(path, chunks);
  return { id: uid(), name: file.name, size: file.size, path, chars, count: chunks.length, pages: isPdf ? pages.length : 0 };
}

export async function removeProjectFile(db, f) {
  cache.delete(f.path);
  try { await removeFile(db, f.path); } catch { /* the file may already be gone */ }
}

async function loadChunks(db, f) {
  if (cache.has(f.path)) return cache.get(f.path);
  const j = JSON.parse(await (await downloadBlob(db, f.path)).text());
  cache.set(f.path, j.chunks);
  return j.chunks;
}

// The text that goes in front of the question inside a project chat: instructions plus the parts of the files that matter.
export async function projectContext(db, project, query, budget = 24000) {
  const head = [`PROJECT: ${project.name}`];
  if (project.description?.trim()) head.push(project.description.trim());
  if (project.instructions?.trim()) head.push(`PROJECT INSTRUCTIONS (always follow these):\n${project.instructions.trim()}`);
  const used = [];
  const problems = [];
  const blocks = [];
  const files = project.files || [];
  if (files.length) {
    const total = files.reduce((t, f) => t + (f.chars || 0), 0);
    const per = Math.max(2, Math.floor(budget / 3000 / files.length));
    for (const f of files) {
      try {
        const all = await loadChunks(db, f);
        if (total <= budget) {
          blocks.push(`--- ${f.name} ---\n${all.map((c) => (c.page ? `[page ${c.page}] ` : '') + c.text).join('\n\n')}`);
          used.push(f.name);
        } else {
          const { picked, ranked } = pickChunks(all, query, per);
          blocks.push(`--- ${f.name}: ${ranked ? 'most relevant' : 'first'} excerpts, ${picked.length} of ${all.length} sections (${describeChunks(picked)}) ---\n${picked.map((c) => (c.page ? `[page ${c.page}] ` : '') + c.text).join('\n\n')}`);
          used.push(`${f.name} (${picked.length} of ${all.length} sections)`);
        }
      } catch {
        problems.push(f.name);
      }
    }
  }
  if (blocks.length) head.push(`PROJECT KNOWLEDGE (use it to answer, and say so when the files do not cover something):\n${blocks.join('\n\n')}`);
  return { system: head.join('\n\n'), used, problems };
}
