// Alle Seiten des Dashboards als HTML (ohne Template-Engine). Werte werden über html`` automatisch maskiert.
const { html, raw, json } = require('./html');
const store = require('../lib/applications/store');
const { profileUrl } = require('../lib/applications/roblox');
const { formatDuration } = require('../lib/applications/forms');

const SERVER_NAME = () => require('../lib/settings').base.serverName;
const dateFormat = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (ms) => (ms ? dateFormat.format(new Date(ms)) : '—');

const STATUS_TONE = {
  SUBMITTED: 'info',
  SCREENING: 'info',
  INTERVIEW: 'info',
  PENDING_DECISION: 'warn',
  OPEN: 'info',
  ACCEPTED: 'good',
  REJECTED: 'bad',
  WITHDRAWN: 'muted',
};
const AI_TONE = { gering: 'good', mittel: 'warn', hoch: 'bad' };

const badge = (label, tone) => html`<span class="badge badge-${tone}">${label}</span>`;
const statusBadge = (status) => badge(store.STATUS[status] ?? status, STATUS_TONE[status] ?? 'muted');

function avatarUrl(session) {
  if (session.avatar) return `https://cdn.discordapp.com/avatars/${session.userId}/${session.avatar}.png?size=64`;
  return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(session.userId) >> 22n) % 6n)}.png`;
}
const guildIcon = (id, icon) => (icon ? `https://cdn.discordapp.com/icons/${id}/${icon}.png?size=128` : null);
const initials = (name) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();

function layout({ title, session, body, wide = false }) {
  return html`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? `${title} · ` : ''}${SERVER_NAME()} Dashboard</title>
<link rel="stylesheet" href="/static/style.css">
<script src="/static/app.js" defer></script>
<script src="/static/panel.js" defer></script>
</head>
<body>
<header class="topbar">
  <a class="brand" href="${session ? '/server' : '/'}"><span class="brand-mark">${initials(SERVER_NAME())}</span><span>${SERVER_NAME()} <span class="brand-sub">Dashboard</span></span></a>
  ${
    session
      ? html`<div class="user">
    <img src="${avatarUrl(session)}" alt="" width="32" height="32">
    <span class="user-name">${session.globalName ?? session.username}</span>
    <form method="post" action="/auth/logout"><input type="hidden" name="csrf" value="${session.csrf}"><button class="btn btn-ghost btn-sm">Abmelden</button></form>
  </div>`
      : ''
  }
</header>
<main class="${wide ? 'wide' : ''}">${body}</main>
</body>
</html>`;
}

function notice(query) {
  const messages = {
    gespeichert: ['good', 'Gespeichert.'],
    geloescht: ['good', 'Gelöscht.'],
    entschieden: ['good', 'Entscheidung gespeichert. Die Person wurde per DM benachrichtigt.'],
    status: ['good', 'Status geändert.'],
    gesendet: ['good', 'Gespeichert und in Discord gesendet.'],
  };
  const errors = {
    abgebrochen: 'Die Anmeldung wurde abgebrochen.',
    sitzung: 'Die Anmeldung ist abgelaufen. Bitte versuche es noch einmal.',
    discord: 'Discord hat die Anmeldung nicht bestätigt. Prüfe DISCORD_CLIENT_SECRET und die Redirect-URL im Developer Portal.',
  };
  if (query.ok && messages[query.ok]) return html`<div class="notice notice-${messages[query.ok][0]}">${messages[query.ok][1]}</div>`;
  if (query.fehler) return html`<div class="notice notice-bad">${errors[query.fehler] ?? query.fehler}</div>`;
  return '';
}

// ---------- Ohne Server ----------

