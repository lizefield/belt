# 要件・概念・判断台帳

ナビゲーション: [概要](../../README.md) ｜ [索引](../README.md) ｜ **要件・概念（現在）** ｜ [導入・SDK](02-project-integration.md) ｜ [構成・UTC](03-architecture.md) ｜ [永続化・反映](04-storage.md) ｜ [実行](05-execution.md) ｜ [ログ・監視](06-observability.md) ｜ [開発・運用](07-operations.md) ｜ [API](08-api.md) ｜ [セキュリティ](09-security.md) ｜ [Web認証](10-web-authentication.md) ｜ [設定](11-configuration.md) ｜ [controller分散](12-controller-distribution.md) ｜ [release](13-release.md) ｜ [検証・計画](14-validation-plan.md) ｜ [一次資料](15-references.md)

状態: **設計文書・未実装**。確定要件/採用契約と数値提案/未決を区別する。読む順序と正本は [設計索引](../README.md) を参照。

基準日: 2026-10-27 / 状態: 実装に向けた設計提案。

## 確定要件と提案の区別

製品の基本要件は次のとおり。

- belt本体と利用側job/registry/config/jobnetのsourceはTypeScript必須。strictな型チェック済みbuildを公式SDK/CLI/CIの必須経路とし、型無しJavaScriptの開発対応はしない。配備物はcompiled JS、設定/通信/保存形式は検証付きJSON。基本動作環境はLinux。
- belt は利用側プロジェクトへ framework/library として導入し、業務 job は利用側の TypeScript で実装する。belt 本体への業務 job 追加を要求しない。
- 利用側で登録した同じ job を単独実行し、または jobnet/workflow の部品として再利用できるようにする。job コードと workflow 定義を分離する。
- MVPはcontroller・worker・管理Web consoleと共通resource collector。workerが登録済みjob/commandを隔離runnerで実行する。指定サーバー向け専用agentは後続で、監視の必須依存にしない。
- 複数プロセスでの実行を想定し、Redis または相当する共有基盤を最低限の依存として許容する。
- リレーショナルDBは採用しない。設定・定義の保存/入出力は JSON、共有実行状態は Redis に置く。
- 定期実行は belt controller 内の独自 scheduler で実現し、JSON interval/daily/weekly/monthlyを定義し、Redisの実行状態と原子的dispatchで管理する。
- 外部パッケージ・ライブラリ・サービスを極限まで減らす。
- 内部の各部分を個別ライブラリに切り出せる構成にする。
- 認証/最小権限/credential分離/署名検証/資源制限を出荷条件とし、満たせない配置では管理面やjob実行を開始しない。

本書の基本要件・明示採用した契約と、各専門仕様の「提案/初期案」を区別する。MVPは対象スコープであって実装済みの意味ではない。数値の既定案、対象版、出荷前検証は未確定のまま保持し、採用済み要件を一律に未決へ戻さない。判断台帳D1〜D9の正本は本書、詳細制御とgateは専門仕様を参照する。

