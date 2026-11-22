// Prüft die Eingaben aus dem Bewerbungs-Editor und baut daraus eine saubere Bewerbungsart.
// Es wird nur übernommen, was hier ausdrücklich steht; Rollen und Kanäle müssen auf dem Server existieren.
const { ChannelType } = require('discord.js');
const { validateType } = require('../lib/applications/forms');

const ROLE_KEYS = ['required', 'blocked', 'acceptAdd', 'acceptRemove', 'rejectAdd', 'rejectRemove', 'pending', 'removeOnSubmit', 'ping', 'managers'];
const MESSAGE_KEYS = ['start', 'finish', 'accept', 'reject'];
const QUESTION_TYPES = ['TEXT', 'CHOICE', 'ROLE', 'ROBLOX'];

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const bool = (value) => value === true;
function int(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
// Discord nimmt für Buttons und Menüs nur echte Emojis oder Server-Emojis (<:name:id>).
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3)[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0F\u200D]*$|^<a?:\w{2,32}:\d{17,20}>$/u;
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

function sanitizeType(input, { guild, defaults, existingId, takenIds }) {
  const errors = [];
  const roleIds = new Set(guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed).map((r) => r.id));
  const channelIds = new Set(guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).map((c) => c.id));
  const roles = (list) => [...new Set((Array.isArray(list) ? list : []).filter((id) => roleIds.has(id)))];
  const channel = (id) => (typeof id === 'string' && channelIds.has(id) ? id : '');

  // Schlüssel und Nummern-Präfix werden bei neuen Bewerbungen automatisch aus dem Namen gebildet.
  const slug = text(input.name, 80)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let id = existingId;
  if (!id) {
    const base = slug.slice(0, 20).replace(/-+$/, '') || 'bewerbung';
    id = base.length >= 2 && !['neu', 'kanal'].includes(base) ? base : `bewerbung-${base}`.slice(0, 24);
    for (let n = 2; takenIds.includes(id); n++) id = `${base.slice(0, 20)}-${n}`;
  }
  const autoPrefix = (slug.replace(/[^a-z0-9]/g, '').slice(0, 4) || 'Q').toUpperCase();
  if (!existingId && ['neu', 'kanal'].includes(id)) errors.push(`Der Schlüssel „${id}“ ist reserviert.`);
  if (!existingId && takenIds.includes(id)) errors.push(`Der Schlüssel „${id}“ ist schon vergeben.`);

  const type = {
    id,
    name: text(input.name, 80),
    emoji: text(input.emoji, 32) || defaults.emoji,
    description: text(input.description, 300),
    enabled: bool(input.enabled),
    panel: oneOf(input.panel, ['apply', 'quali'], 'apply'),
    workflow: oneOf(input.workflow, ['police', 'simple'], 'simple'),
    numberPrefix: existingId ? text(input.numberPrefix, 8).toUpperCase() || 'Q' : autoPrefix,
    mode: oneOf(input.mode, ['DM', 'DM_WEB'], 'DM'),
    showStats: input.showStats !== false,
    hideAnswers: bool(input.hideAnswers),
    channels: { open: channel(input.channels?.open), accepted: channel(input.channels?.accepted), rejected: channel(input.channels?.rejected) },
    messages: Object.fromEntries(MESSAGE_KEYS.map((key) => [key, text(input.messages?.[key], 2000) || defaults.messages[key]])),
    roles: {
      ...Object.fromEntries(ROLE_KEYS.map((key) => [key, roles(input.roles?.[key])])),
      requiredMode: oneOf(input.roles?.requiredMode, ['all', 'any'], 'all'),
      blockedMode: oneOf(input.roles?.blockedMode, ['any', 'all'], 'any'),
    },
    teamThreads: bool(input.teamThreads),
    cooldownMinutes: int(input.cooldownMinutes, 0, 525_600, defaults.cooldownMinutes),
    timeLimitMinutes: int(input.timeLimitMinutes, 5, 10_080, defaults.timeLimitMinutes),
    onLeave: oneOf(input.onLeave, ['NONE', 'DENY', 'WITHDRAW'], 'WITHDRAW'),
    questions: [],
  };

  if (!type.name) errors.push('Gib der Bewerbung einen Namen.');
  if (!EMOJI.test(type.emoji)) errors.push('Das Emoji muss ein einzelnes Emoji sein (z. B. 👮) oder ein Server-Emoji wie <:name:123…>.');
  if (!/^[A-Z0-9]{1,8}$/.test(type.numberPrefix)) errors.push('Das Nummern-Präfix darf nur A–Z und 0–9 enthalten (1–8 Zeichen).');

  const questions = Array.isArray(input.questions) ? input.questions.slice(0, 50) : [];
  const usedKeys = new Set();
  questions.forEach((q, index) => {
    const n = index + 1;
    // Schlüssel automatisch: gültiger vorhandener bleibt, sonst aus dem Fragetext, immer eindeutig
    let key = text(q.key, 32).toLowerCase();
    if (!/^[a-z0-9_]{1,32}$/.test(key) || usedKeys.has(key)) {
      const base =
        text(q.label, 250)
          .toLowerCase()
          .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 28) || 'frage';
      key = base;
      for (let n = 2; usedKeys.has(key); n++) key = `${base}_${n}`;
    }
    usedKeys.add(key);
    const question = {
      key,
      type: oneOf(q.type, QUESTION_TYPES, 'TEXT'),
      label: text(q.label, 250),
      required: q.required !== false,
    };
    const description = text(q.description, 500);
    if (description) question.description = description;
    if (!/^[a-z0-9_]{1,32}$/.test(question.key)) errors.push(`Frage ${n}: Der Schlüssel darf nur a–z, 0–9 und _ enthalten.`);
    if (!question.label) errors.push(`Frage ${n}: Der Fragetext fehlt.`);

    if (question.type === 'TEXT') {
      question.min = int(q.min, 0, 5000, 0);
      question.max = int(q.max, 1, 5000, 1000);
      if (question.min > question.max) errors.push(`Frage ${n}: Die Mindestlänge ist größer als die Höchstlänge.`);
    }
    if (question.type === 'CHOICE' || question.type === 'ROLE') {
      question.multiple = bool(q.multiple);
      question.options = (Array.isArray(q.options) ? q.options : []).slice(0, 25).map((o) => {
        const option = { label: text(o?.label, 100) };
        const optionDescription = text(o?.description, 100);
        if (optionDescription) option.description = optionDescription;
        if (question.type === 'ROLE') option.roleId = roleIds.has(o?.roleId) ? o.roleId : '';
        return option;
      });
      if (!question.options.length) errors.push(`Frage ${n}: Lege mindestens eine Antwortmöglichkeit an.`);
      if (question.options.some((o) => !o.label)) errors.push(`Frage ${n}: Jede Antwortmöglichkeit braucht einen Text.`);
      if (new Set(question.options.map((o) => o.label)).size !== question.options.length) errors.push(`Frage ${n}: Zwei Antwortmöglichkeiten haben denselben Text.`);
      if (question.type === 'ROLE' && question.options.some((o) => !o.roleId)) errors.push(`Frage ${n}: Wähle für jede Antwortmöglichkeit eine Rolle.`);
    }
    type.questions.push(question);
  });

  // Zum Schluss die Prüfung, die auch npm run check und der Bot-Start verwenden.
  if (!errors.length) errors.push(...validateType(type));
  return { type, errors: [...new Set(errors)] };
}

module.exports = { sanitizeType, ROLE_KEYS };
