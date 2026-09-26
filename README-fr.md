[English](README.md) · [日本語](README-ja.md) · [Deutsch](README-de.md) · Français

# histbak

Des sauvegardes planifiées de votre historique de navigation, avec une visionneuse qui le rend lisible. Tout fonctionne en local. Rien n’est envoyé nulle part, et l’extension ne fait absolument aucune requête réseau.

Chrome et Firefox, Manifest V3, aucune dépendance à l’exécution.

![La visionneuse](docs/screenshots/viewer.png)

## Pourquoi

L’historique est la seule partie d’un profil de navigateur qui n’a ni export digne de ce nom ni sauvegarde. Un profil corrompu, un disque plein ou une réinstallation en emportent des années sans prévenir. Et l’historique qui survit ne se consulte que sous forme de liste plate, du plus récent au plus ancien, qui ne répond à presque aucune des questions qu’on voudrait lui poser.

histbak écrit l’historique sur le disque selon un planning, et le relit sous une forme qu’on peut vraiment regarder.

## Avertissement

Il s’agit d’un logiciel personnel, publié au cas où il servirait à quelqu’un d’autre. Il n’offre aucune garantie. Lisez cette section avant de lui confier quoi que ce soit.

### Ce n’est pas une stratégie de sauvegarde à lui seul

Les fichiers arrivent dans votre dossier de téléchargements, sur le même disque que le profil dont ils viennent. Une panne de disque emporte les deux. Si l’historique compte pour vous, copiez la sortie ailleurs.

### Vérifiez vos sauvegardes

Ouvrez-en une dans la visionneuse, ou avec le script autonome plus bas, et vérifiez qu’elle contient ce que vous attendez. Faites-le avant d’en avoir besoin, pas après. Une sauvegarde non testée n’est qu’une supposition.

### Une phrase de passe perdue est irrécupérable

Il n’y a ni réinitialisation, ni indice, ni porte dérobée. Les fichiers chiffrés avec une phrase de passe oubliée sont définitivement illisibles. C’est une propriété de la conception, pas un oubli.

### Les sauvegardes contiennent tout votre historique

Une sortie non chiffrée est du JSON brut que toute personne ayant le fichier peut lire. Pensez à l’emplacement du dossier de téléchargements, à sa synchronisation éventuelle avec un service cloud et aux autres utilisateurs de la machine.

### Le nettoyage supprime des fichiers

Quand `keepLastN` est défini, les anciennes sauvegardes sont supprimées du disque. Seuls les noms de fichiers de l’extension sont visés, mais cela reste une suppression qui tourne sans surveillance. Mettez 0 pour désactiver.

### Non audité

La cryptographie utilise des primitives WebCrypto standard dans un agencement classique, et le format est documenté plus bas et couvert par des tests. Ce n’est pas la même chose qu’une relecture par un cryptographe.

L’extension n’est ni signée ni publiée. Elle tourne comme extension de développement non empaquetée, ce dont Chrome avertit à chaque démarrage.

## Installation

Pas de page sur le store. Compilez-la et chargez-la non empaquetée.

```bash
git clone https://github.com/didvc/histbak
cd histbak
npm install
npm run build
```

Chrome, Edge, Brave :

1. Ouvrir `chrome://extensions`
2. Activer le mode développeur
3. « Charger l’extension non empaquetée » et choisir `build/chrome`

Firefox :

1. Ouvrir `about:debugging#/runtime/this-firefox`
2. « Charger un module complémentaire temporaire »
3. Choisir `build/firefox/manifest.json`

Un module temporaire disparaît au redémarrage de Firefox. Une installation permanente demande une version signée via AMO.

## Sauvegardes

Une exécution collecte l’historique, applique les filtres de confidentialité, emballe le résultat dans une enveloppe indiquant sa période et ses totaux, le compresse, le chiffre éventuellement et l’écrit dans votre dossier de téléchargements.

Les exécutions sont incrémentales par défaut : chacune n’exporte que ce qui a changé depuis la précédente. Un instantané complet est tout de même créé tous les 30 jours, car une longue chaîne de deltas dont un maillon est abîmé n’est pas une sauvegarde.

La planification utilise des alarmes ponctuelles réarmées après chaque exécution, plutôt qu’un intervalle répété. Une période fixe de 24 heures se décale de l’heure réelle à chaque changement d’heure, si bien que `03:00 daily` finirait par devenir 02:00. Si le navigateur était fermé à l’heure prévue, l’exécution a lieu peu après le lancement suivant.

![Réglages](docs/screenshots/options.png)

## Chiffrement

Désactivé par défaut, car l’activer a une conséquence qu’il vaut mieux comprendre d’abord : une phrase de passe oubliée, c’est une archive perdue.

Une fois activé, les fichiers sont chiffrés en AES-256-GCM avec une clé dérivée par PBKDF2-SHA-256 en 600 000 itérations, le plancher actuel de l’OWASP. Le sel et l’IV sont aléatoires pour chaque fichier. L’en-tête portant l’algorithme et le nombre d’itérations est authentifié comme données additionnelles GCM : un fichier modifié pour annoncer une seule itération échoue au déchiffrement au lieu de devenir facile à attaquer.

