# Dashboard

Web-Oberfläche für das Bewerbungssystem. Man meldet sich **mit Discord** an und sieht nur die Server, auf denen man
Rechte hat. Das Dashboard läuft im selben Programm wie der Bot und nutzt dieselben Daten (`data/db.json`) – es braucht
keine Datenbank und keinen zweiten Prozess.

## Was es kann

| Bereich | Inhalt | Wer |
|---|---|---|
| **Übersicht** | offene Bewerbungen, Kennzahlen der letzten 30 Tage, nächste Schritte beim Einrichten | alle mit Zugriff |
| **Bewerbungen** | Bewerbungen anlegen, bearbeiten, löschen: Name, Emoji, Fragen (Freitext, Auswahl, Rollen-Auswahl, Roblox; duplizieren, sortieren), Texte, Rollen, Kanäle, Wartezeit und Zeitlimit (Tage/Std./Min.), Team-Thread, Statistik an/aus, Antworten verstecken, **Ausfüllen per DM oder auch auf der Website** (mit Link zum Teilen); Standard-Kanal für eingehende Bewerbungen | „Server verwalten“ |
| **Panels** | beliebig viele Panels: verknüpfte Bewerbungen (mit Reihenfolge), Darstellung (automatisch, Auswahlmenü oder ein Button pro Bewerbung), Titel, Text, Kopfzeile, Vorschaubild, großes Bild, Fußzeile, Farbe, Button-/Menütext, Live-Vorschau, **in einen Kanal senden** | „Server verwalten“ |
| **Eingänge** | eingegangene Bewerbungen filtern und durchsuchen, alle Antworten, KI-Checker, Verlauf; **annehmen / ablehnen mit Grund**, Prüfschritte | Staff und Manager-Rollen der jeweiligen Bewerbung |

Entscheidungen im Dashboard wirken genauso wie die Buttons in Discord: DM an die Person, Rollen werden vergeben/genommen,
die Team-Nachricht in Discord wird aktualisiert. Gespeicherte Panels aktualisieren sich in Discord automatisch.

Wer Zugriff hat, wird bei jedem Aufruf live über den Bot geprüft (Rollen und Rechte auf dem Server):
- **„Server verwalten“** → alles
- **Staff-Rolle** (`roles.staff`) → Eingänge aller Bewerbungen
- **Manager-Rolle** einer Bewerbung → Eingänge dieser Bewerbung

## Bewerben im Browser

Steht bei einer Bewerbung **Ausfüllen: Per Direktnachricht oder auf der Website**, gibt es dafür einen Link
(`https://deine-adresse/bewerben/<Server-ID>/<Schlüssel>`), den der Editor zum Kopieren anzeigt. In Discord bekommen
Bewerber zusätzlich den Button **Im Browser ausfüllen** – auch dann, wenn ihre DMs geschlossen sind.

- Anmeldung mit Discord ist Pflicht, die Person muss auf dem Server sein.
- Geprüft wird dasselbe wie per DM: Rollen, Sperren, offene Bewerbung, Wartezeit, Zeitlimit, Länge der Antworten,
  Roblox-Konto (wird bei Roblox nachgeschlagen).
- Alle Fragen stehen auf einer Seite. Danach läuft alles wie bei einer DM-Bewerbung: Team-Nachricht, Rollen,
  Abschluss-DM mit Nummer.

## Einrichten

### 1. Domain auf den Server zeigen lassen

Das Dashboard ist ein normaler Webserver auf einem Port (Standard `3000`). Damit es unter deiner Domain erreichbar ist:

- **Eigener Server (VPS):** Einen DNS-Eintrag (`A`-Record) für die Domain auf die IP des Servers setzen und einen
  Reverse-Proxy mit HTTPS davorschalten, z. B. [Caddy](https://caddyserver.com) – der holt das Zertifikat automatisch:
  ```
  dashboard.deine-domain.de {
      reverse_proxy localhost:3000
  }
  ```
- **Bot-Hoster (Pterodactyl, z. B. bot-hosting.net):** Der Hoster gibt dir einen Port (Variable `SERVER_PORT`), den
  nutzt das Dashboard automatisch. Ob du dort eine eigene Domain mit HTTPS verbinden kannst, hängt vom Hoster ab – frag
  im Zweifel den Support. Ohne HTTPS funktioniert die Anmeldung, ist aber unsicher.

### 2. Discord Developer Portal

1. [Developer Portal](https://discord.com/developers/applications) → deine Bot-App → **OAuth2**.
2. Unter **Redirects** eintragen (genau so, mit deiner Domain):
   ```
   https://dashboard.deine-domain.de/auth/callback
   ```
3. **Client Secret** → *Reset Secret* → kopieren (niemals teilen).

### 3. `.env`

```env
DASHBOARD_URL=https://dashboard.deine-domain.de
DISCORD_CLIENT_SECRET=dein-client-secret
# optional, Standard: SERVER_PORT des Hosters, sonst 3000
DASHBOARD_PORT=
```

`DASHBOARD_URL` ohne `/` am Ende. Bleiben beide Werte leer, startet der Bot ohne Dashboard. Beim Start steht in der
Konsole:

```
✅ Dashboard läuft auf Port 3000 → https://dashboard.deine-domain.de
   Redirect-URL fürs Developer Portal: https://dashboard.deine-domain.de/auth/callback
```

## Sicherheit

- Anmeldung über Discord OAuth2 (nur `identify` und `guilds`). Der Discord-Zugangstoken wird nach der Anmeldung sofort
  verworfen; gespeichert werden nur Name, Profilbild und die Liste der Server.
- Sitzungen gelten 7 Tage. Im Cookie steht nur ein Zufallswert (`HttpOnly`, `SameSite=Lax`, bei HTTPS `Secure`),
  in `data/db.json` nur dessen Hash.
- Jede Änderung braucht einen CSRF-Schlüssel der Sitzung. Alle Eingaben werden auf dem Server geprüft: Rollen und
  Kanäle müssen auf dem Server existieren, Bild-Links müssen `https://` sein, Texte werden gekürzt und beim Anzeigen
  maskiert. Strenge Content-Security-Policy, keine fremden Skripte.

## Hinweise

- Bewerbungen und Panels, die im Dashboard angelegt werden, gelten nur für diesen Server und stehen in `data/db.json`.
  `/einstellungen zuruecksetzen` lässt sie stehen.
- Es gibt keine vorgefertigten Bewerbungen oder Panels – alles legst du selbst an. Ein Panel kannst du auch in Discord
  mit `/bewerbungspanel panel:<Name>` posten.
- Schlüssel und Nummern-Präfix einer Bewerbung werden automatisch aus dem Namen gebildet (z. B. „Polizei-Bewerbung“ →
  Nummern `POLI-0001`).
- Neue Bewerbungen erscheinen erst in einem Panel, wenn du sie dort verknüpfst. Über `/bewerbung` sind sie sofort
  erreichbar.
- Höchstens 25 Bewerbungen und 25 Panels je Server (Grenze der Discord-Auswahlmenüs).
