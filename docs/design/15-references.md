# 一次資料・調査日・確認範囲

ナビゲーション: [概要](../../README.md) ｜ [索引](../README.md) ｜ [要件・概念](01-requirements.md) ｜ [導入・SDK](02-project-integration.md) ｜ [構成・UTC](03-architecture.md) ｜ [永続化・反映](04-storage.md) ｜ [実行](05-execution.md) ｜ [ログ・監視](06-observability.md) ｜ [開発・運用](07-operations.md) ｜ [API](08-api.md) ｜ [セキュリティ](09-security.md) ｜ [Web認証](10-web-authentication.md) ｜ [設定](11-configuration.md) ｜ [controller分散](12-controller-distribution.md) ｜ [release](13-release.md) ｜ [検証・計画](14-validation-plan.md) ｜ **一次資料（現在）**

状態: **設計文書・未実装**。確定要件/採用契約と数値提案/未決を区別する。読む順序と正本は [設計索引](../README.md) を参照。

調査日: **2026-10-27**。設計判断の根拠と確認範囲を示す。

## 保存形式の用語

Redis の用語 **RDB（Redis Database）** は、時点のデータを保存する Redis 固有のスナップショット形式であり、リレーショナルDBを指さない。本文では「Redis スナップショット（バイナリ形式）」と表記する。JSON の定義 export と Redis の復旧用ファイルは用途が異なる。[Redis persistence 公式](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)。

## 根拠リンクと確認範囲

表の基本調査日は2026-10-27、Web認証の追記は2026-10-28。公式サイト/公式リポジトリのみを設計根拠として使用した。URL が最新版を指す場合、将来内容が変わり得るので実装時に再確認する。

