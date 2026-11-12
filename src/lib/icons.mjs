// Inline SVG icons (stroke-based, 24×24 grid). Decorative by default: callers
// pass aria-hidden or a title depending on whether the icon conveys meaning.
export const icons = {
  ruler: '<path d="M3 8.5 8.5 3 21 15.5 15.5 21 3 8.5Z"/><path d="m7 9 1.5 1.5M10 6l1.5 1.5M11 13l1.5 1.5M14 10l1.5 1.5M15 17l1.5 1.5M18 14l1.5 1.5"/>',
  factory: '<path d="M3 20V9l5 3V9l5 3V9l5 3v8H3Z"/><path d="M7 20v-3M12 20v-3M17 20v-3"/>',
  shield: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.9 0-1.6-1.6-1.9-1.6-3.2 0-1 .8-1.9 2-1.9H16a5 5 0 0 0 5-5C21 5.6 17 3 12 3Z"/><circle cx="8" cy="9" r="1.2"/><circle cx="12" cy="7" r="1.2"/><circle cx="16" cy="9" r="1.2"/>',
  truck: '<path d="M3 7h10v9H3zM13 10h4l3 3v3h-7"/><circle cx="7" cy="18.5" r="1.8"/><circle cx="17" cy="18.5" r="1.8"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  arrowRight: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  arrowDown: '<path d="M12 4v15M6 13l6 6 6-6"/>',
  arrowUp: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 7 8.5-7"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
  clockSmall: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  telegram: '<path d="M21 4 3 11l6 2.2L11 20l3-4.5 5 3.5 2-15Z"/><path d="m9 13.2 8.5-6.4L11 16"/>',
  whatsapp: '<path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3Z"/><path d="M8.7 8.2c-.3.6-.2 1.5.2 2.3a8 8 0 0 0 3.7 3.4c.9.4 1.7.4 2.2.1l1.1-.9-2-1.2-.8.7a6 6 0 0 1-2.3-2.2l.7-.8-1.2-2-1.6.6Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  menu: '<path d="M3.5 7h17M3.5 12h17M3.5 17h17"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  star: '<path d="m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 16.9 6.4 20l1.2-6.2L3 9.5l6.3-.8L12 3Z"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="m4 16 5-5 4 4 2.5-2.5L20 17"/><circle cx="8.5" cy="9" r="1.3"/>',
  spark: '<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="M18.5 15.5 19 17l1.5.5L19 18l-.5 1.5L18 18l-1.5-.5L18 17l.5-1.5Z"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z"/><path d="M4 21c3-5 7-8 11-10"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
};

export function icon(name, { className = 'icon', size = 24, title } = {}) {
  const body = icons[name];
  if (!body) throw new Error('Unknown icon: ' + name);
  const a11y = title
    ? `role="img" aria-label="${title}"`
    : 'aria-hidden="true" focusable="false"';
  return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`;
}
