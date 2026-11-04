import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';
import ModelPicker from './ModelPicker';
import { modelOptions } from '../lib/ai';
import { addProjectFile, MAX_FILES, removeProjectFile } from '../lib/projects';
import { errText } from '../lib/util';

const fmtSize = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : (n || 0) + ' B');
const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });

function ProjectList({ projects, chatCount, onSelect, onCreate }) {
  const [name, setName] = useState('');
  const create = () => { const n = name.trim(); if (!n) return; onCreate(n); setName(''); };
  return (
    <div className='settings'>
      <div className='settings-inner'>
        <div className='set-head'><h1>Projects</h1></div>
        <div className='hint'>A project keeps your instructions, reference files and chats together. Every chat inside it follows the project&apos;s instructions and can read its files.</div>
        <section className='card'>
          <h2>New project</h2>
          <div className='inline'>
            <label className='sr' htmlFor='np'>Project name</label>
            <input id='np' className='field' placeholder='Name your project, for example Q4 audit' value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
            <button className='btn primary' disabled={!name.trim()} onClick={create}><Icon name='plus' size={16} /> Create</button>
          </div>
        </section>
        {projects.length === 0 ? (
          <div className='empty'>No projects yet. Create one above to start.</div>
        ) : (
          <div className='proj-grid'>
            {projects.map((p) => (
              <button key={p.id} className='pcard' onClick={() => onSelect(p.id)}>
                <span className='pcard-ico'><Icon name='folder' size={20} /></span>
                <strong>{p.name}</strong>
                <span className='hint'>{p.description || (p.instructions ? p.instructions.slice(0, 80) : 'No instructions yet')}</span>
                <span className='hint'>{(p.files || []).length} file{(p.files || []).length === 1 ? '' : 's'} · {chatCount(p.id)} chat{chatCount(p.id) === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProjectsView({ db, settings, projects, project, convs, chatProject, onSelect, onCreate, onUpdate, onDelete, onOpenChat, onNewChat, onError, onNotice }) {
  const chatCount = (id) => convs.filter((c) => chatProject[c.id] === id).length;
  if (!project) return <ProjectList projects={projects} chatCount={chatCount} onSelect={onSelect} onCreate={onCreate} />;
  return <ProjectPage key={project.id} {...{ db, settings, project, convs, chatProject, onSelect, onUpdate, onDelete, onOpenChat, onNewChat, onError, onNotice }} />;
}

function ProjectPage({ db, settings, project, convs, chatProject, onSelect, onUpdate, onDelete, onOpenChat, onNewChat, onError, onNotice }) {
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description || '');
  const [instr, setInstr] = useState(project.instructions || '');
  const [status, setStatus] = useState('');
  const [saved, setSaved] = useState('');
  const [drop, setDrop] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const pRef = useRef(project);
  pRef.current = project;
  const options = [{ id: '', name: 'My default model', group: 'Default' }, ...modelOptions(settings)];
  const chats = convs.filter((c) => chatProject[c.id] === project.id);

  useEffect(() => {
    // Saves what you typed shortly after you stop, so nothing is lost if you leave the page.
    const changed = name.trim() !== project.name || desc !== (project.description || '') || instr !== (project.instructions || '');
    if (!changed) return undefined;
    const t = setTimeout(() => {
      onUpdate({ ...pRef.current, name: name.trim() || pRef.current.name, description: desc, instructions: instr });
      setSaved('Saved');
    }, 800);
    return () => clearTimeout(t);
  }, [name, desc, instr]); // eslint-disable-line
  useEffect(() => { if (saved) { const t = setTimeout(() => setSaved(''), 2500); return () => clearTimeout(t); } return undefined; }, [saved]);

  const addFiles = async (list) => {
    for (const f of Array.from(list || [])) {
      if ((pRef.current.files || []).length >= MAX_FILES) { onNotice(`A project can hold up to ${MAX_FILES} files.`); break; }
      try {
        setStatus(`${f.name}: reading...`);
        const rec = await addProjectFile(db, pRef.current, f, (t) => setStatus(`${f.name}: ${t}`));
        onUpdate({ ...pRef.current, files: [...(pRef.current.files || []), rec] });
      } catch (e) { onError(errText(e)); }
    }
    setStatus('');
  };
  const removeFile = async (f) => {
    await removeProjectFile(db, f);
    onUpdate({ ...pRef.current, files: (pRef.current.files || []).filter((x) => x.id !== f.id) });
  };

  return (
    <div className='settings'>
      <div className='settings-inner'>
        <div className='set-head'>
          <button className='btn ghost small' onClick={() => onSelect(null)}>← All projects</button>
          <span style={{ flex: 1 }} />
          <span className='hint'>{saved}</span>
        </div>
        <div>
          <label className='sr' htmlFor='pn'>Project name</label>
          <input id='pn' className='proj-name' value={name} onChange={(e) => setName(e.target.value)} />
          <label className='sr' htmlFor='pd'>Short description</label>
          <input id='pd' className='field' style={{ marginTop: 8 }} placeholder='A short description (optional)' value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>

        <section className='card'>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ flex: 1 }}>Chats</h2>
            <button className='btn primary small' onClick={onNewChat}><Icon name='plus' size={15} /> New chat</button>
          </div>
          {chats.length === 0 && <div className='hint'>No chats yet. Start one and it will use this project&apos;s instructions and files.</div>}
          <div className='proj-chats'>
            {chats.map((c) => (
              <button key={c.id} className='proj-chat' onClick={() => onOpenChat(c.id)}>
                <span>{c.no != null ? `${c.no}. ` : ''}{c.title}</span>
                <span className='hint'>{fmtDate(c.updated_at)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className='card'>
          <h2>Instructions</h2>
          <div className='hint'>Tell the AI how to work in this project: who the work is for, what format you want, what to avoid. It follows this in every chat here.</div>
          <label className='sr' htmlFor='pi'>Project instructions</label>
          <textarea id='pi' className='field' rows={7} value={instr} placeholder='For example: You are helping with the Q4 internal controls review. Reference the control IDs in the files. Keep answers to one page.' onChange={(e) => setInstr(e.target.value)} />
        </section>

        <section className='card'>
          <h2>Knowledge</h2>
          <div className='hint'>Add PDFs and text files. Their text is read in your browser and stored privately in your own database. When you ask something, the parts that matter are sent to the AI with your question.</div>
          <label className={'drop' + (drop ? ' on' : '')} onDragOver={(e) => { e.preventDefault(); setDrop(true); }} onDragLeave={() => setDrop(false)} onDrop={(e) => { e.preventDefault(); setDrop(false); addFiles(e.dataTransfer.files); }}>
            Drop files here, or tap to choose (PDF, text, Markdown, CSV, JSON)
            <input type='file' multiple hidden accept='.pdf,.txt,.md,.csv,.tsv,.json,text/*,application/pdf' onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          {status && <div className='status'>{status}</div>}
          {(project.files || []).map((f) => (
            <div className='kfile' key={f.id}>
              <Icon name='file' size={18} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className='kname'>{f.name}</div>
                <span className='hint'>{fmtSize(f.size)} · {f.count} section{f.count === 1 ? '' : 's'}{f.pages ? ` · ${f.pages} pages` : ''}</span>
              </div>
              <button className='icon-btn tiny' aria-label={`Remove ${f.name}`} onClick={() => removeFile(f)}><Icon name='trash' size={15} /></button>
            </div>
          ))}
        </section>

        <section className='card'>
          <h2>Model for this project</h2>
          <label className='sr' htmlFor='pm'>Model for this project</label>
          <ModelPicker id='pm' className='field mono' options={options} value={project.model || ''} onChange={(v) => onUpdate({ ...pRef.current, model: v })} />
          <div className='hint'>New chats in this project start on this model. Pick &ldquo;My default model&rdquo; to follow your Settings. Your fallback order still applies.</div>
        </section>

        <section className='card'>
          <h2>Delete project</h2>
          <div className='hint'>Deletes the project, its files and all {chats.length} chat{chats.length === 1 ? '' : 's'} inside it. This cannot be undone.</div>
          <button className='btn danger' style={{ alignSelf: 'flex-start' }} onClick={() => (confirmDel ? onDelete(project.id) : setConfirmDel(true))}>{confirmDel ? 'Tap again to delete everything' : 'Delete project'}</button>
        </section>
      </div>
    </div>
  );
}
