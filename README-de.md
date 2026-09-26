[English](README.md) · [日本語](README-ja.md) · Deutsch · [Français](README-fr.md)

# histbak

Geplante Sicherungen deines Browserverlaufs, dazu ein Viewer, der den Verlauf lesbar macht. Alles läuft lokal. Nichts wird irgendwohin hochgeladen, und die Erweiterung stellt überhaupt keine Netzwerkanfragen.

Chrome und Firefox, Manifest V3, keine Laufzeitabhängigkeiten.

![Der Viewer](docs/screenshots/viewer.png)

## Warum

Der Browserverlauf ist der einzige Teil eines Browserprofils ohne brauchbaren Export und ganz ohne Sicherung. Ein beschädigtes Profil, eine volle Festplatte oder eine Neuinstallation nimmt Jahre davon ohne Vorwarnung mit. Und der Verlauf, der übrig bleibt, lässt sich nur als flache, umgekehrt chronologische Liste durchsehen, die kaum eine Frage beantwortet, die man tatsächlich an ihn hätte.

histbak schreibt den Verlauf nach Plan auf die Festplatte und liest ihn als etwas zurück, das man sich ansehen kann.

## Haftungsausschluss

Das ist persönliche Software, veröffentlicht für den Fall, dass sie jemand anderem nützt. Sie kommt ohne jede Gewährleistung. Lies diesen Abschnitt, bevor du ihr irgendetwas anvertraust.

### Allein ist das keine Backup-Strategie

Die Dateien landen in deinem Download-Ordner, auf derselben Festplatte wie das Profil, aus dem sie stammen. Ein Festplattenausfall nimmt beides mit. Wenn dir der Verlauf wichtig ist, kopiere die Ausgabe woandershin.

### Prüfe deine Sicherungen

Öffne eine im Viewer oder mit dem eigenständigen Skript weiter unten und prüfe, ob sie enthält, was du erwartest. Tu das, bevor du sie brauchst, nicht danach. Eine ungetestete Sicherung ist eine Vermutung.

### Eine verlorene Passphrase ist nicht wiederherstellbar

Es gibt kein Zurücksetzen, keinen Hinweis und keine Hintertür. Dateien, die mit einer vergessenen Passphrase verschlüsselt wurden, sind dauerhaft unlesbar. Das ist eine Eigenschaft des Designs, kein Versehen.

### Sicherungen enthalten deinen gesamten Verlauf

Unverschlüsselte Ausgabe ist einfaches JSON, das jeder mit der Datei lesen kann. Bedenke, wo der Download-Ordner liegt, ob er mit einem Cloud-Dienst synchronisiert wird und wer den Rechner sonst noch nutzt.

### Das Aufräumen löscht Dateien

Ist `keepLastN` gesetzt, werden alte Sicherungen von der Festplatte entfernt. Es trifft nur die eigenen Dateinamen der Erweiterung, bleibt aber ein Löschvorgang, der unbeaufsichtigt läuft. Setze es auf 0, um das abzuschalten.

### Nicht geprüft

Die Kryptografie nutzt Standard-Primitive von WebCrypto in einer üblichen Anordnung, und das Format ist unten dokumentiert und durch Tests abgedeckt. Das ist nicht dasselbe wie eine Prüfung durch einen Kryptografen.

Die Erweiterung ist nicht signiert und nicht gelistet. Sie läuft als entpackte Entwicklererweiterung, wovor Chrome bei jedem Start warnt.

## Installation

Kein Store-Eintrag. Bauen und entpackt laden.

```bash
git clone https://github.com/didvc/histbak
cd histbak
npm install
npm run build
```

Chrome, Edge, Brave:

1. `chrome://extensions` öffnen
2. Den Entwicklermodus einschalten
3. „Entpackte Erweiterung laden“ und `build/chrome` auswählen

Firefox:

