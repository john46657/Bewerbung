// Gemeinsame Bausteine für die Editoren (Karten, Schalter, Rollen-Auswahl, Zeitangaben, Symbole).
// Inhalte immer per textContent/value – nur die festen Symbole unten werden als SVG eingesetzt.
(() => {
  'use strict';

  const ICONS = {
    grip: '<svg viewBox="0 0 24 24" width="20" height="20"><g fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g></svg>',
    copy: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L6 21"/></svg>',
    tag: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
    form: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
  };

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'value') node.value = value;
      else if (key === 'color') node.style.background = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key in node && typeof value !== 'string') node[key] = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  }

  function icon(name, extra = '') {
    const span = el('span', { class: `icon ${extra}`.trim(), 'aria-hidden': 'true' });
    span.innerHTML = ICONS[name]; // feste Symbole oben, keine Nutzerdaten
    return span;
  }

  // Karte im Raster: Titel, Beschreibung, Inhalt
  const card = (title, description, ...content) =>
    el('div', { class: 'set-card' }, el('div', { class: 'set-head' }, typeof title === 'string' ? el('h3', { text: title }) : title, description ? el('p', { class: 'set-desc', text: description }) : null), el('div', { class: 'set-body' }, ...content));

  const section = (title, ...content) => el('section', { class: 'set-section' }, el('h2', { class: 'set-title', text: title }), ...content);
  const grid = (cols, ...cards) => el('div', { class: `set-grid cols-${cols}` }, ...cards);

  // Schalter (an/aus)
  function toggle(checked, onChange, label = '') {
    const input = el('input', { type: 'checkbox', checked: Boolean(checked), onchange: (e) => onChange(e.target.checked) });
    return el('label', { class: 'switch', title: label }, input, el('span', { class: 'switch-track' }), label ? el('span', { class: 'switch-label', text: label }) : null);
  }

  // Auswahlliste mit Chips in einem Feld (Rollen, Bewerbungen …). items: [{ id, name, color? }]
  function multiPicker(items, list, onChange, { placeholder = 'Auswählen …', max = 25 } = {}) {
    const box = el('div', { class: 'picker' });
    const draw = () => {
      const chosen = list.map((id) => items.find((i) => i.id === id) ?? { id, name: 'gelöscht' });
      const rest = items.filter((i) => !list.includes(i.id));
      const chooser = el(
        'select',
        {
          class: 'picker-select',
          'aria-label': placeholder,
          disabled: !rest.length || list.length >= max,
          onchange: (e) => {
            if (e.target.value) list.push(e.target.value);
            onChange();
            draw();
          },
        },
        el('option', { value: '', text: list.length ? '' : placeholder }),
        rest.map((i) => el('option', { value: i.id, text: i.name })),
      );
      box.replaceChildren(
        ...chosen.map((i) =>
          el(
            'span',
            { class: 'chip' },
            i.color ? el('span', { class: 'chip-dot', color: i.color }) : null,
            i.name,
            el('button', { type: 'button', class: 'chip-x', 'aria-label': `${i.name} entfernen`, text: '×', onclick: () => (list.splice(list.indexOf(i.id), 1), onChange(), draw()) }),
          ),
        ),
        chooser,
        icon('chevron', 'picker-arrow'),
      );
    };
    draw();
    return box;
  }

  // Minuten als Tage / Stunden / Minuten
  function duration(minutes, onChange, { min = 0, max = 525600 } = {}) {
    const parts = { d: Math.floor(minutes / 1440), h: Math.floor((minutes % 1440) / 60), m: minutes % 60 };
    const box = (key, label, limit) =>
      el(
        'label',
        { class: 'dur' },
        el('span', { text: label }),
        el('input', {
          type: 'number',
          min: 0,
          max: limit,
          value: String(parts[key]),
          oninput: (e) => {
            parts[key] = Math.max(0, Number(e.target.value) || 0);
            onChange(Math.min(max, Math.max(min, parts.d * 1440 + parts.h * 60 + parts.m)));
          },
        }),
      );
    return el('div', { class: 'durations' }, box('d', 'Tage', 365), box('h', 'Stunden', 23), box('m', 'Minuten', 59));
  }

  // Segment-Schalter („Hat alle Rollen“ / „Hat eine Rolle“)
  function segmented(options, value, onChange) {
    const wrap = el('div', { class: 'segmented' });
    const draw = () =>
      wrap.replaceChildren(
        ...options.map(([v, label]) =>
          el('button', { type: 'button', class: v === value ? 'seg active' : 'seg', text: label, onclick: () => ((value = v), onChange(v), draw()) }),
        ),
      );
    draw();
    return wrap;
  }

  const slug = (value, max) =>
    String(value)
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, max);

  async function postJson(url, csrf, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf, Accept: 'application/json' }, body: JSON.stringify(body) });
    const result = res.headers.get('content-type')?.includes('json') ? await res.json() : { errors: [(await res.text()) || `Fehler ${res.status}`] };
    return { ok: res.ok && result.ok, result };
  }

  window.UI = { el, icon, card, section, grid, toggle, multiPicker, duration, segmented, slug, postJson };
})();