function home({ session, query }) {
  return layout({
    title: '',
    session,
    body: html`<section class="hero">
  <h1>${SERVER_NAME()} Dashboard</h1>
  <p class="lead">Bewerbungen mit eigenen Fragen bauen, Panels gestalten und senden, eingegangene Bewerbungen prüfen und entscheiden.</p>
  ${notice(query)}
  ${
    session
      ? html`<a class="btn btn-primary btn-lg" href="/server">Zu meinen Servern</a>`
      : html`<a class="btn btn-discord btn-lg" href="/auth/login">${raw(DISCORD_LOGO)} Mit Discord anmelden</a>`
  }
  <p class="hint">Wir lesen nur deinen Discord-Namen, dein Profilbild und die Liste deiner Server.</p>
</section>`,
  });
}

function message({ session, title, text, back }) {
  return layout({
    title,
    session,
    body: html`<section class="hero"><h1>${title}</h1><p class="lead">${text}</p>${back ? html`<a class="btn" href="${back}">Zurück</a>` : ''}</section>`,
  });
}

function servers({ session, list, inviteUrl }) {
  const card = (g) => {
    const icon = guildIcon(g.id, g.icon);
    const logo = icon ? html`<img src="${icon}" alt="" width="56" height="56">` : html`<span class="guild-fallback">${initials(g.name)}</span>`;
    if (g.state === 'open') return html`<a class="guild-card" href="/g/${g.id}">${logo}<span class="guild-name">${g.name}</span><span class="guild-action">Öffnen →</span></a>`;
    return html`<a class="guild-card guild-card-invite" href="${inviteUrl(g.id)}">${logo}<span class="guild-name">${g.name}</span><span class="guild-action">Bot einladen</span></a>`;
  };
  const open = list.filter((g) => g.state === 'open');
  const invite = list.filter((g) => g.state === 'invite');
  return layout({
    title: 'Server',
    session,
    body: html`<h1>Deine Server</h1>
${
  open.length
    ? html`<div class="guild-grid">${open.map(card)}</div>`
    : html`<div class="empty"><p>Auf keinem Server mit dem Bot hast du Team-Rechte.</p><p class="hint">Du brauchst „Server verwalten“, die Staff-Rolle oder eine Manager-Rolle einer Bewerbung. Wurden dir gerade Rechte gegeben? Dann melde dich ab und wieder an.</p></div>`
}
${invite.length ? html`<h2>Bot noch nicht dabei</h2><div class="guild-grid">${invite.map(card)}</div>` : ''}`,
  });
}

// ---------- Server-Bereich ----------

function guildLayout({ session, guild, member, perms, active, title, body, query = {} }) {
  const nav = [
    ['overview', `/g/${guild.id}`, 'Übersicht', true],
    ['types', `/g/${guild.id}/formulare`, 'Bewerbungen', perms.manage],
    ['panels', `/g/${guild.id}/panels`, 'Panels', perms.manage],
    ['records', `/g/${guild.id}/eingaenge`, 'Eingänge', perms.review],
  ].filter(([, , , show]) => show);
  const icon = guild.iconURL({ size: 64 });
  return layout({
    title,
    session,
    wide: true,
    body: html`<div class="shell">
<aside class="sidebar">
  <a class="sidebar-guild" href="/server">
    ${icon ? html`<img src="${icon}" alt="" width="40" height="40">` : html`<span class="guild-fallback guild-fallback-sm">${initials(guild.name)}</span>`}
    <span><strong>${guild.name}</strong><small>Server wechseln</small></span>
  </a>
  <nav>${nav.map(([key, href, label]) => html`<a href="${href}" class="${key === active ? 'active' : ''}">${label}</a>`)}</nav>
  <p class="sidebar-role">Angemeldet als ${member.displayName}${perms.manage ? ' · Verwaltung' : perms.review ? ' · Team' : ''}</p>
</aside>
<section class="content">${notice(query)}${body}</section>
</div>`,
  });
}

