# HTTP API・CLI・Web console

ナビゲーション: [概要](../../README.md) ｜ [索引](../README.md) ｜ [要件・概念](01-requirements.md) ｜ [導入・SDK](02-project-integration.md) ｜ [構成・UTC](03-architecture.md) ｜ [永続化・反映](04-storage.md) ｜ [実行](05-execution.md) ｜ [ログ・監視](06-observability.md) ｜ [開発・運用](07-operations.md) ｜ **API（現在）** ｜ [セキュリティ](09-security.md) ｜ [Web認証](10-web-authentication.md) ｜ [設定](11-configuration.md) ｜ [controller分散](12-controller-distribution.md) ｜ [release](13-release.md) ｜ [検証・計画](14-validation-plan.md) ｜ [一次資料](15-references.md)

状態: **設計文書・未実装**。確定要件/採用契約と数値提案/未決を区別する。読む順序と正本は [設計索引](../README.md) を参照。

## Web / API / CLI

Developmentの一括foreground/個別起動は [dev CLI](07-operations.md#development-cli)、Productionの同梱原本は [systemd](07-operations.md#systemd-templates)、npm公開/SDK/protocol/schema互換性は [release契約](13-release.md) に分離する。

共通 `/v1` JSON API の案。全endpointに用途別認証、action/project/target scope認可、body/rate制限を適用する。worker/automationはmTLSと必要なscope token、WebはHTTPS上のID＋TOTP認証後secure cookie session/CSRF。login/登録確認は狭い未認証例外でpre-auth/Origin/rateを要求し、worker/admin経路を公開しない。未整備のlistenerは起動しない。詳細は [セキュリティ要件](09-security.md#security-gates)。validation は unknown から始め、unknown fields は version 方針に従い拒否する。絶対日時は [UTC契約](03-architecture.md#utc-time-policy) のZ終端RFC3339、数値日時は単位を明示したUTC epoch ms、sequence/tokenは別のdecimal string。

| API | 用途 |
| --- | --- |
| `POST /v1/auth/enrollment/exchange`、`.../confirm` | account/期限に束縛したticketの一回限り交換と確認OTP。self-signup/初回admin作成不可。QR応答はno-store、平文secretをログ化しない |
| `POST /v1/session`、`POST /v1/session/logout` | ID＋TOTP/pre-auth nonceからWeb session作成/失効。Origin/CSRF/rate/replayを検査し、以後cookie/CSRFを要求。詳細は[認証契約](10-web-authentication.md#login-session) |
| `POST /v1/runs` | `{projectId, definitionId, version, definitionHash, args, target?, notBefore?, idempotencyKey}`。共通endpointで登録schema/active版/認可を検証し、耐久性ACK後202+runId。job別handler不要 |
| `GET /v1/runs?cursor=...`、`GET /v1/runs/:id` | keyset pagination、attempt/状態/理由を参照 |
| `POST /v1/runs/:id/cancel`、`.../retry` | request ID、理由、expectedRevision 必須。retry は新 run 作成 |
| `POST /v1/definition-releases/apply` | 認可済みmanifest/固定source参照を検証し、expected desired revisionのCASで共有登録。operation ID/receiptで再送を照合 |
| `POST /v1/definition-releases/:id/activate` | CI/adminのscope・expected active/desired revision・readyを検証して共有Redisで有効化。jobごとのroute作成なし |
| `POST /v1/definitions/validate`、`PUT /v1/definitions/:id/versions/:v` | admin が project scope 内の manifest/不変 version を検証・登録。JS 関数を受信・import しない。同 version 異内容は 409 |
| `POST /v1/workflow-runs`、`GET /v1/workflow-runs/:id` | DAG 起動と node 状態 |
| `POST /v1/schedules`、`POST /v1/schedules/:id/pause`、`GET /v1/schedules/:id/preview` | JSON interval/calendar を検証し version 固定。preview は同じ計算 core。再開時 skip/coalesce/bounded を適用 |
| `GET /v1/queues`、`POST /v1/queues/:id/pause`、`.../resume` | 新規 claim の制御。running は別途 cancel |
| `GET /v1/executors`、`POST /v1/executors/:id/revoke` | ホスト・last_seen・slots・失効 |
| `GET /v1/operations/:id` | 同じprincipal/deploymentのoperation receipt/確定run等を照合。他principalの存在/内容を漏らさない |
| `POST /v1/executor-sessions`、`POST /v1/executor/claim` | mTLS identity/失効/grantとepochを検査、容量内の割当 |
| `POST /v1/executor/heartbeat`、`.../started`、`.../finish`、`.../logs` | leaseRef と報告 ID による冪等更新 |
| `POST /v1/executor/system-errors`、`GET /v1/system-errors`、`.../:id` | 認証付きbatch報告、scope/期間/component/project/category絞込・bounded詳細。job log/audit/telemetryと別policy |
| `GET /v1/runs/:id/logs`、`GET /v1/audit` | cursor/byte limit、role ごとの閲覧範囲 |
| `GET /health/live`、`GET /health/ready` | 別のloopback運用面で最小応答。公開せずRedis/credential/設定等の詳細は認証後のみ |

resource sampleの送信/閲覧・scope/query/gap契約は [可観測性](06-observability.md#resource-telemetry) に従う。ここでは未確定のtelemetry route名を新たに決めない。

HTTP error: 400 構文、401/403 認証/認可、404 不可視を含む、409 version/lease/state 競合、413 body、422 意味検証、429 上限（Retry-After）、503 store/耐久性確認不可。`{code, message, requestId}` を返し stack/secret を公開しない。run 受付前の失敗は runId を発行済みと偽らない。受付後のクライアント timeout は同一 key で照会・再送する。

指定サーバー向け専用agentのCLI/起動/配備は後続設計に分離する。MVPはcontroller/worker/固定runnerの起動だけで実行・監視できる。

CLI 例: `belt controller start`, `belt worker start`, `belt definition validate/apply/export`, `belt run enqueue/show/cancel/retry`, `belt queue pause/resume`, `belt worker list/revoke`, `belt schedule preview`, `belt storage backup/restore`。`--json` と非対話実行に対応する。token/秘密鍵をargvに渡さずmTLSとprotected file/credentialを使い、認可は API 側で必ず再検査する。backup/restore は Redis の公式運用手順への管理入口とし、独自 DB 形式を作らない。restore は controller/executor 停止・隔離下の操作とする。

consoleはloopback/閉域の明示bindと認証を必須にする。登録済み project/job/definition/bundle version を一覧し、queue の待機・実行・失敗数、最古待機時間、run/attempt と結果不明理由、静的 DAG、worker 状態を表示。操作前に対象・影響・理由を確認し、危険操作は追加grant/直近再認証/理由/expectedRevisionを必須にする。UIが成功と表示するのはAPI応答後だけ。ログは text node として描画し HTML を解釈しない。MVPは [web.pollMs設定](11-configuration.md#json-policy) に従うpollingと手動更新、cursor 差分取得で上限を守る。アクセシビリティのため状態は色だけに依存しない。

<a id="enqueue-responses"></a>

### 未登録・不一致・反映遅延・rolling deploy

| 状況 | enqueue/実行の契約 |
| --- | --- |
| 未登録job | job_not_registered/404。権限外なら存在を漏らさない404。worker registryだけで自動登録しない |
| 入力schema違反 | invalid_job_input/422。queue/run/attemptを作らずfield位置と安全な理由のみ返す |
| refと登録version/hashが不一致 | definition_mismatch/409。別version/最新schemaへ自動変換しない |
| desiredのみで未active | definition_not_active/409。producerから自動apply/activateしない |
| 接続先controllerがactive版未反映 | 503+Retry-After。他controllerでも同operation IDで照合/再送。入力/権限の恒久エラーをfan-out retryしない |
| 保持中の旧version | 明示したenqueue許可集合/grant内ならその版で受ける。retiredはjob_version_retired/409で新規投入拒否、進行中run/retryは固定版を保持 |
| 対応worker/artifactが未配備 | active登録と認可が正常なら202でqueue待機できるが、同版/hash capabilityが来るまでclaimしない。待機理由を表示しdeadlineで終端、最新版へ代用しない |
