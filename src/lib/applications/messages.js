// Aufbau von Panels und Team-Nachrichten der Bewerbungen.
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const { base, forGuild } = require('../settings');
const { embed, truncate } = require('../util');
const { bucket, save } = require('../db');
const store = require('./store');
const { AI_ICONS } = require('./aiCheck');
const { profileUrl } = require('./roblox');
const { dashboardUrl } = require('../dashboardUrl');

const STATUS_COLORS = { ACCEPTED: 'success', REJECTED: 'danger', WITHDRAWN: '#99AAB5', SCREENING: 'warning', INTERVIEW: 'warning', PENDING_DECISION: 'warning' };
const unix = (ms) => Math.floor(ms / 1000);

// ---------- Panels ----------

// Ein Panel legt mit `types` (Liste von IDs) selbst fest, welche Bewerbungen es zeigt (Dashboard).
// Ohne `types` gilt wie früher: alle Arten mit passendem `panel` ("apply" / "quali").
function panelTypes(guildId, kind) {
  const panel = forGuild(guildId).applications.panels[kind];
  if (Array.isArray(panel?.types)) return panel.types.map((id) => store.typeById(guildId, id)).filter(Boolean);
  return store.types(guildId).filter((t) => t.panel === kind);
}

const DEFAULT_PLACEHOLDER = { apply: 'Wofür möchtest du dich bewerben?', quali: 'Wähle eine Einheit oder Qualifikation …' };

function accent(panel) {
  const color = /^#[0-9a-f]{6}$/i.test(panel.color ?? '') ? panel.color : base.colors.primary;
  return parseInt(color.slice(1), 16);
}

function buildPanel(guildId, kind) {
  const panel = forGuild(guildId).applications.panels[kind];
  if (!panel) return null;
  const list = panelTypes(guildId, kind);
  // style: "auto" (1 Bewerbung = Button, mehrere = Auswahlmenü), "menu" oder "buttons"
  const style = panel.style === 'buttons' || panel.style === 'menu' ? panel.style : 'auto';
  const asButtons = list.length > 0 && (style === 'buttons' || (style === 'auto' && list.length === 1));
  const head = `${panel.author ? `-# **${panel.author}**\n` : ''}## ${panel.title}${panel.description ? `\n${panel.description}` : ''}`;
  const container = new ContainerBuilder().setAccentColor(accent(panel));
  if (panel.thumbnail) {
    container.addSectionComponents(
      new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(head)).setThumbnailAccessory(new ThumbnailBuilder().setURL(panel.thumbnail)),
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(head));
  }

  if ((list.length > 1 && panel.showList !== false) || kind === 'quali' || !list.length) {
    container.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        list.length
          ? list.map((t) => `- [${t.emoji}] **${t.name}**${t.enabled ? '' : ' *(geschlossen)*'}${t.description ? `\n${t.description}` : ''}`).join('\n\n')
          : '*Derzeit gibt es hier keine Bewerbungen.*',
      ),
    );
  }
  if (panel.image) {
    container.addSeparatorComponents(new SeparatorBuilder()).addMediaGalleryComponents(new MediaGalleryBuilder().addItems((item) => item.setURL(panel.image)));
  }
  if (panel.footer) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${panel.footer}`));

  const components = [container];
  if (asButtons && list.length > 1) {
    // Ein Button je Bewerbung, 5 pro Reihe
    for (let i = 0; i < Math.min(list.length, 25); i += 5) {
      components.push(
        new ActionRowBuilder().addComponents(
          list.slice(i, i + 5).map((t) =>
            new ButtonBuilder()
              .setCustomId(`quali:apply:${t.id}`)
              .setLabel(truncate(t.name, 80))
              .setStyle(t.enabled ? ButtonStyle.Primary : ButtonStyle.Secondary)
              .setEmoji(t.emoji),
          ),
        ),
      );
    }
  } else if (asButtons) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`quali:apply:${list[0].id}`)
          .setLabel(truncate(panel.buttonLabel || 'Jetzt bewerben', 80))
          .setStyle(ButtonStyle.Primary)
          .setEmoji(list[0].emoji),
      ),
    );
  } else if (list.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('quali:pick')
          .setPlaceholder(truncate(panel.placeholder || DEFAULT_PLACEHOLDER[kind] || 'Wofür möchtest du dich bewerben?', 150))
          .addOptions(list.slice(0, 25).map((t) => ({ label: t.name, value: t.id, emoji: t.emoji, description: truncate(t.description || t.name, 100) }))),
      ),
    );
  }
  return { components, flags: MessageFlags.IsComponentsV2 };
}

async function postPanel(channel, kind) {
  const payload = buildPanel(channel.guild.id, kind);
  if (!payload) throw new Error(`Panel ${kind} gibt es nicht.`);
  const message = await channel.send(payload);
  bucket('appPanels', channel.guild.id)[message.id] = { channelId: channel.id, kind };
  save();
  return message;
}

async function refreshPanels(guild) {
  const panels = bucket('appPanels', guild.id);
  for (const [messageId, { channelId, kind }] of Object.entries(panels)) {
    const payload = buildPanel(guild.id, kind);
    const message = payload && (await guild.channels.cache.get(channelId)?.messages.fetch(messageId).catch(() => null));
    if (!message) {
      // Nachricht gelöscht oder Panel im Dashboard entfernt: nicht mehr verfolgen.
      delete panels[messageId];
      save();
      continue;
    }
    await message.edit(payload).catch((err) => console.error('[appPanel]', err.message));
  }
}

// ---------- Team-Nachricht ----------

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.` : `${minutes} Min. ${seconds} Sek.`;
}

