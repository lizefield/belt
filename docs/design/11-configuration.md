# 設定・環境変数・デフォルト値

ナビゲーション: [概要](../../README.md) ｜ [索引](../README.md) ｜ [要件・概念](01-requirements.md) ｜ [導入・SDK](02-project-integration.md) ｜ [構成・UTC](03-architecture.md) ｜ [永続化・反映](04-storage.md) ｜ [実行](05-execution.md) ｜ [ログ・監視](06-observability.md) ｜ [開発・運用](07-operations.md) ｜ [API](08-api.md) ｜ [セキュリティ](09-security.md) ｜ [Web認証](10-web-authentication.md) ｜ **設定（現在）** ｜ [controller分散](12-controller-distribution.md) ｜ [release](13-release.md) ｜ [検証・計画](14-validation-plan.md) ｜ [一次資料](15-references.md)

状態: **設計文書・未実装**。確定要件/採用契約と数値提案/未決を区別する。読む順序と正本は [設計索引](../README.md) を参照。

状態: **未実装の設計契約 / 初期提案**、基準日2026-10-27。以下のBELT_*は現在利用可能な環境変数ではない。実装時のCLI/JSON schema/設定検証を同じ契約から生成する。数値はD1/D2/D7で検証して確定する。内部定数をすべて環境変数化する目的ではない。

## 設定の読み込みと優先順位

