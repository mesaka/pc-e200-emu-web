---
title: ROMなしでPC-G850同等機(PC-E200)のポケコンエミュレータをブラウザ向けに作り、BASICでマインスイーパーを動かした
tags:
  - JavaScript
  - Z80
  - エミュレータ
  - BASIC
  - ポケコン
private: false
---

<!-- 公開前に埋める: デモURL / 実機での確認有無 -->

## はじめに

https://note.com/lain2772/n/n1141a5c91cd6 の記事を読んで、自分も所有しているPC-E200のWeb版のエミュレータが作りたいと思い、作ってみました。（ただし、実装は、Claude Code）

**ROM なし**・ブラウザだけで動く形にして、その上で動く **マインスイーパー (BASIC, 75行)** も書きました。

- マインスイーパー: https://github.com/mesaka/minesweeper-emu (MIT)
<!-- エミュレータ本体のリポジトリ(pc-e200-emu)を公開するなら、ここにリンクを追加 -->

### 使用させていただいたもの

- **きっかけの記事**: [lain2772 様の note 記事](https://note.com/lain2772/n/n1141a5c91cd6)。この記事を読んで作りたいと思いました。記事のコードは使っていません。
- **Z80 コア**: Claude Code が一から実装したものです (他のZ80エミュレータのコードは使っていません)。命令テスト ZEXDOC で検証しています。
- **ハードウェア仕様**: MAME の `src/mame/sharp/pce220.cpp` (BSD-3-Clause) の記述を参考にしました。
- **PC-G850用のゲーム**: 「Version 0」様のサイト (https://ver0.sakura.ne.jp/g800/) からダウンロードさせていただき、試用させていただきました。ゲーム本体は本記事のリポジトリには含めていません。

![プレイ中の画面](https://raw.githubusercontent.com/mesaka/minesweeper-emu/main/images/screenshot.png)
<!-- ↑ Qiita では画像をアップロードし直すのが確実です -->

先に断っておくと、**実機ROMでの照合はしていません**。仕様は MAME の記述、公開されているデータシート、そして PC-G850 向けの公開ソースの呼び出し箇所からの推定です。未検証の点は後半にまとめます。

## PC-E200 / PC-G850 の概要

シャープのZ80搭載ポケットコンピュータ(ポケコン)です。このエミュレータは、PC-E200 を **PC-G850 の同等機** として扱い、仕様は PC-G850 系 (G850V) を基準にしています。

### エミュレータが前提にしているスペック (PC-G850V 基準)

| 項目 | 内容 |
|---|---|
| CPU | Z80 (エミュレータの既定クロック 8MHz) |
| メモリ | RAM 64KB (内蔵32KB + 外部32KB) を想定。16KB x 4 ウィンドウのバンク構成 |
| 表示 | 液晶 144x48 ドット (24桁 x 6行)。コントローラは SED1560 (ポート 0x40 / 0x41) |
| 文字フォント | 5x7 ドットの ASCII (本エミュレータ側で用意したもの) |
| 入力 | キーマトリクス (ポート 0x10〜0x13)、ON キー |
| 音 | ブザー (ポート 0x18 の bit7)。リンク端子 (11ピン) では L / R の出力も可能 |
| 割り込み | Z80 IM1。タイマ周期 468ms |
| BASIC | シャープ系ポケコン BASIC (本エミュレータは言語仕様に基づく独自実装) |

出典は MAME の `src/mame/sharp/pce220.cpp` (BSD-3-Clause) と、PC-G850 向けの公開プログラム・ドキュメントです。

### 同系統機との違い (MAME の記述より)

| 機種 | CPU | LCD |
|---|---|---|
| PC-E220 | Z80 3.072MHz | HD61202, 144x32 |
| PC-G815 | Z80 3.072MHz | HD61202 x2 |
| PC-G850V | Z80 8MHz | SED1560, 144x48 |

### 注意: PC-E200 固有の仕様は未確認です

MAME に PC-E200 は無く、**PC-G850 との差分は確認できていません**。たとえば、PC-G850 用のプログラムの中には「6行表示を使うので PC-E200 には非対応」と明記しているもの
([Version 0 様のサイト](https://ver0.sakura.ne.jp/g800/) の Pocket BlackJack の説明) があり、表示行数などが PC-G850 と同じとは限りません。
PC-E200 向けのプログラムを動かす場合は、実機との差に注意してください。

<!-- TODO: 実機(PC-E200)の取扱説明書で確認できる値を追記する。例: 表示桁数・行数、RAMサイズ、クロック、発売時期 -->

## なぜ ROM なしなのか

ポケコンのエミュレータは、通常は実機 ROM を吸い出して読み込ませます。ROM は配布できないので、「開いてすぐ試せる」ものにはなりません。

そこで、ROM が担っている役割を **JavaScript で肩代わり** する方針にしました。静的サイトなので Cloudflare Pages にそのまま置けます (`wrangler pages deploy web`)。

## 構成: 3つのモード

| モード | ROM | 概要 |
|---|---|---|
| BASIC | 不要 | BASIC インタプリタを JS で自作。関数電卓としても使える |
| 機械語 Z80 | 不要 | `.hex` / `.bin` を読み込んで直接実行 (実機の `MON` → `G100` 相当) |
| ROMエミュレーション (実験) | ユーザーが読み込む | Z80 + 周辺回路を実装。ROMは同梱しない |

ファイル構成はこうなっています。

```
web/js/
  basic/interp.js   # BASIC インタプリタ (約860行)
  basic/screen.js   # 24桁x6行テキスト + 144x48 グラフィック
  basic/machine.js  # 入力・RUN・LIST などの"本体"
  z80.js            # Z80 コア
  machine.js        # 64KB メモリ + I/O ポート
  lcd.js            # SED1560 / HD61202
  iocs.js           # システムコールの肩代わり
  audio.js          # ポート0x18 → PCM
```

## BASIC モード: 実機ファームの再現ではなく「言語仕様に基づく実装」

LCD は 24桁 x 6行 (144x48ドット)。1文字は 6x8 ドットで、文字とドット単位のグラフィック (`PSET` / `LINE` / `CIRCLE`) が 1 枚のフレームバッファを共有します。

対応している主な機能は `PRINT` / `INPUT` / `FOR-NEXT` / `GOSUB` / `IF-THEN-ELSE` / `ON..GOTO` / `DATA-READ` / `DIM` / 文字列関数 / 三角関数 (DEGREE/RADIAN/GRAD) / `PRINT USING` / `BEEP` / `ON ERROR GOTO` などです。

### 字句解析: キーワード最長一致

Sharp 系 BASIC は `FORI=1TO5` のように空白なしで書けるので、変数名とキーワードの切り分けが必要です。キーワード表を長い順に並べ、先頭一致で拾っています。

```js
const KEYWORDS = [ 'PRINT', 'INPUT', 'GOTO', ... ].sort((a, b) => b.length - a.length);

// ...
const up = src.slice(i).toUpperCase();
const kw = KEYWORDS.find(k => up.startsWith(k));
```

そのため **変数名にキーワードを含められません** (実機と同じ方針にしたつもりですが、照合はしていません)。`TO` や `ON` や `OR` などを含む変数名は使えないので、プログラムを書くときは注意が必要です。

### 関数電卓: 行番号か式かの判定

ポケコンは電源を入れるとそのまま計算できます。`2+3*4` と打てば結果が出て、`10 PRINT 5` ならプログラム行です。

- 数字のあとが文の開始 → プログラム行
- そうでなければ電卓の式 (`5 NPR 2` や `2+3`)
- `ANS` は直前の結果。`*` `/` `^` で始まる式は `ANS` から継続 (`6` → `*7` = 42)

`2nd` / `hyp` キーパネル、`M+` / `RM`、`nPr` / `nCr` / `n!` も実装しました。

## 機械語 Z80 モード

こちらは「本物のCPUを動かす」側です。

- 64KB を **すべて RAM** にし、リセット時にプログラムを書き戻して PC=0x100、SP=0xFFFE から実行します。0x0000 には `HALT` を置いてあり、プログラムが `RET` で終わると止まります。
- Z80 コアは ZEXDOC (CP/M の命令テスト) で検証できるようにしてあります。ZEXDOC 本体は GPL のため同梱せず、`tests/fixtures/zexdoc.com` に置いたときだけ走ります (約2分)。

### LCD (SED1560) のダミーリード

SED1560 のデータ読み出しは、アドレスを設定した直後の1回目が **古いラッチ値** を返します。エミュレータ側でこれを再現しないと、HoustonTracker 2 のカーソル描画が壊れます。

```js
read(rs) {
  if (rs === 0) return this.on ? 0x00 : 0x20; // status: not busy
  // Data reads go through a latch: the first read after setting an address returns the stale latch.
  const v = this.latch;
  this.latch = this.vram[this.page * 256 + (this.col & 0xff)];
  ...
  return v;
}
```

### 1ビット音源をそのまま PCM にする

ブザーはポート 0x18 の bit7 を叩くだけの 1 ビット出力です。HoustonTracker 2 のような 1 ビット音源プレイヤーは、パルスの密度で音量を混ぜています。

そこで「ポートへの書き込みを **サイクル時刻つき** で記録し、出力サンプルごとに時間加重平均する」ことにしました。こうすると、パルス密度ミックスが追加の処理なしでそのまま混ざった音になります。

```js
// 出力1サンプル分の区間で、0/1 だった時間の割合を積分している
al += cl * (et - pos);
...
const xl = al / cps;
```

クロックは 8MHz にしています。HoustonTracker 2 でノート C を鳴らすと約 2104Hz で、C7 (2093Hz) にほぼ一致しました。3.072MHz だと合いませんでした。動作確認で、この周波数を測定しました。

## ROMなしでゲームを動かす: システムコールを JS で肩代わり

PC-G850 のゲームは、キー入力や文字表示を ROM 内のシステムコール (0xBC00〜0xBFFF 付近) に頼っています。ROM がないので、**その番地に CPU のアドレスフックを仕掛け、JS で処理してから `RET` する** ことにしました (`web/js/iocs.js`)。

```js
table.set(0xbe53, c => { // INKEY
  const k = scanKeys(m); c.r8[7] = k.code; setCarry(c, k.pressed); ret(c); return 120;
});
```

| アドレス | 名称 | 役割 |
|---|---|---|
| 0xBE53 | INKEY | 押されていれば CY=1、A=スキャンコード |
| 0xBCFD | GETKEY | 新しい押下まで待つ |
| 0xBE62 / 0xBE5F | PUTCHR | 1文字表示 |
| 0xBFEE | PUTCHRS | 同じ文字を B 個 |
| 0xBFF1 | PUTSTR | 文字列表示 |
| 0xBFD0 | PUTPAT | LCD の列データを直接書く |

仕様は、これらを呼んでいる公開ソース (`rogue.h` の `_inkey` `_getkey` `_putchrs` など) から **推定** したものです。上記以外の 0xBC00〜0xBFFF への呼び出しは記録して即 `RET` し、UI に「未実装のシステムコール」と出します。

これで **SAME GAME / シューティング / Reversi / 花札850 / Rogue** (いずれも PC-G850 用) が起動し、描画とキー操作ができることを自動テストで確認しています。動作確認に使ったゲームは [Version 0](https://ver0.sakura.ne.jp/g800/) 様のサイトからダウンロードさせていただいたもので、ライセンスが様々なためリポジトリには含めていません。

花札850 は 4 階調で描くので、LCD は 120Hz (エミュレート時間) でサンプリングして **直近4回を平均** し、グレーを作っています。液晶の残像を利用した擬似階調をそのまま再現する形です。

## マインスイーパー (BASIC 75行)

ここからが本題です。24桁 x 6行という画面で遊べるようにしました。

### 画面設計

- 盤面は **11列 x 5行、地雷8個**。最下行は状態表示 (`MINES: n`)。
- 1マスは **2文字幅** にしています。`11 x 2 = 22` 桁に、右端のカーソル用の1桁を足して 23 桁で収まります。
- カーソルは、選択マスの **左右の空白に `[` と `]` を描く** ことで表現しました。専用の反転表示がなくても、数字の両側が括弧になるので見分けられます。

| 表示 | 意味 |
|---|---|
| `#` | 未開封 |
| `.` | 周囲に地雷なし |
| `1`〜`8` | 周囲の地雷数 |
| `F` | 旗 |
| `*` | 地雷 (ゲームオーバー時) |

### データ構造

```basic
20 DIM M(10,4),S(10,4),N(10,4),ZX(60),ZY(60)
```

| 配列 | 役割 |
|---|---|
| `M(x,y)` | 地雷があれば 1 |
| `N(x,y)` | 周囲の地雷数 |
| `S(x,y)` | 状態 (0=未開封 / 1=開封済 / 2=旗 / 3=展開待ち) |
| `ZX, ZY` | 連鎖展開用のスタック |

### 初手を必ず安全にする

地雷は **最初に開いたとき** に配置します。クリック位置とその周囲 8 マス (`ABS(A-X)<2 AND ABS(B-Y)<2`) を避けるだけで、初手が地雷になることも、初手が数字マスになることもなくなります。

```basic
310 IF P=0 THEN GOSUB 500:P=1
...
500 Z=0
510 A=INT(RND(1)*11):B=INT(RND(1)*5)
520 IF M(A,B)=1 THEN 510
530 IF ABS(A-X)<2 AND ABS(B-Y)<2 THEN 510
540 M(A,B)=1:Z=Z+1:IF Z<K THEN 510
```

配置後に、周囲 8 マスを数えて `N` を埋めます (550〜580行)。

### 連鎖展開は再帰ではなく自前スタック

「0 のマスを開いたら隣を開く」は普通は再帰で書きますが、BASIC の `GOSUB` の深さには限りがあるはずなので、**明示的なスタック** (`ZX`, `ZY`) で書きました。1000〜1100行です。

```basic
1000 ZP=1:ZX(0)=X:ZY(0)=Y:S(X,Y)=3
1010 IF ZP=0 THEN RETURN
1020 ZP=ZP-1:I=ZX(ZP):J=ZY(ZP)
1030 S(I,J)=1:O=O+1
1040 IF N(I,J)>0 THEN 1010
1050 FOR U=-1 TO 1:FOR V=-1 TO 1
1060 A=I+U:B=J+V
1070 IF A<0 OR A>10 OR B<0 OR B>4 THEN 1090
1080 IF S(A,B)=0 THEN S(A,B)=3:ZX(ZP)=A:ZY(ZP)=B:ZP=ZP+1
1090 NEXT V:NEXT U
1100 GOTO 1010
```

ポイントは、**積む時点で状態を 3 (展開待ち) にする** ことです。これで同じマスを二重に積まず、スタックの最大が 55 マス以内に収まるので `ZX(60)` で足ります。旗 (状態 2) のマスは `S=0` ではないので、展開が旗を越えて開くこともありません。

### クリア判定

開いたマスの数 `O` を数えておき、`O=55-K` (55マス − 地雷8) になればクリアです (340行)。

### 描画は「変わった行だけ」

全画面を毎回描き直すのは重そうなので、カーソルが動いたときは **移動前と移動後の2行だけ** (`J=OY:GOSUB 600:J=Y:GOSUB 600`)、旗を立てたときは1行だけ再描画しています。描画量を減らす狙いです (速度の効果は計測していません)。

### 全コード

```basic
10 REM MINESWEEPER 11X5 8 MINES
20 DIM M(10,4),S(10,4),N(10,4),ZX(60),ZY(60)
30 K=8:CLS:RANDOM
40 PRINT "    MINESWEEPER":PRINT "ARROW/WASD:MOVE":PRINT "SPACE/Z:OPEN F/X:FLAG":PRINT "PRESS ANY KEY"
50 A$=INKEY$:IF A$="" THEN 50
60 FOR I=0 TO 10:FOR J=0 TO 4:M(I,J)=0:S(I,J)=0:N(I,J)=0:NEXT J:NEXT I
70 X=5:Y=2:F=0:O=0:P=0:E=0:CLS:GOSUB 950:GOSUB 900
100 A$=INKEY$:IF A$="" THEN 100
110 C=ASC(A$):IF C>96 THEN C=C-32
120 OX=X:OY=Y
130 IF C=28 OR C=68 THEN X=X+1
140 IF C=29 OR C=65 THEN X=X-1
150 IF C=30 OR C=87 THEN Y=Y-1
160 IF C=31 OR C=83 THEN Y=Y+1
170 IF X<0 THEN X=10
180 IF X>10 THEN X=0
190 IF Y<0 THEN Y=4
195 IF Y>4 THEN Y=0
200 IF X<>OX OR Y<>OY THEN J=OY:GOSUB 600:J=Y:GOSUB 600:GOTO 100
210 IF C=32 OR C=90 THEN 300
220 IF C=70 OR C=88 THEN 400
230 IF C=82 THEN 60
240 GOTO 100
300 IF S(X,Y)<>0 THEN 100
310 IF P=0 THEN GOSUB 500:P=1
320 IF M(X,Y)=1 THEN 700
330 GOSUB 1000:GOSUB 950:GOSUB 900
340 IF O=55-K THEN 750
350 GOTO 100
400 IF S(X,Y)=1 THEN 100
410 IF S(X,Y)=0 THEN S(X,Y)=2:F=F+1:GOTO 430
420 S(X,Y)=0:F=F-1
430 J=Y:GOSUB 600:GOSUB 900:GOTO 100
500 Z=0
510 A=INT(RND(1)*11):B=INT(RND(1)*5)
520 IF M(A,B)=1 THEN 510
530 IF ABS(A-X)<2 AND ABS(B-Y)<2 THEN 510
540 M(A,B)=1:Z=Z+1:IF Z<K THEN 510
550 FOR I=0 TO 10:FOR J=0 TO 4:C=0
560 FOR U=-1 TO 1:FOR V=-1 TO 1:A=I+U:B=J+V
570 IF A>=0 AND A<=10 AND B>=0 AND B<=4 THEN C=C+M(A,B)
580 NEXT V:NEXT U:N(I,J)=C:NEXT J:NEXT I:RETURN
600 R$=""
610 FOR I=0 TO 10
620 L$=" ":IF J=Y AND I=X THEN L$="["
630 IF J=Y AND I=X+1 THEN L$="]"
640 GOSUB 800:R$=R$+L$+C$
650 NEXT I
660 L$=" ":IF J=Y AND X=10 THEN L$="]"
670 LOCATE 0,J:PRINT R$;L$;:RETURN
700 E=1:GOSUB 950:LOCATE 0,5:PRINT "BOOM! ANY KEY:RETRY";:BEEP 1
710 A$=INKEY$:IF A$="" THEN 710
720 GOTO 60
750 FOR I=0 TO 10:FOR J=0 TO 4:IF M(I,J)=1 THEN S(I,J)=2
760 NEXT J:NEXT I:F=K:GOSUB 950:LOCATE 0,5:PRINT "CLEARED! ANY KEY";:BEEP 2
770 A$=INKEY$:IF A$="" THEN 770
780 GOTO 60
800 IF E=1 AND M(I,J)=1 THEN C$="*":RETURN
810 IF S(I,J)=2 THEN C$="F":RETURN
820 IF S(I,J)=0 THEN C$="#":RETURN
830 IF N(I,J)=0 THEN C$=".":RETURN
840 C$=STR$(N(I,J)):RETURN
900 LOCATE 0,5:PRINT "MINES: ";K-F;"      ";:RETURN
950 FOR J=0 TO 4:GOSUB 600:NEXT J:RETURN
1000 ZP=1:ZX(0)=X:ZY(0)=Y:S(X,Y)=3
1010 IF ZP=0 THEN RETURN
1020 ZP=ZP-1:I=ZX(ZP):J=ZY(ZP)
1030 S(I,J)=1:O=O+1
1040 IF N(I,J)>0 THEN 1010
1050 FOR U=-1 TO 1:FOR V=-1 TO 1
1060 A=I+U:B=J+V
1070 IF A<0 OR A>10 OR B<0 OR B>4 THEN 1090
1080 IF S(A,B)=0 THEN S(A,B)=3:ZX(ZP)=A:ZY(ZP)=B:ZP=ZP+1
1090 NEXT V:NEXT U
1100 GOTO 1010
```

### 遊び方

1. エミュレータを開き、モードを **BASIC** にする
2. 「プログラム」欄に上のコードを貼る (または `minesweeper.bas` を「ファイルを開く」で読み込む)
3. 「メモリへ読み込む」→「RUN」
4. 動作が遅いときは「速度」を上げる

| 操作 | キー |
|---|---|
| カーソル移動 (端で反対側へ回り込む) | 矢印 / `W` `A` `S` `D` |
| 開く | `Space` / `Z` |
| 旗 | `F` / `X` |
| やり直し | `R` |

## テスト

`npm test` で次を走らせます。

```
node tests/basic.test.mjs     # BASIC インタプリタ / 関数電卓
node tests/machine.test.mjs   # ROMモードの配線 (合成ROM)
node tests/iocs.test.mjs      # システムコールのエミュレーション
GAMES_DIR=<dir> node tests/games.test.mjs   # 実ゲーム5本 (別途用意したファイル)
```

ROM がなくても `HALT` を置いた合成 ROM でバスの配線を確かめたり、音声の周波数をアサートしたりできるので、ブラウザを開かずに回帰テストが書けたのが助かりました。

## 未検証・制約 (正直なところ)

`SPEC.md` に **[未検証]** として列挙している項目から、特に影響の大きいものを挙げます。

- **PC-E200 固有の仕様は未確認** です。MAME に PC-E200 は無く、PC-G850 (G850V) の同等機として扱っています。差分があっても気づけていません。
- BASIC は実機ファームの再現ではありません。`FOR` の初期値が上限を超えたときの挙動 (標準の MS BASIC は 0 回、このエミュレータは 1 回実行する実装)、`RND n` の仕様、エラー番号と文言などは独自です。
- 日本語・カナ・特殊文字のフォント、`CHR$(128..)` は未対応 (`?` 表示)。`PEEK`/`POKE` によるシステム領域、機械語 `CALL`、カセット I/O、`PAINT` も未実装です。
- マインスイーパーは **エミュレータ上でのみ確認** しています。矢印キーが `INKEY$` で 28〜31 を返す点はエミュレータの仕様に依存しており、実機の BASIC では動くか分かりません。
- 機械語モードは、命令タイミングに依存するプログラムには弱いです。HoustonTracker 2 のマニュアルにも「エミュレータでの再現性は極めて低い」とあり、ブラウザの描画/音声スケジューリングの揺れで音が途切れることがあります。
- Z80 の命令サイクルは主要な表と照合して直しましたが、全命令の網羅検証はしていません。

## おわりに

ROM がない前提だと、「実機の挙動を正確に写す」のではなく「**呼ぶ側のプログラムが期待しているインターフェースを満たす**」という発想になります。システムコールのフックはその典型で、公開ソースの呼び出し箇所を読むだけで意外なほど動きました。

マインスイーパーのような小さなプログラムは、エミュレータの BASIC が実用になっているかを試すちょうどいい題材でした。

## ライセンスなど

- エミュレータとマインスイーパーのソース: 各リポジトリを参照 (マインスイーパーは MIT)
- 動作確認に使った HoustonTracker 2 (作者 utz82、修正BSDライセンス) とゲームは、リポジトリに含めていません
- 仕様の出典: MAME `src/mame/sharp/pce220.cpp` (BSD-3-Clause)
