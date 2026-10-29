# 永続ストア・共有JSON・定義反映

ナビゲーション: [概要](../../README.md) ｜ [索引](../README.md) ｜ [要件・概念](01-requirements.md) ｜ [導入・SDK](02-project-integration.md) ｜ [構成・UTC](03-architecture.md) ｜ **永続化・反映（現在）** ｜ [実行](05-execution.md) ｜ [ログ・監視](06-observability.md) ｜ [開発・運用](07-operations.md) ｜ [API](08-api.md) ｜ [セキュリティ](09-security.md) ｜ [Web認証](10-web-authentication.md) ｜ [設定](11-configuration.md) ｜ [controller分散](12-controller-distribution.md) ｜ [release](13-release.md) ｜ [検証・計画](14-validation-plan.md) ｜ [一次資料](15-references.md)

状態: **設計文書・未実装**。確定要件/採用契約と数値提案/未決を区別する。読む順序と正本は [設計索引](../README.md) を参照。

## 永続化の選択

**job実行状態の唯一の主ストアとしてRedis**を採用する。キャッシュではなく、受付済み run・workflow進捗・schedule cursor・履歴・executor認可を失わないための永続基盤である。複数サーバーの executor の実行状態を集約し、受付・割当・履歴を一つの基盤で管理する。

<a id="backend-selection"></a>

### 正本の一意性と backend 製品の選択

「唯一」は一つの配備で状態の正本を一つにする意味であり、Redis 製品への恒久固定ではない。現在の基準実装は Redis、MVP の正式対応は一製品・検証済み版に絞る。Store port を維持し、Valkey を第一比較候補とするのは提案事項である。採用変更や複数 backend の正式サポートを確定しない。

候補には RESP/client 接続だけでなく、使用する Hash/List/Set/Sorted Set/String、固定 Lua の複数 key 原子更新・エラー挙動、transaction、AOF fsync と ACK、必要な場合の WAITAOF、noeviction/容量不足、ACL/TLS、backup/restore と crash recovery の同じ契約試験を要求する。Streams は現設計の必須条件ではない。client を製品ごとに無条件に追加せず、対象版との動作を adapter 内で検証する。自作 RESP client は採用しない。