1. `about:debugging#/runtime/this-firefox` öffnen
2. „Temporäres Add-on laden“
3. `build/firefox/manifest.json` auswählen

Ein temporäres Add-on wird beim Neustart von Firefox entfernt. Eine dauerhafte Installation braucht einen über AMO signierten Build.

## Sicherungen

Ein Lauf sammelt den Verlauf, wendet die Datenschutzfilter an, verpackt das Ergebnis in einen Umschlag mit Zeitraum und Anzahlen, komprimiert es, verschlüsselt es optional und schreibt es in deinen Download-Ordner.

Läufe sind standardmäßig inkrementell: Jeder exportiert nur, was sich seit dem letzten geändert hat. Alle 30 Tage entsteht trotzdem ein vollständiger Snapshot, denn eine lange Kette von Deltas mit einem beschädigten Glied ist keine Sicherung.

Die Planung nutzt einmalige Alarme, die nach jedem Lauf neu gestellt werden, statt eines sich wiederholenden Intervalls. Ein fester 24-Stunden-Takt driftet bei jeder Zeitumstellung von der Uhrzeit weg, sodass aus `03:00 daily` langsam 02:00 würde. War der Browser zur geplanten Zeit geschlossen, findet der Lauf kurz nach dem nächsten Start statt.

![Einstellungen](docs/screenshots/options.png)

## Verschlüsselung

Standardmäßig aus, denn das Einschalten hat eine Folge, die man vorher verstehen sollte: Eine vergessene Passphrase bedeutet ein totes Archiv.

Ist sie an, werden Dateien mit AES-256-GCM verschlüsselt, mit einem Schlüssel, der per PBKDF2-SHA-256 mit 600.000 Runden abgeleitet wird, der aktuellen Untergrenze von OWASP. Salt und IV sind pro Datei zufällig. Der Header mit Algorithmus und Rundenzahl wird als zusätzliche GCM-Daten authentifiziert, sodass eine Datei, die so verändert wurde, dass sie eine einzige KDF-Runde angibt, nicht entschlüsselt werden kann, statt billig angreifbar zu werden.

Die Passphrase liegt im Sitzungsspeicher und wird nie auf die Festplatte geschrieben. Beim Schließen des Browsers geht sie verloren. Ein geplanter Lauf mit eingeschalteter Verschlüsselung und ohne eingegebene Passphrase wird übersprungen und gemeldet, nie stillschweigend im Klartext geschrieben.

Komprimiert wird vor dem Verschlüsseln. Geheimtext lässt sich nicht komprimieren, die andere Reihenfolge würde also Dateien erzeugen, die größer sind als die Eingabe.

![Popup](docs/screenshots/popup.png)

## Datenschutzfilter

Werden angewendet, bevor irgendetwas die Festplatte erreicht, und ebenso im Viewer.

Tracking-Parameter wie `utm_*`, `fbclid` und `gclid` werden standardmäßig entfernt, da sie Kampagnen und Verweise kennzeichnen und dabei nichts Nützliches verloren geht. Optional kann der ganze Query-String weg, womit auch Suchbegriffe verschwinden. Titel lassen sich ganz weglassen; sie verraten oft mehr als die URL. URLs, die auf deine Ausschlussmuster passen, verlassen den Browser nie, und lokale Schemata wie `chrome://`, `file://` und `data:` werden nie erfasst.

Ausschlussmuster sind Globs mit `*`, eines pro Zeile, und werden gegen die ganze URL geprüft:

```
*://*.bank*.*/*
*://mail.google.com/*
*://*.onion/*
*://localhost:*/*
```

## Dateinamen

Sicherungen werden anhand einer Vorlage in deinen Download-Ordner geschrieben:

```
histbak/{YYYY}-{MM}/history-{YYYY}{MM}{DD}-{HH}{mm}-{count}items{ext}
```

