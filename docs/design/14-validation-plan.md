# 検証・故障注入・段階実装計画

ナビゲーション: [概要](../../README.md) ｜ [索引](../README.md) ｜ [要件・概念](01-requirements.md) ｜ [導入・SDK](02-project-integration.md) ｜ [構成・UTC](03-architecture.md) ｜ [永続化・反映](04-storage.md) ｜ [実行](05-execution.md) ｜ [ログ・監視](06-observability.md) ｜ [開発・運用](07-operations.md) ｜ [API](08-api.md) ｜ [セキュリティ](09-security.md) ｜ [Web認証](10-web-authentication.md) ｜ [設定](11-configuration.md) ｜ [controller分散](12-controller-distribution.md) ｜ [release](13-release.md) ｜ **検証・計画（現在）** ｜ [一次資料](15-references.md)

状態: **設計文書・未実装**。確定要件/採用契約と数値提案/未決を区別する。読む順序と正本は [設計索引](../README.md) を参照。

## テストと故障注入

Node 標準 `node:test` / `assert` と一時ディレクトリ、対象版の実 Redis、実子プロセスを基本にする。domain は注入 Clock/Random を使い、wall-clock sleep に依存しない。

| 検証 | 必須ケースと受入条件 |
| --- | --- |
| retry/backoff | 初回attempt=1/retryNo=1の対応、maxAttempts=1/3、5〜6秒→10〜12秒、jitter最小最大/previous floor/cap/overflow、elapsed予算境界、failure原子更新/ACK消失/再起動/二重tick/cancel競合、非retryable/同effectKeyを検証。HTTP再接続とservice restartでjob予算をresetしない |
| domain | 許されない遷移、retry 上限、DAG cycle/join/失敗伝播、終端不変、held 解消。列挙した不変条件を満たす |
| storage 契約 | 同時 claim 100 要求でも有効 attempt 一つ、global/host slot 超過なし。enqueue/finish/DAG 解放と index/監査が原子的。SQL rollback を前提とせず script 事前検証とエラー時停止・照合が機能する |
| crash 点 | Redis 更新と耐久性 ACK の前後、claim 後、started ACK 前後、spawn 前後、外部効果後 finish 前、finish 保存後 ACK 前を強制 kill。耐久性 ACK 済み状態が前提の通常再起動で消失/虚偽成功なし。許容 RPO を伴う restore の損失は別途記録 |
| system error | component/identity偽装・project越境・機密message/stack・2KiB/8KiB超過・rate stormを拒否。60秒dedupeとeventId再送/ACK消失で二重countなし。Redis/HTTPS/local stderr停止、queue1000件/4MiB/5分、再起動/unknown gap、7日/件数bytes削除/TTL、UIフィルタとinfra grantを確認。logger失敗が再帰/job停止を招かない |
| resource 48h保持 | 0/1/2880/2881分の設定境界、48時間ちょうど/超過、key TTL更新中のentry削除、無通信TTL、cleanup backlog/停止/再開/epoch変更、host/container target数・controller/worker instance数増加とmemory budget、UI窓/2880点/gapを検証。ジョブログ/監査の保持は別契約 |
| resource telemetry | 非root/proc非公開/hidepid/cgroup v1-v2/親quota不可視/namespaceを検証。CPU初回/巻戻り/分母/100%超、memory割合の分母、statfsの実行UID別bavail/拒否/巨大値/滞留、stale/TTL/重複target/旧epoch、scope越境/任意path/label拒否、容量dropを確認。正式指標3項目のみで計算用raw値・RSS/heap/load/network/IOを送信/保存せず、heartbeat/finishや固定slotを壊さない |
| 共有 JSON source（採用時） | 同時 publish の expected revision/ETag 競合、公開途中 kill、欠落/改変/巨大 manifest、S3 409/412/ACK消失、mount断/403、cache差異、active変更中の取得、旧 controller を試験。混合版・無条件上書き・未検証版の実行なし。desired競合、loadedだけ/partial apply/failed、stale ACK、再起動epoch、rollback中の実行固定を確認。GC/restore が参照中版を壊さず、共有 JSON のみで HA 起動しない |
| VPC/TLS 運用 | private DNS/IP の SAN/chain/用途検証、wrong name/期限切れ/更新失敗/CA rollover/失効/既存接続を確認。SG 許可/拒否、Redis への worker 接続拒否、HTTP fallback 不可。任意 ALB profile は header 偽装・迂回・target 区間を別試験し、未検証なら有効化不可 |
| 通信 | drop/遅延/重複/順序反転/長い partition、stale token/epoch/finish。失効した token/epoch の報告で状態が変わらない |
| command | 固定interpreter/path/argv/cwd/env/stdin/option injection/secret非継承、巨大出力、exit/signal/spawn error、timeoutとsetsid子孫を検証。任意shell文字列/動的scriptを拒否し、停止未確認はheld |
| development CLI | dev startがcontroller/worker/組込UIをforeground管理しagent不要。個別起動/port競合/部分失敗/Ctrl-C/watch/strict/TLS/固定UID launcherを検証。既存Redis/processの破壊や自動trust変更なし |
| unit同梱 | controller/worker/runnerのMVP3原本とrole別drop-inをpackageに含める。未置換placeholder/不正instance/owner/設定pathを拒否し、手動install/enable/start/status/stop/update/uninstallを対象OSで再現。managerのactiveとアプリreadyを区別 |
| service lifecycle | SIGTERMで受付/claim停止後も期限内renew/finishを処理。drain期限/TimeoutStopSec/強制kill/Restart制限、別UID runner unit残存、再起動時journal照合を検証。停止未確認のlease/slot先行解放なし |
| process | CPU loop、SIGTERM 無視、child spawn、supervisor SIGKILL、ホスト再起動。停止確認できない場合は held |
| UTC契約 | OS/process/browser TZをUTC/Asia-Tokyo等へ変えても同じUTC定義/実行instantを保存/通信/監査/telemetryへ出力。Z/epoch ms厳密検証、非UTC offset/naive/不正日付/秒ms混同拒否、Web表示のみ変更、単調origin破棄、時計stepと48時間windowを確認 |
| schedule 計算 | fake wall/monotonic clockでUTC interval anchor前/一致/直後、daily位相、UTC日付/ISO weekday/月末skip-lastDay/閏年/対応年終端を検証。timeZone/dst等の未知fieldと非UTC日時を拒否。WebのJST/DST表示変更がdue/definition/runを変えず、previewとoccurrenceが一致 |
| scheduler/restart | grace境界、skip/coalesce/bounded、長期停止、overlap forbid/allow、held、quota、重複tick、NTP前進/後退、process suspend、表示TZ情報変更、計算予算超過、Redis停止・ACK消失。boundedな実行とcursor/marker一貫性を確認 |
| 容量/永続化 | Redis maxmemory/noeviction、OOM、AOF 書込失敗/full disk、rewrite、readonly、接続枠飽和、破損 log 末尾、巨大出力。受付抑制・終了枠確保・監査保持を検証 |
| multi profile（提供前必須） | endpoint切替中のclaim/started/finish ACK消失、同時schedule/active切替/回収、同じsession resumeと旧epoch拒否、slow/draining controller、共有logの二重publish/全台読取、telemetry/error重複、Redis停止/時計step/restore、sticky無効・LBなしを試験。operation ID照合でjobの盲目的再実行なし |
| Redis recovery | primary/controller 別々の kill、AOF 再読込、Redis スナップショットからの restore、ACK 消失、WAITAOF timeout、script cache 消失。永続性未確認の受付/起動許可なし、巻戻りは照合へ |
| TypeScript gate | 有効tsconfig/strict/noImplicitAny等の必須設定、args/result/jobnetの型エラーfixture、any/ignore/assertion規約、型失敗後の古いdist拒否、manifest provenanceとruntime入力/結果検証。transpile-onlyを正式buildとしない |
| typed enqueue生成 | job+registry追加だけで軽量JobRef/schema/manifestを生成し共通APIへ投入でき、job別handler変更不要。producer import graphにjob/registry/業務secret依存なし。生成順序/古いref/alias衝突/未対応schema、未登録404/入力422/hash409/未反映503、分散apply/ACK消失/新旧worker/retired版を検証。controller/supervisorもcodeをimportしない |
| 利用側 SDK/CLI | belt 本体と別の最小 TypeScript project から defineJob/registry → manifest → apply → enqueue → worker を確認。生成refs/schema/hashの型とruntime一致、未登録job、改変artifact、固定した job version での retry を検証。本体への業務 job 追加なし |
| TOTP/account gate | 初回admin競合、pending確認/期限/再登録、RFC vectorsと同step並列login、S3 CAS/Redis反映失敗/旧cache・restore replay隔離、KMS拒否、権限失効、QR/secretログ漏えい、account/IP/global rateを[認証受入条件](10-web-authentication.md#auth-operations-tests)で検証 |
| security gate | [Security acceptance tests](09-security.md#security-tests) のTLS/失効/認可/Web/OS/artifact/FS/Redis/restore/releaseケースを全て満たす |
| 認可 | viewer の変更拒否、host/definition scope、失効 token、再登録、path traversal、option injection、XSS、CORS/body limits |
| 復元 | 稼働中 backup → 別環境 restore、復元前 credential の worker の再接続拒否、全 active 照合、migration 失敗。RPO/RTO とログ欠落を記録 |
| 負荷 | D1 の初期 profile で latency/throughput/memory/AOF/queue 待ち時間を記録。設定上限が効き、回復後 backlog を消化 |

副作用模擬サーバーに effectKey の受領記録を置き、成功応答を故意に消失させる。冪等ありでは業務効果が一回、冪等なしでは held が必要になることを確認する。「実行回数が必ず一回」をテスト条件にはしない。一般 command の外部 fence がない限界も受入試験の説明に含める。

## 段階実装計画

各段階はその受入条件を満たしてから次へ進める。P5の正式提供物はMVP3種unit原本/手動手順、development一括/個別起動、resource Web表示と [npm release契約](13-release.md) に沿う公開準備を含む。期間を約束せず、順序と検証可能な出口を固定する。

| 段階 | 成果物・依存 | 受入条件 |
| --- | --- | --- |
| P0: 判断と骨格 | D1〜D9 の所有者/暫定結論、workspaces、contracts/domain、adapter ports、依存台帳 | import 方向検査、型検査、wire fixture、公開 SDK/job 宣言/schema subset、単独 job と workflow 定義の分離、UTC schedule JSON/Clock/次回計算契約、状態/DAG 基本検証。Node/Redis/client 対象版、ACK/永続化と Redis 配置を記録 |
| P1: Redis 縦断 | 共通enqueue SDK/API、利用側job/producerのstrict build、軽量JobRef/schema/manifest生成、storage-redis、enqueue/claim/finish、複数 worker、登録済み TypeScript由来のcompiled JS/command | 利用側コードから本体編集なしで実行。Redis 耐久性 ACK 後 kill から回復。上限・token 条件付き更新。非冪等結果不明は held |
| P2: 信頼性 | retry/deadline/cancel、journal、reconciliation、履歴/ログ上限、telemetry collector/Redis集約 | 主要 crash 点・full disk・無限出力・停止不応答を注入し不変条件を満たす。非root計測、単位/欠損/stale/保持上限・集約認可を検証。Web出荷時にscope付きresource表示まで受入 |
| P3: worker通信と認可 | mTLS、登録/期限/失効/session、指定 host、署名manifest、action/project/host scopes、監査 | partition/stale session/host scope を検証。既知 host と署名と配備済み bundle hash のみで実行、秘密値が出ない |
| P4: jobnet と schedule | 静的 DAG、allSuccess、独自UTC schedule core、controller scheduler、interval/calendar JSON、UTC暦/無効日/misfire/overlap、preview | 同じ登録済み job を単独実行/複数 jobnet で再利用。node 結果、二重 tick/finish で一意性、UTC境界/時計/再起動/計算上限を検証。JSON定義とRedis実行管理の整合、負荷測定で計算予算を確定 |
| P5: console と運用 | minimal UI、resource/system error絞込・欠測表示、検索/操作、systemd/runner境界、Web session/CSRF、署名/SBOM/更新、backup/migration/restore手順 | Web/API/CLI の結果一致、RBAC/ログ描画検証、複数ホストの worker と単一 controller で負荷/復元演習。D1/D6 実測、D7〜D9とsecurity acceptance合格、運用者レビュー |
| 後続 | multi profileの実装・同時scheduler/endpoint分散/共有log/復旧受入、指定サーバー向け専用agent実行/専用unit/設定、calendar/結果 binding/条件分岐/部分再実行、上限付き loop の要否検討、通知、標準認証、Redis相当の別backend、Redis/障害領域のHA（別要件） | 実業務要求と個別 ADR を先に追加。MVP の契約試験を adapter に継承 |

P1/P2 は隔離した開発検証用であり、認証・OS境界を欠く公開profileは作らない。閉域運用もP3/P5と [security acceptance tests](09-security.md#security-tests) の完了を必須にする。公衆インターネット公開はMVP外。MVP 完了は P5 まで。性能と SLA は計測・合意後に定義する。
