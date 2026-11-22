// Panel-Editor: Kanal, verknüpfte Bewerbungen, Aussehen und Live-Vorschau. Inhalte nur per textContent/value.
(() => {
  'use strict';
  const root = document.getElementById('panel-editor');
  if (!root) return;

  const { panel: initial, types, channels, defaultColor, serverName } = JSON.parse(document.getElementById('panel-data').textContent);
  const state = structuredClone(initial);
  const isNew = Boolean(root.dataset.new);
  let dirty = false;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'value') node.value = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key in node && typeof value !== 'string') node[key] = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  }
  const update = () => {
    dirty = true;
    drawPreview();
  };
  const field = (label, input, hint) => el('label', { class: 'field' }, el('span', { class: 'field-label', text: label }), input, hint ? el('small', { class: 'hint', text: hint }) : null);
  const input = (key, props = {}) => el('input', { type: 'text', value: state[key] ?? '', ...props, oninput: (e) => ((state[key] = e.target.value), update()) });

  // **fett**, *kursiv* und Zeilenumbrüche wie in Discord (einfach gehalten)
  function markdown(text) {
    const out = document.createDocumentFragment();
    const lines = String(text).split('\n');
    lines.forEach((line, i) => {
      const heading = line.match(/^(#{1,3}) (.*)$/);
      const target = heading ? el(`h${heading[1].length + 2}`, { class: 'dc-h' }) : out;
      const content = heading ? heading[2] : line;
      for (const part of content.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)) {
        if (/^\*\*[^*]+\*\*$/.test(part)) target.append(el('strong', { text: part.slice(2, -2) }));
        else if (/^\*[^*]+\*$/.test(part)) target.append(el('em', { text: part.slice(1, -1) }));
        else if (part) target.append(document.createTextNode(part));
      }
      if (heading) out.append(target);
      else if (i < lines.length - 1) out.append(el('br'));
    });
    return out;
  }

  // ---------- Verknüpfte Bewerbungen (Reihenfolge = Reihenfolge im Panel) ----------
  const linkedWrap = el('div', { class: 'linked' });
  function drawLinked() {
    const linked = state.types.map((id) => types.find((t) => t.id === id)).filter(Boolean);
    linkedWrap.replaceChildren(
      ...linked.map((t, i) =>
        el(
          'div',
          { class: 'linked-row' },
          el('span', { class: 'type-emoji', text: t.emoji }),
          el('span', { class: 'grow', text: t.name }),
          t.enabled ? null : el('span', { class: 'badge badge-muted', text: 'geschlossen' }),
          el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: '↑', 'aria-label': 'Nach oben', disabled: i === 0, onclick: () => swap(i, -1) }),
          el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: '↓', 'aria-label': 'Nach unten', disabled: i === linked.length - 1, onclick: () => swap(i, 1) }),
          el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: '×', 'aria-label': 'Entfernen', onclick: () => ((state.types = state.types.filter((x) => x !== t.id)), update(), drawLinked()) }),
        ),
      ),
      types.length
        ? el(
            'select',
            {
              class: 'role-add',
              onchange: (e) => {
                if (e.target.value) state.types.push(e.target.value);
                update();
                drawLinked();
              },
            },
            el('option', { value: '', text: types.every((t) => state.types.includes(t.id)) ? 'Alle Bewerbungen verknüpft' : '+ Bewerbung hinzufügen' }),
            types.filter((t) => !state.types.includes(t.id)).map((t) => el('option', { value: t.id, text: `${t.emoji} ${t.name}` })),
          )
        : el('p', { class: 'hint', text: 'Du hast noch keine Bewerbungen. Lege zuerst unter „Bewerbungen“ eine an.' }),
    );
    const kind = display(linked.length);
    buttonField.hidden = !(kind === 'buttons' && linked.length === 1);
    placeholderField.hidden = kind !== 'menu';
  }
  // Gleiche Regel wie im Bot: auto = 1 Bewerbung Button, mehrere Auswahlmenü
  function display(count) {
    if (!count) return 'none';
    if (state.style === 'buttons' || state.style === 'menu') return state.style;
    return count === 1 ? 'buttons' : 'menu';
  }
  function swap(i, delta) {
    [state.types[i], state.types[i + delta]] = [state.types[i + delta], state.types[i]];
    update();
    drawLinked();
  }

  // ---------- Vorschau ----------
  const preview = el('div', { class: 'dc-message' });
  function drawPreview() {
    const linked = state.types.map((id) => types.find((t) => t.id === id)).filter(Boolean);
    const kind = display(linked.length);
    const container = el('div', { class: 'dc-container' });
    container.style.borderLeftColor = /^#[0-9a-f]{6}$/i.test(state.color) ? state.color : defaultColor;
    const head = el('div', { class: 'dc-head' });
    if (state.author) head.append(el('div', { class: 'dc-small dc-strong', text: state.author }));
    head.append(el('h3', { class: 'dc-title', text: state.title || 'Titel' }));
    if (state.description) head.append(el('div', { class: 'dc-text' }, markdown(state.description)));
    if (/^https:\/\/\S+$/.test(state.thumbnail)) {
      const thumb = el('img', { class: 'dc-thumb', alt: '' });
      thumb.addEventListener('error', () => thumb.remove());
      thumb.src = state.thumbnail;
      container.append(el('div', { class: 'dc-section' }, head, thumb));
    } else container.append(head);
    if (linked.length > 1 || !linked.length) {
      container.append(el('hr', { class: 'dc-sep' }));
      if (linked.length) {
        container.append(
          el(
            'ul',
            { class: 'dc-list' },
            linked.map((t) => el('li', {}, `[${t.emoji}] `, el('strong', { text: t.name }), t.enabled ? null : el('em', { text: ' (geschlossen)' }), t.description ? el('div', { text: t.description }) : null)),
          ),
        );
      } else container.append(el('em', { class: 'dc-text', text: 'Derzeit gibt es hier keine Bewerbungen.' }));
    }
    if (/^https:\/\/\S+$/.test(state.image)) {
      container.append(el('hr', { class: 'dc-sep' }));
      const img = el('img', { class: 'dc-image', alt: '' });
      img.addEventListener('error', () => img.replaceWith(el('div', { class: 'dc-image-missing', text: 'Bild konnte nicht geladen werden. Prüfe die URL.' })));
      img.src = state.image;
      container.append(img);
    }
    if (state.footer) container.append(el('div', { class: 'dc-small', text: state.footer }));
    const parts = [el('div', { class: 'dc-author' }, el('span', { class: 'dc-bot', text: 'BOT' }), el('strong', { text: serverName })), container];
    if (kind === 'buttons') {
      parts.push(
        el(
          'div',
          { class: 'dc-buttons' },
          linked.length === 1
            ? el('div', { class: 'dc-button' }, `${linked[0].emoji} `, state.buttonLabel || 'Jetzt bewerben')
            : linked.map((t) => el('div', { class: `dc-button${t.enabled ? '' : ' dc-button-grey'}` }, `${t.emoji} `, t.name)),
        ),
      );
    }
    if (kind === 'menu') parts.push(el('div', { class: 'dc-select' }, el('span', { text: state.placeholder || 'Wofür möchtest du dich bewerben?' }), el('span', { text: '⌄' })));
    preview.replaceChildren(...parts);
  }

  // ---------- Formular ----------
  const buttonField = field('Button-Text', input('buttonLabel', { maxlength: 80, placeholder: 'Jetzt bewerben' }), 'Text auf dem Button.');
  const placeholderField = field('Text im Auswahlmenü', input('placeholder', { maxlength: 150, placeholder: 'Wofür möchtest du dich bewerben?' }), 'Steht im Menü, bevor man etwas auswählt.');
  const errorsBox = el('div', { class: 'notice notice-bad', hidden: true });
  const saveButton = el('button', { type: 'button', class: 'btn', text: 'Speichern', onclick: () => save(false) });
  const sendButton = el('button', { type: 'button', class: 'btn btn-primary', text: 'In Kanal senden', onclick: () => save(true) });
  const colorInput = el('input', { type: 'color', value: state.color || defaultColor, oninput: (e) => ((state.color = e.target.value), update()) });

  const step = (number, title, intro, ...content) =>
    el('section', { class: 'step' }, el('div', { class: 'step-head' }, el('span', { class: 'step-number', text: String(number) }), el('div', {}, el('h2', { text: title }), intro ? el('p', { class: 'hint', text: intro }) : null)), el('div', { class: 'step-body' }, ...content));

  root.replaceChildren(
    el('h1', { text: isNew ? 'Neues Panel' : state.title || 'Panel' }),
    el(
      'div',
      { class: 'editor-split' },
      el(
        'div',
        { class: 'steps-col' },
        step(
          1,
          'Inhalt',
          'Was im Panel steht.',
          field('Name (nur im Dashboard)', input('name', { maxlength: 80, placeholder: 'z. B. Hauptpanel' })),
          field('Titel', input('title', { maxlength: 200 })),
          field('Text', el('textarea', { rows: 5, maxlength: 3000, value: state.description, oninput: (e) => ((state.description = e.target.value), update()) }), '**fett**, *kursiv* und Zeilenumbrüche funktionieren wie in Discord.'),
          field('Bild-URL (optional)', input('image', { type: 'url', maxlength: 500, placeholder: 'https://…' }), 'Großes Bild unten im Panel'),
          el(
            'details',
            { class: 'q-more', open: Boolean(state.author || state.thumbnail || state.footer) },
            el('summary', { text: 'Mehr: Kopfzeile, Vorschaubild, Fußzeile' }),
            field('Kopfzeile (klein über dem Titel)', input('author', { maxlength: 100, placeholder: 'z. B. ENRP Personalabteilung' })),
            field('Vorschaubild-URL', input('thumbnail', { type: 'url', maxlength: 500, placeholder: 'https://… (z. B. Logo)' }), 'Kleines Bild rechts neben dem Titel'),
            field('Fußzeile', input('footer', { maxlength: 200, placeholder: 'z. B. Bewerbungen werden innerhalb von 48 Stunden bearbeitet.' })),
          ),
          el('div', { class: 'row' }, field('Farbstreifen', colorInput), el('div', { class: 'field field-check' }, el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: 'Zurück auf Standard', onclick: () => ((state.color = ''), (colorInput.value = defaultColor), update()) }))),
        ),
        step(
          2,
          'Bewerbungen',
          'Welche Bewerbungen man über dieses Panel starten kann. Die Reihenfolge hier ist die Reihenfolge im Panel.',
          linkedWrap,
          field(
            'Darstellung',
            el(
              'select',
              { onchange: (e) => ((state.style = e.target.value), update(), drawLinked()) },
              [
                ['auto', 'Automatisch (eine Bewerbung = Button, mehrere = Auswahlmenü)'],
                ['menu', 'Auswahlmenü'],
                ['buttons', 'Ein Button pro Bewerbung'],
              ].map(([v, t]) => el('option', { value: v, text: t, selected: (state.style || 'auto') === v })),
            ),
          ),
          buttonField,
          placeholderField,
        ),
        step(
          3,
          'Senden',
          'Speichern aktualisiert alle bereits gesendeten Nachrichten dieses Panels. „Senden“ postet es zusätzlich neu in den gewählten Kanal.',
          field(
            'Kanal',
            el(
              'select',
              { onchange: (e) => ((state.channel = e.target.value), update()) },
              el('option', { value: '', text: 'Kanal wählen …' }),
              channels.map((c) => el('option', { value: c.id, text: `#${c.name}`, selected: c.id === state.channel })),
            ),
          ),
          errorsBox,
          el('div', { class: 'step-actions' }, saveButton, sendButton),
        ),
      ),
      el('aside', { class: 'preview-col' }, el('div', { class: 'preview-label', text: 'Vorschau in Discord' }), el('div', { class: 'dc-frame' }, preview), el('p', { class: 'hint', text: 'Buttons und Menüs funktionieren in der Vorschau nicht.' })),
    ),
  );
  drawLinked();
  drawPreview();
  dirty = false;

  async function save(send) {
    errorsBox.hidden = true;
    if (send && !state.channel) return showErrors(['Wähle oben einen Kanal, in den das Panel gesendet wird.']);
    if (send && !window.confirm('Panel jetzt in den gewählten Kanal senden?')) return;
    saveButton.disabled = sendButton.disabled = true;
    try {
      const res = await fetch(root.dataset.save, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF': root.dataset.csrf, Accept: 'application/json' },
        body: JSON.stringify({ ...state, send }),
      });
      const result = res.headers.get('content-type')?.includes('json') ? await res.json() : { errors: [(await res.text()) || `Fehler ${res.status}`] };
      if (res.ok && result.ok) {
        dirty = false;
        window.location.href = result.redirect;
        return;
      }
      showErrors(result.errors ?? ['Speichern fehlgeschlagen.']);
      if (result.redirect && isNew) {
        dirty = false;
        window.setTimeout(() => (window.location.href = result.redirect), 2500);
      }
    } catch {
      showErrors(['Keine Verbindung zum Dashboard. Läuft der Bot?']);
    }
    saveButton.disabled = sendButton.disabled = false;
  }

  function showErrors(errors) {
    errorsBox.replaceChildren(el('ul', {}, errors.map((e) => el('li', { text: e }))));
    errorsBox.hidden = false;
    errorsBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  window.addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  });
})();