function infoEmbed(record, type) {
  const color = STATUS_COLORS[record.status] ?? 'primary';
  const status = [`**${store.STATUS[record.status]}**`];
  if (record.decidedBy) status.push(`von <@${record.decidedBy}> <t:${unix(record.decidedAt)}:R>`);

  const info = embed(color)
    .setTitle(`${type.emoji} ${type.name} – ${record.number}`)
    .setAuthor({ name: record.userTag, iconURL: record.avatarUrl ?? undefined })
    .setFooter({ text: `${base.serverName} · ${record.number}` })
    .setTimestamp(record.createdAt)
    .addFields({ name: 'Status', value: status.join(' ') });
  if (record.reason) info.addFields({ name: 'Grund', value: truncate(record.reason, 1024) });

  const applicant = [`<@${record.userId}> · \`${record.userId}\``];
  if (record.roblox) applicant.push(`Roblox: [${record.roblox.name}](${profileUrl(record.roblox.id)}) (ID ${record.roblox.id})`);
  if (type.showStats !== false) {
    if (record.joinedAt) applicant.push(`Auf dem Server seit <t:${unix(record.joinedAt)}:R>`);
    if (record.accountCreatedAt) applicant.push(`Discord-Konto seit <t:${unix(record.accountCreatedAt)}:R>`);
    applicant.push(`Dauer: ${formatDuration(record.durationMs ?? 0)}${record.source === 'WEB' ? ' · über die Website' : ''}`);
  }
  info.addFields({ name: 'Bewerber', value: applicant.join('\n') });

  if (record.ai) {
    const reasons = record.ai.reasons.length ? `\n${record.ai.reasons.join(' · ')}` : '';
    info.addFields({ name: 'KI-Checker', value: truncate(`${AI_ICONS[record.ai.level]} Verdacht **${record.ai.level}**${reasons}`, 1024), inline: true });
  }
  if (record.roleSelections?.length) {
    info.addFields({ name: 'Rollen bei Annahme', value: record.roleSelections.map((id) => `<@&${id}>`).join(' '), inline: true });
  }
  return info;
}

// Zeichen, die Discord für das 6000er-Limit aller Embeds einer Nachricht zählt.
function embedChars(e) {
  const json = e.toJSON();
  return (
    (json.title?.length ?? 0) +
    (json.description?.length ?? 0) +
    (json.footer?.text?.length ?? 0) +
    (json.author?.name?.length ?? 0) +
    (json.fields ?? []).reduce((sum, f) => sum + f.name.length + f.value.length, 0)
  );
}

// Antworten auf Embeds verteilen (max. 25 Felder je Embed). Reicht der Platz nicht, werden erst die
// Antworten und dann die Fragen gekürzt; die vollständigen Antworten hängen dann als Datei an.
function answerEmbeds(record, budget) {
  const flagged = new Set(record.ai?.flagged ?? []);
  const items = record.answers.map((a, i) => ({ name: `${i + 1}. ${flagged.has(a.question) ? '⚠️ ' : ''}${a.question}`, value: a.answer || '—' }));
  let nameLimit = 256;
  let valueLimit = 1024;
  const size = () => items.reduce((sum, f) => sum + Math.min(f.name.length, nameLimit) + Math.min(f.value.length, valueLimit), 0);
  while (size() > budget && (valueLimit > 20 || nameLimit > 20)) {
    if (valueLimit > 20) valueLimit = Math.max(20, Math.floor(valueLimit * 0.85));
    if (size() > budget && nameLimit > 20) nameLimit = Math.max(20, Math.floor(nameLimit * 0.85));
  }

  const truncated = items.some((f) => f.name.length > nameLimit || f.value.length > valueLimit);
  const embeds = [];
  for (let i = 0; i < items.length; i += 25) {
    embeds.push(
      embed(STATUS_COLORS[record.status] ?? 'primary')
        .setFooter(null)
        .setTimestamp(null)
        .addFields(items.slice(i, i + 25).map((f) => ({ name: truncate(f.name, nameLimit), value: truncate(f.value, valueLimit) }))),
    );
  }
  return { embeds, truncated };
}