Valkey の公式資料では Redis OSS 7.2 系との互換性、既存 client/Lua、WAITAOF が示されるが、Redis 7.4 以降のデータファイルをそのまま交換できるとは扱わない。WAITAOF も failover 時の無損失や強整合性の保証ではない。製品/版の保守期間・license・脆弱性対応と運用ツールも選定する。[Valkey 互換性](https://valkey.io/topics/migration/) / [WAITAOF](https://valkey.io/commands/waitaof/) / [保守方針](https://valkey.io/topics/releases/)（調査日 2026-10-27）。HA/Cluster は別要件であり、protocol 互換だけで multi-key Lua を別 shard へ拡張しない。

Redis primary は MVP で一つ。Cluster/Sentinel/自動 failover は必須にしない。replica を置くだけでも強整合にはならず、failover で受付済み書込を失う場合がある。[Redis replication 公式](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)。

### JSON ファイルと Redis の正本

belt の永続基盤として SQLite/PostgreSQL/MySQL 等のリレーショナルDBは採用しない。JSON は設定・定義・入出力に用い、共有 queue/claim/lease を複数ホストから書き換える JSON ファイルにはしない。

| 対象 | JSON ファイルの役割 | 実行時の正本と更新方法 |
| --- | --- | --- |
| controller / worker の初期 config | 接続先、証明書/secretRef、registry/manifest 参照、上限等。秘密値は別 credential | 配備された config を起動時に検証して採用。runtimeはJSONを採用。job/registry宣言はtrusted build/runnerだけ、producerは接続設定と生成JobRefだけを使い、同じ設定を二重正本で管理しない |
| job definition manifest / jobnet / schedule | 利用側で作成・version 管理する定義 JSON、TypeScript job 宣言から生成した manifest | validate/apply で登録した不変 version が Redis 上の実行時正本。ファイル編集だけでは稼働中定義は変わらない |
| definition export | Redis に登録済みの定義メタデータを JSON で書き出す | export は参照・配布用 snapshot。再登録は validate/apply を通し、双方向自動同期しない |
| worker journal / finish evidence | attempt ID、version、receipt、process identity、結果を JSON で記録し通信断時に再送 | worker 内の再送用局所記録。共有実行状態の正本は Redis、journal を共有 queue にしない |
| log metadata / export manifest | ファイル参照、checksum、gap、export 時刻/schema version を JSON で保存可能 | 実行状態と関連 index は Redis。stdout/stderr 本文はサイズ制限付き file、JSON 化を強制しない |

利用側の `belt.config.ts` は信頼したbuild/CIの型補助付き宣言入口に限定し、producerは別の `belt.client.ts` と生成JobRefだけを読む。runtime用はsecret値を含まないJSONへ展開してhost管理者がcredential参照/runner境界を配備する。controller/supervisorはJSONを検証して使い、業務TypeScript configをimportしない。definition のソース JSON と Redis は「作成入力」と「登録済み実行状態」の異なる責務であり、同一 version の二重編集は許さない。

JSON export は queue/active attempt/lease/token/request receipt を含む完全な復旧用 backup ではない。Redis 全状態の復旧には Redis スナップショット（バイナリ形式）と AOF の整合した backup を使う。JSON 定義だけを戻して進行中処理や重複排除を復元したとは扱わない。

<a id="shared-json-publication"></a>

### 共有フォルダ・S3 による JSON の配布

複数サーバーの controller を並列運用する場合、定義/共通設定 JSON の取得元を各 host の複製だけに限定せず、共有フォルダ（検証済み NFS/EFS 等）または S3 等の共有 storage にできる設計とする。MVP の単一 controller でも任意に利用できるが、定義配布用S3は任意adapter。Web account用のS3/KMS依存とは別に選定する。現在は設計のみで複数 controller/adapter の実装・動作保証ではない。

| 対象 | 共有できる内容 | 正本/適用境界 |
| --- | --- | --- |
| 定義 | job manifest、schema、jobnet/DAG、schedule の不変 JSON | 配布物は apply の入力。認可付き validate/apply 後の登録済み不変 version と active revision は Redis が実行時の正本 |
| 共通設定 | 非機密な共通上限・policy・参照名、schema version | 明示した共通設定 release が配布上の正本。Redis の active release参照/revision は採用版の識別・調整用。Redis の任意編集と file の双方向同期を作らない |
| host 固有設定 | source の固定接続先/prefix、信頼鍵/CA参照、host identity、bind、credential参照 | OS管理のローカル bootstrap JSON と protected credential。全 controller/worker の設定を丸ごと共有しない。共有設定で接続先/信頼 anchor/UID を任意上書き不可 |
| 成果物 | 署名済み manifest と immutable job artifact を同じ配布基盤に置くことは可能 | JSON はコード本体ではない。信頼 CI/配備者が runner host へ検証・配備し、runner が import 前に署名/hash/version を再確認。controller は業務コードを import しない |
| 除外 | private key、token、平文 secret、run/queue/lease/token/cursor、worker journal/spool | 秘密値は個別 credential。共有実行状態は Redis。journal/spool は host 局所 file。共有 JSON を実行 DB や controller election lock にしない |

#### 一つの release として公開する

publisher は権限を持つ CI/管理操作に限定し、controller reader と分離する。release は一意な release ID、schema version、base revision、対象 project、各 JSON/artifact の固定参照・byte size・SHA-256、署名を検証できる manifest を持つ。参照範囲は許可 root/prefix 内に限定し、任意 URL/import path を受け付けない。JSON/署名の検査には既存のサイズ上限と artifact 信頼方針を適用する。

先に一意な version 配下へ全 payload と署名済み manifest を公開し、全参照が取得・検証できる状態にしてから、小さな published-ref をその release へ切替える。複数 JSON を順に上書きして reader に混合版を見せない。reader は一度取得した manifest の固定参照だけを読み、途中で current を再解決しない。published-ref の変更も認可・監査し、replay/rollback を自動受入れしない。rollback は過去 payload を指す新しい公開 revision として明示承認する。

| backend | 公開・競合検出 | 注意と保証の確認 |
| --- | --- | --- |
| 共有 filesystem | 不変 release directory を作成し、同一 filesystem 内の temp file → fsync → published-ref の atomic rename → 親 directory fsync。単一 publisher の直列化下で expected base revision を検査し、不一致は競合として拒否 | rename は比較交換ではない。read→rename だけで複数 writer の更新競合を防げない。複数 publisher が必要なら選択 FS で検証した排他/失効 writer fencing を別設計するまで禁止。NFS/EFS の cache/rename/lock/書込耐久性をローカル FS と同一と仮定せず、read-only mount でも親/entry の置換権限を検査 |
| S3（一般用途 bucket の採用版を検証） | payload は一意 key と `If-None-Match: *`、published-ref 初回も同条件。更新は読んだ ETag の `If-Match` で conditional PUT。412 は競合、409/timeout は読戻し・release ID照合してから再判断 | object 一件の更新は atomic/strong read-after-write だが、複数 key の transaction、filesystem rename/flock はない。ETag は比較用 opaque値で SHA-256 の代わりではない。必要なら VersionId で固定参照し IAM GetObjectVersion を限定許可。versioning だけで競合を防げず、Object Lock も publisher mutex の代わりではない |

SDK retry の成功扱い/409/412/ACK消失は adapter 契約に含める。同一 release の再送と別 revision の上書きを区別し、無条件 PUT や rename への fallback をしない。S3 の署名/credential更新は成熟した AWS SDK 等に任せ、依存最小化のために SigV4/client を自作しない。採用時だけその adapter の依存台帳を追加する。[S3 条件付き書込](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) / [S3 consistency](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel) / [rename](https://man7.org/linux/man-pages/man2/rename.2.html)（確認日 2026-10-27）。

#### controller の取得・cache・更新反映

各 controller は Redis の desired/active の固定 release 参照を優先し、published-ref の最新版へ勝手に追随しない。ローカル bootstrap の固定 source から、起動時と上限付き定期 poll（初期案30秒 + jitter）で published-ref を取得する。ETag/revision の条件付き取得、request timeout、byte/取得並列数/cache容量の上限を設ける。FS watch や S3 event は将来の補助通知で、通知一回を更新の正本にしない。取得した release は byte hash/署名/schema/参照を全部検証してから read-only な version cache に atomic 配置し、途中取得の cache は採用しない。

**公開・反映準備・有効化は別操作。** ファイル変更や poll だけで definition/schedule を有効化しない。定義実体は immutable JSON release、Redis はその hash/参照・登録済み実行用メタデータと反映制御状態を持つ。Redis 上の派生メタデータを別の編集入口にせず、定義実体との二重正本を作らない。

| Redis の最小反映状態 | 意味・更新主体 |
| --- | --- |
| deployment の desired revision | 認可付き apply が expected desired revision を比較交換して設定する目標。不変 release ID/manifest hash/source参照/schema と操作receiptを持つ。公開済み候補と区別 |
| deployment の active revision | dispatch が使用できる有効版。activate が expected active/desired revision を検査し原子的に切替えて監査。desired の登録だけでは変わらない |
| controller ごとの loaded revision | 指定 release の全 byte取得が完了した版。取得だけの状態で、署名/schema検証・反映成功を意味しない |
| controller ごとの applied revision / status | 全参照の hash/署名/schema・runtime対応を検証し、不変cacheとローカル反映準備を完了した版。status は fetching/validating/ready/failed、errorは限定code/機密除去要約。ready はglobal有効化やjob成功を意味しない |
| controller identity / epoch / heartbeat | 登録controller ID、再起動ごとのepoch、server受信のlastHeartbeatAt、当該revisionのlastReportAt。古いepoch/順序逆転の報告を拒否し、heartbeat切れのACKを反映完了に数えない |

初期提案は controller heartbeat 10秒、30秒超で stale、反映報告は状態変化時と heartbeat に同梱し上限管理する。これはexecutorの実行leaseとは別で、詳細数値はD1で検証。controller再起動は新epoch/fetchingから始め、前回applied値をそのまま現在readyとせずcacheを再検証する。失敗報告には対象 desired revision を必ず付け、別revisionの成功を上書きしない。statusの最終受信時刻と成功版の最終時刻を区別する。

採用方針は **全台完了待ちにせず、有効revision対応済みのcontrollerだけがdispatch可能**とする。activateは現在desiredに一致する少なくとも一つの生存controllerのready報告と認可を確認してactiveを切替える。ACKは準備の証拠であり以後の生存保証ではないため、各controller自身も要求/dispatch時にactiveとapplied/epochを照合する。更新の遅れたcontrollerはreadyから外す。全台同時反映が業務上必要なら別のbarrier要件とする。

認可付き apply は検証済み release の実行用メタデータを不変versionとして冪等登録し、desiredをCAS更新する。大きい定義を複数操作に分ける場合はprepared markerと全内容の検証完了を用い、未完了versionを参照可能なdesired/activeにしない。activateはactive参照と監査を一つの原子的操作にする。共有storageとRedisを跨ぐtransactionは約束しない。公開済み未desired/未activeの候補は実行せず、ACK不明はreceipt/revisionを読戻す。競合は再読・人間の再判断へ戻し無条件上書きしない。rollbackも過去payloadを参照する新しいdesired revisionで同じ検証/activateを通し、進行中runを切替えない。

複数 controller がある場合、各要求/dispatch で Redis の active revision と必要な cache version を照合する。未取得/非対応の controller はその revision の受付・schedule/dispatch を拒否し readiness を落として再取得する。全 controller の同時切替や cache の即時一斉更新は保証しない。互換性のある version を段階配備し、非対応変更は drain/restart を要求する。bind/CA/secret参照/UID 等の bootstrap 変更を共通 JSON の hot reload に含めない。進行中 run/再試行は記録済み definition/artifact version を保持し、新版へ差替えない。

初回取得不能・署名/hash不一致・権限不足・active版なしでは起動/新規受付・dispatchを拒否。配布先停止中も、Redis 上の active revision に一致する検証済み cache があり、認可/失効検査が正常な範囲に限り継続できる。cache にない active版、新たな有効化、失効確認不能は止める。破損・署名失効・hash検証失敗はfailedとして対象revisionに報告し、部分反映をreadyとしない。既存 attempt の renew/finish は Redis と認証が利用可能なら継続し、証拠と固定 version を保つ。Redis 不通を古い JSON/cache で代替しない。

#### controller HA との分担

共有JSONは定義/設定配布であり、multi profileのstate/session/lease/scheduler/log調停を代替しない。[controller分散契約](12-controller-distribution.md) の原子的cursor/occurrence・token/slot・active revision・共有LogStore・故障試験を満たして複数起動を許可する。基本scheduler/recoveryにglobal leaderは置かずCASで競合解決する提案。将来排他的taskでleaderを選ぶ場合はlease/fencingが別途必要。S3/file lockや反映ACKだけでHA/election/exactly-onceを保証しない。

### 保存範囲とデータ構造案

Redis Stack/JSON/Search module は必須にせず、標準 Hash/List/Set/Sorted Set/String を使う。key prefix は `belt:<deployment>:v1:`、ID を検証し、内部 key を API 入力として自由指定させない。

| 対象 | Redis 内の表現・不変条件 |
| --- | --- |
| definitions | project/job ID/version ごとの JSON String または Hash。input schema、handler 参照、bundle ID/hash、policy と content hash。コード本体や任意 import path は保存しない |
| queues | 設定 Hash、ready List/Sorted Set、pending/active index。queue/host/executor の枠を原子的予約 |
| runs / attempts | ID ごとの Hash、state/revision/definition version/effectKey/target、試行番号/token/lease expiry/結果、retry policy/選択delay/nextEligibleAtUtcMs/retryDeadlineAtUtcMs |
| workflows / nodes / edges | 不変 graph JSON、node 状態 Hash、親依存 Set/完了数。各 node run の一意作成を script で検査 |
| schedules / occurrences | UTC固定JSON規則/runtime版/cursor/revision Hash、nextDueUtc Sorted Set。schedule ID/version と once / interval index / UTC date/time label の logical occurrence marker によって一度だけ run 化 |
| executors / sessions | 承認 host/capabilities/slots、generation/session epoch、last_seen。TTL だけを実行記録にしない |
| principals / credentials / grants | worker/automationのcertificate identity/fingerprint、token hash、grant/expiry。WebはS3検証済みaccount metadataとrevocationVersion/cache revision、gate、session hash、OTP使用済みstep/rate。Web account正本/暗号secretはS3、plainsecretはRedisへ保存しない |
| request/operation keys | principal/scope/key、request hash、response ref。操作 ACK の再送と重複排除 |
| events / audit | bounded な sequence index と event Hash/JSON。状態変更と同じ script で追加 |
| system error events | 機密除去event/group、first-last/count、eventId receipt、scope/時刻index、drop/gap metadata。係数は[systemErrors設定](11-configuration.md#json-policy)、保持/欠落は[error契約](06-observability.md#system-error-events)。業務状態/auditと別 |
| log metadata | attempt/stream/sequence、ファイル参照、checksum、truncated/gap。大量本文は file |
| deployment metadata | schema version、controller membership/起動epoch、deployment generation、backup/restore 世代 |

ready は `(available_at, created_at, run_id)` の明示的な tie-break を持たせ、二重精度 score に全順序を無理に詰め込まない。lease expiry は Sorted Set で明示走査し、TTL 消滅や keyspace notification を唯一の recovery trigger にしない。時刻は UTC epoch milliseconds、token は単調整数の decimal string、ID は `crypto.randomUUID()`。履歴検索用の日時・queue・state index は同じ操作で保守し、全件 KEYS/無制限走査を API に使わない。

### 原子的な操作と耐久性 ACK

1. enqueue: 認可・型・quota・request key/hash を検査し、run/index/監査/receipt を一つの bounded script で確定。異なる hash の key 再利用は 409。
2. claim: 同じscriptでdeployment generation/登録controller epoch（single時はownerも）、実行先許可、空き slots、候補 state を検査し、ready から処理中へ移し、attempt/lease/token と占有枠を保存する。複数 executor の同時要求でも一つの有効割当と global/host 上限を守る。単なる取り出し後の別 SET は不可。
3. started/renew/finish: generation/session/token/revision/lease を条件に処理。finish は結果・枠解放・retry・DAG 後続解放・監査・再送 receipt をまとめる。外部副作用の処理中に Redis をロックしない。
4. tick/recovery: retry/schedule/lease を bounded batch で評価。occurrence と node 作成の重複排除は script の条件更新で保証する。大きい DAG の解放は cursor 付き小 batch に分け、一度だけ解放する marker を残す。

Redis script は他要求と交錯せず実行できるが、SQL の rollback transaction と同じではない。書込開始前に key type/入力/状態を検証し、途中エラーが起きる実装を避ける。script error/OOM 等で整合性を確信できない場合は受付・dispatch を停止して照合する。無制限 loop を入れず、script 時間・要求数・接続待ちを上限管理する。[Lua 公式](https://redis.io/docs/latest/develop/programmability/eval-intro/) / [Transactions 公式](https://redis.io/docs/latest/develop/using-commands/transactions/)。

初期の耐久性方針案は **AOF 有効 + `appendfsync always` + 定期 Redis スナップショット（バイナリ形式）の backup**。実装対象版・storage/OS の前提を検証し、Redis の成功応答に加えて必要な耐久性を満たしてから enqueue ACK / started 起動許可 / finish ACK を返す。D2 でより軽い方針を選ぶ場合も ACK の意味を明示する。起動時/readiness で AOF/fsync/noeviction 等の実設定と永続化エラーを確認し、要求する耐久性条件を満たさなければ受付・dispatch を開始しない。設定は運用側で管理し、アプリが無断変更しない。

- Redis スナップショット（バイナリ形式）のみでは最後の snapshot 以降を失い得る。AOF `everysec` も ACK 済みの直近約1秒が失われ得るため、durable acceptance と同一視しない。
- Redis 7.2 以降の `WAITAOF` を用いる場合は、書込と同じ接続で script 後に呼び、timeout 付きで返却数が条件を満たすか検査する。script/MULTI 内に置かない。`WAIT` の replica ACK を fsync ACK と混同しない。
- ACK timeout/切断でも書込済みの可能性がある。同一 operation ID の照会・再送を行い、新規 run や副作用を自動増殖させない。保存済み receipt の再応答も耐久性を再確認してから返し、単なる key の存在を fsync の証明にしない。started の記録が失われると副作用だけ残り得るため、耐久性不明の許可では executor を起動しない。
- crash/restore で token/cursor が巻き戻る場合を recovery に含める。AOF/replication による損失ゼロや exactly-once は約束しない。

[Redis persistence 公式](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/) / [WAITAOF 公式](https://redis.io/docs/latest/commands/waitaof/)。

`maxmemory-policy noeviction` と有限 `maxmemory` を使い、キャッシュ用途と混在させない。上限では書込が拒否され得るので、先行して quota/backpressure を掛け、finish/heartbeat に容量と接続枠を残す。active/held/definition/必要な effectKey の TTL 削除は禁止し、終端履歴だけ保持ポリシーで index ごと削除する。永続化 buffer、fork/rewrite、OS 用 RAM とディスクの余裕も必要。[Eviction 公式](https://redis.io/docs/latest/develop/reference/eviction/)。

events は運用履歴であり全面的な event sourcing を必須にしない。runs 等を正とし、監査のない状態変更を作らない。将来の外部通知には同じ原子的操作で outbox を作り、送信は別処理で重複許容にする。