| Token | Bedeutung |
| --- | --- |
| `{YYYY}` `{YY}` | Jahr |
| `{MM}` `{DD}` | Monat, Tag |
| `{HH}` `{mm}` `{ss}` | Stunde, Minute, Sekunde |
| `{MON}` `{DAY}` | kurze Monats- und Wochentagsnamen |
| `{TZ}` | UTC-Versatz, für Dateien, die über Zeitzonen hinweg geteilt werden |
| `{count}` | Anzahl der Einträge in dieser Sicherung |
| `{ext}` | Endung passend zur verwendeten Verarbeitung |

Alles wird in Ortszeit aufgelöst. Schrägstriche erzeugen Unterordner. Vorlagen werden bereinigt: Ein Muster mit `..` kann den Download-Ordner nicht verlassen, unter Windows unzulässige Zeichen werden ersetzt, und reservierte Gerätenamen wie `con` erhalten ein Präfix. Unbekannte Tokens bleiben sichtbar, statt stillschweigend entfernt zu werden, sodass ein Tippfehler in der Vorschau sofort auffällt.

## Eine Sicherung lesen

Der Viewer öffnet Sicherungsdateien direkt. Wähle eine oder mehrere über `Open backup…`, und er entschlüsselt, entpackt und zeigt sie mit denselben Diagrammen wie den laufenden Verlauf. Öffnet man einen vollständigen Snapshot zusammen mit den folgenden Inkrementen, werden sie zusammengeführt; pro URL gewinnt der neueste Eintrag.

Die Schichten werden am Inhalt erkannt, nicht an der Dateiendung, sodass sich auch eine umbenannte Datei noch öffnen lässt.

## Eine Sicherung ohne die Erweiterung öffnen

Eine Sicherung, die sich nur mit dem Werkzeug lesen lässt, das sie geschrieben hat, ist eine Geisel. Das Format ist einfaches gzip und Standard-AES-GCM, daher stellt dieses Skript eine Sicherung allein mit Node wieder her:

```js
// node open-backup.mjs <file> [passphrase]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { webcrypto as crypto } from "node:crypto";

const [file, passphrase] = process.argv.slice(2);
let bytes = new Uint8Array(readFileSync(file));

const MAGIC = "HISTBAK1";
if (Buffer.from(bytes.slice(0, 8)).toString() === MAGIC) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const iterations = view.getUint32(10, false);
  const salt = bytes.slice(14, 30);
  const iv = bytes.slice(30, 42);
  const header = bytes.slice(0, 42);          // authenticated, must be passed in
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(passphrase.normalize("NFKC")),
    "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  bytes = new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: header }, key, bytes.slice(42)));
}

if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
const envelope = JSON.parse(Buffer.from(bytes).toString("utf8"));
console.log(envelope.kind, envelope.items.length, "items");
console.log(envelope.items.slice(0, 5));
```

Eine unverschlüsselte Sicherung braucht noch weniger:

```bash
gunzip -c history-20260812-0300-915items.json.gz | jq '.items | length'
```

## Format der Sicherungsdateien

Unverschlüsselte Ausgabe ist mit gzip komprimiertes JSON. Verschlüsselte Ausgabe verpackt diese Bytes in einen 42-Byte-Header, gefolgt vom AES-GCM-Geheimtext mit angehängtem Tag:

| Offset | Bytes | Feld |
| --- | --- | --- |
| 0 | 8 | Magic, `HISTBAK1` |
| 8 | 1 | KDF-ID, 1 = PBKDF2-SHA-256 |
| 9 | 1 | Cipher-ID, 1 = AES-256-GCM |
| 10 | 4 | Iterationszahl, uint32 Big-Endian |
| 14 | 16 | Salt |
| 30 | 12 | IV |
| 42 | n | Geheimtext, GCM-Tag angehängt |

Der ganze Header wird als zusätzliche GCM-Daten übergeben, sodass sich kein Teil davon ändern lässt, ohne dass die Entschlüsselung fehlschlägt.