function answersFile(record, type) {
  const lines = [
    `${type.name} – ${record.number}`,
    `Bewerber: ${record.userTag} (${record.userId})`,
    record.roblox ? `Roblox: ${record.roblox.name} (ID ${record.roblox.id})` : null,
    `Eingereicht: ${new Date(record.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`,
    `Status: ${store.STATUS[record.status]}${record.reason ? ` – Grund: ${record.reason}` : ''}`,
    record.ai ? `KI-Checker: ${record.ai.level}${record.ai.reasons.length ? ` (${record.ai.reasons.join('; ')})` : ''}` : null,
    '',
    ...record.answers.flatMap((a, i) => [`${i + 1}. ${a.question}`, a.answer || '—', '']),
  ].filter((l) => l !== null);
  return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), { name: `bewerbung-${record.number}.txt` });
}

const recordUrl = (record) => `${dashboardUrl()}/g/${record.guildId}/eingaenge/${record.number}`;

function teamComponents(record, type) {
  const open = store.isOpenStatus(record.status);
  const rows = [];
  if (open) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`quali:decide:${record.number}:accept`).setLabel('Annehmen').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId(`quali:decide:${record.number}:reject`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger).setEmoji('❌'),
        new ButtonBuilder().setCustomId(`quali:reason:${record.number}:accept`).setLabel('Annehmen mit Grund').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`quali:reason:${record.number}:reject`).setLabel('Ablehnen mit Grund').setStyle(ButtonStyle.Secondary),
      ),
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`quali:history:${record.userId}`).setLabel('Verlauf').setStyle(ButtonStyle.Secondary).setEmoji('📜'),
      new ButtonBuilder().setCustomId(`quali:ticket:${record.number}`).setLabel('Ticket mit Bewerber öffnen').setStyle(ButtonStyle.Secondary).setEmoji('🎫'),
      ...(dashboardUrl() ? [new ButtonBuilder().setURL(recordUrl(record)).setLabel('Im Dashboard').setStyle(ButtonStyle.Link)] : []),
    ),
  );
  const next = (store.POLICE_TRANSITIONS[record.status] ?? []).filter((s) => !['ACCEPTED', 'REJECTED'].includes(s));
  if (open && type.workflow === 'police' && next.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`quali:status:${record.number}`)
          .setPlaceholder(`Status: ${store.STATUS[record.status]} – nächster Schritt …`)
          .addOptions(next.map((s) => ({ label: s === 'WITHDRAWN' ? 'Zurückziehen' : store.STATUS[s], value: s }))),
      ),
    );
  }
  return rows;
}

// withFile: beim ersten Senden die vollständigen Antworten anhängen, falls etwas gekürzt wurde.
function buildTeamMessage(record, type, { withFile = false, components = true } = {}) {
  const info = infoEmbed(record, type);
  // „Antworten verstecken“: Antworten nur im Dashboard (bzw. /bewerbungen anzeigen), nicht im Kanal.
  if (type.hideAnswers) {
    info.addFields({ name: 'Antworten', value: dashboardUrl() ? `Nur im [Dashboard](${recordUrl(record)}) sichtbar.` : 'Ausgeblendet – ansehen mit `/bewerbungen anzeigen`.' });
    return { embeds: [info], components: components ? teamComponents(record, type) : [], allowedMentions: { parse: [] } };
  }
  const { embeds, truncated } = answerEmbeds(record, 5900 - embedChars(info));
  const message = { embeds: [info, ...embeds], components: components ? teamComponents(record, type) : [], allowedMentions: { parse: [] } };
  if (withFile && truncated) message.files = [answersFile(record, type)];
  return message;
}

module.exports = { panelTypes, buildPanel, postPanel, refreshPanels, buildTeamMessage, answersFile, formatDuration };
