// Panel-Editor: Einstellungen (Kanal, verknüpfte Bewerbungen), Aussehen mit Vorschau, Panel-Typ, Senden.
(() => {
  'use strict';
  const root = document.getElementById('panel-editor');
  if (!root) return;
  const { el, icon, card, section, grid, multiPicker, postJson } = window.UI;

  const { panel: initial, types, channels, defaultColor, serverName } = JSON.parse(document.getElementById('panel-data').textContent);
  const state = structuredClone(initial);
  if (!['menu', 'buttons'].includes(state.style)) state.style = state.types.length === 1 ? 'buttons' : 'menu';
  const isNew = Boolean(root.dataset.new);
  let dirty = false;
  const update = () => {
    dirty = true;
    drawPreview();
  };
  const isUrl = (v) => /^https:\/\/\S+$/.test(v ?? '');
  const input = (key, props = {}) => el('input', { type: 'text', value: state[key] ?? '', ...props, oninput: (e) => ((state[key] = e.target.value), update()) });

  // **fett**, *kursiv*, Überschriften und Zeilenumbrüche wie in Discord (einfach gehalten)
  function markdown(text) {
    const out = document.createDocumentFragment();
    const lines = String(text).split('\n');
    lines.forEach((line, i) => {
      const heading = line.match(/^(#{1,3}) (.*)$/);
      const target = heading ? el(`h${heading[1].length + 2}`, { class: 'dc-h' }) : out;
      for (const part of (heading ? heading[2] : line).split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)) {
        if (/^\*\*[^*]+\*\*$/.test(part)) target.append(el('strong', { text: part.slice(2, -2) }));
        else if (/^\*[^*]+\*$/.test(part)) target.append(el('em', { text: part.slice(1, -1) }));
        else if (part) target.append(document.createTextNode(part));
      }
      if (heading) out.append(target);
      else if (i < lines.length - 1) out.append(el('br'));
    });
    return out;
  }

  // ---------- Vorschau ----------
  const preview = el('div', { class: 'dc-message' });
  function drawPreview() {
    const linked = state.types.map((id) => types.find((t) => t.id === id)).filter(Boolean);
    const container = el('div', { class: 'dc-container' });
    container.style.borderLeftColor = /^#[0-9a-f]{6}$/i.test(state.color) ? state.color : defaultColor;
    const head = el('div', { class: 'dc-head' });
    if (state.author) head.append(el('div', { class: 'dc-author-line' }, icon('form', 'dc-mini'), el('strong', { text: state.author })));
    head.append(el('h3', { class: 'dc-title', text: state.title || 'Titel' }));
    if (state.description) head.append(el('div', { class: 'dc-text' }, markdown(state.description)));
    if (isUrl(state.thumbnail)) {
      const thumb = el('img', { class: 'dc-thumb', alt: '' });
      thumb.addEventListener('error', () => thumb.remove());
      thumb.src = state.thumbnail;
      container.append(el('div', { class: 'dc-section' }, head, thumb));
    } else container.append(head);
    if (linked.length > 1 || !linked.length) {
      container.append(el('hr', { class: 'dc-sep' }));
      container.append(
        linked.length
          ? el('ul', { class: 'dc-list' }, linked.map((t) => el('li', {}, `[${t.emoji}] `, el('strong', { text: t.name }), t.enabled ? null : el('em', { text: ' (geschlossen)' }), t.description ? el('div', { text: t.description }) : null)))
          : el('em', { class: 'dc-text', text: 'Derzeit gibt es hier keine Bewerbungen.' }),
      );
    }
    if (isUrl(state.image)) {
      container.append(el('hr', { class: 'dc-sep' }));
      const img = el('img', { class: 'dc-image', alt: '' });
      img.addEventListener('error', () => img.replaceWith(el('div', { class: 'dc-image-missing', text: 'Bild konnte nicht geladen werden. Prüfe die URL.' })));
      img.src = state.image;
      container.append(img);
    }
    if (state.footer) container.append(el('div', { class: 'dc-footer' }, icon('form', 'dc-mini'), el('span', { text: state.footer })));

    const parts = [el('div', { class: 'dc-author' }, el('span', { class: 'dc-avatar' }, icon('form')), el('strong', { text: serverName }), el('span', { class: 'dc-bot', text: 'BOT' })), container];
    if (linked.length && state.style === 'buttons') {
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
    if (linked.length && state.style === 'menu') parts.push(el('div', { class: 'dc-select' }, el('span', { text: state.placeholder || 'Treffe eine Auswahl' }), icon('chevron')));
    preview.replaceChildren(...parts);
  }

  // ---------- Bild-Felder (gestrichelte Kästen mit URL) ----------
  function imageBox(key, { small = false, label }) {
    const media = el('div', { class: 'img-media' });
    const showImage = () => {
      if (isUrl(state[key])) {
        const img = el('img', { alt: '' });
        img.addEventListener('error', () => media.replaceChildren(icon('image')));
        img.src = state[key];
        media.replaceChildren(img);
      } else media.replaceChildren(icon('image'));
    };
    showImage();
    const url = el('input', {
      type: 'url',
      class: 'img-url',
      placeholder: small ? 'Bild-URL' : 'Bild-URL einfügen (https://…)',
      value: state[key] ?? '',
      'aria-label': label,
      oninput: (e) => {
        state[key] = e.target.value.trim();
        update();
        showImage();
      },
    });
    return el('div', { class: small ? 'img-box small' : 'img-box', title: label }, media, url);
  }

  // ---------- Aufbau ----------
  const typeExtra = el('div');
  function drawTypeOptions() {
    if (state.style === 'buttons' && state.types.length === 1) {
      typeExtra.replaceChildren(el('label', { class: 'stack-field' }, el('span', { text: 'Text auf dem Button' }), input('buttonLabel', { maxlength: 80, placeholder: 'Jetzt bewerben' })));
    } else if (state.style === 'menu') {
      typeExtra.replaceChildren(el('label', { class: 'stack-field' }, el('span', { text: 'Text im Auswahlmenü' }), input('placeholder', { maxlength: 150, placeholder: 'Treffe eine Auswahl' })));
    } else typeExtra.replaceChildren(el('p', { class: 'set-desc', text: 'Jede verknüpfte Bewerbung bekommt einen eigenen Button.' }));
  }

  const linkedPicker = multiPicker(
    types.map((t) => ({ id: t.id, name: `${t.emoji} ${t.name}` })),
    state.types,
    () => {
      update();
      drawTypeOptions();
    },
    { placeholder: 'Bewerbung auswählen …' },
  );
  const typesHint = types.length ? null : el('p', { class: 'set-desc', text: 'Du hast noch keine Bewerbungen. Lege zuerst unter „Bewerbungen“ eine an.' });

  const stripe = el('span', { class: 'embed-stripe', color: state.color || defaultColor });
  const colorInput = el('input', {
    type: 'color',
    value: state.color || defaultColor,
    oninput: (e) => {
      state.color = e.target.value;
      stripe.style.background = e.target.value;
      update();
    },
  });

  const embedEditor = el(
    'div',
    { class: 'embed-editor' },
    stripe,
    el('div', { class: 'ee-row' }, el('span', { class: 'ee-avatar' }, icon('form')), input('author', { maxlength: 100, placeholder: 'Kopfzeile (z. B. Name des Teams)' })),
    el('div', { class: 'ee-row ee-top' }, input('title', { maxlength: 200, placeholder: 'Titel', class: 'ee-title' }), imageBox('thumbnail', { small: true, label: 'Vorschaubild rechts neben dem Titel' })),
    el('textarea', { rows: 6, maxlength: 3000, placeholder: 'Text des Panels – **fett**, *kursiv* und Zeilenumbrüche wie in Discord', value: state.description ?? '', oninput: (e) => ((state.description = e.target.value), update()) }),
    imageBox('image', { label: 'Großes Bild unten im Panel' }),
    el('div', { class: 'ee-row' }, el('span', { class: 'ee-avatar' }, icon('form')), input('footer', { maxlength: 200, placeholder: 'Fußzeile' })),
    el(
      'div',
      { class: 'ee-color' },
      el('span', { text: 'Farbe des Rands' }),
      colorInput,
      el('button', {
        type: 'button',
        class: 'btn btn-sm btn-ghost',
        text: 'Standard',
        onclick: () => {
          state.color = '';
          colorInput.value = defaultColor;
          stripe.style.background = defaultColor;
          update();
        },
      }),
    ),
  );

  const previewCard = card('Vorschau', 'So sieht das Panel in Discord aus. Buttons und Menüs funktionieren hier nicht.', el('div', { class: 'dc-frame' }, preview));
  previewCard.classList.add('top');
  const errorsBox = el('div', { class: 'notice notice-bad', hidden: true });
  const saveButton = el('button', { type: 'button', class: 'btn', text: 'Speichern', onclick: () => save(false) });
  const sendButton = el('button', { type: 'button', class: 'btn btn-primary', text: 'Panel senden', onclick: () => save(true) });

  root.replaceChildren(
    el(
      'div',
      { class: 'edit-head' },
      el('a', { class: 'edit-back', href: root.dataset.back, 'aria-label': 'Zurück' }, icon('back')),
      el('h1', { text: isNew ? 'Neues Panel' : state.name || state.title || 'Panel' }),
      el('div', { class: 'head-actions' }, saveButton, sendButton),
    ),
    errorsBox,
    section(
      'Panel-Einstellungen',
      grid(
        2,
        card(
          'Kanal',
          'In diesen Kanal wird das Panel gesendet.',
          el(
            'select',
            { onchange: (e) => ((state.channel = e.target.value), update()) },
            el('option', { value: '', text: 'Kanal auswählen' }),
            channels.map((c) => el('option', { value: c.id, text: `#${c.name}`, selected: c.id === state.channel })),
          ),
        ),
        card('Verknüpfte Bewerbungen', 'Diese Bewerbungen kann man über das Panel starten.', linkedPicker, typesHint),
      ),
    ),
    section(
      'Panel-Aussehen',
      grid(2, el('div', { class: 'set-card' }, embedEditor), previewCard),
    ),
    grid(
      2,
      card(
        'Panel-Typ',
        'Button oder Auswahlmenü.',
        el(
          'select',
          { onchange: (e) => ((state.style = e.target.value), update(), drawTypeOptions()) },
          [
            ['menu', 'Auswahlmenü'],
            ['buttons', 'Button'],
          ].map(([v, t]) => el('option', { value: v, text: t, selected: state.style === v })),
        ),
        typeExtra,
      ),
      card('Name im Dashboard', 'Nur für dich, damit du deine Panels auseinanderhältst. Optional.', input('name', { maxlength: 80, placeholder: 'z. B. Hauptpanel' })),
    ),
  );
  drawTypeOptions();
  drawPreview();
  dirty = false;

  async function save(send) {
    errorsBox.hidden = true;
    if (send && !state.channel) return showErrors(['Wähle oben einen Kanal, in den das Panel gesendet wird.']);
    if (send && !window.confirm('Panel jetzt in den gewählten Kanal senden?')) return;
    saveButton.disabled = sendButton.disabled = true;
    try {
      const { ok, result } = await postJson(root.dataset.save, root.dataset.csrf, { ...state, send });
      if (ok) {
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
