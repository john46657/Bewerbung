// Dashboard: Rückfragen, klickbare Tabellenzeilen und der Editor für Bewerbungsarten.
// Alle Inhalte werden mit textContent/value gesetzt, nie als HTML.
(() => {
  'use strict';

  // ---------- Kleinigkeiten ----------
  document.addEventListener('click', (event) => {
    const confirmEl = event.target.closest('[data-confirm]');
    if (confirmEl && confirmEl.dataset.confirm && !window.confirm(confirmEl.dataset.confirm)) {
      event.preventDefault();
      return;
    }
    const row = event.target.closest('tr[data-href]');
    if (row && !event.target.closest('a, button')) window.location.href = row.dataset.href;
  });

  // Farbstreifen der Panel-Karten (Inline-Styles sind per CSP verboten, CSSOM ist erlaubt)
  for (const node of document.querySelectorAll('[data-color]')) {
    if (/^#[0-9a-f]{6}$/i.test(node.dataset.color)) node.style.background = node.dataset.color;
  }

  // Zeichenzähler im Bewerbungsformular
  for (const area of document.querySelectorAll('textarea[data-counter]')) {
    const hint = area.nextElementSibling;
    const base = hint?.textContent ?? '';
    const update = () => {
      const n = area.value.trim().length;
      hint.textContent = `${n} Zeichen · ${base}`;
      hint.classList.toggle('over', (area.minLength > 0 && n > 0 && n < area.minLength) || n > area.maxLength);
    };
    area.addEventListener('input', update);
    if (area.value) update();
  }
  // Suchfeld über einer Liste (data-filter=".selector", Einträge mit data-search)
  for (const search of document.querySelectorAll('input[data-filter]')) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      for (const row of document.querySelectorAll(search.dataset.filter)) row.hidden = Boolean(q) && !row.dataset.search.includes(q);
    });
  }
  // Doppelklick auf „Absenden“ verhindern
  for (const form of document.querySelectorAll('form[data-apply]')) {
    form.addEventListener('submit', () => setTimeout(() => form.querySelector('button').setAttribute('disabled', ''), 0));
  }

  const root = document.getElementById('editor');
  if (root) buildTypeEditor(root);
})();

