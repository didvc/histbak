[English](README.md) · 日本語 · [Deutsch](README-de.md) · [Français](README-fr.md)

# histbak

ブラウザの閲覧履歴を定期的にバックアップし、その履歴を読みやすく表示するビューアも備えています。すべてローカルで動作します。どこにもアップロードされず、拡張機能は一切ネットワーク通信を行いません。

Chrome と Firefox 対応、Manifest V3、実行時の依存関係なし。

![ビューア](docs/screenshots/viewer.png)

## なぜ作ったか

閲覧履歴は、ブラウザのプロフィールの中で、まともに使えるエクスポート手段もバックアップもまったくない唯一の部分です。プロフィールの破損、ディスクの空き容量不足、再インストールによって、何年分もの履歴が前触れもなく失われます。しかも残った履歴は新しい順に並んだ平坦なリストでしか閲覧できず、実際に知りたいことにはほとんど答えてくれません。

histbak は、履歴を定期的にディスクへ書き出し、目で見て理解できる形で読み戻します。

## 免責事項

これは個人用のソフトウェアで、誰かの役に立つかもしれないと思い公開しています。いかなる保証もありません。何かを任せる前に、このセクションを読んでください。

### これだけではバックアップ戦略になりません

ファイルはダウンロードフォルダ、つまり元のプロフィールと同じディスクに保存されます。ディスクが故障すれば両方とも失われます。履歴が大切なら、出力をどこか別の場所にコピーしてください。

### バックアップを確認してください

ビューアか、下にある単体のスクリプトでバックアップを開き、期待どおりの内容が入っているか確認してください。必要になる前に確認しましょう。必要になってからでは遅すぎます。テストしていないバックアップは、ただの推測です。

### パスフレーズを忘れると復元できません

リセットもヒントも裏口もありません。忘れたパスフレーズで暗号化されたファイルは、永久に読めなくなります。これは見落としではなく、設計上の性質です。

### バックアップには履歴がすべて含まれます

暗号化していない出力はプレーンな JSON で、ファイルを持つ誰でも読めます。ダウンロードフォルダがどこにあるか、クラウドサービスに同期されていないか、ほかに誰がそのマシンを使うかを考えてください。

### 整理機能はファイルを削除します

`keepLastN` を設定すると、古いバックアップがディスクから削除されます。拡張機能自身が付けたファイル名だけを対象にしますが、それでも無人で動く削除処理です。無効にするには 0 を設定します。

### 監査を受けていません

暗号処理は標準的な WebCrypto の機能を一般的な組み合わせで使っており、形式は下に記載し、テストでも確認しています。とはいえ、暗号の専門家によるレビューと同じではありません。

拡張機能は署名されておらず、ストアにも掲載していません。パッケージ化されていない開発者用の拡張機能として動くため、Chrome は起動のたびに警告を表示します。

## インストール

ストアには掲載していません。ビルドして、パッケージ化されていない拡張機能として読み込みます。

```bash
git clone https://github.com/didvc/histbak
cd histbak
npm install
npm run build
```

Chrome、Edge、Brave:

1. `chrome://extensions` を開く
2. デベロッパーモードをオンにする
3. 「パッケージ化されていない拡張機能を読み込む」で `build/chrome` を選ぶ

Firefox:

1. `about:debugging#/runtime/this-firefox` を開く
2. 「一時的なアドオンを読み込む」
3. `build/firefox/manifest.json` を選ぶ

一時的なアドオンは Firefox を再起動すると消えます。恒久的にインストールするには、AMO で署名されたビルドが必要です。

## バックアップ

1回の実行では、履歴を集め、プライバシーフィルターを適用し、期間と件数を含む外枠で結果を包み、圧縮し、必要に応じて暗号化してから、ダウンロードフォルダに書き込みます。

実行はデフォルトで差分方式で、前回から変わった分だけを書き出します。ただし30日ごとに必ず完全なスナップショットも作ります。差分が長く連なっていると、1つが壊れただけでバックアップとして役に立たなくなるからです。

スケジュールには、一定間隔で繰り返すタイマーではなく、実行のたびに設定し直す一回限りのアラームを使います。24時間の固定周期では夏時間の切り替えのたびに実際の時計とずれていき、「毎日 03:00」が少しずつ 02:00 になってしまうからです。予定の時刻にブラウザが閉じていた場合は、次に起動したすぐ後に実行されます。

![設定](docs/screenshots/options.png)

## 暗号化

デフォルトではオフです。オンにする前に理解しておくべき結果があるからです。パスフレーズを忘れると、アーカイブは二度と開けません。

オンにすると、ファイルは AES-256-GCM で暗号化されます。鍵は PBKDF2-SHA-256 で 600,000 回の反復により導出され、これは現在の OWASP の最低基準です。ソルトと IV はファイルごとにランダムです。アルゴリズムと反復回数を持つヘッダーは GCM の追加データとして認証されるので、反復回数を1回だと偽るようにファイルを改ざんしても、攻撃しやすくなるのではなく、復号に失敗します。

