// Bewerbung im Browser ausfüllen (Bewerbungen mit mode "DM_WEB"). Anmeldung mit Discord ist Pflicht,
// geprüft wird dasselbe wie per DM: Rollen, Sperren, offene Bewerbung, Wartezeit, Zeitlimit, Antworten, Roblox.
const store = require('../lib/applications/store');
const flow = require('../lib/applications/flow');
const { checkAnswer, renderMessage, formatDuration, optionValue } = require('../lib/applications/forms');
const { findRobloxUser } = require('../lib/applications/roblox');
const { html, raw, escape } = require('./html');
const { layout } = require('./pages');
const auth = require('./auth');
const { memberOf } = require('./access');

const starts = new Map(); // `${userId}:${guildId}:${typeId}` → Startzeit (für Zeitlimit und Dauer)
const busy = new Set(); // verhindert doppeltes Absenden

// **fett**, *kursiv*, Zeilenumbrüche – erst maskieren, dann formatieren
const discordText = (text) =>
  raw(
    escape(text)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>'),
  );

function messagePage(res, session, title, text, status = 200) {
  res.status(status).type('html').send(layout({ title, session, body: html`<section class="hero"><h1>${title}</h1><p class="lead">${text}</p></section>` }).toString());
}

function vars(type, member) {
  return { applicationName: type.name, applicant: member.displayName, questionCount: type.questions.length, timeLimit: formatDuration(type.timeLimitMinutes) };
}

function formPage({ session, guild, member, type, expiresAt, values = {}, errors = {}, general = [] }) {
  const field = (q, i) => {
    const name = `q_${i}`;
    const value = values[name];
    const error = errors[name];
    const required = q.required !== false;
    let input;
    if (q.type === 'TEXT') {
      input = html`<textarea name="${name}" rows="${(q.max ?? 1000) > 300 ? 5 : 2}" maxlength="${Math.min(q.max ?? 5000, 5000)}" ${q.min ? raw(`minlength="${Number(q.min)}"`) : ''} ${required ? raw('required') : ''} data-counter>${value ?? ''}</textarea>
<small class="hint counter">${q.min ? `mind. ${q.min} · ` : ''}max. ${Math.min(q.max ?? 5000, 5000)} Zeichen</small>`;
    } else if (q.type === 'ROBLOX') {
      input = html`<input name="${name}" value="${value ?? ''}" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" autocomplete="off" ${required ? raw('required') : ''} placeholder="Roblox-Benutzername">
<small class="hint">Der Benutzername, nicht der Anzeigename. Wir prüfen ihn beim Absenden bei Roblox.</small>`;
    } else {
      const chosen = [].concat(value ?? []);
      const kind = q.multiple ? 'checkbox' : 'radio';
      input = html`<div class="choices">${q.options.map(
        (o) => html`<label class="choice"><input type="${kind}" name="${name}" value="${optionValue(o)}" ${chosen.includes(optionValue(o)) ? raw('checked') : ''} ${required && kind === 'radio' ? raw('required') : ''}><span><strong>${o.label}</strong>${o.description ? html`<small>${o.description}</small>` : ''}</span></label>`,
      )}</div>`;
    }
    return html`<div class="card question ${error ? 'has-error' : ''}" id="${name}">
  <h2><span class="q-number">${i + 1}</span> ${q.label}${required ? '' : html` <small class="muted">(optional)</small>`}</h2>
  ${q.description ? html`<p class="hint">${q.description}</p>` : ''}
  ${input}
  ${error ? html`<p class="field-error">${error}</p>` : ''}
</div>`;
  };

  return layout({
    title: type.name,
    session,
    body: html`<div class="apply">
<p class="muted">${guild.name}</p>
<h1>${type.emoji} ${type.name}</h1>
<div class="card apply-intro"><p class="discord-text">${discordText(renderMessage(type.messages.start, vars(type, member)).replace(/\n?[^\n]*\babbrechen\b[^\n]*/i, ''))}</p>
<p class="hint">Zeit bis <strong>${new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', timeStyle: 'short', dateStyle: 'short' }).format(new Date(expiresAt))}</strong> Uhr. Du kannst die Seite schließen und später weitermachen, deine Eingaben gehen dabei aber verloren.</p></div>
${general.length ? html`<div class="notice notice-bad"><ul>${general.map((g) => html`<li>${g}</li>`)}</ul></div>` : ''}
${Object.keys(errors).length ? html`<div class="notice notice-bad">Bitte prüfe die markierten Fragen.</div>` : ''}
<form method="post" class="stack" data-apply>
  <input type="hidden" name="csrf" value="${session.csrf}">
  ${type.questions.map(field)}
  <div class="form-actions"><button class="btn btn-primary btn-lg">Bewerbung absenden</button></div>
</form>
</div>`,
  });
}

