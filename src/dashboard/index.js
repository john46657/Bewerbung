// Web-Dashboard: läuft im selben Prozess wie der Bot und nutzt dieselben Daten (data/db.json).
// Start nur, wenn DASHBOARD_URL und DISCORD_CLIENT_SECRET in der .env stehen.
const path = require('node:path');
const express = require('express');
const { ChannelType } = require('discord.js');
const settings = require('../lib/settings');
const { bucket } = require('../lib/db');
const store = require('../lib/applications/store');
const appMessages = require('../lib/applications/messages');
const { decideFromDashboard } = require('../lib/applications/decide');
const auth = require('./auth');
const pages = require('./pages');
const { memberOf, canManage, canReview, reviewableTypes, hasAccess } = require('./access');
const { sanitizeType } = require('./sanitize');

const PAGE_SIZE = 25;

function readConfig(client) {
  const url = (process.env.DASHBOARD_URL ?? '').trim().replace(/\/+$/, '');
  const clientSecret = (process.env.DISCORD_CLIENT_SECRET ?? '').trim();
  if (!url && !clientSecret) return null;
  const missing = [!url && 'DASHBOARD_URL', !clientSecret && 'DISCORD_CLIENT_SECRET'].filter(Boolean);
  if (missing.length) {
    console.warn(`⚠️  Dashboard nicht gestartet: ${missing.join(' und ')} fehlt in der .env.`);
    return null;
  }
  if (!/^https?:\/\/[^/\s]+$/.test(url)) {
    console.warn('⚠️  Dashboard nicht gestartet: DASHBOARD_URL muss so aussehen: https://deine-domain.de (ohne Pfad).');
    return null;
  }
  return {
    url,
    clientSecret,
    clientId: () => (process.env.DISCORD_CLIENT_ID ?? '').trim() || client.application?.id || client.user?.id,
    secure: url.startsWith('https://'),
    port: Number(process.env.DASHBOARD_PORT || process.env.SERVER_PORT || process.env.PORT || 3000),
  };
}

const textChannels = (guild) =>
  guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildText)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({ id: c.id, name: c.name }));

const roleList = (guild) =>
  guild.roles.cache
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? null : r.hexColor }));