パスフレーズはセッションストレージに保持され、ディスクには書き込まれません。ブラウザを閉じると消えます。暗号化がオンなのにパスフレーズが入力されていない場合、予定された実行はスキップされて報告され、黙って平文で書き込まれることはありません。

圧縮は暗号化の前に行います。暗号文は圧縮できないので、逆の順序だと入力より大きなファイルになってしまいます。

![ポップアップ](docs/screenshots/popup.png)

## プライバシーフィルター

ディスクに書き込まれる前に適用され、ビューアにも適用されます。

`utm_*`、`fbclid`、`gclid` などのトラッキング用パラメータは、デフォルトで取り除かれます。キャンペーンや参照元を識別するためのもので、消しても役に立つ情報は失われないからです。オプションでクエリ文字列全体を取り除くこともでき、その場合は検索語も消えます。タイトルを丸ごと除外することもできます。タイトルは URL より多くを明かすことがよくあります。除外パターンに一致する URL はブラウザの外に出ることがなく、`chrome://`、`file://`、`data:` などのローカルのスキームは記録されません。

除外パターンは `*` を使ったグロブで、1行に1つ書き、URL 全体に対して照合されます:

```
*://*.bank*.*/*
*://mail.google.com/*
*://*.onion/*
*://localhost:*/*
```

## ファイル名

バックアップは、テンプレートに従ってダウンロードフォルダの下に書き込まれます:

```
histbak/{YYYY}-{MM}/history-{YYYY}{MM}{DD}-{HH}{mm}-{count}items{ext}
```

| トークン | 意味 |
| --- | --- |
| `{YYYY}` `{YY}` | 年 |
| `{MM}` `{DD}` | 月、日 |
| `{HH}` `{mm}` `{ss}` | 時、分、秒 |
| `{MON}` `{DAY}` | 月と曜日の短縮名 |
| `{TZ}` | UTCオフセット（タイムゾーンをまたいで共有するファイル向け） |
| `{count}` | このバックアップの件数 |
| `{ext}` | 使った処理に合った拡張子 |

すべてローカル時刻で解決されます。スラッシュを入れるとサブフォルダが作られます。テンプレートは無害化されます。`..` を含むパターンでもダウンロードディレクトリの外には出られず、Windows で使えない文字は置き換えられ、`con` のような予約されたデバイス名には接頭辞が付きます。不明なトークンは黙って消されず、そのまま表示されるので、打ち間違いはプレビューですぐにわかります。

## バックアップを読む

ビューアはバックアップファイルを直接開けます。`Open backup…` から1つまたは複数を選ぶと、復号と展開を行い、ライブの履歴と同じグラフで表示します。完全なスナップショットとその後の差分を一緒に開くと統合され、URL ごとに最新のレコードが採用されます。

層の判定はファイルの拡張子ではなく中身で行うので、名前を変えたファイルでも開けます。

## 拡張機能なしでバックアップを開く

書き出したツールでしか読めないバックアップは、人質のようなものです。形式はただの gzip と標準的な AES-GCM なので、このスクリプトを使えば Node だけで復元できます:

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

暗号化していないバックアップなら、さらに簡単です:

```bash
gunzip -c history-20260812-0300-915items.json.gz | jq '.items | length'
```

## バックアップファイルの形式

暗号化していない出力は gzip された JSON です。暗号化した出力では、そのバイト列を 42 バイトのヘッダーで包み、その後にタグを付けた AES-GCM の暗号文が続きます:

| オフセット | バイト数 | フィールド |
| --- | --- | --- |
| 0 | 8 | マジック、`HISTBAK1` |
| 8 | 1 | KDF の ID、1 = PBKDF2-SHA-256 |
| 9 | 1 | 暗号方式の ID、1 = AES-256-GCM |
| 10 | 4 | 反復回数、uint32 ビッグエンディアン |
| 14 | 16 | ソルト |
| 30 | 12 | IV |
| 42 | n | 暗号文、GCM タグ付き |

ヘッダー全体が GCM の追加データとして渡されるので、どの部分を変更しても復号に失敗します。

中身の JSON の外枠:

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

反復回数はコードではなくファイルの中に保存されるので、あとでデフォルトを引き上げても、古いバックアップが開けなくなることはありません。

## 数値の意味

ブラウザは、ページごとに1つのタイムスタンプ（最後に訪問した時刻）と、通算の訪問回数を記録しています。検索 API からは、個々の訪問の時刻は取得できません。そのため、時間軸のグラフは最終訪問でページを数えています。200回開いたページも、最後に開いた時点の1点として数えられます。通算の訪問回数は正確です。時間や日ごとに区切った数は、訪問ではなくページの数として表しています。

![表での表示](docs/screenshots/viewer-table.png)

