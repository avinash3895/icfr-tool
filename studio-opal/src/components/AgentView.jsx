import { useState } from 'react';
import * as Legacy from './AgentViewLegacy';
import SuperAgent from './SuperAgent';

// The Agent tab: your existing Assistant (unchanged) and the new Super Agent, side by side.
export * from './AgentViewLegacy';
const Assistant = Legacy.default || Legacy.AgentView;

export function AgentView(props) {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem('agent.mode') || 'assistant'; } catch { return 'assistant'; }
  });
  const pick = (m) => {
    setMode(m);
    try { localStorage.setItem('agent.mode', m); } catch { /* private mode */ }
  };
  return (
    <div className="sa-host">
      <div className="sa-switch" role="tablist" aria-label="Agent mode">
        <button role="tab" aria-selected={mode === 'assistant'} className={mode === 'assistant' ? 'on' : ''} onClick={() => pick('assistant')}>Assistant</button>
        <button role="tab" aria-selected={mode === 'super'} className={mode === 'super' ? 'on' : ''} onClick={() => pick('super')}>✦ Super Agent</button>
      </div>
      <div className="sa-host-body">{mode === 'super' ? <SuperAgent /> : <Assistant {...props} />}</div>
    </div>
  );
}
export default AgentView;
