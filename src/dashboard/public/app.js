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

  const root = document.getElementById('editor');
  if (!root) return;

  // ---------- Editor ----------
  const { type: initial, roles, channels, defaults } = JSON.parse(document.getElementById('editor-data').textContent);
  const state = structuredClone(initial);
  const isNew = Boolean(root.dataset.new);
  let dirty = false;
  let idTouched = !isNew;

  const QUESTION_TYPES = [
    ['TEXT', 'Freitext'],
    ['CHOICE', 'Auswahl'],
    ['ROLE', 'Rollen-Auswahl (Rolle bei Annahme)'],
    ['ROBLOX', 'Roblox-Benutzername (wird geprüft)'],
  ];
  const ROLE_FIELDS = [
    ['managers', 'Manager', 'Dürfen Bewerbungen dieser Art sehen und entscheiden (Discord und Dashboard).'],
    ['ping', 'Bei neuen Bewerbungen markieren', ''],
    ['acceptAdd', 'Bei Annahme geben', ''],
    ['acceptRemove', 'Bei Annahme nehmen', ''],
    ['rejectAdd', 'Bei Ablehnung geben', ''],
    ['rejectRemove', 'Bei Ablehnung nehmen', ''],
    ['pending', 'Während die Bewerbung offen ist', 'Wird beim Einreichen gegeben und bei der Entscheidung genommen.'],
    ['removeOnSubmit', 'Beim Einreichen nehmen', ''],
    ['required', 'Erforderlich', 'Ohne diese Rollen kann man sich nicht bewerben.'],
    ['blocked', 'Gesperrt', 'Mit diesen Rollen kann man sich nicht bewerben.'],
  ];
  const MESSAGES = [
    ['start', 'Startnachricht (DM)'],
    ['finish', 'Nach dem Einreichen (DM)'],
    ['accept', 'Bei Annahme (DM)'],
    ['reject', 'Bei Ablehnung (DM)'],
  ];

  const slug = (value, max) =>
    value
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, max);

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'color') node.style.background = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'value') node.value = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key in node && typeof value !== 'string') node[key] = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child) node.append(child);
    return node;
  }
  const changed = () => {
    dirty = true;
  };

  function field(label, input, hint) {
    return el('label', { class: 'field' }, el('span', { class: 'field-label', text: label }), input, hint ? el('small', { class: 'hint', text: hint }) : null);
  }
  function textInput(value, onInput, props = {}) {
    return el('input', { type: 'text', value: value ?? '', ...props, oninput: (e) => (onInput(e.target.value), changed()) });
  }
  function numberInput(value, onInput, props = {}) {
    return el('input', { type: 'number', value: value ?? '', ...props, oninput: (e) => (onInput(e.target.value === '' ? '' : Number(e.target.value)), changed()) });
  }
  function textArea(value, onInput, props = {}) {
    return el('textarea', { rows: 3, ...props, value: value ?? '', oninput: (e) => (onInput(e.target.value), changed()) });
  }
  function select(options, value, onChange) {
    return el(
      'select',
      { onchange: (e) => (onChange(e.target.value), changed()) },
      options.map(([v, label]) => el('option', { value: v, text: label, selected: v === value })),
    );
  }
  function checkbox(label, checked, onChange) {
    return el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: Boolean(checked), onchange: (e) => (onChange(e.target.checked), changed()) }), el('span', { text: label }));
  }
  const section = (title, intro, ...content) => el('fieldset', { class: 'card' }, el('legend', { text: title }), intro ? el('p', { class: 'hint', text: intro }) : null, ...content);

  const channelOptions = [['', '— Standard —'], ...channels.map((c) => [c.id, `#${c.name}`])];
  const roleName = (id) => roles.find((r) => r.id === id)?.name ?? 'gelöschte Rolle';

  // Rollen-Auswahl als Chips + „hinzufügen“-Menü
  function rolePicker(list, onChange) {
    const wrap = el('div', { class: 'role-picker' });
    const draw = () => {
      wrap.replaceChildren(
        ...list.map((id) =>
          el(
            'span',
            { class: 'chip' },
            el('span', { class: 'chip-dot', color: roles.find((r) => r.id === id)?.color }),
            roleName(id),
            el('button', { type: 'button', class: 'chip-x', 'aria-label': 'Entfernen', text: '×', onclick: () => (list.splice(list.indexOf(id), 1), onChange(), changed(), draw()) }),
          ),
        ),
        el(
          'select',
          {
            class: 'role-add',
            onchange: (e) => {
              if (e.target.value) list.push(e.target.value);
              onChange();
              changed();
              draw();
            },
          },
          el('option', { value: '', text: '+ Rolle hinzufügen' }),
          roles.filter((r) => !list.includes(r.id)).map((r) => el('option', { value: r.id, text: r.name })),
        ),
      );
    };
    draw();
    return wrap;
  }

  // ---------- Fragen ----------
  const questionsWrap = el('div', { class: 'questions' });

  function newQuestion() {
    return { key: '', type: 'TEXT', label: '', description: '', required: true, min: 10, max: 1000, _new: true };
  }

  function drawQuestions() {
    questionsWrap.replaceChildren(
      ...state.questions.map((q, index) => questionCard(q, index)),
      state.questions.length
        ? null
        : el('p', { class: 'empty-inline', text: 'Noch keine Fragen. Jede Bewerbung braucht mindestens eine.' }),
    );
    addQuestionButton.disabled = state.questions.length >= 50;
    questionCount.textContent = `${state.questions.length} / 50`;
  }

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= state.questions.length) return;
    [state.questions[index], state.questions[target]] = [state.questions[target], state.questions[index]];
    changed();
    drawQuestions();
  }

  function questionCard(q, index) {
    const details = el('div', { class: 'q-details' });
    const keyInput = textInput(q.key, (v) => {
      q.key = v;
      q._keyTouched = true;
    }, { maxlength: 32, pattern: '[a-z0-9_]+', class: 'mono' });

    const drawDetails = () => {
      const parts = [];
      if (q.type === 'TEXT') {
        parts.push(
          el(
            'div',
            { class: 'row' },
            field('Mindestlänge', numberInput(q.min ?? 0, (v) => (q.min = v), { min: 0, max: 5000 })),
            field('Höchstlänge', numberInput(q.max ?? 1000, (v) => (q.max = v), { min: 1, max: 5000 })),
          ),
        );
      }
      if (q.type === 'CHOICE' || q.type === 'ROLE') {
        q.options ??= [];
        const list = el('div', { class: 'options' });
        const drawOptions = () => {
          list.replaceChildren(
            ...q.options.map((o, i) =>
              el(
                'div',
                { class: 'option-row' },
                textInput(o.label, (v) => (o.label = v), { placeholder: `Antwort ${i + 1}`, maxlength: 100 }),
                textInput(o.description ?? '', (v) => (o.description = v), { placeholder: 'Beschreibung (optional)', maxlength: 100 }),
                q.type === 'ROLE' ? select([['', '— Rolle wählen —'], ...roles.map((r) => [r.id, r.name])], o.roleId ?? '', (v) => (o.roleId = v)) : null,
                el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: 'Entfernen', onclick: () => (q.options.splice(i, 1), changed(), drawOptions()) }),
              ),
            ),
            el('button', {
              type: 'button',
              class: 'btn btn-sm',
              text: '+ Antwortmöglichkeit',
              disabled: q.options.length >= 25,
              onclick: () => (q.options.push({ label: '' }), changed(), drawOptions()),
            }),
          );
        };
        drawOptions();
        parts.push(checkbox('Mehrfachauswahl erlauben', q.multiple, (v) => (q.multiple = v)), el('div', { class: 'field' }, el('span', { class: 'field-label', text: 'Antwortmöglichkeiten (max. 25)' }), list));
        if (q.type === 'ROLE') parts.push(el('p', { class: 'hint', text: 'Die gewählte Rolle bekommt die Person, wenn die Bewerbung angenommen wird.' }));
      }
      if (q.type === 'ROBLOX') parts.push(el('p', { class: 'hint', text: 'Der Bot sucht das Roblox-Konto und die Person bestätigt es. Das Konto erscheint mit Profil-Link in der Bewerbung und zählt für Sperren.' }));
      details.replaceChildren(...parts);
    };
    drawDetails();

    return el(
      'div',
      { class: 'q-card' },
      el(
        'div',
        { class: 'q-head' },
        el('span', { class: 'q-number', text: String(index + 1) }),
        select(QUESTION_TYPES, q.type, (v) => {
          q.type = v;
          if ((v === 'CHOICE' || v === 'ROLE') && !q.options?.length) q.options = [{ label: '' }, { label: '' }];
          drawDetails();
        }),
        el(
          'div',
          { class: 'q-tools' },
          el('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Nach oben', 'aria-label': 'Nach oben', text: '↑', disabled: index === 0, onclick: () => move(index, -1) }),
          el('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Nach unten', 'aria-label': 'Nach unten', text: '↓', disabled: index === state.questions.length - 1, onclick: () => move(index, 1) }),
          el('button', {
            type: 'button',
            class: 'btn btn-sm btn-ghost',
            text: 'Löschen',
            onclick: () => {
              if (q.label && !window.confirm(`Frage „${q.label}“ löschen?`)) return;
              state.questions.splice(index, 1);
              changed();
              drawQuestions();
            },
          }),
        ),
      ),
      field(
        'Frage',
        textInput(q.label, (v) => {
          q.label = v;
          if (q._new && !q._keyTouched) {
            q.key = slug(v, 32);
            keyInput.value = q.key;
          }
        }, { maxlength: 250, placeholder: 'z. B. Warum möchtest du zu uns?' }),
      ),
      field('Zusatztext (optional)', textInput(q.description ?? '', (v) => (q.description = v), { maxlength: 500, placeholder: 'Erscheint klein unter der Frage' })),
      el('div', { class: 'row' }, field('Schlüssel', keyInput, 'Intern, eindeutig je Bewerbung'), el('div', { class: 'field field-check' }, checkbox('Pflichtfrage', q.required !== false, (v) => (q.required = v)))),
      details,
    );
  }

  const questionCount = el('span', { class: 'muted' });
  const addQuestionButton = el('button', {
    type: 'button',
    class: 'btn',
    text: '+ Frage hinzufügen',
    onclick: () => {
      state.questions.push(newQuestion());
      changed();
      drawQuestions();
      questionsWrap.lastElementChild?.querySelector('input')?.focus();
    },
  });

  // ---------- Formular aufbauen ----------
  const idInput = textInput(state.id, (v) => {
    state.id = v;
    idTouched = true;
  }, { maxlength: 24, pattern: '[a-z0-9_-]{2,24}', class: 'mono', placeholder: 'z. B. polizei', disabled: !isNew });

  const errorsBox = el('div', { class: 'notice notice-bad', hidden: true });
  const saveButton = el('button', { type: 'submit', class: 'btn btn-primary', text: isNew ? 'Bewerbungsart anlegen' : 'Speichern' });

  const form = el(
    'form',
    { class: 'stack', novalidate: true, onsubmit: save },
    section(
      'Allgemein',
      null,
      el(
        'div',
        { class: 'row' },
        field('Name', textInput(state.name, (v) => {
          state.name = v;
          if (isNew && !idTouched) {
            state.id = slug(v, 24).replace(/_/g, '-');
            idInput.value = state.id;
          }
        }, { maxlength: 80, required: true, placeholder: 'z. B. Polizei-Bewerbung' })),
        field('Emoji', textInput(state.emoji, (v) => (state.emoji = v), { maxlength: 32, class: 'short' })),
      ),
      field('Beschreibung', textArea(state.description, (v) => (state.description = v), { maxlength: 300, rows: 2, placeholder: 'Erscheint im Panel und im Auswahlmenü' })),
      el(
        'div',
        { class: 'row' },
        field('Schlüssel', idInput, isNew ? 'Kann später nicht mehr geändert werden' : 'Kann nicht geändert werden'),
        field('Nummern-Präfix', textInput(state.numberPrefix, (v) => (state.numberPrefix = v.toUpperCase()), { maxlength: 8, class: 'mono short' }), 'z. B. APP → APP-0001'),
      ),
      el(
        'div',
        { class: 'row' },
        field(
          'Ablauf',
          select([['simple', 'Einfach: offen → angenommen/abgelehnt'], ['police', 'Mit Prüfschritten: Prüfung → Gespräch → Entscheidung']], state.workflow, (v) => (state.workflow = v)),
        ),
      ),
      el('p', { class: 'hint', text: 'In welchem Panel die Bewerbung erscheint, stellst du unter „Panels“ ein.' }),
      checkbox('Bewerbungen annehmen (sonst im Panel „geschlossen“)', state.enabled, (v) => (state.enabled = v)),
    ),
    section('Fragen', 'Die Fragen kommen nacheinander per Direktnachricht. Reihenfolge mit ↑ ↓ ändern.', el('div', { class: 'card-head' }, questionCount), questionsWrap, addQuestionButton),
    section(
      'Texte',
      'Variablen: {applicant} Bewerber · {user} Entscheider · {applicationName} · {number} · {reason} · {questionCount} · {timeLimit}. Leer lassen = Standardtext.',
      MESSAGES.map(([key, label]) => field(label, textArea(state.messages?.[key] === defaults.messages[key] ? '' : state.messages?.[key], (v) => ((state.messages ??= {})[key] = v), { maxlength: 2000, rows: 3, placeholder: defaults.messages[key] }))),
    ),
    section(
      'Rollen',
      'Manager-Rolle und Annahme-Rolle reichen für den Anfang.',
      ROLE_FIELDS.map(([key, label, hint]) => field(label, rolePicker((state.roles[key] ??= []), () => {}), hint)),
      el(
        'div',
        { class: 'row' },
        field('Erforderliche Rollen', select([['all', 'alle nötig'], ['any', 'eine reicht']], state.roles.requiredMode, (v) => (state.roles.requiredMode = v))),
        field('Gesperrte Rollen', select([['any', 'eine reicht zum Sperren'], ['all', 'nur wenn alle']], state.roles.blockedMode, (v) => (state.roles.blockedMode = v))),
      ),
    ),
    section(
      'Kanäle',
      '„Standard“ nimmt den Kanal aus „Panels & Kanäle“.',
      el(
        'div',
        { class: 'row' },
        field('Neue Bewerbungen', select(channelOptions, state.channels?.open ?? '', (v) => (state.channels.open = v))),
        field('Kopie: angenommen', select([['', '— keine —'], ...channelOptions.slice(1)], state.channels?.accepted ?? '', (v) => (state.channels.accepted = v))),
        field('Kopie: abgelehnt', select([['', '— keine —'], ...channelOptions.slice(1)], state.channels?.rejected ?? '', (v) => (state.channels.rejected = v))),
      ),
    ),
    section(
      'Sonstiges',
      null,
      el(
        'div',
        { class: 'row' },
        field('Wartezeit zwischen zwei Bewerbungen (Minuten)', numberInput(state.cooldownMinutes, (v) => (state.cooldownMinutes = v), { min: 0, max: 525600 }), '1440 = 1 Tag, 10080 = 1 Woche'),
        field('Zeit zum Ausfüllen (Minuten)', numberInput(state.timeLimitMinutes, (v) => (state.timeLimitMinutes = v), { min: 5, max: 10080 }), '5 bis 10080'),
      ),
      field(
        'Wenn die Person den Server verlässt',
        select([['WITHDRAW', 'Bewerbung zurückziehen'], ['DENY', 'Bewerbung ablehnen'], ['NONE', 'Nichts tun']], state.onLeave, (v) => (state.onLeave = v)),
      ),
      checkbox('Zu jeder Bewerbung einen Thread fürs Team öffnen', state.teamThreads, (v) => (state.teamThreads = v)),
    ),
    errorsBox,
    el('div', { class: 'form-actions sticky' }, el('a', { class: 'btn btn-ghost', href: root.dataset.back, text: 'Abbrechen' }), saveButton),
  );

  state.channels ??= { open: '', accepted: '', rejected: '' };
  root.replaceChildren(form);
  drawQuestions();

  async function save(event) {
    event.preventDefault();
    errorsBox.hidden = true;
    saveButton.disabled = true;
    const payload = structuredClone(state);
    payload.questions = payload.questions.map(({ _new, _keyTouched, ...q }) => q);
    try {
      const res = await fetch(root.dataset.save, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF': root.dataset.csrf, Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = res.headers.get('content-type')?.includes('json') ? await res.json() : { errors: [(await res.text()) || `Fehler ${res.status}`] };
      if (res.ok && result.ok) {
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
})();