function overview({ ctx, records, types, reviewable }) {
  const { guild, perms } = ctx;
  const ids = new Set(reviewable.map((t) => t.id));
  const mine = records.filter((r) => ids.has(r.type));
  const open = mine.filter((r) => store.isOpenStatus(r.status));
  const since = Date.now() - 30 * 86_400_000;
  const decided = mine.filter((r) => r.decidedAt && r.decidedAt >= since && ['ACCEPTED', 'REJECTED'].includes(r.status));
  const accepted = decided.filter((r) => r.status === 'ACCEPTED').length;
  const rate = decided.length ? Math.round((accepted / decided.length) * 100) : null;
  const latest = [...open].sort((a, b) => a.createdAt - b.createdAt).slice(0, 8);

  const setup = [];
  if (perms.manage && !types.length) setup.push(html`<li>Lege deine erste <a href="/g/${guild.id}/formulare/neu">Bewerbung</a> an.</li>`);
  if (perms.manage && types.length && !ctx.config.applications.channel && types.some((t) => !t.channels.open)) {
    setup.push(html`<li>Stelle unter <a href="/g/${guild.id}/formulare">Bewerbungen</a> den Standard-Kanal für eingehende Bewerbungen ein.</li>`);
  }
  if (perms.manage && types.length && !ctx.panelCount) setup.push(html`<li>Verknüpfe deine Bewerbungen mit einem <a href="/g/${guild.id}/panels">Panel</a> und sende es in einen Kanal.</li>`);
  if (perms.manage && types.some((t) => !t.roles.managers.length)) setup.push(html`<li>Einige Bewerbungen haben noch keine Manager-Rolle. Bis dahin entscheiden nur Staff und „Server verwalten“.</li>`);

  return guildLayout({
    ...ctx,
    active: 'overview',
    title: 'Übersicht',
    body: html`<h1>Übersicht</h1>
${setup.length ? html`<div class="card card-accent"><h2>Nächste Schritte</h2><ul class="steps">${setup}</ul></div>` : ''}
${
  perms.review
    ? html`<div class="stats">
  <div class="stat"><span class="stat-value">${open.length}</span><span class="stat-label">offen</span></div>
  <div class="stat"><span class="stat-value">${mine.filter((r) => r.createdAt >= since).length}</span><span class="stat-label">eingegangen (30 Tage)</span></div>
  <div class="stat"><span class="stat-value">${decided.length}</span><span class="stat-label">entschieden (30 Tage)</span></div>
  <div class="stat"><span class="stat-value">${rate === null ? '—' : `${rate} %`}</span><span class="stat-label">Annahmequote (30 Tage)</span></div>
</div>
<div class="card">
  <div class="card-head"><h2>Am längsten offen</h2><a href="/g/${guild.id}/eingaenge">Alle Eingänge →</a></div>
  ${latest.length ? recordTable(guild.id, latest, types) : html`<p class="muted">Keine offenen Bewerbungen. 🎉</p>`}
</div>`
    : ''
}
<div class="card">
  <div class="card-head"><h2>Bewerbungen</h2>${perms.manage ? html`<a href="/g/${guild.id}/formulare">Verwalten →</a>` : ''}</div>
  ${
    types.length
      ? html`<ul class="type-list">${types.map(
          (t) =>
            html`<li><span class="type-emoji">${t.emoji}</span><span><strong>${t.name}</strong><small>${t.questions.length} ${t.questions.length === 1 ? 'Frage' : 'Fragen'}</small></span>${t.enabled ? badge('offen', 'good') : badge('geschlossen', 'muted')}</li>`,
        )}</ul>`
      : html`<p class="muted">Noch keine Bewerbungen angelegt.</p>`
  }
</div>`,
  });
}