Der JSON-Umschlag darin:

```json
{
  "format": "histbak",
  "version": 1,
  "kind": "full",
  "createdAt": 1786000000000,
  "range": { "from": 0, "to": 1786000000000 },
  "counts": { "collected": 920, "kept": 915 },
  "filters": { "stripTracking": true, "stripQuery": false, "excluded": 5 },
  "items": [
    {
      "url": "https://example.com/page",
      "title": "Example",
      "lastVisitTime": 1785999000000,
      "visitCount": 3,
      "typedCount": 0
    }
  ]
}
```

Die Iterationszahl steht in der Datei statt im Code, sodass eine spätere Erhöhung des Standards dich nicht von älteren Sicherungen aussperrt.

## Was die Zahlen bedeuten

Der Browser speichert pro Seite einen Zeitstempel, ihren letzten Besuch, und eine Gesamtzahl der Besuche. Die Zeit jedes einzelnen Besuchs gibt er über die Such-API nicht heraus. Deshalb zählen die zeitbasierten Diagramme Seiten nach ihrem letzten Besuch. Eine 200-mal geöffnete Seite ergibt einen einzigen Punkt, beim letzten Öffnen. Der Gesamtzähler der Besuche ist exakt; alles, was nach Stunde oder Tag gruppiert ist, wird als Seiten und nicht als Besuche bezeichnet.

![Tabellenansicht](docs/screenshots/viewer-table.png)

Jedes Diagramm hat eine Tabellenansicht mit denselben Daten, durchsuchbar und für Screenreader lesbar.

## Einstellungen im Überblick

| Einstellung | Standard | Bedeutung |
| --- | --- | --- |
| `enabled` | `true` | Sicherungen automatisch ausführen |
| `frequency` | `daily` | `hourly`, `daily` oder `weekly` |
| `timeOfDay` | `03:00` | lokale Uhrzeit |
| `dayOfWeek` | `0` | Sonntag, für weekly |
| `runMissedOnStartup` | `true` | nachholen, wenn der Browser geschlossen war |
| `incremental` | `true` | nur Geändertes exportieren |
| `fullBackupEveryDays` | `30` | regelmäßiger vollständiger Snapshot, 0 schaltet ab |
| `maxItemsPerRun` | `100000` | Obergrenze, damit ein Lauf nicht den Speicher erschöpft |
| `compress` | `true` | gzip |
| `encrypt` | `false` | AES-256-GCM |
| `kdfIterations` | `600000` | PBKDF2-Runden |
| `filenameTemplate` | siehe oben | Muster für den Ausgabepfad |
| `keepLastN` | `30` | ältere Sicherungen aufräumen, 0 behält alles |
| `stripTracking` | `true` | `utm_*` und Ähnliches entfernen |
| `stripQuery` | `false` | alle Query-Strings entfernen |
| `stripFragment` | `false` | `#fragments` entfernen |
| `dropTitles` | `false` | URLs ohne Seitentitel speichern |

## Berechtigungen

| Berechtigung | Warum |
| --- | --- |
| `history` | den Verlauf zum Sichern und Anzeigen lesen |
| `downloads` | Sicherungsdateien schreiben und alte aufräumen |
| `storage` | Einstellungen und die nur für die Sitzung gespeicherte Passphrase |
| `alarms` | der Zeitplan |
| `unlimitedStorage` | große Verläufe überschreiten das Standardkontingent |

Keine Host-Berechtigungen, keine Content-Scripts, kein Netzwerkzugriff.

## Projektaufbau

```
src/
  lib/
    crypto.js      AES-GCM + PBKDF2, file header, tamper detection
    compress.js    gzip via CompressionStream
    naming.js      filename templating and path sanitising
    privacy.js     exclude globs, tracking-parameter stripping
    history.js     windowed reads around the search-result cap
    backup.js      the run: collect, filter, compress, encrypt, download
    schedule.js    DST-safe next-run computation
    insights.js    aggregation for the viewer
    restore.js     reading backups back in
    settings.js    defaults and storage
  background/      MV3 service worker: alarms, messages
  popup/           status and manual run
  options/         settings
  viewer/          dashboard
  ui/              shared DOM helpers, charts, stylesheet
```