La phrase de passe est conservée dans le stockage de session et jamais écrite sur le disque. Elle est perdue à la fermeture du navigateur. Une exécution planifiée avec le chiffrement activé mais sans phrase de passe saisie est ignorée et signalée, jamais écrite en clair en silence.

La compression a lieu avant le chiffrement. Un texte chiffré ne se compresse pas, donc l’ordre inverse produirait des fichiers plus gros que l’entrée.

![Fenêtre contextuelle](docs/screenshots/popup.png)

## Filtres de confidentialité

Appliqués avant que quoi que ce soit n’atteigne le disque, et aussi dans la visionneuse.

Les paramètres de suivi comme `utm_*`, `fbclid` et `gclid` sont retirés par défaut, car ils identifient des campagnes et des référents sans rien apporter d’utile. En option, toute la chaîne de requête peut disparaître, ce qui retire aussi les termes de recherche. Les titres peuvent être entièrement supprimés ; ils en disent souvent plus que l’URL. Les URL qui correspondent à vos motifs d’exclusion ne quittent jamais le navigateur, et les schémas locaux comme `chrome://`, `file://` et `data:` ne sont jamais enregistrés.

Les motifs d’exclusion sont des globs avec `*`, un par ligne, comparés à l’URL entière :

```
*://*.bank*.*/*
*://mail.google.com/*
*://*.onion/*
*://localhost:*/*
```

## Nommage des fichiers

Les sauvegardes sont écrites dans votre dossier de téléchargements selon un modèle :

```
histbak/{YYYY}-{MM}/history-{YYYY}{MM}{DD}-{HH}{mm}-{count}items{ext}
```

| Jeton | Signification |
| --- | --- |
| `{YYYY}` `{YY}` | année |
| `{MM}` `{DD}` | mois, jour |
| `{HH}` `{mm}` `{ss}` | heure, minute, seconde |
| `{MON}` `{DAY}` | noms courts du mois et du jour |
| `{TZ}` | décalage UTC, pour les fichiers partagés entre fuseaux horaires |
| `{count}` | nombre d’éléments dans cette sauvegarde |
| `{ext}` | extension correspondant au traitement utilisé |

Tout est résolu en heure locale. Les barres obliques créent des sous-dossiers. Les modèles sont assainis : un motif contenant `..` ne peut pas sortir du dossier de téléchargements, les caractères interdits sous Windows sont remplacés, et les noms de périphériques réservés comme `con` reçoivent un préfixe. Les jetons inconnus restent visibles au lieu d’être supprimés en silence, si bien qu’une faute de frappe saute aux yeux dans l’aperçu.

## Lire une sauvegarde

La visionneuse ouvre directement les fichiers de sauvegarde. Choisissez-en un ou plusieurs via `Open backup…` : elle les déchiffre, les décompresse et les affiche avec les mêmes graphiques que l’historique en direct. Ouvrir un instantané complet avec les incréments qui ont suivi les fusionne, l’enregistrement le plus récent de chaque URL l’emportant.

Les couches sont détectées par leur contenu et non par l’extension du fichier, donc un fichier renommé s’ouvre quand même.

## Ouvrir une sauvegarde sans l’extension

Une sauvegarde qu’on ne peut lire qu’avec l’outil qui l’a écrite est un otage. Le format est du gzip ordinaire et de l’AES-GCM standard, donc ce script en récupère une avec rien d’autre que Node :

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

Une sauvegarde non chiffrée demande encore moins :

```bash
gunzip -c history-20260812-0300-915items.json.gz | jq '.items | length'
```

## Format des fichiers de sauvegarde

La sortie non chiffrée est du JSON compressé en gzip. La sortie chiffrée emballe ces octets dans un en-tête de 42 octets suivi du texte chiffré AES-GCM, étiquette ajoutée à la fin :

| Décalage | Octets | Champ |
| --- | --- | --- |
| 0 | 8 | magique, `HISTBAK1` |
| 8 | 1 | id du KDF, 1 = PBKDF2-SHA-256 |
| 9 | 1 | id du chiffrement, 1 = AES-256-GCM |
| 10 | 4 | nombre d’itérations, uint32 gros-boutiste |
| 14 | 16 | sel |
| 30 | 12 | IV |
| 42 | n | texte chiffré, étiquette GCM ajoutée |

L’en-tête entier est passé en données additionnelles GCM, donc aucune partie ne peut être modifiée sans faire échouer le déchiffrement.

L’enveloppe JSON à l’intérieur :

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

Le nombre d’itérations est stocké dans le fichier et non dans le code, donc relever la valeur par défaut plus tard ne vous empêchera pas d’ouvrir les anciennes sauvegardes.

## Ce que signifient les chiffres

Le navigateur enregistre un horodatage par page, celui de sa visite la plus récente, et un nombre total de visites. Il n’expose pas l’heure de chaque visite via l’API de recherche. Les graphiques temporels comptent donc les pages selon leur dernière visite. Une page ouverte 200 fois compte pour un seul point, à sa dernière ouverture. Le compteur total de visites est exact ; tout ce qui est regroupé par heure ou par jour est décrit en pages plutôt qu’en visites.