function recordTable(guildId, records, types) {
  const typeOf = (id) => types.find((t) => t.id === id);
  return html`<div class="table-wrap"><table class="table">
<thead><tr><th>Nummer</th><th>Art</th><th>Bewerber</th><th>Status</th><th>KI</th><th>Eingereicht</th></tr></thead>
<tbody>${records.map((r) => {
    const type = typeOf(r.type);
    return html`<tr class="row-link" data-href="/g/${guildId}/eingaenge/${r.number}">
  <td><a href="/g/${guildId}/eingaenge/${r.number}"><strong>${r.number}</strong></a></td>
  <td>${type ? `${type.emoji} ${type.name}` : html`<span class="muted">${r.type} (gelöscht)</span>`}</td>
  <td><span class="person">${r.avatarUrl ? html`<img src="${r.avatarUrl}" alt="" width="24" height="24">` : ''}${r.userTag ?? r.userId}</span></td>
  <td>${statusBadge(r.status)}</td>
  <td>${r.ai ? badge(r.ai.level, AI_TONE[r.ai.level]) : '—'}</td>
  <td class="nowrap">${formatDate(r.createdAt)}</td>
</tr>`;
  })}</tbody></table></div>`;
}

function records({ ctx, list, types, reviewable, filters, page, pages, total }) {
  const { guild } = ctx;
  const options = (items, selected) => items.map(([value, label]) => html`<option value="${value}" ${value === selected ? raw('selected') : ''}>${label}</option>`);
  const query = (p) => `?${new URLSearchParams({ ...filters, seite: String(p) })}`;
  return guildLayout({
    ...ctx,
    active: 'records',
    title: 'Eingänge',
    body: html`<h1>Eingegangene Bewerbungen</h1>
<form class="filters" method="get">
  <label>Status<select name="status">${options(
    [
      ['offen', 'Offen'],
      ['alle', 'Alle'],
      ...Object.entries(store.STATUS),
    ],
    filters.status,
  )}</select></label>
  <label>Art<select name="art">${options([['', 'Alle Arten'], ...reviewable.map((t) => [t.id, t.name])], filters.art)}</select></label>
  <label>Suche<input type="search" name="suche" value="${filters.suche}" placeholder="Nummer, Name, Discord- oder Roblox-ID"></label>
  <button class="btn">Filtern</button>
</form>
<p class="muted">${total} ${total === 1 ? 'Bewerbung' : 'Bewerbungen'}</p>
${list.length ? recordTable(guild.id, list, types) : html`<div class="empty"><p>Keine Bewerbungen gefunden.</p></div>`}
${
  pages > 1
    ? html`<nav class="pager">${page > 1 ? html`<a class="btn btn-sm" href="${query(page - 1)}">← Zurück</a>` : ''}<span>Seite ${page} von ${pages}</span>${page < pages ? html`<a class="btn btn-sm" href="${query(page + 1)}">Weiter →</a>` : ''}</nav>`
    : ''
}`,
  });
}