## Bauen

```bash
npm install
npm run build     # build/chrome and build/firefox, unpacked
npm run dist      # minified, into dist/
npm run build:watch
```

## Tests

```bash
npm test          # 27 unit tests, no browser
npm run test:e2e  # 41 assertions against real Chromium
```

Die Unit-Tests decken das Krypto-Format ab, einschließlich Manipulationserkennung und authentifiziertem Header, dazu gzip-Hin- und -Rückwege, Dateinamenvorlagen und Versuche, den Pfad zu verlassen, sowie die Wiederherstellungswege.

Der End-to-End-Lauf lädt die gebaute Erweiterung, legt Verlauf an und führt echte Sicherungen durch. Er prüft die Dateinamenvorlage gegen das, was bei der Downloads-API tatsächlich angefragt wird, entschlüsselt die erzeugte Datei zurück zum eingegebenen Verlauf, bestätigt, dass ein unveränderter zweiter Lauf nichts schreibt, und bestätigt, dass Verschlüsselung ohne Passphrase nichts schreibt, statt auf Klartext auszuweichen.

`npm run screenshots` erzeugt die Bilder oben neu. Die Viewer-Bilder verwenden künstlichen Verlauf, denn `history.addUrl` setzt immer die aktuelle Zeit, und ein Testprofil kann daher nie die über mehrere Tage verteilten Daten enthalten, für die die Diagramme gedacht sind.

## Bekannte Einschränkungen

Zeitlich gruppierte Diagramme zählen Seiten nach ihrem letzten Besuch, wie oben beschrieben. Zeitstempel pro Besuch gibt es über `history.getVisits` mit einem Aufruf pro URL; `insights.js` hat dafür eine optionale Implementierung, die die Oberfläche noch nicht anbietet.

Wer im Browser Verlauf löscht, löscht ihn nicht aus früheren Sicherungen. Das ist der Sinn einer Sicherung und zugleich ein Risiko, das man kennen sollte.

Surfen im Inkognito-Modus wird von der Verlaufs-API nie erfasst und erscheint daher hier nie.

Firefox braucht für eine dauerhafte Installation eine Signatur über AMO; praktisch bleibt unter Firefox also ein temporäres Add-on, das beim Neustart verschwindet.

Der Viewer hält den abgefragten Zeitraum im Speicher. Sehr große Zeiträume bei langem Verlauf sind langsam, weshalb der Zeitraumfilter standardmäßig auf 30 Tage steht.

## Fehlerbehebung

### Es erscheinen keine Sicherungen

Sieh ins Popup. Es zeigt das letzte Ergebnis, auch übersprungene Läufe wegen fehlender Passphrase oder weil sich nichts geändert hat. Ein geplanter Lauf braucht einen geöffneten Browser zur geplanten Zeit oder eingeschaltetes `runMissedOnStartup`.

### Jeder Lauf meldet „nothing new“

Das ist korrekt, wenn keine neuen Seiten besucht wurden. Mit `Full` im Popup erzwingst du einen vollständigen Snapshot.

### Chrome warnt ständig wegen des Entwicklermodus

Bei einer entpackten Erweiterung unvermeidlich. Die Alternative ist, eine CRX zu packen und selbst zu hosten, was Chrome ebenfalls einschränkt.

### Eine Sicherung lässt sich nicht öffnen

Prüfe die Passphrase und probiere dann das eigenständige Skript oben, um den Viewer als Ursache auszuschließen. GCM kann eine falsche Passphrase nicht von einer beschädigten Datei unterscheiden, daher melden beide denselben Fehler.

## Lizenz

MPL-2.0
