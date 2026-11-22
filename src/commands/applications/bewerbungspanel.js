const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { replyPrivate } = require('../../lib/util');
const { forGuild } = require('../../lib/settings');
const { postPanel } = require('../../lib/applications/messages');

// Postet ein im Dashboard angelegtes Panel in diesen Kanal.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('bewerbungspanel')
    .setDescription('Postet ein Bewerbungs-Panel aus dem Dashboard in diesem Kanal.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) => o.setName('panel').setDescription('Welches Panel?').setRequired(true).setAutocomplete(true)),

  autocomplete(interaction) {
    const query = String(interaction.options.getFocused() ?? '').toLowerCase();
    const panels = Object.entries(forGuild(interaction.guildId).applications.panels ?? {});
    return interaction.respond(
      panels
        .map(([id, p]) => ({ name: `${p.title}${p.name ? ` (${p.name})` : ''}`.slice(0, 100), value: id }))
        .filter((c) => c.name.toLowerCase().includes(query))
        .slice(0, 25),
    );
  },

  async execute(interaction) {
    const id = interaction.options.getString('panel');
    if (!forGuild(interaction.guildId).applications.panels?.[id]) {
      return replyPrivate(interaction, 'Dieses Panel gibt es nicht. Lege Panels im Dashboard unter „Panels“ an.');
    }
    await postPanel(interaction.channel, id);
    await replyPrivate(interaction, '✅ Panel gepostet. Es aktualisiert sich automatisch, wenn du es im Dashboard änderst.');
  },
};
