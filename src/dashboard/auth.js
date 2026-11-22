// Anmeldung mit Discord (OAuth2) und Sitzungen. Sitzungen liegen in data/db.json, damit ein Neustart
// niemanden abmeldet. Im Cookie steht nur ein Zufallswert, gespeichert wird nur dessen Hash.
const crypto = require('node:crypto');
const { data, save } = require('../lib/db');

const API = 'https://discord.com/api/v10';
const COOKIE = 'enrp_session';
const STATE_COOKIE = 'enrp_oauth';
const SESSION_DAYS = 7;
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;

const sessions = () => (data.dashboardSessions ??= {});
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    try {
      cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // kaputtes Cookie ignorieren
    }
  }
  return cookies;
}

function cookieOptions(config, maxAgeSeconds) {
  return [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAgeSeconds}`, config.secure ? 'Secure' : null].filter(Boolean).join('; ');
}

function setCookie(res, config, name, value, maxAgeSeconds) {
  const previous = res.getHeader('Set-Cookie') ?? [];
  res.setHeader('Set-Cookie', [...[].concat(previous), `${name}=${encodeURIComponent(value)}; ${cookieOptions(config, maxAgeSeconds)}`]);
}

// Abgelaufene Sitzungen aufräumen.
function sweepSessions() {
  const now = Date.now();
  let changed = false;
  for (const [key, session] of Object.entries(sessions())) {
    if (session.expiresAt < now) {
      delete sessions()[key];
      changed = true;
    }
  }
  if (changed) save();
}

// Middleware: req.session (oder null) setzen.
function loadSession(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const session = token ? sessions()[hash(token)] : null;
  req.session = session && session.expiresAt > Date.now() ? session : null;
  next();
}

async function discord(path, options) {
  const res = await fetch(`${API}${path}`, { ...options, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Discord antwortet mit HTTP ${res.status} (${path})`);
  return res.json();
}

function routes(app, config) {
  const redirectUri = `${config.url}/auth/callback`;

  app.get('/auth/login', (req, res) => {
    const state = random();
    setCookie(res, config, STATE_COOKIE, state, 600);
    const params = new URLSearchParams({
      client_id: config.clientId(),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
      state,
      prompt: 'none',
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  app.get('/auth/callback', async (req, res) => {
    const expected = parseCookies(req.headers.cookie)[STATE_COOKIE];
    setCookie(res, config, STATE_COOKIE, '', 0);
    const { code, state, error } = req.query;
    if (error) return res.redirect('/?fehler=abgebrochen');
    if (!code || typeof code !== 'string' || !expected || state !== expected) return res.redirect('/?fehler=sitzung');

    try {
      const token = await discord('/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId(),
          client_secret: config.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      const auth = { headers: { Authorization: `Bearer ${token.access_token}` } };
      const [user, guilds] = await Promise.all([discord('/users/@me', auth), discord('/users/@me/guilds', auth)]);

      const sessionToken = random();
      sessions()[hash(sessionToken)] = {
        userId: user.id,
        username: user.username,
        globalName: user.global_name ?? null,
        avatar: user.avatar ?? null,
        guilds: guilds.map((g) => {
          const perms = BigInt(g.permissions ?? 0);
          return { id: g.id, name: g.name, icon: g.icon ?? null, manage: g.owner || Boolean(perms & (MANAGE_GUILD | ADMINISTRATOR)) };
        }),
        csrf: random(),
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_DAYS * 86_400_000,
      };
      save();
      // Den Discord-Zugangstoken brauchen wir danach nicht mehr – er wird nicht gespeichert.
      fetch(`${API}/oauth2/token/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.clientId(), client_secret: config.clientSecret, token: token.access_token }),
      }).catch(() => {});

      setCookie(res, config, COOKIE, sessionToken, SESSION_DAYS * 86_400);
      res.redirect('/server');
    } catch (err) {
      console.error('[dashboard] Anmeldung fehlgeschlagen:', err.message);
      res.redirect('/?fehler=discord');
    }
  });

  app.post('/auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token && req.session && req.body?.csrf === req.session.csrf) {
      delete sessions()[hash(token)];
      save();
    }
    setCookie(res, config, COOKIE, '', 0);
    res.redirect('/');
  });
}

// Middleware: nur angemeldet weiter.
function requireLogin(req, res, next) {
  if (req.session) return next();
  if (req.method === 'GET') return res.redirect('/auth/login');
  return res.status(401).json({ error: 'Bitte melde dich erneut an.' });
}

// Middleware: POST-Anfragen brauchen den CSRF-Wert der Sitzung (Formularfeld "csrf" oder Header "X-CSRF").
function requireCsrf(req, res, next) {
  const sent = req.get('X-CSRF') ?? req.body?.csrf;
  if (req.session && typeof sent === 'string' && sent.length === req.session.csrf.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.session.csrf))) {
    return next();
  }
  return res.status(403).send('Ungültige Anfrage. Lade die Seite neu und versuche es noch einmal.');
}

module.exports = { loadSession, routes, requireLogin, requireCsrf, sweepSessions };