![Vue en tableau](docs/screenshots/viewer-table.png)

Chaque graphique a une vue en tableau sur les mêmes données, consultable par recherche et lisible par un lecteur d’écran.

## Référence des réglages

| Réglage | Défaut | Signification |
| --- | --- | --- |
| `enabled` | `true` | lancer les sauvegardes automatiquement |
| `frequency` | `daily` | `hourly`, `daily` ou `weekly` |
| `timeOfDay` | `03:00` | heure locale |
| `dayOfWeek` | `0` | dimanche, utilisé par weekly |
| `runMissedOnStartup` | `true` | rattraper après une fermeture du navigateur |
| `incremental` | `true` | n’exporter que ce qui a changé |
| `fullBackupEveryDays` | `30` | instantané complet périodique, 0 désactive |
| `maxItemsPerRun` | `100000` | plafond pour qu’une exécution n’épuise pas la mémoire |
| `compress` | `true` | gzip |
| `encrypt` | `false` | AES-256-GCM |
| `kdfIterations` | `600000` | itérations PBKDF2 |
| `filenameTemplate` | voir plus haut | modèle du chemin de sortie |
| `keepLastN` | `30` | nettoyer les anciennes sauvegardes, 0 garde tout |
| `stripTracking` | `true` | retirer `utm_*` et similaires |
| `stripQuery` | `false` | retirer toutes les chaînes de requête |
| `stripFragment` | `false` | retirer les `#fragments` |
| `dropTitles` | `false` | enregistrer les URL sans titre de page |

## Autorisations

| Autorisation | Pourquoi |
| --- | --- |
| `history` | lire l’historique pour le sauvegarder et l’afficher |
| `downloads` | écrire les fichiers de sauvegarde et nettoyer les anciens |
| `storage` | les réglages, et la phrase de passe limitée à la session |
| `alarms` | le planning |
| `unlimitedStorage` | les gros historiques dépassent le quota par défaut |

Aucune autorisation d’hôte, aucun script de contenu, aucun accès réseau.

## Organisation du projet

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

## Compilation

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

Les tests unitaires couvrent le format cryptographique, y compris la détection de falsification et l’en-tête authentifié, les allers-retours gzip, les modèles de nom de fichier et les tentatives de sortie du chemin, ainsi que les chemins de restauration.

Le test de bout en bout charge l’extension compilée, crée de l’historique et réalise de vraies sauvegardes. Il vérifie le modèle de nom de fichier par rapport à ce qui est réellement demandé à l’API de téléchargements, déchiffre le fichier produit pour retrouver l’historique d’origine, confirme qu’une deuxième exécution sans changement n’écrit rien, et confirme qu’un chiffrement sans phrase de passe n’écrit rien au lieu de retomber sur du texte clair.

`npm run screenshots` régénère les images ci-dessus. Celles de la visionneuse utilisent un historique synthétique, car `history.addUrl` enregistre toujours l’heure actuelle, et un profil de test ne peut donc jamais contenir la répartition sur plusieurs jours pour laquelle les graphiques sont faits.

## Limites connues

Les graphiques regroupés dans le temps comptent les pages selon leur dernière visite, comme expliqué plus haut. Les horodatages de chaque visite sont disponibles via `history.getVisits`, à raison d’un appel par URL ; `insights.js` en contient une implémentation optionnelle que l’interface n’expose pas encore.

Supprimer l’historique dans le navigateur ne le supprime pas des sauvegardes passées. C’est tout l’intérêt d’une sauvegarde, et aussi un risque à connaître.

La navigation privée n’est jamais enregistrée par l’API d’historique, elle n’apparaît donc jamais ici.

Firefox exige une signature AMO pour une installation permanente ; en pratique, sous Firefox, on passe donc par un module temporaire qui disparaît au redémarrage.

La visionneuse garde en mémoire la période demandée. Les très grandes périodes sur un long historique sont lentes, c’est pourquoi le filtre de période est réglé sur 30 jours par défaut.

## Dépannage

### Aucune sauvegarde n’apparaît

Regardez la fenêtre contextuelle. Elle affiche le dernier résultat, y compris les exécutions ignorées faute de phrase de passe ou parce que rien n’avait changé. Une exécution planifiée exige que le navigateur soit ouvert à l’heure prévue, ou que `runMissedOnStartup` soit activé.

### Chaque exécution indique « nothing new »

C’est normal si aucune nouvelle page n’a été visitée. Utilisez `Full` dans la fenêtre contextuelle pour forcer un instantané complet.

### Chrome avertit sans cesse au sujet du mode développeur

Inévitable pour une extension non empaquetée. L’alternative est d’empaqueter et d’héberger soi-même un CRX, ce que Chrome restreint aussi.

### Une sauvegarde ne s’ouvre pas

Vérifiez la phrase de passe, puis essayez le script autonome ci-dessus pour écarter la visionneuse. GCM ne sait pas distinguer une mauvaise phrase de passe d’un fichier abîmé, les deux signalent donc le même échec.

## Licence

MPL-2.0
