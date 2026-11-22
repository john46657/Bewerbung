// Einstellungen je Server. config.json ist die Vorlage für alle Server; was per /einstellungen in Discord
// geändert wird, gilt nur für den jeweiligen Server und wird in data/db.json gespeichert.
// forGuild(guildId) liefert das fertige config-Objekt eines Servers. Es wird direkt verändert, damit alle
// Module sofort die neuen Werte sehen.
const base = require('../../config.json');
const db = require('./db');

require('./applications/normalize')(base); // Standardwerte der Bewerbungsarten ergänzen

const overrides = (db.data.settings ??= {}); // { guildId: { pfad: wert } }
const configs = new Map(); // guildId → config-Objekt

// Ältere Versionen speicherten die Änderungen nur für einen Server direkt unter "settings".
// Mit GUILD_ID werden sie diesem Server zugeordnet, sonst beim Start dem einzigen Server (adoptLegacy).
const isGuildId = (key) => /^\d+$/.test(key);
const legacyKeys = Object.keys(overrides).filter((key) => !isGuildId(key) && key !== '_legacy');
if (legacyKeys.length) {
  const legacy = (overrides._legacy ??= {});
  for (const key of legacyKeys) {
    legacy[key] = overrides[key];
    delete overrides[key];
  }
  db.save();
}
if (overrides._legacy && process.env.GUILD_ID) adoptLegacy(process.env.GUILD_ID);

function adoptLegacy(guildId) {
  if (!overrides._legacy) return false;
  overrides[guildId] = { ...overrides._legacy, ...overrides[guildId] };
  delete overrides._legacy;
  configs.delete(guildId);
  db.save();
  return true;
}

// Pfade wie "channels.welcome" oder "tickets.types.general.capacity" (in Listen wird per id gesucht).
function resolve(root, path) {
  const keys = path.split('.');
  const last = keys.pop();
  let target = root;
  for (const key of keys) {
    target = Array.isArray(target) ? target.find((entry) => entry.id === key) : target?.[key];
    if (target === undefined) return null;
  }
  return { target, last };
}

function apply(config, path, value) {
  const found = resolve(config, path);
  if (!found) return false;
  if (value === undefined) delete found.target[found.last];
  else found.target[found.last] = value;
  return true;
}

function forGuild(guildId) {
  if (!configs.has(guildId)) {
    const config = structuredClone(base);
    for (const [path, value] of Object.entries(overrides[guildId] ?? {})) {
      if (!apply(config, path, value ?? undefined)) {
        console.warn(`⚠️  Gespeicherte Einstellung ${path} (Server ${guildId}) passt nicht mehr zur config.json und wird ignoriert`);
      }
    }
    configs.set(guildId, config);
  }
  return configs.get(guildId);
}

function get(guildId, path) {
  const found = resolve(forGuild(guildId), path);
  return found ? found.target[found.last] : undefined;
}

// value === undefined entfernt den Schlüssel (z. B. eine Level-Belohnung).
function set(guildId, path, value) {
  if (!apply(forGuild(guildId), path, value)) throw new Error(`Unbekannte Einstellung: ${path}`);
  (overrides[guildId] ??= {})[path] = value === undefined ? null : value;
  db.save();
}

// Ersetzt alle Bewerbungsarten eines Servers (Dashboard). Ältere Einzeländerungen an den Arten werden dabei
// verworfen, damit sie die neue Liste nach einem Neustart nicht wieder überschreiben.
function setApplicationTypes(guildId, types) {
  const own = (overrides[guildId] ??= {});
  for (const key of Object.keys(own)) {
    if (key === 'applications.types' || key.startsWith('applications.types.')) delete own[key];
  }
  own['applications.types'] = structuredClone(types);
  forGuild(guildId).applications.types = structuredClone(types);
  db.save();
}

// Ersetzt alle Bewerbungs-Panels eines Servers (Dashboard), wie setApplicationTypes.
function setApplicationPanels(guildId, panels) {
  const own = (overrides[guildId] ??= {});
  for (const key of Object.keys(own)) {
    if (key === 'applications.panels' || key.startsWith('applications.panels.')) delete own[key];
  }
  own['applications.panels'] = structuredClone(panels);
  forGuild(guildId).applications.panels = structuredClone(panels);
  db.save();
}

// Alle Änderungen eines Servers verwerfen und wieder die Werte aus config.json verwenden.
// Im Dashboard angelegte Bewerbungsarten und Panels bleiben erhalten.
function reset(guildId) {
  const kept = Object.fromEntries(['applications.types', 'applications.panels'].filter((key) => overrides[guildId]?.[key]).map((key) => [key, overrides[guildId][key]]));
  delete overrides[guildId];
  if (Object.keys(kept).length) overrides[guildId] = kept;
  configs.delete(guildId);
  db.save();
}

module.exports = {
  base,
  forGuild,
  get,
  set,
  reset,
  setApplicationTypes,
  setApplicationPanels,
  adoptLegacy,
  hasLegacy: () => Boolean(overrides._legacy),
  overrideCount: (guildId) => Object.keys(overrides[guildId] ?? {}).length,
};