function record({ ctx, record: r, type, history, names }) {
  const { guild, session } = ctx;
  const flagged = new Set(r.ai?.flagged ?? []);
  const open = store.isOpenStatus(r.status);
  const own = r.userId === session.userId;
  const steps = type.workflow === 'police' ? (store.POLICE_TRANSITIONS[r.status] ?? []).filter((s) => !['ACCEPTED', 'REJECTED'].includes(s)) : [];
  const name = (id) => (id ? (names[id] ?? id) : 'System');
  const discordLink = r.messageId ? `https://discord.com/channels/${guild.id}/${r.channelId}/${r.messageId}` : null;

  const actions = !open
    ? html`<p class="muted">Diese Bewerbung ist abgeschlossen.</p>`
    : own
      ? html`<p class="muted">Über deine eigene Bewerbung kannst du nicht entscheiden.</p>`
      : html`<form method="post" action="/g/${guild.id}/eingaenge/${r.number}/entscheiden" class="decide">
  <input type="hidden" name="csrf" value="${session.csrf}">
  <input type="hidden" name="version" value="${r.version}">
  <label>Grund <small>(optional, geht per DM an die Person)</small><textarea name="reason" maxlength="1000" rows="3"></textarea></label>
  <div class="decide-buttons">
    <button class="btn btn-good" name="status" value="ACCEPTED" data-confirm="Bewerbung ${r.number} annehmen?">Annehmen</button>
    <button class="btn btn-bad" name="status" value="REJECTED" data-confirm="Bewerbung ${r.number} ablehnen?">Ablehnen</button>
  </div>
  ${
    steps.length
      ? html`<div class="steps-row"><span class="muted">Prüfschritt:</span>${steps.map(
          (s) => html`<button class="btn btn-sm ${s === 'WITHDRAWN' ? 'btn-ghost' : ''}" name="status" value="${s}" data-confirm="${s === 'WITHDRAWN' ? `Bewerbung ${r.number} zurückziehen?` : ''}">${store.STATUS[s]}</button>`,
        )}</div>`
      : ''
  }
</form>`;

  return guildLayout({
    ...ctx,
    active: 'records',
    title: r.number,
    body: html`<a class="back" href="/g/${guild.id}/eingaenge">← Alle Eingänge</a>
<div class="record-head">
  <div>
    <h1>${type.emoji} ${type.name} <span class="muted">${r.number}</span></h1>
    <p>${statusBadge(r.status)} eingereicht am ${formatDate(r.createdAt)}${r.decidedAt ? ` · entschieden von ${name(r.decidedBy)} am ${formatDate(r.decidedAt)}` : ''}</p>
  </div>
  ${discordLink ? html`<a class="btn btn-ghost" href="${discordLink}" target="_blank" rel="noopener">In Discord öffnen</a>` : ''}
</div>
${r.reason ? html`<div class="notice notice-muted"><strong>Grund:</strong> ${r.reason}</div>` : ''}
<div class="record-grid">
  <div class="record-main">
    <div class="card">
      <h2>Antworten</h2>
      <ol class="answers">${r.answers.map(
        (a) =>
          html`<li class="${flagged.has(a.question) ? 'flagged' : ''}"><h3>${flagged.has(a.question) ? html`<span title="Vom KI-Checker markiert">⚠️</span> ` : ''}${a.question}</h3><p>${a.answer || '—'}</p>${a.cpm ? html`<small class="muted">${Math.round(a.cpm)} Zeichen/Min.</small>` : ''}</li>`,
      )}</ol>
    </div>
  </div>
  <div class="record-side">
    <div class="card"><h2>Entscheiden</h2>${actions}</div>
    <div class="card">
      <h2>Bewerber</h2>
      <p class="person person-lg">${r.avatarUrl ? html`<img src="${r.avatarUrl}" alt="" width="40" height="40">` : ''}<span><strong>${r.userTag ?? r.userId}</strong><small>${r.userId}</small></span></p>
      <dl class="facts">
        ${r.roblox ? html`<dt>Roblox</dt><dd><a href="${profileUrl(r.roblox.id)}" target="_blank" rel="noopener">${r.roblox.name}</a> <small class="muted">ID ${r.roblox.id}</small></dd>` : ''}
        <dt>Auf dem Server seit</dt><dd>${formatDate(r.joinedAt)}</dd>
        <dt>Discord-Konto seit</dt><dd>${formatDate(r.accountCreatedAt)}</dd>
        <dt>Dauer</dt><dd>${formatDuration(Math.max(1, Math.round((r.durationMs ?? 0) / 60_000)))}</dd>
        ${r.roleSelections?.length ? html`<dt>Rollen bei Annahme</dt><dd>${r.roleSelections.map((id) => html`<span class="chip">${guild.roles.cache.get(id)?.name ?? id}</span>`)}</dd>` : ''}
      </dl>
    </div>
    ${
      r.ai
        ? html`<div class="card"><h2>KI-Checker</h2><p>${badge(`Verdacht ${r.ai.level}`, AI_TONE[r.ai.level])}</p>${r.ai.reasons.length ? html`<ul class="small-list">${r.ai.reasons.map((x) => html`<li>${x}</li>`)}</ul>` : ''}<p class="hint">Nur ein Hinweis, kein Beweis.</p></div>`
        : ''
    }
    <div class="card"><h2>Verlauf</h2><ul class="timeline">${r.history.map(
      (h) => html`<li>${statusBadge(h.status)} <span>${name(h.by)}</span><small>${formatDate(h.at)}${h.reason ? ` · ${h.reason}` : ''}</small></li>`,
    )}</ul></div>
    ${
      history.length > 1
        ? html`<div class="card"><h2>Weitere Bewerbungen</h2><ul class="small-list">${history
            .filter((x) => x.number !== r.number)
            .map((x) => html`<li><a href="/g/${guild.id}/eingaenge/${x.number}">${x.number}</a> ${statusBadge(x.status)} <small class="muted">${formatDate(x.createdAt)}</small></li>`)}</ul></div>`
        : ''
    }
  </div>
</div>`,
  });
}