function routes(app, client) {
  // Bewerbung und Mitglied laden, Grundprüfungen. Antwortet selbst bei Fehlern und gibt dann null zurück.
  async function load(req, res) {
    const guild = client.guilds.cache.get(req.params.guildId);
    const type = guild && store.typeById(guild.id, req.params.typeId);
    if (!type || type.mode !== 'DM_WEB') {
      messagePage(res, req.session, 'Nicht gefunden', 'Diese Bewerbung gibt es nicht oder sie kann nicht im Browser ausgefüllt werden.', 404);
      return null;
    }
    const member = await memberOf(guild, req.session.userId);
    if (!member) {
      messagePage(res, req.session, 'Nicht auf dem Server', `Um dich zu bewerben, musst du Mitglied von „${guild.name}“ sein.`, 403);
      return null;
    }
    if (flow.sessions.has(member.id)) {
      messagePage(res, req.session, 'Bewerbung läuft schon', 'Du füllst gerade eine Bewerbung in deinen Discord-Direktnachrichten aus. Beende oder breche sie dort zuerst ab (schreibe „abbrechen“).', 409);
      return null;
    }
    const problem = store.eligibility(member, type);
    if (problem) {
      // Discord-Formatierung entfernen (<@&id>, **…**)
      messagePage(res, req.session, type.name, problem.replace(/<@&\d+>/g, 'eine bestimmte Rolle').replace(/<t:(\d+):\w>/g, (m, t) => new Date(t * 1000).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })).replace(/\*\*/g, ''), 403);
      return null;
    }
    const key = `${member.id}:${guild.id}:${type.id}`;
    return { guild, type, member, key };
  }

  app.get('/bewerben/:guildId/:typeId', auth.requireLogin, async (req, res) => {
    const loaded = await load(req, res);
    if (!loaded) return;
    const { type, key } = loaded;
    let startedAt = starts.get(key);
    if (!startedAt || startedAt + type.timeLimitMinutes * 60_000 < Date.now()) {
      startedAt = Date.now();
      starts.set(key, startedAt);
    }
    res.type('html').send(formPage({ session: req.session, ...loaded, expiresAt: startedAt + type.timeLimitMinutes * 60_000 }).toString());
  });

  app.post('/bewerben/:guildId/:typeId', auth.requireLogin, auth.requireCsrf, async (req, res) => {
    const loaded = await load(req, res);
    if (!loaded) return;
    const { guild, type, member, key } = loaded;
    const startedAt = starts.get(key);
    const expiresAt = (startedAt ?? 0) + type.timeLimitMinutes * 60_000;
    const values = {};
    type.questions.forEach((q, i) => {
      const v = req.body[`q_${i}`];
      values[`q_${i}`] = q.type === 'CHOICE' || q.type === 'ROLE' ? [].concat(v ?? []).map(String) : typeof v === 'string' ? v.replace(/\r\n/g, '\n') : '';
    });
    const again = (errors, general = [], status = 400) => res.status(status).type('html').send(formPage({ session: req.session, ...loaded, expiresAt: Math.max(expiresAt, Date.now()), values, errors, general }).toString());

    if (!startedAt || expiresAt < Date.now()) {
      starts.set(key, Date.now());
      return again({}, [`Die Zeit für diese Bewerbung (${formatDuration(type.timeLimitMinutes)}) ist abgelaufen. Die Zeit läuft jetzt neu – sende das Formular noch einmal ab.`]);
    }
    if (busy.has(key)) return again({}, ['Deine Bewerbung wird gerade schon gesendet.'], 409);
    busy.add(key);
    try {
      const errors = {};
      const answers = [];
      const roleSelections = [];
      let roblox = null;
      for (const [i, q] of type.questions.entries()) {
        const name = `q_${i}`;
        const value = values[name];
        const rawValue = Array.isArray(value) ? value : value.trim();
        const problem = checkAnswer(q, rawValue === '' || (Array.isArray(rawValue) && !rawValue.length) ? null : rawValue);
        if (problem) {
          errors[name] = problem;
          continue;
        }
        let display = Array.isArray(rawValue) ? q.options.filter((o) => rawValue.includes(optionValue(o))).map((o) => o.label).join(', ') : rawValue;
        if (q.type === 'ROLE') roleSelections.push(...q.options.filter((o) => rawValue.includes(optionValue(o))).map((o) => o.roleId));
        if (q.type === 'ROBLOX' && rawValue) {
          let found;
          try {
            found = await findRobloxUser(rawValue);
          } catch {
            errors[name] = 'Roblox ist gerade nicht erreichbar. Versuche es gleich noch einmal.';
            continue;
          }
          if (!found) {
            errors[name] = `Es gibt kein Roblox-Konto „${rawValue}“.`;
            continue;
          }
          roblox = { id: found.id, name: found.name };
          display = `${found.name} (ID ${found.id})`;
        }
        answers.push({ key: q.key, question: q.label, type: q.type, answer: display, raw: rawValue });
      }
      if (Object.keys(errors).length) return again(errors);

      // Zwischendurch geändert? (Rolle verloren, gesperrt, schon beworben …) – inkl. Roblox-Sperre
      const problem = store.eligibility(member, type, { robloxId: roblox?.id });
      if (problem) return again({}, [problem.replace(/<@&\d+>/g, 'eine bestimmte Rolle').replace(/\*\*/g, '')], 403);

      const record = await flow.finalize({ guild, member, user: member.user, type, answers, roblox, roleSelections, startedAt, source: 'WEB' });
      starts.delete(key);
      res.type('html').send(
        layout({
          title: 'Eingereicht',
          session: req.session,
          body: html`<section class="hero"><h1>✅ Eingereicht</h1><p class="lead discord-text">${discordText(renderMessage(type.messages.finish, { ...vars(type, member), number: record.number }))}</p><p class="hint">Du bekommst die Entscheidung per Discord-Direktnachricht.</p></section>`,
        }).toString(),
      );
    } finally {
      busy.delete(key);
    }
  });
}

module.exports = { routes };