| ID | 公式資料 | 確認範囲と留意点 |
| --- | --- | --- |
| N1 | [ECMA-402 DateTimeFormat / formatToParts](https://tc39.es/ecma402/#sec-intl.datetimeformat.prototype.formatToParts) | Web表示でUTC instantをJST等へ変換する根拠。定義/入力/次回計算には使用せず、表示だけの変更でdueを変えない |
| N2 | [Node Internationalization](https://nodejs.org/api/intl.html) | Intl/ICUの表示dataはbuild/runtimeに依存。schedulerはUTC演算のみで、表示data更新をschedule再計算の理由にしない |
| N3 | [Node timers](https://nodejs.org/api/timers.html) | 本文確認。正確な発火時刻を保証しない。timer を起床通知に限定し due/cursor を Redis へ保持 |
| N4 | [ECMAScript Date.UTC](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date.utc) | UTC componentによる日付生成の仕様を確認。不正日付のoverflowは事前検証/UTC round-tripで拒否し、local演算を使わない |
| R1 | [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/) | 本文確認。Redis スナップショット（バイナリ形式）/AOF、fsync 方針、backup、rewrite。耐久性 ACK 方針の根拠 |
| R2 | [Redis replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/) | 本文確認。非同期 replication と WAIT の限界。HA を自動的に保証しない |
| R3 | [Redis WAITAOF](https://redis.io/docs/latest/commands/waitaof/) | 本文確認。7.2 以降、同一接続の先行書込、返却数と timeout を確認。強整合性にはならない |
| R4 | [Redis key eviction](https://redis.io/docs/latest/develop/reference/eviction/) | 本文確認。noeviction の書込拒否、maxmemory、永続化 buffer の余裕 |
| R5 | [Redis Lua](https://redis.io/docs/latest/develop/programmability/eval-intro/) / [Transactions](https://redis.io/docs/latest/develop/using-commands/transactions/) | 本文確認。原子的な条件更新と rollback 非対応の区別、短い script に限定 |
| R6 | [node-redis guide](https://redis.io/docs/latest/develop/clients/nodejs/) | 本文確認。公式推奨 Node client。外部 npm 依存として storage adapter に限定 |
| R7 | [Redis security](https://redis.io/docs/latest/operate/oss_and_stack/management/security/) | 本文確認。閉域、ACL、TLS、専用 UID。Web/worker に Redis 接続権限を渡さない |
| V1 | [Valkey 互換性](https://valkey.io/topics/migration/) / [WAITAOF](https://valkey.io/commands/waitaof/) / [保守](https://valkey.io/topics/releases/) | 本文確認。将来比較の第一候補という提案のみ。製品/版ごとの Store・耐久性試験は未実施で、対応済みとは扱わない |
| A1 | [AWS SG](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html) / [EC2 データ保護](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/data-protection.html) | 本文確認。VPC の到達制御と TLS を分け、全通信の暗号化を仮定しない |
| A2 | [ACM DNS 検証](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html) / [ALB listener](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html) / [targets](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html) / [mTLS](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/mutual-authentication.html) | 本文確認。任意構成の TLS 終端・target 証明書非検証・identity header 境界。実機検証は未実施 |
| A3 | [AWS Private CA 料金](https://aws.amazon.com/private-ca/pricing/) | 有料サービスであり必須化しない。金額は固定せず採用時に再確認 |
| S1 | [S3 条件付き書込](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) / [consistency](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel) | 本文確認。If-Match/If-None-Match、409/412、単一 key atomic と multi-key transaction 非対応。定義用S3 adapterは任意・未実装。Web account用S3は別profileの採用依存 |
| S2 | [rename(2)](https://man7.org/linux/man-pages/man2/rename.2.html) / [S3 security](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html) / [SDK credentials](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html) | 本文確認。atomic rename と競合検出を区別。採用共有FS/SDK/IAMの契約試験が必要で、local FS と同じ lock/耐久性を仮定しない |
| T1 | [Node OS](https://nodejs.org/api/os.html) / [process](https://nodejs.org/docs/latest-v24.x/api/process.html) / [statfs](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesstatfspath-options) | CPU/メモリ割合の内部計算とFS空き量の標準API・利用可能版を確認。計算用raw値を独立指標にせず、availableParallelism推定を厳密なcontainer capacityにしない。対象Node版はD2で固定 |
| T2 | [Linux proc](https://docs.kernel.org/filesystems/proc.html) / [hidepid](https://man7.org/linux/man-pages/man5/proc.5.html) / [cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html) | 読取scope/累積counter/階層limitとnamespace/権限制限。root不要で読める部分のみ収集、実Linux試験は未実施 |
| T3 | [cgroup v1 cpuacct](https://docs.kernel.org/admin-guide/cgroup-v1/cpuacct.html) / [v1 memory](https://docs.kernel.org/admin-guide/cgroup-v1/memory.html) | v1/v2でunit/階層/精度が異なる。v1 memory資料は公式にもoutdatedの注記があり、採用kernelの実挙動を検証してreader対応範囲を決定 |
| TS1 | [strict](https://www.typescriptlang.org/tsconfig/strict.html) / [noImplicitAny](https://www.typescriptlang.org/tsconfig/noImplicitAny.html) / [noUncheckedIndexedAccess](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html) / [型消去の境界](https://www.typescriptlang.org/docs/handbook/2/basic-types.html) | 公式compiler契約を確認。明示any/assertionを自動排除する保証ではなく、runtime検証も必要。採用compiler版とlintは開発依存として固定 |
| N5 | [Node child_process](https://nodejs.org/api/child_process.html) | spawn/execFileとshellの区別、pipeのdrain、exit/close/killの限界。OS実行境界と組合せる設計で、実機停止試験は未実施 |
| O1 | [systemd.service 256](https://www.freedesktop.org/software/systemd/man/256/systemd.service.html) / [PM2 startup](https://pm2.keymetrics.io/docs/usage/startup/) | 常駐方式の比較とunit template同梱設計。OS/service再起動・停止とbelt job保証を分離。配備先の方式採用・実機unit検証・サービス登録は未実施 |
| O2 | [SemVer](https://semver.org/) / [Git tag](https://git-scm.com/docs/git-tag) / [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) / [provenance](https://docs.npmjs.com/generating-provenance-statements/) | version/tag/公開権限とartifactの設計根拠。現行provider/action条件を確認、実公開/registry設定は未実施。詳細は [release契約](13-release.md) |
| R8 | [Redis EXPIRE](https://redis.io/docs/latest/commands/expire/) / [ZRANGE公式source](https://github.com/redis/redis-doc/blob/master/commands/zrange.md) | keyTTLとSorted Setのentry時刻範囲/有界取得を区別し、resource履歴48時間の範囲削除・点数capと併用する設計。実Redisの保持試験は未実施 |
| R9 | [Redis TIME](https://redis.io/docs/latest/commands/time/) / [Lua原子性](https://redis.io/docs/latest/develop/programmability/eval-intro/) | 共有UTC期限判定とmulti-controller CASの根拠。TIME/Lua/対象版の実動作・時計step/fault試験は未実施。詳細は [分散profile](12-controller-distribution.md) |

## セキュリティの根拠と受入条件

一次資料は [本書のセキュリティ資料](#security-sources)、脅威モデル・公開条件は [セキュリティ](09-security.md)、判断台帳は [要件D1〜D9](01-requirements.md#design-decisions) に置く。調査日と対象版の検証範囲を分け、資料の存在を実装の検証済み保証としない。

## Web認証の一次資料（2026-10-28確認）

| 資料 | 確認範囲 |
| --- | --- |
| [RFC6238](https://www.rfc-editor.org/rfc/rfc6238) | time-step/secretとtest vector。独自OTPを実装せずlibraryへ委任 |
| [NIST SP800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) | single-factor OTP、protected channel/rate/replayと非phishing耐性。製品の適合認定は主張しない |
| [Google Authenticator URI](https://github.com/google/google-authenticator/wiki/Key-Uri-Format) | otpauth URI/issuer/label/secret/parameter。相互運用資料であって全アプリ対応保証なし |
| [S3公開遮断](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html) / [SSE-KMS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html) | bucket/accountの公開遮断とKMS権限境界。難読化を暗号と扱わない |
| [S3条件付き書込](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) / [Encryption SDK](https://docs.aws.amazon.com/encryption-sdk/latest/developer-guide/introduction.html) | 単一catalog CASと標準envelope libraryの境界。IAM/KMS/実機障害試験は未実施 |

<a id="security-sources"></a>

## 公式根拠

調査日: **2026-10-27**。対象版で動作を再確認し、リンク先の最新版の機能を対象 Linux/Node に無条件で存在すると扱わない。本文の制限値・profile・出荷 gate は belt の設計提案である。

| 公式資料 | 確認した根拠 |
| --- | --- |
| [AWS SG](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html) / [ALB targets](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html) / [ALB mTLS](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/mutual-authentication.html) | 到達制御と TLS の区別、target 証明書非検証、mTLS verify と転送 identity の境界 |
| [OWASP TLS](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html) / [Linux UDS](https://man7.org/linux/man-pages/man7/unix.7.html) | 内部 CA の信頼配布、ローカル IPC の pathname 権限と peer credential の範囲 |
| [Node VM](https://nodejs.org/api/vm.html) / [Permissions](https://nodejs.org/api/permissions.html) | vm/Permission Modelを敵対コードのsecurity境界としない |
| [Node TLS](https://nodejs.org/api/tls.html) / [Crypto](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature) | certificate/mTLS・署名検証の標準実装を利用 |
| [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) / [resource-control](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html) / [kill](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html) | 実行環境/cgroups/プロセス停止の範囲 |
| [Linux open(2)](https://man7.org/linux/man-pages/man2/open.2.html) | open flags、O_NOFOLLOWの対象、FDを用いるFS境界 |
| [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) | deny-by-default・最小権限・毎要求の検証 |
| [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) / [CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) | session寿命/rotation/cookie属性、CSRFtoken/Originと多層対策 |
| [OWASP XSS](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html) / [CSP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html) | 出力先別escaping、安全なDOMとCSPによる多層対策 |
| [OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) / [Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) | 接続先制限とsecret/ログの取り扱い |
| [Redis security](https://redis.io/docs/latest/operate/oss_and_stack/management/security/) | Redisのネットワーク/認証/ACL/TLS境界 |
| [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/) / [SBOM](https://docs.npmjs.com/cli/v11/commands/npm-sbom/) | lockfileによるbuildと依存一覧の管理 |
