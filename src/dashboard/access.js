// Wer darf im Dashboard was? Geprüft wird immer live über den Bot (Rollen und Rechte auf dem Server),
// nicht über die Daten aus der Anmeldung.
const { PermissionFlagsBits } = require('discord.js');
const store = require('../lib/applications/store');
const { isStaff } = require('../lib/util');

async function memberOf(guild, userId) {
  return guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
}

// Bewerbungsarten, Panels und Kanäle bearbeiten – wie /einstellungen.
const canManage = (member) => Boolean(member?.permissions.has(PermissionFlagsBits.ManageGuild));

// Bewerbungen sehen und entscheiden: Staff oder Manager-Rolle der jeweiligen Art.
const canReview = (member, type) => Boolean(member && type && store.isManager(member, type));
const reviewableTypes = (member) => store.types(member.guild.id).filter((t) => canReview(member, t));
const hasAccess = (member) => Boolean(member && (canManage(member) || isStaff(member) || store.managesAny(member)));

module.exports = { memberOf, canManage, canReview, reviewableTypes, hasAccess };
