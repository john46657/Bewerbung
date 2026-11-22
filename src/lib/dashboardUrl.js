// Öffentliche Adresse des Dashboards (DASHBOARD_URL) oder null, wenn kein Dashboard eingerichtet ist.
function dashboardUrl() {
  const url = (process.env.DASHBOARD_URL ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+$/.test(url) && process.env.DISCORD_CLIENT_SECRET ? url : null;
}

// Link zum Browser-Formular einer Bewerbung (nur wenn sie „DM und Website“ erlaubt).
function webApplyUrl(guildId, type) {
  const url = dashboardUrl();
  return url && type.mode === 'DM_WEB' ? `${url}/bewerben/${guildId}/${type.id}` : null;
}

module.exports = { dashboardUrl, webApplyUrl };