function typesList({ ctx, types, openCounts, panelsOf, channels }) {
  const { guild, session, config } = ctx;
  const channelSelect = (name, selected) =>
    html`<select name="${name}"><option value="">— nicht gesetzt —</option>${channels.map((c) => html`<option value="${c.id}" ${c.id === selected ? raw('selected') : ''}>#${c.name}</option>`)}</select>`;
  return guildLayout({
    ...ctx,
    active: 'types',
    title: 'Bewerbungen',
    body: html`<div class="page-head"><h1>Bewerbungen <span class="muted">${types.length}/25</span></h1>${types.length < 25 ? html`<a class="btn btn-primary" href="/g/${guild.id}/formulare/neu">+ Neue Bewerbung</a>` : ''}</div>
${
  types.length
    ? html`<div class="card"><ul class="type-list type-list-big">${types.map(
        (t) => html`<li>
  <span class="type-emoji">${t.emoji}</span>
  <span class="grow"><strong>${t.name}</strong><small>${t.questions.length} ${t.questions.length === 1 ? 'Frage' : 'Fragen'} · ${t.workflow === 'police' ? 'mit Prüfschritten' : 'einfach'} · ${panelsOf(t.id).length ? `im Panel: ${panelsOf(t.id).join(', ')}` : 'in keinem Panel'}${openCounts[t.id] ? ` · ${openCounts[t.id]} offen` : ''}</small></span>
  ${t.enabled ? badge('offen', 'good') : badge('geschlossen', 'muted')}
  <a class="btn btn-sm" href="/g/${guild.id}/formulare/${t.id}">Bearbeiten</a>
  <form method="post" action="/g/${guild.id}/formulare/${t.id}/loeschen"><input type="hidden" name="csrf" value="${session.csrf}"><button class="btn btn-sm btn-ghost" data-confirm="„${t.name}“ wirklich löschen? Die Fragen und Einstellungen gehen verloren.">Löschen</button></form>
</li>`,
      )}</ul></div>`
    : html`<div class="empty"><p>Noch keine Bewerbungen.</p><a class="btn btn-primary" href="/g/${guild.id}/formulare/neu">Erste Bewerbung anlegen</a></div>`
}
<form method="post" action="/g/${guild.id}/formulare/kanal" class="card inline-form">
  <input type="hidden" name="csrf" value="${session.csrf}">
  <label class="grow">Standard-Kanal für eingehende Bewerbungen <small class="hint">Hier landen neue Bewerbungen fürs Team, wenn bei der Bewerbung kein eigener Kanal gesetzt ist.</small>${channelSelect('channel', config.applications.channel)}</label>
  <button class="btn">Speichern</button>
</form>`,
  });
}

