# 実行・queue・jobnet・UTC scheduler

ナビゲーション: [概要](../../README.md) ｜ [索引](../README.md) ｜ [要件・概念](01-requirements.md) ｜ [導入・SDK](02-project-integration.md) ｜ [構成・UTC](03-architecture.md) ｜ [永続化・反映](04-storage.md) ｜ **実行（現在）** ｜ [ログ・監視](06-observability.md) ｜ [開発・運用](07-operations.md) ｜ [API](08-api.md) ｜ [セキュリティ](09-security.md) ｜ [Web認証](10-web-authentication.md) ｜ [設定](11-configuration.md) ｜ [controller分散](12-controller-distribution.md) ｜ [release](13-release.md) ｜ [検証・計画](14-validation-plan.md) ｜ [一次資料](15-references.md)

状態: **設計文書・未実装**。確定要件/採用契約と数値提案/未決を区別する。読む順序と正本は [設計索引](../README.md) を参照。

状態: 提案 / 基準日: 2026-10-27。安全性と運用は [運用設計](07-operations.md) を参照。

## 実行保証と不変条件

永続受付後は、完了・失敗・取消・結果不明のいずれかを追跡できるようにする。ただしディスク喪失、backup 以降の復旧損失、保持期限経過は別条件である。安全に再試行できるジョブには at-least-once を目指す。非冪等 command は不確実時に保留するため、自動的な実行完遂を保証しない。停止した controller や到達不能の指定ホストでは進行しない。

**外部副作用の exactly-once は保証しない。** Redis に保存できるのは belt の状態であり、外部 API の送信と belt の完了状態更新を一つの原子操作にはできない。完了報告前の crash で副作用だけが成功する場合がある。

不変条件は次とする。

- 一つの run には controller が有効と認める active attempt が最大一つ。ただしネットワーク分断中に古い実プロセスが残る可能性は別問題。
- すべての変更は状態・revision・session epoch・fencing token 条件付き。古い attempt からの報告が新しい状態を上書きしない。
- completed/canceled 等の終端 run は書き戻さない。手動再実行は関連 ID 付きの新しい run。
- DAG の node run と schedule occurrence は原子的な作成条件と一意 marker で一度だけ作る。これは外部実行が一度だけという意味ではない。
- 上限、認可、target 能力は受付時だけでなく claim 時にも検査する。

## 状態と試行

JobRun の状態案:

```text
scheduled --到来--> ready --claim--> leased --started ACK--> running
running --成功--> succeeded
running --再試行可の失敗--> retry_wait --到来--> ready
running --再試行不可/上限--> failed
leased/running --lease喪失/結果不明--> held
scheduled/ready/retry_wait --取消--> canceled
leased/running --取消要求--> canceling --停止確認--> canceled
leased/running/canceling --停止未確認--> held
```

`blocked` は DAG 前提待ち、`skipped` は先行失敗による未実行終端として追加する。deadline は未開始なら `failed(reason=deadline_exceeded)`、実行中なら停止手順を行い確認後 `failed(reason=timed_out)`。timeout/cancel 要求の記録だけで子プロセスが停止したと表示しない。

Attempt は `leased → running → succeeded/failed/canceled/timed_out/lost/unknown` を持つ。run の retry と attempt の終端を区別し、エラー分類・exit code・signal・controller 時刻・executor 観測時刻を保存する。開始準備失敗も attempt として残す。

`started` は起動許可を確定する handshake であり、OS 起動の証明ではない。executor は許可 ACK を得る前に処理を始めない。ACK 後に起動前 crash した場合も結果不明になり得る。耐久性が確認された同一 Redis generation で started 許可が一度も記録されず、期限切れとなった leased attempt は実行未許可として retry 上限内で再配達できる。ただし Redis の損失/restore が疑われる場合は記録の不存在だけから未実行と断定せず held にする。finish は同じ報告 ID と同じ内容で再送でき、既に保存した結果なら元の receipt を返す。異なる内容の再送や obsolete token は 409。finish ACK 消失を処理失敗と誤認して直ちに新 attempt を開始しない。

