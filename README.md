# belt

ナビゲーション: **概要（現在）** ｜ [索引](docs/README.md) ｜ [要件・概念](docs/design/01-requirements.md) ｜ [導入・SDK](docs/design/02-project-integration.md) ｜ [構成・UTC](docs/design/03-architecture.md) ｜ [永続化・反映](docs/design/04-storage.md) ｜ [実行](docs/design/05-execution.md) ｜ [ログ・監視](docs/design/06-observability.md) ｜ [開発・運用](docs/design/07-operations.md) ｜ [API](docs/design/08-api.md) ｜ [セキュリティ](docs/design/09-security.md) ｜ [Web認証](docs/design/10-web-authentication.md) ｜ [設定](docs/design/11-configuration.md) ｜ [controller分散](docs/design/12-controller-distribution.md) ｜ [release](docs/design/13-release.md) ｜ [検証・計画](docs/design/14-validation-plan.md) ｜ [一次資料](docs/design/15-references.md)

Linux向けのTypeScript製ジョブ管理framework。利用側プロジェクトでjobを定義し、共通enqueue API/型付きSDKから単独実行、または静的DAGのjobnetとして実行する。業務jobごとのAPI handler作成やbelt本体へのコード追加は不要。

**現在は設計段階で、API・CLI・package名・systemd templateは未実装。** 採用契約と数値の初期提案、出荷前の未決事項を区別する。[設計索引](docs/README.md) に読む順序・各仕様の正本・配置変更表をまとめた。

初期MVPはcontroller・複数ホスト/プロセスのworker・固定UID runner・Web console。専用agentは後続。job実行状態は永続Redisへ集約し、workerはHTTPS/mTLSでcontrollerから取得する。利用側のjob/registry/config/jobnetはstrict TypeScript、配備は型チェック済みartifactと検証付きJSONを使う。

時刻はschedule定義/評価を含めUTC限定。Web表示だけJST等へ変換できる。retryは有界で単調非減少、重複副作用や結果不明は照合し、exactly-onceを保証しない。仕様は [実行契約](docs/design/05-execution.md) を参照。

Webは利用者ID＋TOTP、当面のaccount正本は非公開S3、Redisはsession/replay/失効照合。初回adminは運用権限による明示登録で、公開先着登録はない。TOTPの保証限界と復旧は [Web認証](docs/design/10-web-authentication.md)。controller/worker自己採取の3指標と最大48時間履歴、運用エラーのRedis集約は [可観測性](docs/design/06-observability.md) に定める。

まず [要件・概念](docs/design/01-requirements.md)、次に [利用側への導入例](docs/design/02-project-integration.md) を読む。開発起動・Production systemdは [運用](docs/design/07-operations.md)、未決D1〜D9と出荷条件は [検証計画](docs/design/14-validation-plan.md) を確認する。