function typeEditor({ ctx, type, isNew, roles, channels, defaults, webBase }) {
  const { guild, session } = ctx;
  return guildLayout({
    ...ctx,
    active: 'types',
    title: isNew ? 'Neue Bewerbung' : type.name,
    body: html`<a class="back" href="/g/${guild.id}/formulare">← Alle Bewerbungen</a>
<h1>${isNew ? 'Neue Bewerbung' : html`${type.emoji} ${type.name}`}</h1>
<div id="editor" data-save="/g/${guild.id}/formulare/${isNew ? 'neu' : type.id}" data-csrf="${session.csrf}" data-back="/g/${guild.id}/formulare" data-new="${isNew ? '1' : ''}"><p class="muted">Editor wird geladen …</p></div>
<script type="application/json" id="editor-data">${json({ type, roles, channels, defaults, webBase })}</script>
<noscript><div class="notice notice-bad">Für den Editor muss JavaScript aktiviert sein.</div></noscript>`,
  });
}

function panelsList({ ctx, panels, channelName }) {
  const { guild, session } = ctx;
  return guildLayout({
    ...ctx,
    active: 'panels',
    title: 'Panels',
    body: html`<div class="page-head"><h1>Panels</h1><a class="btn btn-primary" href="/g/${guild.id}/panels/neu">+ Neues Panel</a></div>
<p class="muted">Ein Panel ist die Nachricht in Discord, über die sich Mitglieder bewerben. Wähle, welche Bewerbungen hineinkommen, gestalte es und sende es in einen Kanal. Bereits gesendete Panels aktualisieren sich beim Speichern automatisch.</p>
<div class="panel-grid">${panels.map(
      (p) => html`<div class="card panel-card">
  <span class="panel-accent" data-color="${p.color ?? ''}"></span>
  <h2>${p.title}</h2>
  <p class="muted">${p.name}</p>
  <dl class="facts">
    <dt>Kanal</dt><dd>${p.channel ? `#${channelName(p.channel)}` : '—'}</dd>
    <dt>Bewerbungen</dt><dd>${p.typeNames.length ? p.typeNames.join(', ') : html`<span class="muted">keine</span>`}</dd>
    <dt>Gesendet</dt><dd>${p.posted ? `${p.posted}×` : 'noch nicht'}</dd>
  </dl>
  <div class="card-actions">
    <a class="btn btn-sm" href="/g/${guild.id}/panels/${p.id}">Bearbeiten</a>
    ${
      p.builtIn
        ? ''
        : html`<form method="post" action="/g/${guild.id}/panels/${p.id}/loeschen"><input type="hidden" name="csrf" value="${session.csrf}"><button class="btn btn-sm btn-ghost" data-confirm="Panel „${p.title}“ löschen? Bereits gesendete Nachrichten bleiben stehen, werden aber nicht mehr aktualisiert.">Löschen</button></form>`
    }
  </div>
</div>`,
    )}</div>`,
  });
}

function panelEditor({ ctx, panel, isNew, types, channels, defaultColor }) {
  const { guild, session } = ctx;
  return guildLayout({
    ...ctx,
    active: 'panels',
    title: isNew ? 'Neues Panel' : panel.title,
    body: html`<a class="back" href="/g/${guild.id}/panels">← Alle Panels</a>
<div id="panel-editor" data-save="/g/${guild.id}/panels/${isNew ? 'neu' : panel.id}" data-csrf="${session.csrf}" data-guild="${guild.id}" data-new="${isNew ? '1' : ''}"><p class="muted">Editor wird geladen …</p></div>
<script type="application/json" id="panel-data">${json({ panel, types, channels, defaultColor, serverName: guild.name })}</script>
<noscript><div class="notice notice-bad">Für den Editor muss JavaScript aktiviert sein.</div></noscript>`,
  });
}

const DISCORD_LOGO =
  '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.5 0L8.7 3a19.5 19.5 0 0 0-4.9 1.4C.7 9-.2 13.6.3 18.1a19.7 19.7 0 0 0 6 3l1.3-2a12.7 12.7 0 0 1-2-1l.5-.4a14 14 0 0 0 12 0l.5.4-2 1 1.3 2a19.6 19.6 0 0 0 6-3c.5-5.2-.9-9.8-3.6-13.7ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>';

module.exports = { layout, home, message, servers, overview, records, record, typesList, typeEditor, panelsList, panelEditor };