保存・通信/API・ログ・Redis・scheduler実行instant・監査・telemetryの絶対日時はUTC。Zを明示した文字列または単位付きepochを用い、naive local datetimeを受け付けない。Web表示はUTC既定、JST等へ変換時はtimezoneを明示し実行日時を変えない。[共通時刻契約](03-architecture.md#utc-time-policy) を適用する。

## 製品像と用語

開発者は利用側プロジェクトで job を実装・明示登録し、型付き SDK から JSON 引数を渡して非同期実行する。belt 本体は汎用 runtime/SDK/CLI を提供し、業務ロジックを所有しない。運用者は複数ホストにまたがる処理の順序・予定・結果を追跡し、安全に停止・再試行する。単一 controller と複数プロセス・複数ホストの worker から開始し、storage や通信を差し替えても実行ルールを再利用できる構造を目指す。複数controllerがある場合のworker分散アクセスを設計要件とし、active-active APIと共有Redis調停の [multi profile](12-controller-distribution.md) を定める。初期MVPのsingle配備と、複数profileを出荷可能にする段階・試験は別に判断する。agent/Redis HAはMVPへ追加しない。

| 用語 | belt での意味 |
| --- | --- |
| JobDefinition | project/job ID、handler / command 参照、入力 schema、bundle ID/hash、実行先、retry 等の不変メタデータ。コード本体は含まない |
| JobBundle | 利用側が build/配備する compiled JS、依存、registry、manifest。Redis 外の不変 artifact |
| RunInput | 一回の実行に渡す JSON 引数。定義やコード artifact と区別する |
| JobRun | 一回の論理的な依頼。複数 Attempt を持つ |
| Attempt | lease と fencing token を持つ一回の実行試行 |
| Queue | 公平性・並列上限・待機上限を設定する論理的な待ち行列 |
| WorkflowDefinition / jobnet | 登録済み job の参照、順序/並列/依存、実行条件、結果参照、失敗時方針を持つ不変定義。MVP は静的 DAG と限定 policy |
| WorkflowRun | 定義バージョンを固定した一回の DAG 実行 |
| worker | MVPのexecutor。登録済みTypeScript job/OS commandを隔離runnerで実行し、共通collectorで自身のresourceを報告する常駐process |
| controller | 定義/受付/queue/schedule/lease/履歴/認可を共有Redisで調停するAPI role。multiでは複数instance |

MVPのexecutorはworkerであり、controllerから取得するjob/commandを固定runnerで実行する。worker自身がhost登録・許可manifest・journalを持つ。専用agentは後続の実行起動形態として共通契約を再利用する案に留め、MVPへ別常駐processを追加しない。worker を「ジョブ関数」「スレッド」と混同しない。controller 自体ではユーザーコードを実行しない。

## 機能スコープ案

| 領域 | MVP（段階 P0〜P5 の完了時点） | 後続 | 非目標 |
| --- | --- | --- | --- |
| controller分散 | 複数存在時にworkerがどのcontrollerにも接続できる契約、共有Redisのstate/session/lease/operation調停、sticky不要 | multi profileの実装/受入・配備段階、将来agentへの共通client適用 | 外部LB/Redis複製/別backend/無停止HAの必須化 |
| 起動・配布 | 開発foreground一括/個別起動CLI、controller/worker/runnerのsystemd原本と手順、npm version/tag/release契約 | 後続の専用agentの起動/原本、追加platform profile | 独自Production process manager、無断サービス登録 |
| 組み込み | TypeScript job/明示registry、strict buildで軽量JobRef/schema/manifest生成、共通POST /v1/runs＋typed client、job毎API handler不要、producerに実行コード不要 | 開発時の自動 discovery 補助 | belt 本体を fork して業務 job を追加する必須運用 |
| 実行 | 即時・日時指定、JSON入力、型チェック済みTypeScript handler/許可commandをworker配置済みhostで実行、承認host範囲 | 後続の指定サーバー向け専用agent、executor pool、追加runtime adapter | 任意ブラウザー入力のコードを無制限に実行 |
| queue | 永続受付、FIFO 候補選択、公平配分、並列上限、一時停止 | リソース別 rate limit、優先度 aging | 実時間 OS の厳密な開始時刻・完了順保証 |
| 障害 | 単調非減少の有界指数retry/backoff、回数/経過予算、UTC次回日時、deadline、cancel、lease、結果不明保留 | 外部効果の照合 adapter、補償操作 | exactly-once、副作用の自動 rollback |
| jobnet | 単独実行と同じ登録済み job を参照する静的 DAG、順序/並列/全成功 join、結果記録、先行失敗時の依存先 skip | 結果を使う条件分岐・安全な引数 binding、ネスト、動的 fan-out、部分再実行、上限付き loop の要否検討 | 無制限 loop/任意 eval |
| schedule | 単発、JSON interval / daily / weekly / monthly、定義・評価・実行instantをUTC固定、月末・取りこぼし・重複起動方針、controller 内 scheduler、Redis due/cursor/occurrence管理 | 営業日・休日カレンダー、日付跨ぎ業務日 | 自作 TZDB、秒精度 SLA |
| system errors | controller/worker/scheduler/定義/通信/ストレージの構造化errorをRedis集約、Web絞込/詳細/gap、size/rate/保持/認可、停止時local fallback | 外部log export adapter | job stdout全文/秘密情報/無制限stackの集約、完全配送保証 |
| 運用 UI | queue/run/attempt/DAG/worker、ログ、retry/cancel/pause、監査 | 視覚的定義エディター、通知連携 | 初期から巨大な SPA・外部監視サービス必須 |
| データ | Redis をjob実行状態の唯一の主ストア、履歴検索・保持上限・backup/restore、config/定義入出力は JSON file、log/spool は file | Redis 相当の別製品 adapter、controller 複数化・HA の設計 | リレーショナルDB依存、自作 DB、複数主ストアの二重管理、初期から複数 backend 必須 |
| 権限/安全性 | 閉域、worker/CLIのmTLS identity、WebのID＋TOTP/session/CSRF、非公開S3の暗号化account正本と初回admin管理経路、期限/失効、role+action/project/job/host/secret scope、別UID runner、署名artifact、監査/DoS制限 | OIDC/SSO/MFA、二者承認、per-attempt隔離、外部監査保全 | 公衆公開、不信任コード/敵対テナントの完全隔離 |

利用側の限定JSON schema付きTypeScript job/registryから、strict buildで実行コードを含まない型付きJobRefとschema/JSON manifestを自動生成する。共通POST /v1/runsとclient.enqueue(jobRef,args,{idempotencyKey})を正式契約とし、jobごとのAPI handler/動的route登録を不要にする。validate/apply/activateとgrantを通してdefinitionの不変versionを有効化し、worker内のregistry登録だけではcontrollerに公開しない。実行ポリシー・DAG・schedule は JSON ファイルでも管理できる。Web は登録済み definition の参照・起動・運用操作を担当し、job のコーディングや任意アップロードを行わない。コードや秘密情報をブラウザー/Redis から配布しない。TypeScript job と system command job は別 kind とし、通常の業務コードを shell command に包むことを必須にしない。

## 設計判断案

| ID | 採用案と理由 | 代替・再検討条件 |
| --- | --- | --- |
| A1 | Redis をjob実行状態の唯一の主ストア、MVP は単一 controller + 複数 worker。共有実行状態を一つの基盤へ集約 | 複数配置時はactive-active API/endpoint分散・Redis CAS調停。controller数とRedis可用性は別。Redis相当の他製品は別adapter提案 |
| A2 | node-redis を storage-redis に限定し、bounded Lua による原子的状態更新と耐久性 ACK を設計 | RESP client や DB を自作しない。Lua と外部 client を必要な依存例外として台帳管理 |
| A3 | executor は mTLS の outbound HTTPS long polling で controller broker から取得。Redis credential を渡さず、controller が job/host/attempt の交差認可を強制。NAT 配下への inbound 不要 | AWS VPC 内も同じ方針。private CA/既存 CA を利用でき、ALB/AWS Private CA は必須にしない。平文 fallback/検証無効化を拒否。詳細は [運用例](07-operations.md#aws-vpc-transport) |
| A4 | UI は HTML/CSS + browser ES modules + fetch、更新は短い polling | 大規模 UI で保守性が劣化した場合のみ小さな UI ライブラリ |
| A5 | scheduleモジュールを独自実装。標準DateのUTC演算とUTC固定JSON規則で次回時刻計算、controller が Redis の due 状態を実行へ変換 | JSON定義をvalidate/applyし、Redisで予定/cursor/occurrence/実行状態を管理する。UTC暦の無効日/曜日/月末/時計境界は独立計算モジュールの契約試験で検証。JST等はWeb表示変換だけに使う |
| A6 | 非冪等 command の結果不明は自動再実行しない | 冪等性・外部照合が保証された定義だけ再配達を許可 |

「Pure」は domain の純粋性、少数のランタイム依存、必要な外部基盤への集約を意味する。job実行にはRedisとclientを許容し、別DBやqueue serviceを重ねない。Web account profileには当面S3/KMSと標準TOTP/QR/envelope libraryを追加し、必要な安全性の依存を隠さない。Node 自体も V8 / OpenSSL / ICU 等を含み、OS・証明書・時刻同期・ファイルシステムにも依存する。暗号や永続化には成熟した実装を用い、安全性と運用性を優先する。

Redis を複数サーバーの worker が扱う共有状態の基盤として選ぶ。再生成可能なキャッシュではなく、受付済み run・進捗・履歴の主状態を保持するため、永続化・容量管理・復元を設計する。

### リソース監視の範囲

controller/worker自己採取によるCPU使用率・メモリ使用率・登録filesystemの利用可能な空きbytesの3項目を対象とし、resource履歴はMVPで最長48時間。専用agent、独立process指標、自動admissionはMVPに追加しない。scope/分母/欠測・保持アルゴリズムは [監視仕様](06-observability.md#resource-telemetry)、係数と既定値は [設定表](11-configuration.md) を正本とする。

<a id="design-decisions"></a>

## 未決事項と推奨初期値

| ID | 実装前に決める事項 | 推奨案・影響 | 判断時点 |
| --- | --- | --- | --- |
| D1 | 想定負荷、同時実行数、保持期間、許容停止 | 最初の検証プロファイルは 10 executor、合計 40 slots、受付 10 runs/s を 10 分。性能保証ではなく計測の開始点 | P0 |
| D2 | Node LTS / Redis / node-redis の対象版と耐久性・配置 | Redis 7.2 以降の必要機能を確認し対象版を固定。初期案は AOF always + 定期 Redis スナップショット（バイナリ形式）の backup。同一ホスト/別ホスト、ACK 条件、容量・RPO を実測し決定。HA は未確定 | P0、production 前 |
| D3 | UTC schedulerの対象年・計算上限・runtime契約 | 定義/評価/実行はUTC限定で確定。timezone/DSTの選択肢なし。interval最短1分、calendarは分単位・Gregorian/2000〜2099年、月末skipを初期案とし、対象Node/CPU予算を測定して確定 | P0/P4 |
| D4 | 配置・認証・証明書の発行管理、共有 JSON の配布先と更新反映 | 単一組織の閉域運用、worker/CLIは組織PKIのmTLS identity、WebはID＋TOTP。定義用共有フォルダ/S3等は任意、account正本の非公開S3/KMSは採用Web profileの依存。複数 controller 時の manifest 公開・revision競合・active版確認は [共有 JSON 設計](04-storage.md#shared-json-publication) に従い、HA の排他とは別に検証。詳細な期限/失効はD7、UID境界はD8、release/監査はD9と整合 | P0/P3 |
| D5 | 実行 OS ユーザー、command 許可、非冪等業務、job artifact 配備 | ホストごと専用 UID、ローカル manifest、結果不明は手動照合。利用側 CI の bundle hash/配備/実行中 version の保持を定義 | P1/P3 |
| D6 | RPO / RTO、監査保存要件、license | 初期目標 RPO 24h / RTO 1h は提案。復元演習で計測。公開 license と package metadata・依存 license の整合を確認 | P0/P5 |
| D7 | PKI/identity/credential/session/閉域運用 | worker/CLIのmTLS、Web TOTP＋S3正本/Redis replay・失効gate、初回admin管理経路、cookie/CSRF、automation tokenの短寿命。公開は別profileで審査 | P0/P3/P5 |
| D8 | LinuxのUID/runner/IPC/FD/cgroup/egress境界 | 非root supervisorから別UIDへの切替を仮定せず、OS管理の固定runner起動橋渡しを検証。未整備はdispatch拒否 | P0/P1/P3 |
| D9 | 署名鍵/依存/SBOM/更新/監査保全 | trusted release manifestとpayload検証、更新責任者・期限、監査/復元/危険操作の承認者を確定 | P0/P5 |

未決事項は本設計の推奨案で開発検証できるが、production 出荷条件を満たしたことにはならない。各段階の受入条件は [実装計画](14-validation-plan.md)、セキュリティ gate と残るリスクは [セキュリティ要件](09-security.md) を参照。