function start(client) {
  const config = readConfig(client);
  if (!config) return null;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; form-action 'self' https://discord.com",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });
  app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '300kb' }));
  app.use(auth.loadSession);

  // Solange der Bot noch nicht verbunden ist, kann nichts geprüft werden.
  app.use((req, res, next) => {
    if (client.isReady() || req.path.startsWith('/static')) return next();
    res.status(503).send(pages.message({ session: null, title: 'Gleich da', text: 'Der Bot startet gerade. Lade die Seite in ein paar Sekunden neu.' }).toString());
  });

  const send = (res, page, status = 200) => res.status(status).type('html').send(page.toString());

  auth.routes(app, config);
  app.get('/', (req, res) => send(res, pages.home({ session: req.session, query: req.query })));
  require('./apply').routes(app, client);

  app.get('/server', auth.requireLogin, async (req, res) => {
    const list = [];
    for (const g of req.session.guilds) {
      const guild = client.guilds.cache.get(g.id);
      if (guild) {
        const member = await memberOf(guild, req.session.userId);
        if (hasAccess(member)) list.push({ id: g.id, name: guild.name, icon: guild.icon, state: 'open' });
      } else if (g.manage) {
        list.push({ ...g, state: 'invite' });
      }
    }
    const inviteUrl = (guildId) =>
      `https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: config.clientId(), scope: 'bot applications.commands', permissions: '8', guild_id: guildId, disable_guild_select: 'true' })}`;
    send(res, pages.servers({ session: req.session, list, inviteUrl }));
  });

  // ---------- Server-Bereich: Zugriff prüfen und ctx aufbauen ----------
  const guildRouter = express.Router({ mergeParams: true });
  app.use('/g/:guildId', auth.requireLogin, async (req, res, next) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    const member = guild && (await memberOf(guild, req.session.userId));
    if (!guild || !hasAccess(member)) {
      return send(res, pages.message({ session: req.session, title: 'Kein Zugriff', text: 'Auf diesen Server hast du im Dashboard keinen Zugriff.', back: '/server' }), 403);
    }
    const reviewable = reviewableTypes(member);
    req.ctx = {
      session: req.session,
      guild,
      member,
      config: settings.forGuild(guild.id),
      perms: { manage: canManage(member), review: reviewable.length > 0 },
      reviewable,
      query: req.query,
    };
    if (req.method === 'POST') return auth.requireCsrf(req, res, next);
    next();
  }, guildRouter);

  const requireManage = (req, res, next) =>
    req.ctx.perms.manage ? next() : send(res, pages.message({ session: req.session, title: 'Kein Zugriff', text: 'Dafür brauchst du auf dem Server das Recht „Server verwalten“.', back: `/g/${req.ctx.guild.id}` }), 403);

  guildRouter.get('/', (req, res) => {
    const { guild, reviewable } = req.ctx;
    req.ctx.panelCount = Object.keys(bucket('appPanels', guild.id)).length;
    send(res, pages.overview({ ctx: req.ctx, records: Object.values(store.recordsOf(guild.id)), types: store.types(guild.id), reviewable }));
  });

  // ---------- Bewerbungen ----------
  guildRouter.get('/eingaenge', (req, res) => {
    const { guild, reviewable } = req.ctx;
    const ids = new Set(reviewable.map((t) => t.id));
    const status = typeof req.query.status === 'string' ? req.query.status : 'offen';
    const art = typeof req.query.art === 'string' ? req.query.art : '';
    const suche = typeof req.query.suche === 'string' ? req.query.suche.trim().slice(0, 100) : '';
    const q = suche.toLowerCase();

    let list = Object.values(store.recordsOf(guild.id)).filter((r) => ids.has(r.type));
    if (status === 'offen') list = list.filter((r) => store.isOpenStatus(r.status));
    else if (store.STATUS[status]) list = list.filter((r) => r.status === status);
    if (art) list = list.filter((r) => r.type === art);
    if (q) {
      list = list.filter((r) => [r.number, r.userTag, r.userId, r.roblox?.name, r.roblox?.id].some((v) => v && String(v).toLowerCase().includes(q)));
    }
    // Offene: älteste zuerst (wartet am längsten); sonst neueste zuerst.
    list.sort((a, b) => (status === 'offen' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));

    const pagesCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    const page = Math.min(pagesCount, Math.max(1, Number.parseInt(req.query.seite, 10) || 1));
    send(
      res,
      pages.records({
        ctx: req.ctx,
        list: list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        types: store.types(guild.id),
        reviewable,
        filters: { status, art, suche },
        page,
        pages: pagesCount,
        total: list.length,
      }),
    );
  });

  function loadRecord(req, res) {
    const { guild, member } = req.ctx;
    const record = store.getRecord(guild.id, req.params.number);
    const type = record && store.typeById(guild.id, record.type);
    if (!record || !type || !canReview(member, type)) {
      send(res, pages.message({ session: req.session, title: 'Nicht gefunden', text: 'Diese Bewerbung gibt es nicht oder du darfst sie nicht sehen.', back: `/g/${guild.id}/eingaenge` }), 404);
      return null;
    }
    return { record, type };
  }

  guildRouter.get('/eingaenge/:number', async (req, res) => {
    const loaded = loadRecord(req, res);
    if (!loaded) return;
    const { guild } = req.ctx;
    const { record } = loaded;
    // Namen für Entscheider und Verlauf
    const ids = [...new Set([record.decidedBy, ...record.history.map((h) => h.by)].filter(Boolean))];
    const names = {};
    for (const id of ids) {
      const m = await memberOf(guild, id);
      const u = m?.user ?? (await client.users.fetch(id).catch(() => null));
      names[id] = m?.displayName ?? u?.username ?? id;
    }
    send(res, pages.record({ ctx: req.ctx, ...loaded, history: store.historyOf(guild.id, record.userId), names }));
  });

  guildRouter.post('/eingaenge/:number/entscheiden', async (req, res) => {
    const loaded = loadRecord(req, res);
    if (!loaded) return;
    const { guild, session } = req.ctx;
    const { record, type } = loaded;
    const back = `/g/${guild.id}/eingaenge/${record.number}`;
    const status = String(req.body.status ?? '');
    const reason = String(req.body.reason ?? '').trim().slice(0, 1000) || null;
    if (String(record.version) !== String(req.body.version)) {
      return res.redirect(`${back}?fehler=${encodeURIComponent('Die Bewerbung wurde inzwischen geändert. Prüfe den neuen Stand.')}`);
    }
    const user = await client.users.fetch(session.userId);
    const error = await decideFromDashboard(guild, record, type, user, status, reason);
    if (error) return res.redirect(`${back}?fehler=${encodeURIComponent(error)}`);
    res.redirect(`${back}?ok=${store.FINAL.includes(status) ? 'entschieden' : 'status'}`);
  });

  // ---------- Bewerbungsarten ----------
  guildRouter.get('/formulare', requireManage, (req, res) => {
    const { guild } = req.ctx;
    const openCounts = {};
    for (const r of store.openOf(guild.id)) openCounts[r.type] = (openCounts[r.type] ?? 0) + 1;
    const panels = panelEntries(guild);
    const panelsOf = (typeId) => panels.filter((p) => p.types.includes(typeId)).map((p) => p.title);
    send(res, pages.typesList({ ctx: req.ctx, types: store.types(guild.id), openCounts, panelsOf }));
  });

  guildRouter.post('/formulare/kanal', requireManage, (req, res) => {
    const { guild } = req.ctx;
    const id = typeof req.body?.channel === 'string' && textChannels(guild).some((c) => c.id === req.body.channel) ? req.body.channel : '';
    settings.set(guild.id, 'applications.channel', id);
    settings.set(guild.id, 'applications.qualiChannel', id);
    res.redirect(`/g/${guild.id}/formulare?ok=gespeichert`);
  });

  function editorPage(req, res, type, isNew) {
    const { guild, config: guildConfig } = req.ctx;
    const defaults = guildConfig.applications.defaults;
    send(res, pages.typeEditor({ ctx: req.ctx, type, isNew, roles: roleList(guild), channels: textChannels(guild), defaults: { messages: defaults.messages, emoji: defaults.emoji }, webBase: `${config.url}/bewerben/${guild.id}/` }));
  }

  guildRouter.get('/formulare/neu', requireManage, (req, res) => {
    const defaults = req.ctx.config.applications.defaults;
    editorPage(req, res, { ...structuredClone(defaults), id: '', name: '', panel: 'apply', questions: [] }, true);
  });

  guildRouter.get('/formulare/:typeId', requireManage, (req, res) => {
    const type = store.typeById(req.ctx.guild.id, req.params.typeId);
    if (!type) return send(res, pages.message({ session: req.session, title: 'Nicht gefunden', text: 'Diese Bewerbungsart gibt es nicht.', back: `/g/${req.ctx.guild.id}/formulare` }), 404);
    editorPage(req, res, type, false);
  });

  async function saveTypes(guild, types) {
    settings.setApplicationTypes(guild.id, types);
    await appMessages.refreshPanels(guild).catch((err) => console.error('[dashboard] Panels aktualisieren:', err.message));
  }

  guildRouter.post(['/formulare/neu', '/formulare/:typeId'], requireManage, async (req, res) => {
    const { guild, config: guildConfig } = req.ctx;
    const isNew = !req.params.typeId;
    const current = store.types(guild.id);
    const existing = isNew ? null : current.find((t) => t.id === req.params.typeId);
    if (!isNew && !existing) return res.status(404).json({ errors: ['Diese Bewerbungsart gibt es nicht mehr.'] });
    if (isNew && current.length >= 25) return res.status(400).json({ errors: ['Es gehen höchstens 25 Bewerbungsarten (Grenze der Discord-Auswahlmenüs).'] });

    const { type, errors } = sanitizeType(req.body ?? {}, {
      guild,
      defaults: guildConfig.applications.defaults,
      existingId: existing?.id,
      takenIds: current.map((t) => t.id),
    });
    if (errors.length) return res.status(400).json({ errors });

    const next = isNew ? [...current, type] : current.map((t) => (t.id === type.id ? type : t));
    await saveTypes(guild, structuredClone(next));
    res.json({ ok: true, redirect: `/g/${guild.id}/formulare/${type.id}?ok=gespeichert` });
  });

  guildRouter.post('/formulare/:typeId/loeschen', requireManage, async (req, res) => {
    const { guild } = req.ctx;
    const current = store.types(guild.id);
    const type = current.find((t) => t.id === req.params.typeId);
    if (!type) return res.redirect(`/g/${guild.id}/formulare`);
    const open = store.openOf(guild.id, (r) => r.type === type.id).length;
    if (open) {
      return res.redirect(`/g/${guild.id}/formulare?fehler=${encodeURIComponent(`„${type.name}“ hat noch ${open} offene Bewerbung(en). Entscheide sie zuerst oder schließe die Art nur (Häkchen „Bewerbungen annehmen“ entfernen).`)}`);
    }
    await saveTypes(guild, structuredClone(current.filter((t) => t.id !== type.id)));
    const panels = structuredClone(settings.forGuild(guild.id).applications.panels);
    let panelsChanged = false;
    for (const panel of Object.values(panels)) {
      if (Array.isArray(panel.types) && panel.types.includes(type.id)) {
        panel.types = panel.types.filter((id) => id !== type.id);
        panelsChanged = true;
      }
    }
    if (panelsChanged) {
      settings.setApplicationPanels(guild.id, panels);
      await appMessages.refreshPanels(guild).catch(() => {});
    }
    res.redirect(`/g/${guild.id}/formulare?ok=geloescht`);
  });

  // ---------- Panels ----------

  // Panels eines Servers mit ihren verknüpften Bewerbungen (bei den alten Panels ohne `types` ausgerechnet).
  function panelEntries(guild) {
    const panels = settings.forGuild(guild.id).applications.panels;
    const posted = Object.values(bucket('appPanels', guild.id));
    return Object.entries(panels).map(([id, p]) => {
      const linked = appMessages.panelTypes(guild.id, id);
      return {
        id,
        name: p.name || '',
        title: p.title,
        description: p.description ?? '',
        image: p.image ?? '',
        color: p.color ?? '',
        channel: p.channel ?? '',
        buttonLabel: p.buttonLabel ?? '',
        placeholder: p.placeholder ?? '',
        style: p.style ?? 'auto',
        author: p.author ?? '',
        thumbnail: p.thumbnail ?? '',
        footer: p.footer ?? '',
        types: linked.map((t) => t.id),
        typeNames: linked.map((t) => t.name),
        posted: posted.filter((x) => x.kind === id).length,
      };
    });
  }

  guildRouter.get('/panels', requireManage, (req, res) => {
    const { guild } = req.ctx;
    const channelName = (id) => guild.channels.cache.get(id)?.name ?? 'gelöschter Kanal';
    send(res, pages.panelsList({ ctx: req.ctx, panels: panelEntries(guild), channelName }));
  });

  function panelEditorPage(req, res, panel, isNew) {
    const { guild } = req.ctx;
    const types = store.types(guild.id).map((t) => ({ id: t.id, name: t.name, emoji: t.emoji, description: t.description, enabled: t.enabled }));
    send(res, pages.panelEditor({ ctx: req.ctx, panel, isNew, types, channels: textChannels(guild), defaultColor: settings.base.colors.primary }));
  }

  guildRouter.get('/panels/neu', requireManage, (req, res) => {
    panelEditorPage(req, res, { style: 'auto', author: '', thumbnail: '', footer: '', id: '', name: '', title: 'Bewerbungen', description: 'Wähle unten aus, wofür du dich bewerben möchtest. Die Fragen kommen per Direktnachricht – lass deine DMs offen!', image: '', color: '', channel: '', buttonLabel: '', placeholder: '', types: [] }, true);
  });

  guildRouter.get('/panels/:panelId', requireManage, (req, res) => {
    const panel = panelEntries(req.ctx.guild).find((p) => p.id === req.params.panelId);
    if (!panel) return send(res, pages.message({ session: req.session, title: 'Nicht gefunden', text: 'Dieses Panel gibt es nicht.', back: `/g/${req.ctx.guild.id}/panels` }), 404);
    panelEditorPage(req, res, panel, false);
  });

  // Speichern (und auf Wunsch gleich senden). Antwortet mit JSON.
  guildRouter.post(['/panels/neu', '/panels/:panelId'], requireManage, async (req, res) => {
    const { guild } = req.ctx;
    const body = req.body ?? {};
    const panels = structuredClone(settings.forGuild(guild.id).applications.panels);
    const isNew = !req.params.panelId;
    if (!isNew && !panels[req.params.panelId]) return res.status(404).json({ errors: ['Dieses Panel gibt es nicht mehr.'] });
    if (isNew && Object.keys(panels).length >= 25) return res.status(400).json({ errors: ['Es gehen höchstens 25 Panels.'] });

    const errors = [];
    const textValue = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
    const channels = new Set(textChannels(guild).map((c) => c.id));
    const typeIds = new Set(store.types(guild.id).map((t) => t.id));
    const image = textValue(body.image, 500);
    const thumbnail = textValue(body.thumbnail, 500);
    const color = textValue(body.color, 7);
    const panel = {
      name: textValue(body.name, 80),
      title: textValue(body.title, 200),
      description: textValue(body.description, 3000),
      image: /^https:\/\/\S+$/.test(image) ? image : '',
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : '',
      channel: typeof body.channel === 'string' && channels.has(body.channel) ? body.channel : '',
      buttonLabel: textValue(body.buttonLabel, 80),
      placeholder: textValue(body.placeholder, 150),
      style: ['auto', 'menu', 'buttons'].includes(body.style) ? body.style : 'auto',
      author: textValue(body.author, 100),
      thumbnail: /^https:\/\/\S+$/.test(thumbnail) ? thumbnail : '',
      footer: textValue(body.footer, 200),
      types: [...new Set(Array.isArray(body.types) ? body.types.filter((id) => typeIds.has(id)) : [])].slice(0, 25),
    };
    if (!panel.title) errors.push('Das Panel braucht einen Titel.');
    if (image && !panel.image) errors.push('Die Bild-URL muss mit https:// beginnen.');
    if (thumbnail && !panel.thumbnail) errors.push('Die Vorschaubild-URL muss mit https:// beginnen.');
    if (body.send && !panel.channel) errors.push('Wähle einen Kanal, in den das Panel gesendet wird.');
    if (errors.length) return res.status(400).json({ errors });

    let id = req.params.panelId;
    if (isNew) {
      const slug = (panel.name || panel.title)
        .toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 20) || 'panel';
      id = slug;
      for (let n = 2; panels[id]; n++) id = `${slug}-${n}`;
    }
    panels[id] = { ...panels[id], ...panel };
    settings.setApplicationPanels(guild.id, panels);
    await appMessages.refreshPanels(guild).catch((err) => console.error('[dashboard] Panels aktualisieren:', err.message));

    let sent = false;
    if (body.send) {
      const channel = guild.channels.cache.get(panel.channel);
      try {
        await appMessages.postPanel(channel, id);
        sent = true;
      } catch (err) {
        return res.status(400).json({
          errors: [`Gespeichert, aber das Senden in #${channel?.name ?? '?'} ist fehlgeschlagen: ${err.message}. Darf der Bot dort schreiben?`],
          redirect: `/g/${guild.id}/panels/${id}`,
        });
      }
    }
    res.json({ ok: true, redirect: `/g/${guild.id}/panels/${id}?ok=${sent ? 'gesendet' : 'gespeichert'}` });
  });

  guildRouter.post('/panels/:panelId/loeschen', requireManage, async (req, res) => {
    const { guild } = req.ctx;
    const panels = structuredClone(settings.forGuild(guild.id).applications.panels);
    const id = req.params.panelId;
    if (panels[id]) {
      delete panels[id];
      settings.setApplicationPanels(guild.id, panels);
      await appMessages.refreshPanels(guild).catch(() => {});
    }
    res.redirect(`/g/${guild.id}/panels?ok=geloescht`);
  });

  app.use((req, res) => send(res, pages.message({ session: req.session, title: 'Nicht gefunden', text: 'Diese Seite gibt es nicht.', back: '/' }), 404));
  app.use((err, req, res, next) => {
    console.error('[dashboard]', err);
    if (res.headersSent) return next(err);
    if (req.accepts(['html', 'json']) === 'json') return res.status(500).json({ errors: ['Interner Fehler. Sieh in die Konsole des Bots.'] });
    send(res, pages.message({ session: req.session, title: 'Fehler', text: 'Da ist etwas schiefgelaufen. Sieh in die Konsole des Bots.', back: '/' }), 500);
  });

  setInterval(auth.sweepSessions, 3_600_000).unref();
  const server = app.listen(config.port, () => {
    console.log(`✅ Dashboard läuft auf Port ${config.port} → ${config.url}`);
    console.log(`   Redirect-URL fürs Developer Portal: ${config.url}/auth/callback`);
  });
  server.on('error', (err) => console.error(`❌ Dashboard konnte Port ${config.port} nicht öffnen: ${err.message}`));
  return { app, server };
}

module.exports = { start, readConfig };
