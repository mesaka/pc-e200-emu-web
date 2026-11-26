# pc-e200-emu

**PC-G850の同等機PC-E200** のエミュレータ (ブラウザ / Cloudflare Pages の静的サイト)。
PC-G850 用のプログラム (BASIC・機械語) が動くことを目標にしています。

## モード
- **BASIC (ROM不要・標準)**: BASIC インタプリタを JavaScript で実装 (`web/js/basic/`)。LCD は 24桁x6行 (144x48)。
  関数電卓としても使え、`PRINT` なしの式評価 (`ANS`)、`2nd`/`hyp` キーパネル、`M+`/`RM`、`nPr`/`nCr`/`n!` に対応。
  PRINT / INPUT / FOR-NEXT / GOSUB / IF-THEN-ELSE / ON..GOTO / DATA-READ / DIM / 文字列関数 / 三角関数 (DEGREE/RADIAN/GRAD) /
  PRINT USING / PSET・LINE・CIRCLE・GPRINT / BEEP / WAIT / PAUSE / ON ERROR GOTO など。
  画面から直接入力 (直接モード、LIST、NEW、RUN、CONT) も、テキスト欄からの読み込みもできます。
- **機械語 Z80 (ROM不要)**: `.hex` / `.bin` を読み込んで直接実行 (実機の `MON` → `G100` 相当)。64KB を全て RAM とし、LCD (SED1560)、
  キーマトリクス、ポート 0x18 の音声出力 (ブザー / L・R) を再現。**HoustonTracker 2、SAME GAME、シューティング、Reversi、花札850、Rogue (いずれも PC-G850 用) が動作確認済み**
  プログラム本体はリポジトリに同梱していません (各自で用意して読み込みます)。
- **ROMエミュレーション (実験)**: Z80 + 周辺の実装 (`web/js/z80.js`, `machine.js`)。ROM は同梱せず、利用者が読み込む必要があります。

## テスト
```
npm test                          # 下記すべて (ZEXDOC は tests/fixtures/zexdoc.com があるときのみ、約2分)
node tests/basic.test.mjs         # BASIC インタプリタ / 関数電卓
node tests/machine.test.mjs       # ROMモードの配線テスト(合成ROM)
node tests/iocs.test.mjs          # システムコールのエミュレーション
GAMES_DIR=<dir> node tests/games.test.mjs   # 実ゲーム5本 (別途用意したファイル。無ければスキップ)
```

## デプロイ
`npm run deploy` (wrangler pages deploy web)

## 互換性について
BASIC は実機ファームの再現ではなく、言語仕様に基づく実装です。未検証の挙動 (FOR の初回判定、RND の仕様、
数値表示の細部、エラー番号など) は `SPEC.md` の一覧を参照してください。

## ZEXDOC
`tests/fixtures/zexdoc.com` (CP/M の Z80 命令テスト、GPL) はリポジトリに含めていません。実行するには各自で配置してください。無い場合はスキップされます。
