const P = {
  chat: <path d='M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z' />,
  flow: <><rect x='3' y='4' width='7' height='6' rx='1.5' /><rect x='14' y='14' width='7' height='6' rx='1.5' /><path d='M10 7h3a2 2 0 0 1 2 2v5' /></>,
  gear: <><circle cx='12' cy='12' r='3' /><path d='M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' /></>,
  plus: <path d='M12 5v14M5 12h14' />,
  clip: <path d='m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7' />,
  up: <path d='M12 19V5M5 12l7-7 7 7' />,
  stop: <rect x='7' y='7' width='10' height='10' rx='2' />,
  copy: <><rect x='9' y='9' width='11' height='11' rx='2' /><path d='M5 15V5a2 2 0 0 1 2-2h10' /></>,
  redo: <><path d='M21 12a9 9 0 1 1-3-6.7L21 8' /><path d='M21 3v5h-5' /></>,
  speaker: <><path d='M11 5 6 9H3v6h3l5 4z' /><path d='M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13' /></>,
  edit: <path d='M4 20h4L19 9l-4-4L4 16z' />,
  trash: <path d='M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3' />,
  bulb: <path d='M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z' />,
  globe: <><circle cx='12' cy='12' r='9' /><path d='M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18' /></>,
  lock: <><rect x='5' y='11' width='14' height='10' rx='2' /><path d='M8 11V7a4 4 0 0 1 8 0v4' /></>,
  menu: <path d='M4 7h16M4 12h16M4 17h16' />,
  folder: <path d='M4 5a2 2 0 0 1 2-2h5l2 3h5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z' />,
  spark: <><path d='M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z' /><path d='M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z' /></>,
  arrow: <path d='M5 12h14M13 6l6 6-6 6' />,
  pen: <path d='M4 20h4L19 9l-4-4L4 16z' />,
  cap: <><path d='M3 6l9-3 9 3-9 3z' /><path d='M7 8v5c0 1.7 2.2 3 5 3s5-1.3 5-3V8' /></>,
  cal: <><rect x='3' y='5' width='18' height='16' rx='2' /><path d='M3 10h18M8 3v4M16 3v4' /></>,
  check: <path d='M5 12l5 5 9-10' />,
  x: <path d='M6 6l12 12M18 6 6 18' />,
  db: <><ellipse cx='12' cy='5' rx='8' ry='3' /><path d='M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3' /></>,
  key: <><circle cx='8' cy='15' r='4' /><path d='M11 12l9-9M16 7l3 3M14 9l2 2' /></>,
  chart: <path d='M4 20V10M10 20V4M16 20v-8M22 20H2' />,
  user: <><circle cx='12' cy='8' r='4' /><path d='M4 21c1-4 4-6 8-6s7 2 8 6' /></>,
  logout: <><path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' /><path d='M16 17l5-5-5-5M21 12H9' /></>,
  phone: <><rect x='7' y='2' width='10' height='20' rx='2' /><path d='M11 18h2' /></>,
  monitor: <><rect x='3' y='4' width='18' height='12' rx='2' /><path d='M8 20h8M12 16v4' /></>,
  file: <><path d='M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' /><path d='M14 3v5h5' /></>,
  layers: <><path d='M12 3l9 5-9 5-9-5z' /><path d='M3 13l9 5 9-5' /></>,
  link: <><path d='M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1' /><path d='M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' /></>,
  bolt: <path d='M13 2L4 14h7l-1 8 9-12h-7z' />,
  clock: <><circle cx='12' cy='12' r='9' /><path d='M12 7v5l3 2' /></>,
  sun: <><circle cx='12' cy='12' r='4' /><path d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' /></>,
  moon: <path d='M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z' />,
  bell: <><path d='M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9' /><path d='M10 21a2 2 0 0 0 4 0' /></>,
  send: <path d='M22 2L11 13M22 2l-7 20-4-9-9-4z' />,
};

export function Icon({ name, size = 18, stroke = 1.8, ...rest }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={stroke} strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' {...rest}>
      {P[name]}
    </svg>
  );
}

export function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 28 28' fill='none' aria-hidden='true'>
      <defs><linearGradient id='lg' x1='0' y1='0' x2='28' y2='28'><stop offset='0' stopColor='#6d4aff' /><stop offset='0.6' stopColor='#b44bff' /><stop offset='1' stopColor='#ff5f8f' /></linearGradient></defs>
      <rect x='1' y='1' width='26' height='26' rx='9' fill='url(#lg)' />
      <path d='M8 17.5c2.2-5.5 9.8-5.5 12 0' stroke='#fff' strokeWidth='2.3' strokeLinecap='round' />
      <circle cx='14' cy='10' r='2.3' fill='#fff' />
    </svg>
  );
}
