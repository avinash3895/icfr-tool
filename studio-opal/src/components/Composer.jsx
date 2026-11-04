import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';
import ModelPicker from './ModelPicker';
import { compressImage, imgSrc } from '../lib/util';

// A calm, minimal message box. Extra options (images, thinking, web search, model) live behind the plus button.
export default function Composer({ value, onChange, onSend, onStop, running, pending, setPending, placeholder, model, models, onModel, thinking, setThinking, search, setSearch, autoWeb, compact, onNotice }) {
  const fileRef = useRef(null);
  const taRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 168) + 'px';
  }, [value]);

  const addImages = async (list) => {
    const imgs = Array.from(list || []).filter((f) => (f.type || '').startsWith('image/'));
    if (!imgs.length) { onNotice?.('Only images can be attached here.'); return; }
    const out = [];
    for (const f of imgs) {
      try { out.push(await compressImage(f, 1280)); } catch (e) { onNotice?.(e.message); }
    }
    setPending((p) => [...p, ...out]);
  };

  const canSend = !running && (value.trim() || pending.length);
  const tid = compact ? 'panel-input' : 'chat-input';
  const hasMenu = !compact;
  const touch = typeof window !== 'undefined' && 'ontouchstart' in window;

  return (
    <div className={'composer' + (drag ? ' drag' : '')} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); addImages(e.dataTransfer.files); }}>
      {pending.length > 0 && (
        <div className='thumbs'>
          {pending.map((f, i) => (
            <div className='thumb' key={i}>
              <img src={imgSrc(f)} alt='' />
              <button className='x' aria-label='Remove image' onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>x</button>
            </div>
          ))}
        </div>
      )}
      {!compact && (thinking || search || autoWeb) && (
        <div className='chips-on'>
          {thinking && <button className='chip on' onClick={() => setThinking(false)}><Icon name='bulb' size={14} /> Think <span aria-hidden='true'>x</span></button>}
          {search && <button className='chip on' onClick={() => setSearch(false)}><Icon name='globe' size={14} /> Web <span aria-hidden='true'>x</span></button>}
          {autoWeb && !search && <span className='chip on auto' title='This message needs current information, so Web search is on for it'><Icon name='globe' size={14} /> Web · auto</span>}
        </div>
      )}
      <div className='cbar'>
        <button className='cbtn' aria-label={hasMenu ? 'More options' : 'Attach image'} aria-expanded={hasMenu ? menu : undefined} disabled={running} onClick={() => (hasMenu ? setMenu(!menu) : fileRef.current?.click())}><Icon name={hasMenu ? 'plus' : 'clip'} size={20} /></button>
        <input ref={fileRef} type='file' accept='image/*' multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = ''; }} />
        <label className='sr' htmlFor={tid}>Message</label>
        <textarea ref={taRef} id={tid} rows={1} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => { const fs = Array.from(e.clipboardData.files || []).filter((f) => f.type.startsWith('image/')); if (fs.length) { e.preventDefault(); addImages(fs); } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !touch) { e.preventDefault(); if (canSend) onSend(); } }} />
        {running ? (
          <button className='send stop' aria-label='Stop' onClick={onStop}><Icon name='stop' size={18} stroke={2.2} /></button>
        ) : (
          <button className='send' aria-label='Send' disabled={!canSend} onClick={onSend}><Icon name='up' size={20} stroke={2.4} /></button>
        )}
      </div>
      {menu && hasMenu && (
        <>
          <div className='cmask' onClick={() => setMenu(false)} />
          <div className='cmenu' role='menu'>
            <button className='citem' onClick={() => { setMenu(false); fileRef.current?.click(); }}><Icon name='clip' size={18} /> Attach an image</button>
            <button className='citem' aria-pressed={!!thinking} onClick={() => setThinking(!thinking)}><Icon name='bulb' size={18} /> Think longer <span className={'sw' + (thinking ? ' on' : '')} /></button>
            <button className='citem' aria-pressed={!!search} onClick={() => setSearch(!search)}><Icon name='globe' size={18} /> Search the web <span className={'sw' + (search ? ' on' : '')} /></button>
            {models?.length > 0 && <div className='citem static'><Icon name='spark' size={18} /><ModelPicker id='model-pick' className='csel' options={models} value={model} onChange={onModel} /></div>}
          </div>
        </>
      )}
    </div>
  );
}