enqueueは [共通API/生成JobRef](02-project-integration.md#typed-enqueue) の登録schema/version/hash/認可を通し、未登録入力でrun/attemptを作らない。反映済みdefinitionに対する同版worker不在はpending理由で示し、別artifactを代用しない。

Job args/resultと静的jobnetの入力は [TypeScript型契約](02-project-integration.md#typescript-contract) を使い、型チェック成功のartifactを固定する。型消去後も外部入力/結果はruntime schemaで検証し、workflow JSONの型・参照整合を省略しない。

## queue と concurrency

ready 候補は queue 内で `(available_at, created_at, run_id)` の順に選ぶ。開始完了順までは保証しない。queue 間は bounded weighted round robin、既定 weight 1。strict priority は MVP に入れず、常時流入する高優先 queue による starvation を避ける。

claim 数は `min(executor free slots, host free slots, queue free slots, batch limit)`。各上限は Redis の原子的 claim 操作内で予約する。executor が申告する slots は管理者の承認上限を超えられない。worker は予約数以上の child を起動しない。最初の既定案は executor 4 slots、claim batch 最大 4、prefetch 0（実行枠のない先取りなし）。同一ホスト上の別 worker による上限回避を防ぐため host ID ごとにも集計する。

queue pause は新規 claim を止め、実行中処理の停止は run cancel/drain で別途行う。到達不能の明示 target は待機し、指定の queue deadline 到達で失敗にする。他ホストへ黙って移さない。後続の label pool は管理者承認 capability だけで照合し、自己申告 label を認可に使わない。

非同期 I/O の concurrency と CPU 並列を区別する。MVP は一 attempt 一子プロセスで CPU 利用と kill 境界を単純にし、`worker_threads` による handler 実行は計測後に検討する。concurrency は CPU、メモリ、外部 DB/API 制限を見て調整する。

<a id="os-command-execution"></a>

### worker からの OS コマンド実行

MVPのworkerは、許可したhostで事前配備済み実行ファイル/シェルスクリプトを実行できる。ジョブ定義/制御はTypeScript、実体のコマンド言語は問わない。`kind: command` は型付きargs/resultとcommand IDをregistryへ登録し、hostの管理者所有manifestとcontrollerのjob/project/host grantが一致する場合だけ起動する。TypeScript handlerが補助commandを呼ぶ場合もrunner UID/OS上限/egressの境界内であり、supervisorのcredentialや追加権限を取得できない。

実行は別UIDの固定runnerで `spawn(absoluteExecutable, argv, { shell: false, cwd, env, stdio })` を基本とし、大きいstdout/stderrをstreamとしてdrainする。小さい出力の補助処理にexecFileを使う場合もshell:false/引数配列と明示maxBuffer/timeoutを要求する。exec/execSyncやAPI入力のshell:true、任意の文字列commandは提供しない。shell:falseだけではoption injectionを防げないため、定義したargv schema/option allowlistとpath制約を適用する。

スクリプトは固定interpreter（例:管理者承認の/bin/bash）と改変不可の絶対script pathをmanifestに登録し、argvの先頭部分を固定する。利用者にinterpreter/path、-c/eval、任意script本文を渡させない。必要なpipeline等は審査済みscript内に記述し、Web/Redis/HTTPの文字列を連結したshellへ変換しない。実行直前のscript/manifest/hashとOS所有権はartifact境界で検証し、動的ダウンロード実行をしない。

cwdは固定の許可directory、envは明示allowlistで構成する。PATH/HOME/loader/preload/制御用BELT_*/Redis/API/PKI/AWS credentialを親から継承しない。stdinは既定ignore/EOFとし、必要なjobだけschema検証済みの上限付き入力をpipeへ一回送りcloseする。対話TTY/任意ファイル/FDの転送や秘密値のargv埋込は行わない。

stdout/stderrは既存の1行64KiB/attempt合計10MiB等の上限・redaction/gap契約で扱い、上限後もpipeをdrainして停止させない。exit code/signalとspawn errorを区別し、exit=0を業務成功とみなす規則/小さな構造化resultはdefinitionで固定する。ログ本文を無制限resultにせず、入力/結果schemaとretryable exit allowlistを検証する。

timeout/cancel/lease喪失時はSIGTERM→kill grace→SIGKILLとprocess identity/子孫確認を行う。process groupへのsignalは可能な範囲の回収手段であり、setsidした子孫や権限外processまで停止した保証にはしない。OS管理cgroup/serviceのcleanupと組合せ、停止未確認ならheld・slot保持・照合にする。Nodeのchild.killedやexit eventだけで全子孫停止と判断しない。[Node child_process](https://nodejs.org/api/child_process.html) / [OS実行境界](09-security.md#execution-boundary)。

## retry・timeout・cancel・recovery

<a id="retry-backoff"></a>

### retry ごとに伸ばす有界 backoff

run作成時にproject/job ID、definition/input/result schema、bundle ID/hashとretry policyをsnapshotし、retryで最新版へ切替えない。[bundle配備](02-project-integration.md#project-integration) と同じartifact/effectKeyを使う。**job retryの選択待ち時間は回数ごとに単調非減少、上限到達後は一定**とする。ネットワーク再接続やservice再起動とは別policyである。

attemptNoは初回=1、retryNoは初回失敗後の再試行=1。maxAttemptsは初回込み、既定3なので自動retryは最大2回。claimで割当attemptを作るたびattemptNoを進め、実行未許可のrecovery再配達も回数上限を消費する。入力検証で受付拒否した要求はrun/attemptを作らない。

既定係数は [defaults.retry](11-configuration.md#json-policy) を参照。r=retryNo（1以上）、previousDelayMsは同runで最後に確定したretry delay（初回0）として、次を使う。

```text
raw = min(maxDelayMs, ceil(baseDelayMs * multiplier^(r - 1)))
jitter = 一度だけ選ぶ整数 [0, min(floor(raw * jitterRatio), maxDelayMs - raw)]
delayMs = min(maxDelayMs, max(previousDelayMs, raw + jitter))
nextEligibleAtUtcMs = failureRecordedAtUtcMs + delayMs
```

計算はsafe integer/overflowを検査し、cap到達後は大きな累乗を計算し続けない。jitterは一斉retryを緩和する正方向の分散で、実待ちが前回より短くなり得るfull jitterはjob policyに採用しない。既定では最初5〜6秒、次10〜12秒となる。multiplier設定によって同じdelayになる場合も含め、確定したdelayを単調非減少に保つ。capでは追加jitterが0になり得るため、queue concurrency/backpressureも維持する。保証対象は保存されたfailureRecordedAtからnextEligibleまでの設定delayで、負荷による追加queue遅延を含む実開始間隔の単調性までは保証しない。

maxElapsedMsは最初のclaim/attempt作成の確定UTC時刻からのrun内retry予算とする。最初のclaimでretryDeadlineAtUtcMsを永続化し、再起動/次attemptで延ばさない。初回claim前の待機は別のqueue deadlineに従う。次回eligible/開始がこの予算またはrun deadlineに達するなら新attemptを作らず、retry_exhausted/deadlineとして終端にする。実行中も残予算とattempt timeoutの早い方で停止手順へ進め、停止未確認はheld。maxAttempts/maxElapsed/queue/attempt deadlineのどれかだけで無限retryを許す構成にしない。

### 失敗確定・永続化・再起動

failureRecordedAtUtcMsはStoreの共有Redis UTC時刻snapshotとして同時保存し、DB commit完了時刻を厳密に観測した値とは扱わない。failure/finishの一つの原子的Store操作でattemptの失敗分類、runのretry_waitまたは終端、retryNo/previousDelayMs/選択delay、UTCのnextEligibleAt、due index、slot扱い・receipt・監査をまとめて確定する。乱数候補はapplicationから渡し、共有時刻はStoreで採り、scriptはexpected revision/attempt/token/cancel/予算を検証する。競合/ACK消失は元receiptと保存値で照合し、保存済みdelayを再抽選しない。

retry_wait→readyもstate/revision/UTC due/予算を原子的に照合し、二重tickで重複run/attemptを作らない。再起動は保存済みnextEligibleAtを使い、現在時刻起点の再計算で前倒し・待ち時間reset・延命をしない。未到来は残durationを単調時計で待ち、超過はbudget確認後に一度だけ候補化する。Redis巻戻り・時刻不明はrecovery/heldで照合し、記録が無いから未実行とは断定しない。

自動retryはjob作者が副作用の安全性を判断して明示したretryable codeだけに限る。入力不正、権限/署名/未知handler・対応版違反等の恒久エラー、cancel済み、非冪等副作用の結果不明は自動retryしない。command非ゼロは既定で自動retryなし、承認したexit allowlistだけ例外。cancelとfailureは同じ条件付き更新で競合解決し、後着finishでcanceledを復活させない。retryしてもeffectKeyを維持し、外部の冪等性/fencingを自動取得したとは扱わない。手動retryは監査付き新runの既存契約に従う。

```json
{
  "retry": {
    "maxAttempts": 3,
    "maxElapsedMs": 3600000,
    "baseDelayMs": 5000,
    "multiplier": 2,
    "maxDelayMs": 300000,
    "jitterRatio": 0.2,
    "retryableCodes": []
  }
}
```

これは提案policyのJSON断片。空allowlistは自動retryしない安全な例で、job定義の型付き宣言から生成する。baseDelayMsは1000〜300000、maxDelayMsはbase以上〜3600000、multiplierは有限数で1より大〜10、jitterRatioは0〜0.2、maxAttemptsは整数1〜100、maxElapsedMsは1000〜604800000を初期許容範囲案とし、各値と合成したUTC時刻のoverflowをvalidate/apply時に拒否する。

workerのHTTP再接続/telemetry送信のbackoffは接続負荷対策でjob attemptを増やさず、finishは同じreport IDを再送する。systemd RestartSec/StartLimitはprocess常駐のpolicyで、runの回数/期限をresetしない。どちらも恒久認証/設定エラーを無限高速再試行する代わりに停止・運用介入とする。


キュー待機を含む `deadlineAt`、一回の実行時間 `attemptTimeoutMs`、停止猶予 `killGraceMs` を分ける。提案既定は attempt 15 分、kill grace 10 秒、queue 最大待機 24 時間。業務ごとに上書きする。controller が決めた残り時間を supervisor が単調時計で監視し、lease を延長しても実行 timeout は延びない。

取消は Redis の原子的操作で要求と監査を保存し、その後 heartbeat 応答で通知。supervisor は AbortSignal / SIGTERM を送り、猶予後 SIGKILL、子孫終了を確認する。終了と cancel が競合したら、最初に有効条件で確定された結果を採用し、取消未達も監査に残す。すでに成功した副作用を取り消したとは扱わない。

controller 再起動は Redis から ready/retry/schedule/lease を再走査する。Redis が停止中なら readiness を落として受付/claim を止め、メモリ queue へ退避して動作継続しない。未期限 lease は再接続を待ち、期限切れだけ判定する。worker 再起動はローカル journal を照合する。同じ attempt に疑わしい生存プロセスがあれば、PID のみで判断せず boot ID・process start time・cgroup を照合し、起動し直さず隔離・停止・報告する。

### 代表的な障害と判断

| 障害 | belt の処理 | 再実行条件 |
| --- | --- | --- |
| enqueue の Redis 更新後に応答消失 | 同じ request key で受付済み run を返す | 新 run を自動増殖させない |
| claim 応答消失 | lease 期限で回収。started がなければ実行許可未確定 | 古い lease の started は拒否 |
| started ACK 前に通信断 | executor は起動せず問い合わせ/期限待ち | 有効 ACK を得た attempt だけ起動 |
| 起動後に executor kill / 電源断 | attempt lost/unknown、run held を基本とする | 冪等再配達許可 + slot/停止未確認の実行の扱いを確認 |
| 外部処理成功後 finish 消失 | 同一 finish を再送。期限後の新規成功報告は stale evidence として保存 | held を運用者が照合して解消。無条件成功上書き不可 |
| Redis 接続断/write拒否/AOF失敗/容量超過 | 受付・新規 claim を 503、実行者は lease 更新失敗時の停止手順。ACK 不明は同一操作 ID で照合 | 永続化・容量・関連 index 整合性を確認後 |
| Redis 復元/損失で状態巻戻り | deployment generation と資格情報/session を更新し、active と外部実行を照合。receipt/effectKey の喪失も疑う | 記録なしを未実行とみなさず held、運用確認後 |
| worker 不通 | host を offline、割当停止、対象 run の不確実性表示 | 別ホストに自動転送しない |
| controller 時計の急変 | lease 回収・新規 dispatch を保留し警告、再同期/照合 | 単調時計との比較で検出。誤回収を許容しない運用 |

## 重複実行と冪等性

enqueue の重複排除 key は受付の二重登録対策であって、外部副作用の重複防止ではない。提案保持期間は 7 日、期限切れ後は同じ key でも再登録され得ることを API 契約に含める。request hash が違う key 再利用は拒否する。

handler の `effectKey` は同一論理 run の retry で固定し、外部 API の idempotency key、利用側の業務ストアの一意制約や transaction 等に渡す。これは利用側が選ぶ任意の業務連携であり、belt がリレーショナルDBを要求する意味ではない。例: 売上集計は対象業務日を自然キーにして upsert、送金は外部サービスの取引 key と結果照会を使う。belt の成功記録だけを先に保存して副作用を省略する設計は採用しない。

定義には `recoveryPolicy: hold | retry-idempotent` を持つ。既定は hold。`retry-idempotent` は業務が冪等であることを所有者が明示した場合に限る。古いプロセスが残り得るため、本当に同時実行してはいけない資源は外部側 fencing/lock を必要とする。手動 retry は新 run とし、`retryOf` と同じ effectKey を既定で継承する。意図的な別業務実行は新 effectKey を発行し、操作理由を監査する。

held は operator が外部結果を確認し、`resolve(success|failure|retry)` と理由・証拠を登録して解消する。success は「人手で確認した成功」と表示し、executor の完了報告とは区別する。held のまま関連する資源枠を自動開放すると実際の同時実行数が上限を超えるため、保守的に slot を予約し続ける。停止確認または明示的なリスク受容の監査付き操作で解放する。

## workflow / jobnet / DAG

job コードは利用側 project に置き、workflow/jobnet 定義は登録済み job の参照と実行関係だけを持つ。同じ project/job/version を単独 enqueue と複数 jobnet で再利用でき、job 自体に特定 workflow の前後関係を埋め込まない。node の別名 ID は job ID と区別し、同じ job を複数 node に配置できる。

MVP の定義は静的で有限な DAG。node ID の重複、未知参照、cycle、過大 graph を登録時に拒否し、topological sort で検証する。最大 100 nodes / 500 edges を提案する。workflow 起動時に graph と各 JobDefinition version/bundle 参照を固定するため、編集中の定義が進行中 run に混ざらない。

workflow 定義は job 参照・node 入力・edge・condition/failure policy・結果の参照契約を持つ。ただし MVP は condition=`allSuccess`、failurePolicy=`skipDependents`、他 branch は継続、結果は node ごと保存/参照に限定し、未対応 policy は登録時に拒否する。任意条件式や結果からの自動引数生成を MVP 実装済みとは扱わない。最初は `allSuccess` 依存だけを提供する。根 node は ready、他は blocked。全親が succeeded なら一度だけ ready にする。一つでも failed/canceled/skipped なら依存 node を skipped にし、他の実行中 branch は継続する。親が held なら後続も blocked のまま。retry_wait は失敗確定ではなく後続を解放しない。

workflow は全 node 成功なら succeeded、失敗を含み全 branch が終端なら failed、held があれば attention 状態、取消要求があれば子 run への cancel と未開始 node の取消を行う。実行中の停止未確認を無視して workflow canceled にはしない。先行失敗時に全 branch を止める fail-fast は後続。

```json
{
  "schemaVersion": 1,
  "projectId": "sales",
  "id": "daily-sales",
  "version": 1,
  "condition": "allSuccess",
  "failurePolicy": "skipDependents",
  "nodes": [
    { "id": "extract", "job": { "id": "extract-sales", "version": 1 }, "target": { "executorId": "db-01" } },
    { "id": "aggregate", "job": { "id": "aggregate-sales", "version": 2 }, "target": { "queue": "compute" } },
    { "id": "notify", "job": { "id": "notify-sales", "version": 1 }, "target": { "queue": "io" } }
  ],
  "edges": [["extract", "aggregate"], ["aggregate", "notify"]]
}
```

node 間データは大きな標準出力を自動で引き回さず、業務 key / 外部成果物参照を使う。MVP は共通 JSON 入力と明示した小さな結果だけを保存し、任意式・eval による引数生成を実装しない。結果は成功 node の小さな JSON result、失敗 node の分類/exit code、skip/cancel/held 理由を区別して記録する。後続の安全な結果 binding は許可した selector と schema 検証で実装し、任意 JS/eval を使わない。loop/繰返しは DAG 外なので MVP では拒否し、最大回数・deadline・結果保持・障害時挙動を決めてから後続で要否判断する。部分再実行・ネスト・条件分岐は後続で、元の成功 node を再利用できる条件と副作用を別途設計する。MVP の再実行は新 workflow run を明示作成する。

<a id="native-scheduler"></a>

## controller 内 scheduler と独立した次回時刻計算

### 対象・UTC 固定・依存

scheduleは **定義・評価・生成実行instantのすべてをUTCに限定**する。belt controller内の独自schedulerがJSONのonce/interval/daily/weekly/monthlyをvalidate/applyし、Redisのnext due/cursor/occurrenceから原子的にrunを作る。[共通UTC契約](03-architecture.md#utc-time-policy) により、絶対日時はZ終端または単位付きUTC epoch ms。JST等はWebの変換表示だけで、入力/定義/実行計算を切替えない。

`packages/schedule`はJSON検証、UTC暦/interval、次回occurrence、misfire planを持つ独立ライブラリ。標準DateのUTC系APIと数値演算を使い、時計/Redis/timerは直接読まずspec/afterUtc/limitを受ける。controller applicationがClock/Storeを組み立てる。`nextOccurrences(spec, afterUtc, limit)`はafterUtcより厳密に後の`{logicalKey, dueUtc, utcCalendarLabel?, policy}`を昇順で返す。interval/onceではUTC暦label不要。previewとdispatchは同じcoreを使い、計算予算超過を明示エラーにする。

内部のtimezone選択・DST resolver・独自TZDB・外部日時libraryは不要。Intl/ICUはWebでのUTC→表示zoneの変換に限り、schedule計算の依存にしない。UTCにDSTはなく、一日の暦境界は常に00:00:00Z、weekday/月末もUTCで決まる。ECMAScript Dateの時間モデルに従い閏秒入力は対応外とし、OSの時刻補正はwall/monotonicの契約で扱う。

### JSON 規則と「毎 N 時間」「毎日」の違い

| trigger | UTCでの意味 | 必須/固有項目 |
| --- | --- | --- |
| once | 指定UTC instantに一回 | Z終端のat |
| interval | anchorからの固定UTC周期、完了時刻を起点にしない | Z終端anchorAt、everyMinutes |
| calendar + daily | 毎日UTC HH:mm | at |
| calendar + weekly | UTCの指定曜日HH:mm | at、weekdays（ISO 1=月〜7=日） |
| calendar + monthly | UTCの毎月指定日HH:mm | at、dayOfMonth、invalidDate |

UTCはschemaの固定契約なのでtimeZone/timezone/dstというfieldを増やさない。calendar.atのHH:mmはabsolute datetimeではなくUTCの時刻ルール。毎24時間のintervalはanchorの位相、dailyはUTCの時刻を固定する。UTCではDSTによる23/25時間日はなく、位相が合えば両者は同じ実行列となるが、初回anchor/enable境界の意味は別。job終了からN時間後のfixed-delayはMVP外。

次は未実装の提案JSON。毎日09:00 UTCを意味し、JST表示は同日18:00である。

```json
{
  "schemaVersion": 1,
  "projectId": "orders",
  "id": "orders.daily-summary",
  "version": 1,
  "enabled": true,
  "target": { "kind": "job", "id": "orders.summarize", "version": 1 },
  "args": { "orderId": "daily-batch" },
  "trigger": { "kind": "calendar", "frequency": "daily", "at": "09:00" },
  "misfire": { "mode": "coalesce", "graceSeconds": 60, "lookbackHours": 24 },
  "overlap": "forbid"
}
```

その他のtrigger例（上記triggerの位置で使用。すべてUTC）:

```json
[
  { "kind": "once", "at": "2026-10-27T09:00:00Z" },
  { "kind": "interval", "anchorAt": "2026-01-01T00:00:00Z", "everyMinutes": 120 },
  { "kind": "calendar", "frequency": "weekly", "at": "01:30", "weekdays": [1, 5] },
  { "kind": "calendar", "frequency": "monthly", "at": "09:00", "dayOfMonth": 31, "invalidDate": "lastDay" }
]
```

### バリデーション・曜日・月末

初期範囲案はGregorian/2000〜2099年、calendarは00:00〜23:59のHH:mm、intervalは整数1〜525600分。once.at/interval.anchorAtはUTCのZ表記必須、anchorは秒/ミリ秒0。非UTC offset、naive日時、不正日付、unsafe integer、対応年外、未知field/enum、frequencyに無関係なfieldを拒否する。timeZone/timezone/dstは値がUTCでもunknown_field、形式・日付違反はinvalid_schedule、計算上限はcalculation_limitとしてfield位置と機密除去理由を返す。無視・local推測・自動timezone変換をしない。

weeklyは重複しない1〜7を1件以上指定し、UTCの日付からweekdayを判定する。monthlyはdayOfMonth=1〜31、invalidDateはskip（既定）またはlastDay。UTC暦上で存在しない日ならskip、lastDay明示時だけ当該UTC月の最終日にする。2月の28/29日をGregorian閏年規則で判定し、Date.UTCのoverflowで翌月へ繰越さない。開始/終了境界を指定するならUTCかつstart<endを検証する。営業日/休日・非Gregorian暦はMVP外。

登録時は次の10件をUTCでpreviewし、適用policy/skip理由を示す。Webはその固定UTC結果をJST等へ変換表示できるが、別zoneで次回時刻を再計算しない。表示zoneが変わってもdefinition hash/version/occurrence keyを変更しない。UTCではDSTの欠落/重複時刻は生じず、gap/fold policyは持たない。

### UTC 次回計算の実現方法と上限

intervalはanchor+n×period（n>=0）を算術で求め、前回の実開始時刻へ加算してdriftさせない。calendarはUTC年月日から日/週/月単位で候補を作り、Date.UTCとgetUTC*等で組み立てる。localのgetDate/getDay/setHoursやlocale依存のDate.parse、現在のoffsetを加減する近似を用いない。候補を作る前に日付/閏年を検証し、UTC componentのround-tripでも不正正規化を検出する。

UTC日付の探索horizonは最大370日、preview最大100件、catch-up候補最大1000件/計画を初期予算とする。必要な未来範囲/対応年の終端に候補がなければ理由を返す。計算は短いbatchと全体CPU/要求quotaで有界にし、超過はcalculation_limitとして保留、controllerのheartbeatを妨げない。UTC暦のためtimezone逆変換の探索やformatter cacheは不要。対象Nodeと計算予算はD3/P4で測定して確定する。

### Redis の due/cursor と原子的な enqueue

controllerがscheduleを所有し、JSON validate/apply後に固定job/workflow version、UTC trigger/policy、enabledFromUtc、revision、schema/runtime版、nextDueUtc、処理済みcursorをRedisへ保存する。新規enable時刻より前は自動backfillしない。過去anchorのintervalもこの下限を守る。

occurrence keyはonce=(scheduleId,version,once)、interval=(scheduleId,version,intervalIndex)、calendar=(scheduleId,version,utcCalendarLabel)。UTC labelは対象UTC日付とHH:mm等の論理識別で、Z付きdue instantも保存する。local zone/labelをkeyにせず、Webの表示zoneに依存しない。runごとのjob/version/bundleは作成時に固定する。

1. nextDueUtc<=nowUtcのscheduleをRedis Sorted Setからbounded batchで読む。
2. schedule coreでUTC候補/misfire/次回を計算する。暦計算をLua内に入れない。
3. 短いscriptでdeployment generation/revision/expected cursor/enabled/quota/overlapを再検査し、occurrence marker・run/監査・次due/cursorを原子的に確定する。
4. 競合/ACK消失は同じoperation ID/cursorを照会して再送。cursorだけ先に進めたり、markerを別要求に分けたりしない。

cursorはどの論理occurrenceまでrun化/skip済みかを持ち、lastEmitted/nextDueと分ける。job完了までcursorを止めず、quotaで確定できなければ進めずdeferredにする。marker/receiptはactive/retry/照合期間を覆い、TTL/evictionで重複防止を壊さない。初期single配備に加え、multi profileでは全controllerが同じ候補を読めるが、expected cursor/occurrence markerの同時CASで一つだけ確定する。基本schedulerにglobal leaderを要求しない。外部副作用のexactly-onceやRedis HAは保証せず、Redis不通/耐久性不明はdispatch保留。[分散契約](12-controller-distribution.md) を参照。

### 再起動・取りこぼし・長時間 job

通常tickの遅延はgraceSeconds（既定60、1〜3600）内なら通常処理。超過する未処理dueには定義のmisfire policyを適用する。

| mode | 処理 |
| --- | --- |
| skip（既定） | grace超過をskip監査し、grace内だけ対象 |
| coalesce | 対象範囲の最新一件にまとめ、範囲/件数を監査 |
| bounded | lookback内の最新N件（maxRuns既定10/上限100）を予定順に対象。他はskipしてcursorを進める |

lookbackHoursは既定24/上限168、候補は最大1000件/計画。古い範囲は集約した欠落を記録し、予算超過は保留/エラー。再起動後の同じ欠落集合をtickごとに再投入しない。intervalは件数を算術計算できる。overlapは同じscheduleの非終端runに既定forbid/明示allow。forbidはqueued/running/retry_wait/heldが一つでもあれば対象occurrenceをskipする。他schedule/手動jobはqueue/hostの別枠で制限する。forbid+boundedで最大一件、残りskip。全件補完には明示allowとqueue上限を要する。

pause中はrunを作らず、resumeは同じcursor/misfireを使う。長時間jobで周期を完了基準へ変更せず、各occurrenceのretryは同run内のattemptで次occurrenceとは分離する。

### UTC wall clock・monotonic・runtime 更新

永続due/cursor/期限はUTC wall clock、プロセス内待ち/timeout/時計差観測はperformance.now()/process.hrtime.bigint()等の単調時計。originを再起動間で流用しない。期限判定のnowUtcはStore内の共有Redis時刻で統一し、controller個別のwall clock差でlease/dispatchを調停しない。timerは1秒程度で再確認する起床手段で、正確な発火/SLAを保証しない。[Node timers](https://nodejs.org/api/timers.html)。

NTP緩補正はUTC due/cursorで追跡する。wall/monotonicの差が初期閾値2秒/観測を超えるstep、後退、suspend/resumeでは新規schedule dispatch/lease回収を保留して照合する。前進で飛び越したdueはmisfire、後退は処理済みkeyを再投入しない。UTC/DSTなしでもOS時計の急変や分断の問題は残り、exactly-onceを保証しない。

Node/計算module更新時はUTC preview差分を検証し、生成済みrun/cursor/keyを保持する。定義変更は新versionと監査付きapply。WebのICU/TZ表示data更新や表示zone変更は未来dueを再計算する理由にしない。

### UTC 暦境界の受入例

以下は実装時の期待値で、実装済み試験の結果ではない。

| ケース | 期待 |
| --- | --- |
| daily 09:00 UTC | 例:2026-10-27T09:00:00Z。Web JSTは18:00、UTC表示へ戻しても同じrun/instant |
| weekly [1] 00:00 UTC | 2026-10-25T23:59:59Z（日曜）の次は2026-10-26T00:00:00Z（月曜）。表示側の日付/曜日は計算に使わない |
| monthly 31 / skip・lastDay | 2026年4月はskip、lastDayは2026-04-30T09:00:00Z等の指定UTC時刻。翌月1日へoverflowしない |
| monthly 29 / 2月 | 2028年2月29日は有効、2026年2月29日は無効。skip/lastDayで決定 |
| dailyと表示側のDST | UTC 09:00の隣接dueは86400000ms差。表示先でoffsetが変わってもUTC due/occurrenceを欠落・重複させない |
| interval anchor一致/1ms前 | exclusive nextは一致なら次周期、1ms前ならanchor。previewとdispatch一致 |
| 非UTC field/offset/naive入力 | timeZone/dst等はunknown_field、Z無しや非UTC offsetの絶対日時はinvalid_scheduleで拒否 |
| ACK消失/再起動/時計後退 | 保存cursor/UTC logical keyを再利用して二重runを作らない |

fake wall/monotonic clockでUTC日付/曜日/月末/閏年/対応年終端/計算予算を検証する。OS/process/browser TZを変えてもUTC計算結果が一致し、表示切替だけではdefinition/Redis/runが変わらないことを確認する。[テスト計画](07-operations.md) を参照。

共有JSONのpublished-ref更新だけではschedule/jobnetは切替わらず、認可付きapply/activate後のRedis active revisionとrunに固定したrelease/definition/artifactを使う。desired更新/rollbackで途中差替えしない。複数controllerの配布/反映は [共有JSON契約](04-storage.md#shared-json-publication)、multi profileのCAS/lease/fencingは [分散契約](12-controller-distribution.md) に従い、反映ACKで実行のexactly-onceを保証しない。

## worker の登録・通信・lease・fencing

MVPのworkerが実行executor兼resource collectorを担う。指定サーバー向け専用agentは後続で、以下の登録/通信/lease契約を再利用する案に留める。独立agentをMVPの監視経路に挟まない。

### 登録と認証

worker supervisor は controller へ outbound HTTPS long polling し、claim/started/renew/finish/log を同じ認証・認可境界に通す。Redis へ直接接続せず、業務 job 子プロセスへ制御資格情報を渡さない。VPC 内も mTLS の検証を省略せず、失効/更新失敗や接続断で未確認 attempt を未実行・成功と決めつけない。[VPC の配備と証明書手順](07-operations.md#aws-vpc-transport) を参照。

workerの初回enrollment・証明書更新/失効・identity/session bindingは [認証/rotation契約](09-security.md#authentication) を正本とする。登録済みhost/grantと期限を満たさなければclaim/renewを拒否し、停止未確認はheldとする。

### 通信の順序

1. supervisorは署名済みメタデータを検証し、OS管理の別UID runnerで検証済みのartifact/registry capabilityを取得する。業務module/configをimportせず、sessionとslots、対応project/job/version/bundle hashを報告する。
2. 空き slots の範囲で long poll（最大 20 秒）し、assignment の `runId/attemptId/sessionEpoch/token/leaseDuration` と固定 job/bundle 参照、JSON args を受ける。ローカル artifact と不一致なら実行しない。
3. assignmentをローカルjournalにfsyncし、`started` handshakeを行う。有効lease/認可の耐久性ACK後、credentialを持たない別UID runnerへ限定IPCで起動を依頼し、process identityを記録する。UID/credential境界を用意できなければ実行しない。
4. heartbeat は別要求で既定 5 秒ごと。lease は controller 時刻で 30 秒。ネットワーク処理とログ転送は分離する。応答には renewal と cancel 指示を含める。
5. executor は最後に耐久性 ACK を確認した lease を単調時計で測る。安全余裕 10 秒前から新規起動を止め実行中を terminate し、満了前の停止を目指す。停止が確認できなければローカルで隔離し、復旧後 held として報告する。
6. 終了結果はローカル journal に durable 保存してから finish を送る。Redis の耐久性を確認した finish ACK 後に削除可能とし、再送で二重状態遷移させない。timeout では削除しない。

数値は初期提案であり、kill grace、RTT、GC pause の最大値に合わせる。通信分断下で controller が「確実に止まった」と確認することはできない。session失効やoperatorの確認だけで停止済みとせず、held解消/slot解放は追加権限・再認証・理由・監査を要する。lease expiry は実行権限の期限であって OS の kill 証明ではない。

### fencing の効く範囲

controller は token/epoch の一致によって古い heartbeat/finish/log の状態更新を拒否できる。外部 DB/API も単調 token を保存して古い書込を拒否する場合に限り、外部副作用も fence できる。任意 Linux command にはこの機構がないため、lease だけで二重実行を完全に防げるとは主張しない。

期限切れ lease の executor の報告は状態を直接変えず、照合用 evidence として別保存する。明示 host の非冪等 command は held にして停止・副作用の照合を要求する。自動 recovery を許可するジョブでも、疑わしいプロセス占有枠を維持したまま追加枠を使うか、停止を確認してから再試行し、ホストの上限を崩さない。

worker の journal/spool は容量制限付きファイルにする。attempt ごとの version 付き intent/許可 receipt/process identity/終了結果を JSON で記録し、temp file → fsync → atomic rename と親 directory の fsync を行う。破損・欠落・中途半端な記録は未実行と決めつけず隔離して照合する。これは再送用の局所的記録であり、共有 queue/履歴の主 DB は作らない。job実行状態はRedisを唯一の正本とし、Web accountのS3正本とは責務を分ける。容量上限に達したら claim を停止し、ログとは別に finish evidence の予約領域を確保する。OS/FS の耐久性条件と各 crash 点は P2 で検証する。
