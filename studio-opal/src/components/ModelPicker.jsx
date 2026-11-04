import { matchOption } from '../lib/ai';

export default function ModelPicker({ options, value, onChange, id, className = 'model-select', label = 'Model' }) {
  const cur = matchOption(options, value);
  const groups = [];
  options.forEach((o) => {
    let g = groups.find((x) => x.name === o.group);
    if (!g) { g = { name: o.group, items: [] }; groups.push(g); }
    g.items.push(o);
  });
  return (
    <>
      <label className='sr' htmlFor={id}>{label}</label>
      <select id={id} className={className} value={cur || value || ''} onChange={(e) => onChange(e.target.value)}>
        {!cur && value && <option value={value}>{value}</option>}
        {groups.map((g) => (
          <optgroup key={g.name} label={g.name}>
            {g.items.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </optgroup>
        ))}
      </select>
    </>
  );
}