// ---------- Bewerbung bearbeiten ----------
function buildTypeEditor(root) {
  'use strict';
  const { el, icon, card, section, grid, toggle, multiPicker, duration, segmented, slug, postJson } = window.UI;
  const { type: initial, roles, channels, defaults, webBase } = JSON.parse(document.getElementById('editor-data').textContent);
  const state = structuredClone(initial);
  state.channels ??= { open: '', accepted: '', rejected: '' };
  state.messages ??= {};
  state.roles ??= {};
  const isNew = Boolean(root.dataset.new);
  let dirty = false;
  const changed = () => (dirty = true);

  const QUESTION_TYPES = [
    ['TEXT', 'Text'],
    ['CHOICE', 'Mehrfachauswahl'],
    ['ROLE', 'Rollen-Auswahl'],
    ['ROBLOX', 'Roblox-Name'],
  ];
  const VARIABLES = [
    ['{applicant}', 'Bewerber'],
    ['{user}', 'wer entschieden hat'],
    ['{applicationName}', 'Name der Bewerbung'],
    ['{number}', 'Bewerbungsnummer'],
    ['{reason}', 'Grund der Entscheidung'],
    ['{questionCount}', 'Anzahl Fragen'],
    ['{timeLimit}', 'Zeitlimit'],
  ];
  const roleItems = roles.map((r) => ({ id: r.id, name: r.name, color: r.color }));
  const channelSelect = (key, required) =>
    el(
      'select',
      { class: required && !state.channels[key] ? 'invalid' : '', onchange: (e) => ((state.channels[key] = e.target.value), e.target.classList.toggle('invalid', required && !e.target.value), changed()) },
      el('option', { value: '', text: 'Kanal auswählen' }),
      channels.map((c) => el('option', { value: c.id, text: `#${c.name}`, selected: c.id === state.channels[key] })),
    );
  const input = (value, onInput, props = {}) => el('input', { type: 'text', value: value ?? '', ...props, oninput: (e) => (onInput(e.target.value), changed()) });
  const area = (value, onInput, props = {}) => el('textarea', { rows: 2, ...props, value: value ?? '', oninput: (e) => (onInput(e.target.value), changed()) });
  const select = (options, value, onChange, props = {}) =>
    el('select', { ...props, onchange: (e) => (onChange(e.target.value), changed()) }, options.map(([v, t]) => el('option', { value: v, text: t, selected: v === value })));

  // ---------- Grundlagen ----------
  const linkBox = el('div', { class: 'share' });
  function drawLink() {
    if (state.mode !== 'DM_WEB') return linkBox.replaceChildren();
    if (isNew) return linkBox.replaceChildren(el('p', { class: 'set-desc', text: 'Den Link zum Online-Formular siehst du hier nach dem ersten Speichern.' }));
    const url = webBase + state.id;
    const copy = el('button', {
      type: 'button',
      class: 'btn btn-primary',
      text: 'Kopieren',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(url);
          copy.textContent = 'Kopiert ✓';
        } catch {
          field.select();
        }
      },
    });
    const field = el('input', { type: 'text', class: 'mono', value: url, readonly: true, onfocus: (e) => e.target.select() });
    linkBox.replaceChildren(el('p', { class: 'set-desc', text: 'Ohne Panel: Teile diesen Link, dann können sich Mitglieder im Online-Formular bewerben.' }), el('div', { class: 'share-row' }, field, copy));
  }

  const basics = section(
    'Grundlagen',
    grid(
      3,
      card('Aktiv', 'Bewerbung öffnen oder schließen. Geschlossene Bewerbungen nehmen keine neuen Einsendungen an.', toggle(state.enabled, (v) => ((state.enabled = v), changed()))),
      card('Name der Bewerbung', 'So heißt die Bewerbung in Discord und im Panel.', input(state.name, (v) => (state.name = v), { maxlength: 80, placeholder: 'z. B. Polizei-Bewerbung', required: true })),
      card(
        'Art der Bewerbung',
        'Wie Mitglieder die Bewerbung ausfüllen.',
        select(
          [
            ['DM', 'Direktnachricht'],
            ['DM_WEB', 'Direktnachricht und Website'],
          ],
          state.mode ?? 'DM',
          (v) => ((state.mode = v), drawLink()),
        ),
        linkBox,
      ),
      card('Kanal für ausstehende Bewerbungen', 'Hierhin werden neue Bewerbungen zur Prüfung geschickt. Am besten nur fürs Team sichtbar.', channelSelect('open', true)),
      card('Kanal für angenommene Bewerbungen', 'Hierhin wird eine Bewerbung kopiert, wenn sie angenommen wurde. Optional.', channelSelect('accepted')),
      card('Kanal für abgelehnte Bewerbungen', 'Hierhin wird eine Bewerbung kopiert, wenn sie abgelehnt wurde. Optional.', channelSelect('rejected')),
      card('Emoji', 'Erscheint im Panel, auf Buttons und im Auswahlmenü.', input(state.emoji, (v) => (state.emoji = v), { maxlength: 32, class: 'emoji-input' })),
      card('Beschreibung', 'Kurzer Text im Panel und im Auswahlmenü. Optional.', area(state.description, (v) => (state.description = v), { maxlength: 300 })),
      card(
        'Ablauf',
        'Einfach: offen → angenommen/abgelehnt. Mit Prüfschritten: Prüfung → Gespräch → Entscheidung.',
        select(
          [
            ['simple', 'Einfach'],
            ['police', 'Mit Prüfschritten'],
          ],
          state.workflow,
          (v) => (state.workflow = v),
        ),
      ),
    ),
  );

  // ---------- Fragen ----------
  const questionsWrap = el('div', { class: 'q-list' });
  const questionsTitle = el('h2', { class: 'set-title' });
  const usage = el('p', { class: 'muted' });
  const addButton = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: 'Neue Frage',
    onclick: () => {
      state.questions.push({ key: '', type: 'TEXT', label: '', required: true, min: 0, max: 1000 });
      changed();
      drawQuestions();
      questionsWrap.lastElementChild?.querySelector('textarea')?.focus();
    },
  });
  let dragFrom = null;

  function drawQuestions() {
    questionsTitle.replaceChildren('Fragen: ', el('span', { class: 'muted', text: `${state.questions.length}/50` }));
    usage.textContent = `${state.questions.length}/50 Fragen verwendet.`;
    addButton.disabled = state.questions.length >= 50;
    questionsWrap.replaceChildren(...state.questions.map(questionCard), ...(state.questions.length ? [] : [el('div', { class: 'q-empty', text: 'Noch keine Fragen. Jede Bewerbung braucht mindestens eine.' })]));
  }

  function answersInput(q) {
    // Antwortmöglichkeiten als Chips; Enter oder Komma fügt hinzu
    q.options ??= [];
    const box = el('div', { class: 'picker answers-picker' });
    const draw = () => {
      const entry = el('input', {
        type: 'text',
        class: 'picker-input',
        placeholder: q.options.length ? '' : 'Antworten hinzufügen …',
        maxlength: 100,
        onkeydown: (e) => {
          if ((e.key === 'Enter' || e.key === ',') && e.target.value.trim()) {
            e.preventDefault();
            if (q.options.length < 25 && !q.options.some((o) => o.label === e.target.value.trim())) q.options.push({ label: e.target.value.trim() });
            changed();
            draw();
            box.querySelector('input').focus();
          } else if (e.key === 'Backspace' && !e.target.value && q.options.length) {
            q.options.pop();
            changed();
            draw();
            box.querySelector('input').focus();
          }
        },
        onblur: (e) => {
          if (e.target.value.trim() && q.options.length < 25 && !q.options.some((o) => o.label === e.target.value.trim())) {
            q.options.push({ label: e.target.value.trim() });
            changed();
            draw();
          }
        },
      });
      box.replaceChildren(
        ...q.options.map((o, i) => el('span', { class: 'chip' }, o.label, el('button', { type: 'button', class: 'chip-x', 'aria-label': `${o.label} entfernen`, text: '×', onclick: () => (q.options.splice(i, 1), changed(), draw()) }))),
        entry,
        ...(q.options.length ? [el('button', { type: 'button', class: 'picker-clear', 'aria-label': 'Alle entfernen', onclick: () => ((q.options = []), changed(), draw()) }, icon('x'))] : []),
      );
    };
    draw();
    box.addEventListener('click', (e) => e.target === box && box.querySelector('input').focus());
    return box;
  }

  function rolesAnswerInput(q) {
    // Rollen-Auswahl: jede gewählte Rolle wird eine Antwort; Text = Rollenname
    const ids = (q.options ?? []).map((o) => o.roleId).filter(Boolean);
    return multiPicker(
      roleItems,
      ids,
      () => {
        q.options = ids.map((id) => ({ label: roles.find((r) => r.id === id)?.name ?? 'Rolle', roleId: id }));
        changed();
      },
      { placeholder: 'Rollen hinzufügen …' },
    );
  }

  function questionCard(q, index) {
    const body = el('div', { class: 'q-body' });
    const settings = el('div', { class: 'q-settings' });
    const drawBody = () => {
      const label = area(q.label, (v) => (q.label = v), { maxlength: 250, rows: 1, placeholder: 'Deine Frage …', class: 'q-label' });
      const extra = q.type === 'CHOICE' ? answersInput(q) : q.type === 'ROLE' ? rolesAnswerInput(q) : null;
      body.className = extra ? 'q-body split' : 'q-body';
      body.replaceChildren(...[label, extra].filter(Boolean));

      const parts = [
        el('label', { class: 'row-line' }, toggle(q.required !== false, (v) => ((q.required = v), changed())), el('span', { text: 'Pflichtfrage' })),
        el('label', { class: 'stack-field' }, el('span', { text: 'Zusatztext unter der Frage (optional)' }), input(q.description, (v) => (q.description = v), { maxlength: 500 })),
      ];
      if (q.type === 'TEXT') {
        parts.push(
          el(
            'div',
            { class: 'two' },
            el('label', { class: 'stack-field' }, el('span', { text: 'Mindestlänge (Zeichen)' }), el('input', { type: 'number', min: 0, max: 5000, value: String(q.min ?? 0), oninput: (e) => ((q.min = Number(e.target.value) || 0), changed()) })),
            el('label', { class: 'stack-field' }, el('span', { text: 'Höchstlänge (Zeichen)' }), el('input', { type: 'number', min: 1, max: 5000, value: String(q.max ?? 1000), oninput: (e) => ((q.max = Number(e.target.value) || 1000), changed()) })),
          ),
        );
      }
      if (q.type === 'CHOICE' || q.type === 'ROLE') parts.push(el('label', { class: 'row-line' }, toggle(q.multiple, (v) => ((q.multiple = v), changed())), el('span', { text: 'Mehrere Antworten erlauben' })));
      if (q.type === 'ROLE') parts.push(el('p', { class: 'set-desc', text: 'Die gewählten Rollen bekommt die Person, wenn die Bewerbung angenommen wird.' }));
      if (q.type === 'ROBLOX') parts.push(el('p', { class: 'set-desc', text: 'Der Bot sucht das Roblox-Konto und lässt es bestätigen. Es zählt auch für Bewerbungssperren.' }));
      settings.replaceChildren(...parts);
    };
    drawBody();

    const node = el(
      'div',
      { class: 'q-card' },
      el(
        'div',
        { class: 'q-top' },
        el('span', { class: 'q-grip', title: 'Ziehen zum Verschieben', draggable: 'true' }, icon('grip')),
        el('h3', { text: `Frage ${index + 1}` }),
        select(QUESTION_TYPES, q.type, (v) => {
          q.type = v;
          if (v === 'ROLE') q.options = (q.options ?? []).filter((o) => o.roleId);
          drawBody();
        }, { class: 'q-type' }),
        el('button', {
          type: 'button',
          class: 'icon-btn',
          title: 'Duplizieren',
          'aria-label': 'Frage duplizieren',
          disabled: state.questions.length >= 50,
          onclick: () => {
            const copy = structuredClone(q);
            copy.key = '';
            state.questions.splice(index + 1, 0, copy);
            changed();
            drawQuestions();
          },
        }, icon('copy')),
        el('button', {
          type: 'button',
          class: 'icon-btn danger',
          title: 'Löschen',
          'aria-label': 'Frage löschen',
          onclick: () => {
            if (q.label && !window.confirm(`Frage „${q.label}“ löschen?`)) return;
            state.questions.splice(index, 1);
            changed();
            drawQuestions();
          },
        }, icon('trash')),
      ),
      body,
      el('details', { class: 'q-foot' }, el('summary', {}, 'Prüfung & Einstellungen', icon('chevron')), settings),
    );

    // Ziehen und Ablegen zum Sortieren
    const grip = node.querySelector('.q-grip');
    grip.addEventListener('dragstart', (e) => {
      dragFrom = index;
      node.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setDragImage(node, 30, 30);
    });
    grip.addEventListener('dragend', () => node.classList.remove('dragging'));
    node.addEventListener('dragover', (e) => {
      if (dragFrom === null) return;
      e.preventDefault();
      node.classList.add('drop-target');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      node.classList.remove('drop-target');
      if (dragFrom === null || dragFrom === index) return;
      const [moved] = state.questions.splice(dragFrom, 1);
      state.questions.splice(index, 0, moved);
      dragFrom = null;
      changed();
      drawQuestions();
    });
    return node;
  }

  const questions = el('section', { class: 'set-section' }, questionsTitle, questionsWrap, usage, addButton);

  // ---------- Nachrichten ----------
  function messageCard(key, title, description) {
    const vars = el('div', { class: 'vars', hidden: true }, VARIABLES.map(([v, t]) => el('button', { type: 'button', class: 'var', title: 'Einfügen', onclick: () => insert(v) }, el('code', { text: v }), ` ${t}`)));
    const text = area(state.messages[key] === defaults.messages[key] ? '' : state.messages[key], (v) => (state.messages[key] = v), { maxlength: 2000, rows: key === 'start' ? 5 : 2, placeholder: defaults.messages[key] });
    const insert = (v) => {
      const pos = text.selectionStart ?? text.value.length;
      text.value = text.value.slice(0, pos) + v + text.value.slice(text.selectionEnd ?? pos);
      state.messages[key] = text.value;
      changed();
      text.focus();
    };
    const head = el('div', { class: 'set-head-row' }, el('h3', { text: title }), el('button', { type: 'button', class: 'vars-btn', onclick: () => (vars.hidden = !vars.hidden) }, icon('tag'), 'Variablen anzeigen'));
    return card(head, description, vars, text);
  }
  const messages = section(
    'Nachrichten',
    grid(
      2,
      messageCard('accept', 'Nachricht bei Annahme', 'Diese Nachricht bekommt die Person, wenn ihre Bewerbung angenommen wurde.'),
      messageCard('reject', 'Nachricht bei Ablehnung', 'Diese Nachricht bekommt die Person, wenn ihre Bewerbung abgelehnt wurde.'),
      messageCard('start', 'Startnachricht', 'Die erste Nachricht, wenn jemand die Bewerbung beginnt.'),
      messageCard('finish', 'Abschlussnachricht', 'Diese Nachricht bekommt die Person, wenn sie die Bewerbung abgeschickt hat.'),
    ),
    el(
      'details',
      { class: 'advanced', open: state.hideAnswers || state.showStats === false },
      el('summary', {}, 'Erweiterte Optionen', icon('chevron')),
      el(
        'div',
        { class: 'advanced-grid' },
        el('div', {}, el('h4', { text: 'Statistik anzeigen' }), el('p', { class: 'set-desc', text: 'Zeigt in der Team-Nachricht z. B. die Dauer, das Alter des Discord-Kontos und seit wann die Person auf dem Server ist.' }), toggle(state.showStats !== false, (v) => ((state.showStats = v), changed()))),
        el('div', {}, el('h4', { text: 'Antworten verstecken' }), el('p', { class: 'set-desc', text: 'Die Antworten stehen dann nicht in der Team-Nachricht, sondern nur im Dashboard.' }), toggle(state.hideAnswers, (v) => ((state.hideAnswers = v), changed()))),
      ),
    ),
  );

  // ---------- Rollen ----------
  const roleCount = (key) => `${(state.roles[key] ?? []).length}`;
  function roleCard(key, title, description, mode) {
    state.roles[key] ??= [];
    const heading = el('h3');
    const drawHeading = () => heading.replaceChildren(`${title}: `, el('span', { class: 'muted', text: roleCount(key) }));
    drawHeading();
    const parts = [];
    if (mode) {
      const modeKey = mode;
      const explain = el('p', { class: 'mode-text' });
      const drawExplain = () => {
        const all = (state.roles[modeKey] ?? (modeKey === 'requiredMode' ? 'all' : 'any')) === 'all';
        explain.textContent =
          modeKey === 'requiredMode'
            ? all ? 'Die Person muss ALLE dieser Rollen haben.' : 'Die Person braucht EINE dieser Rollen.'
            : all ? 'Gesperrt nur, wenn die Person ALLE dieser Rollen hat.' : 'Gesperrt, sobald die Person EINE dieser Rollen hat.';
      };
      drawExplain();
      parts.push(
        el(
          'div',
          { class: 'mode-box' },
          el('span', { class: 'mode-label', text: 'Bedingung' }),
          segmented(
            [
              ['all', 'Hat alle Rollen'],
              ['any', 'Hat eine Rolle'],
            ],
            state.roles[modeKey] ?? (modeKey === 'requiredMode' ? 'all' : 'any'),
            (v) => ((state.roles[modeKey] = v), drawExplain(), changed()),
          ),
          explain,
        ),
      );
    }
    parts.push(multiPicker(roleItems, state.roles[key], () => (drawHeading(), changed()), { placeholder: 'Rollen auswählen …' }));
    return card(heading, description, ...parts);
  }
  const rolesSection = section(
    'Rollen',
    grid(
      3,
      roleCard('blocked', 'Gesperrte Rollen', 'Mit diesen Rollen kann man die Bewerbung nicht abschicken.', 'blockedMode'),
      roleCard('required', 'Benötigte Rollen', 'Diese Rollen braucht man, um die Bewerbung abzuschicken.', 'requiredMode'),
      roleCard('acceptAdd', 'Rollen bei Annahme', 'Diese Rollen bekommt die Person, wenn die Bewerbung angenommen wird.'),
      roleCard('rejectAdd', 'Rollen bei Ablehnung', 'Diese Rollen bekommt die Person, wenn die Bewerbung abgelehnt wird.'),
      roleCard('ping', 'Ping-Rollen', 'Diese Rollen werden erwähnt, wenn eine neue Bewerbung eingeht.'),
      roleCard('acceptRemove', 'Bei Annahme entfernen', 'Diese Rollen werden entfernt, wenn die Bewerbung angenommen wird.'),
      roleCard('rejectRemove', 'Bei Ablehnung entfernen', 'Diese Rollen werden entfernt, wenn die Bewerbung abgelehnt wird.'),
      roleCard('pending', 'Ausstehend-Rollen', 'Diese Rollen hat die Person, solange ihre Bewerbung geprüft wird.'),
      roleCard('removeOnSubmit', 'Beim Abschicken entfernen', 'Diese Rollen werden entfernt, sobald die Person die Bewerbung abschickt.'),
      roleCard('managers', 'Manager-Rollen', 'Wer diese Rollen hat, darf Bewerbungen annehmen und ablehnen (in Discord und im Dashboard). Ohne Manager-Rollen dürfen das nur Staff und „Server verwalten“.'),
    ),
  );

  // ---------- Sonstiges ----------
  const other = section(
    'Sonstiges',
    grid(
      3,
      card('Team-Threads', 'Öffnet zu jeder Bewerbung automatisch einen Thread, in dem das Team darüber sprechen kann.', toggle(state.teamThreads, (v) => ((state.teamThreads = v), changed()))),
      card('Wartezeit', 'Wie lange jemand warten muss, bevor er sich erneut bewerben kann.', duration(state.cooldownMinutes ?? 0, (v) => ((state.cooldownMinutes = v), changed()))),
      card(
        'Aktion beim Verlassen',
        'Was mit einer offenen Bewerbung passiert, wenn die Person den Server verlässt.',
        select(
          [
            ['NONE', 'Nichts'],
            ['WITHDRAW', 'Zurückziehen'],
            ['DENY', 'Ablehnen'],
          ],
          state.onLeave,
          (v) => (state.onLeave = v),
        ),
      ),
      card('Zeitlimit', 'Wie lange man Zeit hat, die Bewerbung auszufüllen (mindestens 5 Minuten, höchstens 7 Tage).', duration(state.timeLimitMinutes ?? 180, (v) => ((state.timeLimitMinutes = v), changed()), { min: 5, max: 10080 })),
    ),
  );

  // ---------- Kopf, Fehler, Speichern ----------
  const errorsBox = el('div', { class: 'notice notice-bad', hidden: true });
  const saveButton = el('button', { type: 'submit', class: 'btn btn-primary', text: isNew ? 'Bewerbung anlegen' : 'Speichern' });
  const header = el(
    'div',
    { class: 'edit-head' },
    el('a', { class: 'edit-back', href: root.dataset.back, 'aria-label': 'Zurück' }, icon('back')),
    el('h1', { text: isNew ? 'Neue Bewerbung' : state.name || 'Bewerbung' }),
    saveButton,
  );

  const form = el('form', { class: 'editor', novalidate: true, onsubmit: save }, header, errorsBox, basics, questions, messages, rolesSection, other);
  root.replaceChildren(form);
  drawQuestions();
  drawLink();

  async function save(event) {
    event.preventDefault();
    errorsBox.hidden = true;
    saveButton.disabled = true;
    const payload = structuredClone(state);
    // Interne Schlüssel automatisch: bestehende bleiben, neue kommen aus dem Fragetext
    const used = new Set();
    payload.questions = payload.questions.map((q) => {
      let key = /^[a-z0-9_]{1,32}$/.test(q.key ?? '') && !used.has(q.key) ? q.key : slug(q.label || 'frage', 28) || 'frage';
      for (let n = 2; used.has(key); n++) key = `${key.replace(/_\d+$/, '').slice(0, 28)}_${n}`;
      used.add(key);
      return { ...q, key };
    });
    try {
      const { ok, result } = await postJson(root.dataset.save, root.dataset.csrf, payload);
      if (ok) {
        dirty = false;
        window.location.href = result.redirect;
        return;
      }
      showErrors(result.errors ?? ['Speichern fehlgeschlagen.']);
    } catch {
      showErrors(['Keine Verbindung zum Dashboard. Läuft der Bot?']);
    }
    saveButton.disabled = false;
  }

  function showErrors(errors) {
    errorsBox.replaceChildren(el('strong', { text: 'Bitte korrigieren:' }), el('ul', {}, errors.map((e) => el('li', { text: e }))));
    errorsBox.hidden = false;
    errorsBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  window.addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  });
}