どのグラフにも同じデータの表での表示があり、検索でき、スクリーンリーダーでも読めます。

## 設定一覧

| 設定 | デフォルト | 意味 |
| --- | --- | --- |
| `enabled` | `true` | 自動でバックアップを実行 |
| `frequency` | `daily` | `hourly`、`daily`、`weekly` |
| `timeOfDay` | `03:00` | ローカルの時刻 |
| `dayOfWeek` | `0` | 日曜日（weekly で使用） |
| `runMissedOnStartup` | `true` | ブラウザが閉じていた分を後から実行 |
| `incremental` | `true` | 変わった分だけを書き出す |
| `fullBackupEveryDays` | `30` | 定期的な完全スナップショット。0 で無効 |
| `maxItemsPerRun` | `100000` | 1回の実行でメモリを使い切らないための上限 |
| `compress` | `true` | gzip |
| `encrypt` | `false` | AES-256-GCM |
| `kdfIterations` | `600000` | PBKDF2 の反復回数 |
| `filenameTemplate` | 上記参照 | 出力パスのパターン |
| `keepLastN` | `30` | 古いバックアップを整理。0 ですべて保持 |
| `stripTracking` | `true` | `utm_*` などを取り除く |
| `stripQuery` | `false` | クエリ文字列をすべて取り除く |
| `stripFragment` | `false` | `#fragments` を取り除く |
| `dropTitles` | `false` | ページタイトルなしで URL を保存 |

## 権限

| 権限 | 理由 |
| --- | --- |
| `history` | バックアップと表示のために履歴を読む |
| `downloads` | バックアップファイルの書き込みと古いファイルの整理 |
| `storage` | 設定と、セッション中だけのパスフレーズ |
| `alarms` | スケジュール |
| `unlimitedStorage` | 大きな履歴はデフォルトの容量を超えるため |

ホスト権限なし、コンテンツスクリプトなし、ネットワークアクセスなし。

## プロジェクト構成

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

## ビルド

```bash
npm install
npm run build     # build/chrome and build/firefox, unpacked
npm run dist      # minified, into dist/
npm run build:watch
```

## テスト

```bash
npm test          # 27 unit tests, no browser
npm run test:e2e  # 41 assertions against real Chromium
```

ユニットテストでは、改ざんの検出と認証されたヘッダーを含む暗号形式、gzip の往復、ファイル名テンプレートとパスの脱出の試み、そして復元の処理を確認しています。

エンドツーエンドの実行では、ビルドした拡張機能を読み込み、履歴を用意して、実際にバックアップを行います。ファイル名テンプレートがダウンロード API に実際に渡される内容と一致するか確認し、作られたファイルを復号して元の履歴に戻ることを確かめ、変化のない2回目の実行では何も書かれないこと、そしてパスフレーズなしで暗号化しようとすると平文にはならず何も書かれないことを確認します。

`npm run screenshots` で上の画像を再生成できます。ビューアの画像には合成した履歴を使っています。`history.addUrl` は常に現在時刻を記録するので、テスト用のプロフィールには、グラフで見せたい数日にわたる履歴をどうしても作れないからです。

## 既知の制限

時間で区切ったグラフは、上で説明したとおり、最終訪問でページを数えます。訪問ごとのタイムスタンプは URL ごとに1回の `history.getVisits` 呼び出しで取得でき、`insights.js` にオプトインの実装がありますが、画面からはまだ使えません。

ブラウザで履歴を削除しても、過去のバックアップからは削除されません。それがバックアップの意味でもあり、知っておくべき危険でもあります。

シークレットモードの閲覧は履歴 API に記録されないので、ここにも現れません。

Firefox で恒久的にインストールするには AMO の署名が必要なので、現実的には再起動で消える一時的なアドオンとして使うことになります。

ビューアは、問い合わせた期間をメモリに保持します。長い履歴で非常に広い期間を指定すると遅くなるため、期間フィルターのデフォルトは30日にしています。

## トラブルシューティング

### バックアップが作られない

ポップアップを確認してください。パスフレーズがなかったためや変化がなかったためにスキップされた実行を含め、最後の結果が表示されます。予定された実行には、その時刻にブラウザが開いているか、`runMissedOnStartup` がオンである必要があります。

### 毎回「nothing new」と表示される

新しいページを訪問していなければ、それが正しい結果です。完全なスナップショットを強制するには、ポップアップの `Full` を使います。

### Chrome がデベロッパーモードの警告を出し続ける

パッケージ化されていない拡張機能では避けられません。代わりの方法は CRX にパッケージ化して自分でホストすることですが、これも Chrome に制限されています。

### バックアップが開けない

パスフレーズを確認してから、ビューアが原因でないか切り分けるために、上の単体スクリプトを試してください。GCM は間違ったパスフレーズと壊れたファイルを区別できないので、どちらも同じ失敗として報告されます。

## ライセンス

MPL-2.0
