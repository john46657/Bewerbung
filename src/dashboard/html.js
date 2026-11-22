// Kleine HTML-Hilfe: html`…${wert}…` maskiert alle eingesetzten Werte automatisch.
// Bereits fertiges HTML (z. B. aus einem anderen html`…`) wird mit raw() oder als Rückgabe von html`…` unverändert eingesetzt.
class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const raw = (value) => new Raw(String(value));

function escape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escape(value);
}

function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new Raw(out);
}

// JSON sicher in <script type="application/json"> einbetten.
const json = (value) => raw(JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'));

module.exports = { html, raw, escape, json };