起動する役割はCLI subcommandで選択する。controller/worker/runnerのservice runtimeはOS管理JSONだけを読み、業務のbelt.config.tsをcontroller/supervisorがimportしない。利用側のbuild宣言はtrusted jobs buildでschema/manifest/軽量JobRefへ展開し、その後producerをstrict buildする。producer appは生成refsと専用接続設定だけを使い、registryをimportしない。[型契約](02-project-integration.md#typescript-contract) と [共有JSON](04-storage.md#shared-json-publication) に従う。

bootstrapの値は **対応する明示CLI option > BELT_*環境変数 > ローカルJSON > 安全な既定値**。runtimeの--config > BELT_CONFIG_FILEでJSONの所在を決める。project build/typecheckの--configはtrusted TypeScript build設定entryの指定で別契約とし、service起動へそのTSを流用しない。各表のJSON keyを正規名とし、CLI optionは同じkeyのkebab-caseを対応付ける提案。CLIに秘密値の直書きoptionは設けない。JSON pointerの単位は名前のMs/Bytes等で固定する。未設定と空文字を区別し、空文字/NaN/負値/未知key/BELT_*名/不適合roleの指定は起動時エラー。起動役割に関係する値のみサービス単位で配布し、共有envfileを全roleへ無条件継承しない。

共有設定はallowlistの非機密policyだけ。bootstrapでsource/信頼先/上限を確定し、共有releaseはそれを拡張できない。業務definitionのretry/timeout等は宣言→validate/apply→run snapshot、共有policyはdesired/active→controller appliedの手順で採用する。env/CLIがrun途中にこれらを書換える経路にはしない。envはすべて**起動時のみ（以下S）**で、process.envの変更をwatchしない。動的変更は認可・revision・監査付きAPI/共有releaseが明示対応するfieldだけ。bind/接続先/CA/UID/bootstrapの変更はdrain/restartを要求する。

表のrole: C=controller、E=MVPのworker supervisor、P=利用側producer/CLI、R=固定runner service。PのSDKは同じ検証済み接続optionをprogrammaticに渡せるためJSONファイル必須ではなく、BELT_CONFIG_FILEの必須条件はCLI runtime操作に適用する。専用agentは後続であり、agent専用env/JSON/起動unitは未確定・MVP必須ではない。将来共通executor設定を再利用する場合も別途契約を検証する。Rには制御用変数/credentialを渡さず、host管理設定と限定IPCだけを与える。共通IDはdeployment内の登録ID（英数字と._-、1〜64字）、パスは管理者の絶対path、URLはcredential/query/fragment無しの許可先。環境変数は文字列から厳密に変換する。boolはtrue/false、整数は十進、配列はJSON文字列配列とする。

## identity・配置・保存先

| 環境変数 / JSON key | 型・単位・許容範囲 | role・必須条件 | 既定値 | 変更 |
| --- | --- | --- | --- | --- |
| BELT_CONFIG_FILE / CLI --config | 絶対path | C/E/RとPのCLI runtime操作で必須 | 未設定、起動拒否 | S |
| BELT_DEPLOYMENT_ID / deploymentId | 登録ID | C/E/P必須 | 未設定、接続操作拒否 | S |
| BELT_SERVER_ID / serverId | 登録server ID | C/E必須、同一host各roleで対応を承認 | 未設定、起動拒否 | S |
| BELT_CONTROLLER_ID / controllerId | 登録ID | C必須 | 未設定、起動拒否 | S |
| BELT_EXECUTOR_ID / executorId | 登録ID | E必須 | 未設定、起動拒否 | S |
| BELT_PROJECT_ID / projectId | 登録ID | Pの投入/apply、Rで必須。C/Eの許可projectはgrantで複数指定 | 未設定、該当操作拒否 | S |
| BELT_STATE_DIR / paths.state | 絶対path、専用owner/書込権限確認 | C/E | /var/lib/belt | S |
| BELT_LOG_DIR / paths.log | 絶対path、専用owner/書込権限確認 | C/E | /var/log/belt | S |
| BELT_ARTIFACT_ROOT / paths.artifacts | 絶対path、job UIDが置換/書込不可 | R必須、Eは署名metadata参照だけ | /opt/belt/artifacts、未配備ならdispatch拒否 | S |
| BELT_RUNNER_SOCKET / runner.socket | protected pathname UDS | E/R必須 | 未設定、dispatch拒否 | S |
| BELT_QUEUES / executor.queues | 登録queue ID配列、1〜32 | E、grant内のみ | ["default"]、未承認なら拒否 | S |

server IDはhostname/IPの自己申告で付与しない。Rのproject IDはOS管理の固定値。runId/attemptId/epoch/lease/fencing tokenはcontroller/Storeが発行して限定IPC/APIで渡し、任意に設定するBELT_RUN_ID等を提供しない。credential参照以外の秘密値もここに含めない。

## Redis と controller HTTPS/mTLS

| 環境変数 / JSON key | 型・単位・許容範囲 | role・必須条件 | 既定値 | 変更 |
| --- | --- | --- | --- | --- |
| BELT_REDIS_ENDPOINT / redis.endpoint | 遠隔rediss://host:port、userinfo/query無し。同一host loopbackのredis://は明示local profileで限定 | C必須 | 未設定、起動拒否。127.0.0.1へ暗黙接続しない | S |
| BELT_REDIS_CREDENTIAL_FILE / redis.credentialFile | protected file、username/passwordを検証、ログ出力不可 | C必須 | 未設定、起動拒否 | S |
| BELT_REDIS_CA_FILE / redis.caFile | 信頼CA bundle絶対path | 遠隔C必須 | 未設定、遠隔接続拒否 | S |
| BELT_REDIS_NAMESPACE / redis.namespace | deployment IDから検証して構成 | C | belt:<deployment>:v1:、他deploymentと共有不可 | S |
| BELT_CONTROLLER_ENDPOINTS / controller.endpoints | HTTPS originのJSON文字列配列、重複なし1〜8件。全要素のCA/SAN/identityを検証 | E/P必須、browserは選択したsame origin | 未設定、接続操作拒否。1件はsingle/LB、複数はclient分散 | S |
| BELT_BIND_HOST / http.bindHost | 明示IP | C | 127.0.0.1。private bindも要明示承認 | S |
| BELT_PORT / http.port | 整数1〜65535 | C | 8443、bind失敗は停止 | S |
| BELT_TLS_CA_FILE / tls.caFile | CA bundle絶対path | C/E/P必須 | 未設定、該当listener/接続拒否 | S |
| BELT_TLS_CERT_FILE / tls.certificateFile | 証明書絶対path | C/E/P必須 | 未設定、該当listener/接続拒否 | S |
| BELT_TLS_KEY_FILE / tls.privateKeyFile | 秘密鍵file、専用owner/0600相当 | C/E/P必須 | 未設定、該当listener/接続拒否 | S |
| BELT_API_TOKEN_FILE / auth.tokenFile | 期限/scope付きtokenのprotected file | P automationで追加tokenを使う場合 | 未設定。mTLSの代替にはしない | S |
| BELT_ENROLLMENT_TOKEN_FILE / enrollment.tokenFile | 一回限りtokenのprotected file | E初回登録時だけ必須 | 未設定、初回登録拒否 | S |
| BELT_AUTH_POLICY_FILE / auth.policyFile | OS管理JSON、principal/identity mapping/bootstrap参照 | C必須 | 未設定、起動拒否。空DBの先着admin禁止 | S |
| BELT_WEB_ENABLED / web.enabled | bool | C | true、ただし認証が未整備ならlistener開始不可 | S |
| BELT_WEB_ORIGIN / web.origin | exact HTTPS origin | CでWeb有効時必須 | 未設定、Web listener拒否 | S |
| BELT_HTTP_BODY_MAX_BYTES / http.bodyMaxBytes | 1024〜65536 bytes | C/E/P | 65536、job args/resultは下位上限 | S |

TLS 1.2以上、SAN/chain/用途/期限と毎要求の失効を検査する。鍵/パスワード/tokenの既定値、BELT_TLS_VERIFY=false、無認証モード、HTTP fallback用変数は用意しない。REDIS_URL内passwordや環境変数/argvの平文secretを推奨しない。worker/automation APIのmTLS/認可はWeb無効でも緩めない。Webは専用HTTPS listenerとTOTP/session/CSRFで、client証明書無しをworker APIへ拡張しない。RedisのAOF/fsync/noeviction/ACL/TLSはDB運用の検証条件で、環境変数でサーバー設定を無断変更しない。

## definition source と反映

| 環境変数 / JSON key | 型・単位・許容範囲 | role・必須条件 | 既定値 | 変更 |
| --- | --- | --- | --- | --- |
| BELT_DEFINITION_SOURCE / definitions.source | local/shared-fs/s3 | C、publisher操作P | local | S |
| BELT_DEFINITION_ROOT / definitions.root | 許可root絶対path | local/shared-fsで必須 | /etc/belt/definitions、未取得版はready不可 | S |
| BELT_DEFINITION_CACHE_DIR / definitions.cacheDir | 専用owner絶対path | C | <state>/definition-cache | S |
| BELT_DEFINITION_POLL_MS / definitions.pollMs | 5000〜300000 ms + jitter | C | 30000 | S |
| BELT_RELEASE_TRUST_FILE / release.trustFile | OS管理read-only署名鍵/用途/失効policy参照 | C/E/R/applyを行うP必須 | 未設定、apply/dispatch拒否 | S |
| BELT_S3_BUCKET / definitions.s3.bucket | 検証済みbucket名 | s3採用時必須 | 未設定、s3操作拒否 | S |
| BELT_S3_PREFIX / definitions.s3.prefix | 許可prefix、上位参照不可 | s3採用時必須 | 未設定、s3操作拒否 | S |
| BELT_S3_REGION / definitions.s3.region | 採用AWS region | s3採用時必須 | 未設定、s3操作拒否 | S |

local/shared-fsはfilesystem adapterの同じ不変release契約を使うが、共有mountのrename/cache/lock/耐久性は別検証。S3は任意SDK adapter、固定AWS endpointを使い、任意endpoint/URLをmanifestから受け付けない。AWS credentialは新規生成せず、配備環境のrole/短期credentialまたは管理者が許可した標準credential providerで取得する。AWS_ACCESS_KEY_ID等の既存AWS変数はSDKの契約であってbeltの新設変数ではない。許可providerとIAM範囲を配備設定で固定し、job UIDのmetadata/credentialアクセスを拒否する。secretを共通JSONに保存しない。

desired/active revision、各controllerのloaded/applied/status/epoch/heartbeatはRedisの認可付き操作で管理する。環境変数で採用版/反映成功を偽装しない。共通sourceの有効化はenv hot reloadで行わない。

## 実行・scheduler・concurrency

| 環境変数 / JSON key | 型・単位・許容範囲 | role・必須条件 | 既定値 | 変更 |
| --- | --- | --- | --- | --- |
| BELT_CONCURRENCY / executor.concurrency | 整数1〜64、管理者承認slots以下 | E | 4、host/queue枠との最小値 | S |
| BELT_CLAIM_BATCH / executor.claimBatch | 整数1〜4、free slots以下 | E/C | 4、prefetch=0固定 | S |
| BELT_LONG_POLL_MS / executor.longPollMs | 1000〜20000 ms | E/C | 20000、HTTP timeoutはこれより長く | S |
| BELT_HEARTBEAT_MS / executor.heartbeatMs | 1000〜10000 ms | E/C、controller値と整合 | 5000 | S |
| BELT_LEASE_MS / executor.leaseMs | 15000〜120000 ms、controllerが決定 | C、Eは受領値で動作 | 30000 | S |
| BELT_LEASE_SAFETY_MS / executor.leaseSafetyMs | 1000〜60000 ms、lease未満 | C/E、kill grace/RTT/pause予算を検証 | 10000 | S |
| BELT_ATTEMPT_TIMEOUT_MS / defaults.attemptTimeoutMs | 1000〜86400000 ms | Cでdefinitionの未指定時default | 900000（15分） | S |
| BELT_KILL_GRACE_MS / defaults.killGraceMs | 1000〜60000 ms | C/R、run snapshotを優先 | 10000 | S |
| BELT_QUEUE_WAIT_MS / defaults.queueWaitMs | 1000〜604800000 ms | C、definitionの未指定時default | 86400000（24時間） | S |
| BELT_SCHEDULER_ENABLED / schedule.enabled | bool | C | true、single/multiともUTC cursor/occurrence CAS。modeの受入gateを先に検証 | S |
| BELT_SCHEDULER_TICK_MS / schedule.tickMs | 100〜10000 ms | C | 1000、秒精度SLAではない | S |
| BELT_CLOCK_STEP_MS / clock.stepThresholdMs | 500〜10000 ms | C | 2000 | S |

leaseはheartbeatの少なくとも3倍以上、safety<leaseを起動時検証し、killGrace/RTT/GC pauseと停止余裕を含めたprofileをD1で試験する。値を満たすだけで停止保証とはしない。Eがlease/slotsを自己申告して承認上限を広げられない。job単位timeout/deadline/retry、queue/host slotsは認可付きdefinition/policyに保持しrunで固定する。job retryの係数は [defaults.retry](#json-policy) 行、単調非減少delay/予算/UTC次回日時は [backoff契約](05-execution.md#retry-backoff) に従う。これらはJSONで宣言し、全jobに作用する個別envの増設はしない。

once/interval/daily/weekly/monthlyの定義・評価はUTC固定。[UTC契約](03-architecture.md#utc-time-policy) のZ/単位付きepoch msを使い、calendar.atのHH:mmとweekday/月末もUTC。JSONのtimezone/timeZone/dst設定は設けず、値がUTCでも未知fieldとして拒否する。表示timezoneだけUTC既定でWebのJST等へのprojectionを許す。NodeのTZ環境変数/表示設定は予定を変えない。calendarの対象年/計算予算はschedule契約で管理し、catch-up/overlapはUTC定義に明示する。

## telemetry・保持・logging

| 環境変数 / JSON key | 型・単位・許容範囲 | role・必須条件 | 既定値 | 変更 |
| --- | --- | --- | --- | --- |
| BELT_TELEMETRY_ENABLED / telemetry.enabled | bool | C/E | true。無効時はdisabled/unavailable表示 | S |
| BELT_TELEMETRY_INTERVAL_MS / telemetry.intervalMs | 10000〜60000 ms + jitter | C/E | 10000 | S |
| BELT_TELEMETRY_STALE_MS / telemetry.staleMs | 30000〜300000 ms、周期の3倍以上 | C | 30000 | S |
| BELT_TELEMETRY_TTL_MS / telemetry.ttlMs | 120000〜3600000 ms、staleより大 | C | 120000 | S |
| BELT_TELEMETRY_HISTORY_MINUTES / telemetry.historyMinutes | 整数0〜2880分、0で履歴なし、2880超は起動拒否 | C | 2880（48時間）、1分bucket最大2880点。MVPの全窓を表示する既定案 | S |
| BELT_TELEMETRY_SAMPLE_MAX_BYTES / telemetry.sampleMaxBytes | 1024〜4096 bytes | C/E | 4096、正式指標3項目・空き容量の登録FS最大4個 | S |
| BELT_TELEMETRY_HOST_COLLECTOR / telemetry.hostCollector | bool | C/E、server登録の代表指定と照合 | false。管理者が一つだけ明示true | S |
| BELT_LOG_LEVEL / logging.level | debug/info/warn/error | C/E/R/P | info、debugでもsecret出力不可 | S |
| BELT_LOG_REDACTION_FILE / logging.redactionPolicyFile | 機密field allowlist/追加redaction rule参照 | C/E/R | 未設定でも組込mandatory redactionは有効 | S |
| BELT_JOB_LOG_MAX_BYTES / logging.attemptMaxBytes | 65536〜10485760 bytes | C/E/R | 10485760（stdout/stderr合計） | S |
| BELT_LOG_SPOOL_MAX_BYTES / logging.spoolMaxBytes | 10485760〜268435456 bytes | E | 268435456、finish evidence予約別 | S |
| BELT_LOG_RETENTION_DAYS / logging.retentionDays | 整数1〜30日 | C | 7、容量policyの全体byte capとの早い方 | S |

server/resourceTarget/instance登録数とactive/held hard cap、definition cache容量はD1で明示設定必須。共通容量・期間と上限時の動作は [容量policy](#capacity-policy)、各機能固有の値は以下のJSON/env表を正本とする。

指標の対象/scope/代表collector/欠測と時刻範囲削除・点数cap・keyTTLの違いは [監視契約](06-observability.md#resource-telemetry) を正本とする。ここではenv/JSONの係数を管理し、任意path/追加指標や動的admissionを設定だけで有効にしない。hostCollector=falseなら代表sampleは報告しない。mandatory redactionの無効化はできず、生入力/秘密/tokenを設定dumpへ出さない。

<a id="json-policy"></a>

## JSON policy に保持する初期値

環境変数を追加しない以下の値も設定契約に含める。単位と許容範囲はJSON schemaで検証し、組込security floorを下回る変更を拒否する。すべて初期案で、動的変更は明示したpolicy fieldの認可付きrevision更新のみ。採用版の変更は新規runから適用し、既存run/attemptを途中変更しない。

| JSON policy / 適用先 | 初期値と制約 | 変更 |
| --- | --- | --- |
| auth.enrollmentTtlMs / C | 600000ms（10分）、一回限り・identity束縛 | 起動時。登録済みtokenを延命しない |
| auth.certificateMaxAgeDays / PKI運用 | 30日以内、実際の発行/更新期限はD7確定 | PKI/配備の承認手順 |
| auth.leafOverlapMs / C/E | 最大600000ms、CA trust bundleの重複期限とは別 | 承認rotation手順 |
| auth.session / Web C | 値/上限は [Web設定表](#web-auth-policy) のauth.session行が正本。cookie/CSRF必須 | 起動時、延命は再認証 |
| auth.automationTokenTtlMs / C/P | 3600000ms（1時間）、mTLS併用・用途scope限定 | token発行時のpolicy、既存tokenを延命しない |
| http.rate / C | 参照30 req/s burst60、通常変更5 req/s burst10、危険1 req/s burst2、enrollment5/分。認証前IPと認証後principal/projectで制限 | 認可付きpolicy、予約枠を維持 |
| definitions.controllerHeartbeat / C | interval10000ms、stale30000ms、revision status報告は状態変化時+heartbeat | 起動時、execution leaseと別 |
| definitions.cache / C | bytes/version数capとsource要求数/時間上限をD1で明示設定必須。active/実行中参照versionの保持を優先し、cap不足なら新releaseを拒否 | bootstrap/配備、無制限defaultなし |
| resources.registeredServerCap / C | server/resourceTarget/instance数capをD1で明示設定必須。未知ID自動登録なし | 認可付きpolicy、登録済み範囲以下にしない |
| concurrency.host/queue、active/held caps / C | workload依存のため未設定。dispatch開始前に管理者が正整数上限を登録 | 認可付きpolicy、既存予約を強制解放しない |
| controller.mode / C | single（既定）またはmulti。singleはowner guard、multiは登録ID/起動epoch・共有generation/Redis/LogStore等の [gate](12-controller-distribution.md) を検証。初期MVPはsingle、未対応binaryでmultiを拒否 | 起動時・配備変更、envやworker自己申告で切替不可 |
| client.distribution / E/P | endpoint一覧のshuffled round-robin、long pollは一worker一つ。connectTimeoutMs=2000、再接続backoffBaseMs=500/maxMs=10000、endpoint冷却のjitter。renew等の総deadlineはlease安全余裕内 | 起動時。TLS/認可緩和なし、job retryとは別policy |
| logs.sharedRoot / C | multiのfilesystem LogStoreは全controllerが読書できるprotected共有rootを明示必須。未設定/mount不一致/排他的publish未検証はmulti起動拒否。singleはpaths.logを使用。容量/保持/ownerはlog契約を継承 | 起動時・配備審査、localへのfallbackなし |
| defaults.retry / C/definition | maxAttempts=3、maxElapsedMs=3600000、baseDelayMs=5000、multiplier=2、maxDelayMs=300000、jitterRatio=0.2、retryableCodes=[]。範囲と合成時刻overflowは [retry契約](05-execution.md#retry-backoff) で検証 | 認可付きdefinitionの新versionを新runへ固定。再起動やenv変更でdelay/予算reset不可 |
| systemErrors / C/E | 暫定retentionDays=7（1〜30）、maxEntries=10000/maxBytes=33554432、eventMaxBytes=2048/batchMaxEvents=4/batchMaxBytes=8192、dedupeWindowMs=60000。sourceRate5/s burst10、globalRate100/s、buffer1000件/4194304bytes/retryAgeMs=300000。UI既定24h/設定保持範囲、page100/detail2KiB。正整数/合成byte制約・index/receipt込みbudgetを起動検証し、無制限値は不可 | 初期設定。保持/予算変更は認可付きpolicyと監査。resource48h/job log/auditとは別 |
| schedule.defaults / C | UTC固定、timezone/DST fieldなし、overlap=forbid、invalidDate=skip、最短interval60000ms、lookback24h/上限168h、候補1000件/計画、misfireはskipを初期案 | schedule定義/既存の計算予算契約。bound超過を無視しない |
| shutdown.drainMs / C/E | 初期60000ms、1000〜3600000ms。期限後は停止確認/heldへ移行。serviceのTimeoutStopSecはdrain+kill grace+flush余裕より長くする | 起動時、OS manager設定と一体で検証 |
| telemetry.historyByteBudget / C | 履歴有効時は正整数bytesをD1で明示設定必須、未設定起動拒否。登録resourceTarget数×最大2880点×最大4KiB/payloadとRedis overheadを実測し総点数/byte capを検証。業務状態/finishの予約分を除外 | 起動時、予算変更は配備審査 |
| web.pollMs / C/browser | 5000ms以上、resource履歴queryは最大48時間/2880点とseries数上限・pagination必須 | 認可された表示設定、quota内 |

resource telemetryのhost/container可視性やundefinedの扱いはcollector契約、audit保持の最低期間は運用要件でありenvで迂回しない。S3/共有folder/PKIの資格情報とOS cgroup設定はこのJSONに平文保存せず、参照と配備条件だけを置く。

## systemd 原本と役割別設定

Linux VM/EC2向けの [MVP3種unit template](07-operations.md#systemd-templates) をフレームワーク配布物に同梱する設計。unit placeholderは環境変数ではなく、OS管理者が@NODE_BIN@/@BELT_ENTRY@/@RELEASE_DIR@とrole/userを固定して検査する。ExecStartの--configで指定したrole別JSONがBELT_CONFIG_FILEに優先する。StateDirectory/LogsDirectoryとpaths.state/logを一致させ、role間で共通default directoryを共有しない。secret参照は専用UIDのprotected fileで管理し、runnerへ制御用BELT_*/AWS/Redis/PKI情報を継承しない。

RestartSec=5秒/StartLimitIntervalSec=60秒/StartLimitBurst=5、TimeoutStopSec=120秒は配布原本の初期提案で、belt環境変数としてOS設定を変更するものではない。drain60秒/kill grace10秒/flush余裕と各roleの資源・書込先・mount/egress制約を配備者が同時検証する。unitの登録/enable/start/解除はsystemctl等のOS操作で、belt CLIが自動実施しない。

## Development の設定

[開発CLI](07-operations.md#development-cli) はdev.jsonからrole別JSON、jobs/producerのprojectとtrusted設定entry、生成JobRef/manifestの出力契約、固定launcher/runnerを参照する。jobs→生成→producerのstrict順序と、CI/admin credentialによるapply/activateを検証し、producer/workerに定義管理権限を渡さない。dev専用の秘密値やTLS迂回環境変数を増やさず、既存56変数は対応roleにだけ適用する。defaultはWeb組込、port8443/bind127.0.0.1、watch=false、既存Redis接続先必須、agentなし、drain60000ms。source/配備先・CA/署名鍵・UID境界が未準備なら起動しない。--watchだけが開発orchestrationの明示optionで、Production自動restartの設定ではない。--config > BELT_CONFIG_FILEの入口とrole別明示値 > env > role JSON > defaultの優先順位を保持する。

## 具体例と起動時検証

次は**提案の設定参照例**であり、コマンド実行やファイル作成済みを意味しない。必要な証明書/権限/runner/登録は別途用意する。秘密値は含めない。

```sh
# supervisor向け。Redis接続情報と秘密値は配らない。
BELT_CONFIG_FILE=/etc/belt/orders-executor.json \
BELT_CONTROLLER_ENDPOINTS='["https://belt.internal.example:8443"]' \
BELT_CONCURRENCY=4 ./node_modules/.bin/belt worker start
```

この例だけではdeployment/server/executor IDや証明書等を満たさず起動できない。JSONに必要項目を配備し、merged config検証を先に行う。実装時にはsecretを表示しないcheck-config操作を提供し、値の出所（CLI/env/local JSON/default）、型/範囲、role、相互制約、owner/mode、証明書/署名/接続先、Redis耐久性と必須quotaを検証する。認証情報/PKI/共有sourceの未準備、unknown設定、scope超過を無視して起動しない。CA/credentialの内容rotationもD7の承認手順で再読/接続更新し、envの動的更新とは区別する。

受入試験はpriority/空文字/未知env/単位overflow/role不一致/不正URL/秘密値混入/期限切れ/読み取れないfile/共有policyによるbootstrap上書き/危険default/古いprocess設定を含む。全設定を無理にenv化せず、公開契約をJSON schema・CLI・環境変数の同じ検証へ接続する。

<a id="web-auth-policy"></a>

## Web TOTP・accountの設定契約

採用方式は [Web認証](10-web-authentication.md)。以下は未実装のJSON契約・初期数値案で、秘密envの追加はしない。既存56環境変数を維持する。Web設定をworker/runnerへ継承しない。CLI/env > JSON > defaultの既存規則は対応済みfieldだけに適用し、任意fieldのCLI/env自動追加を意味しない。

| JSON key / C・管理CLI | 必須条件・値・既定値・変更 |
| --- | --- |
| web.auth.mode | Web有効時totp必須、無認証defaultなし。起動時 |
| web.origin / web.listen | 既存BELT_WEB_ORIGINに対応するexact HTTPS originと、Web専用の明示port/listen。addressはloopback既定、portは未設定でWeb起動拒否、worker mTLS listenerと同じaddress/port不可。起動時 |
| web.auth.accountStore | kind=s3、bucket/key/region、KMS key識別参照、暗号contextのdeployment、AWS role/標準credential chain。接続先/鍵/権限の安全な既定なし、未設定Web起動拒否。起動時、store交換は配備審査 |
| web.auth.accountLimits | catalog最大1000件/2097152bytes、cacheも以下。変更はgate/CAS手順、増大は予算検証 |
| web.auth.totp | SHA1/6桁/30秒/T0=0、windowSteps=1（±1）、secret160-bit以上。account生成時固定、変更は新secret登録 |
| web.auth.pendingTtlMs | 600000、1..600000ms。一回ticket256-bit以上、延命なし。起動時 |
| web.auth.metadataFreshnessMs | 30000以下、期限超過はWeb gate closed。失効反映はpoll待ちでなく更新gate手順。起動時 |
| web.auth.loginRate | ID capacity5/refill1毎60秒、IP capacity30/refill1毎10秒、global capacity100/refill100毎60秒を連続補充。cooldown最大300000ms、key cap10000/TTL600000ms。起動時、試験で厳格化可能、無効化不可 |
| web.auth.verifyConcurrency | controllerあたり4、1..16。復号/KMS要求にも適用し、global rateは共有Redis。起動時 |
| web.auth.reauthMaxAgeMs | 300000以下、危険操作で必要。同step OTP再使用なし。起動時 |
| auth.session | idle900000/absolute28800000ms、account10件/全体10000件・metadata16MiB、超過新規拒否。cookie/CSRFと毎要求gate/account版照合。S3へlastSeen毎回保存なし。失効/role変更/再登録で全該当session破棄 |

SSE-KMS/envelope・非公開bucket/IAM・controller専用復号・限定管理経路が未準備ならWebを開始しない。bootstrapは準備済み管理CLIだけで開始でき、短命登録確認routeのみpending状態で利用可能。通常loginはactive accountのみ。作成済みsecret/QRやAWS credentialを設定例に記載しない。S3保存先は将来再検討可能だがAccountStore交換はCAS/失効/recovery契約試験が条件。

<a id="capacity-policy"></a>

## 容量・保持・到達時の動作


| 対象 | 初期上限案 | 到達時の振る舞い |
| --- | --- | --- |
| HTTP JSON | byte上限はBELT_HTTP_BODY_MAX_BYTES（env表）、深さ16、URL/headers/timeout制限 | 413/400。parser 前に byte 制限 |
| Job 入力/結果 | 入力 32 KiB、結果 16 KiB | 422、巨大物は外部成果物参照 |
| queue pending | queue 10,000、全体 100,000 runs | 429 + Retry-After。受付済み run を黙って捨てない |
| Redis 接続/要求待ち | 1,000 要求 | 503、heartbeat/finish 用の予約接続・枠を確保。無制限 offline queue を禁止 |
| executor claim | slots 以下、最大 4 | prefetch しない。空なら long poll |
| controller long poll | executor ごと 1、全体 1,000 | 超過は 429、jitter 付き再接続 |
| worker log spool | BELT_LOG_SPOOL_MAX_BYTES（env表）、host単位 | 古い log を切り詰め gap marker。新規 claim 停止 |
| attempt log | stdout/stderr合計はBELT_JOB_LOG_MAX_BYTES（env表）、1行64KiB | 超過後は読み捨てつつ truncated を明示し pipe は drain |
| 全体 log storage | 10GiB、期間はBELT_LOG_RETENTION_DAYS（env表） | 終端分から削除。active 分は上限で truncate |
| 終端 run 履歴 | 30 日かつ 100 万件 | 古い終端分を batch 削除。active/held は削除しない |
| 監査 | 90 日かつ 200 万件 | 期限内上限到達は export/運用介入。監査必須の変更を停止 |
| request keys | 7 日、100 万件 | 有効 key を黙って evict せず新規受付を抑制 |
| Redis RAM / ディスク | RAM は maxmemory 前に警戒、ディスク空き 1 GiB または使用率 90% を警戒値 | log/受付/claim を順次抑制、終了記録用予約領域を維持 |

queue pending は scheduled/ready/retry_wait/blocked を含み、workflow は作成時に node 分を予約する。held/active は別の hard cap も設け、保留が際限なく増えないよう claim を止める。schedule の大量展開、失敗 retry storm、巨大 DAG、UI の全件取得をすべて bounded にする。長時間 query / Lua script / cleanup は API と heartbeat を阻害しない batch に分割する。

Redis は `maxmemory-policy noeviction` とし、汎用キャッシュと混在させない。active/held/definition/必要な effectKey は自動 TTL 削除せず、lease expiry index を明示走査する。終端保持は「期間か件数の早い方で削除」と明示し、参照・index・重複排除期間を整合させる。ただし監査の最低保存期間を守れない容量では自動削除せず停止・拡張・export を選ぶ。無制限保存と有限容量を同時には約束しない。active/held が上限を占めた場合は新規受付を止め、保留解消を要求する。
