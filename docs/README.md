# belt 設計索引

ナビゲーション: [概要](../README.md) ｜ **索引（現在）** ｜ [要件・概念](design/01-requirements.md) ｜ [導入・SDK](design/02-project-integration.md) ｜ [構成・UTC](design/03-architecture.md) ｜ [永続化・反映](design/04-storage.md) ｜ [実行](design/05-execution.md) ｜ [ログ・監視](design/06-observability.md) ｜ [開発・運用](design/07-operations.md) ｜ [API](design/08-api.md) ｜ [セキュリティ](design/09-security.md) ｜ [Web認証](design/10-web-authentication.md) ｜ [設定](design/11-configuration.md) ｜ [controller分散](design/12-controller-distribution.md) ｜ [release](design/13-release.md) ｜ [検証・計画](design/14-validation-plan.md) ｜ [一次資料](design/15-references.md)

整理日: 2026-10-29。設計の記載場所と読む順序を整理した。実装・配備・鍵/account作成・公開の実施を意味しない。公式資料の確認日は各資料に残し、整理日を再調査日として扱わない。

## 読む順序と仕様の正本

READMEは概要、本索引は経路と所有場所、各専門文書は契約の正本とする。関連ページには必要な要約と参照を置き、同じ詳細仕様を別の表で再定義しない。コード例は正本の具体例であり、独立した仕様や実装済み機能ではない。

| 順序・文書 | 正本となる内容 |
| --- | --- |
| [01 要件・概念](design/01-requirements.md) | 製品像、用語、MVP/後続/非目標、確定/提案の区別、判断台帳D1〜D9 |
| [02 導入・SDK](design/02-project-integration.md) | 利用側最小構成、strict TS/schema、registry、JobRef自動生成、build/apply/activate/producer分離、job再利用例 |
| [03 構成・UTC](design/03-architecture.md) | controller/worker/runner責務、package依存方向/port、依存予算、UTC表現/単調時計/表示境界 |
| [04 永続化・反映](design/04-storage.md) | Redis ACK/atomic操作/backup、backend候補、JSON/S3/共有FS、desired/loaded/applied/activeとrevision固定 |
| [05 実行](design/05-execution.md) | queue/slots、attempt/lease/fencing、OS command、retry式/予算/cancel/held、静的DAG、UTC JSON scheduler |
| [06 ログ・監視](design/06-observability.md) | run履歴/ジョブログ/監査、CPU・メモリ使用率/空きbytes、48時間保持の削除アルゴリズム、運用error schema/replay/gap/UI |
| [07 開発・運用](design/07-operations.md) | dev foreground/個別起動、systemd3原本、install/drain/update/restore、VPC HTTPS/任意ALB、共有JSON配備手順 |
| [08 API](design/08-api.md) | HTTP endpoint、共通enqueueの入出力/error、CLI索引、Web表示と操作の契約 |
| [09 セキュリティ](design/09-security.md) | 脅威モデル、worker/automation mTLS、RBAC、固定UID runner、artifact/FS/Web防御、security gateと残るrisk |
| [10 Web認証](design/10-web-authentication.md) | ID＋TOTP/初回admin/登録QR/紛失復旧、当面の非公開S3 account正本、Redis gate/session/replay・失効、認証試験 |
| [11 設定](design/11-configuration.md) | 環境変数56件、型/単位/role/必須条件/優先順位、設定可能な既定係数と容量・保持上限/超過時動作 |
| [12 controller分散](design/12-controller-distribution.md) | active-active API/複数endpoint、operation照会、共有session/Redis CAS、multi scheduler/共有LogStore/drainと障害限界 |
| [13 release](design/13-release.md) | SemVer、互換性、Git tag、npm dist-tag、pack/provenance、CI権限、部分公開/rollback |
| [14 検証・計画](design/14-validation-plan.md) | 全体の故障注入/受入一覧、P0〜P5/後続の順序と出口。認証/security固有試験は各仕様を参照 |
| [15 一次資料](design/15-references.md) | 根拠URL、調査日、確認範囲。本文内の近接引用も残す |

## 正本を参照する際のルール

- スコープ/採用判断は01、動作アルゴリズムは専門仕様、設定可能な係数/許容範囲は11を優先する。MVPの48時間上限やUTC限定等の固定要件を係数変更で迂回しない。
- 例に数値が出る場合は11の既定案との対応を検証する。式・byte単位・TTLとentry削除・job retryとtransport retryを混同しない。
- account正本は当面S3、job実行正本はRedis。S3の定義配布adapterが任意であることと、採用Web認証profileのS3/KMS依存は別である。
- 複数controllerへ接続可能な設計契約と、初期single配備・multi出荷試験の段階を区別する。専用agentやRedis HAをMVPへ追加しない。
- 参照先と要約に矛盾を見つけたら正本へ集約し、採用/提案の状態を確認する。実装未検証の仕様を「安全」「完全配送」「exactly-once」等の保証へ変えない。

## 配置変更と重複解消の記録

変更前のファイル名は対応確認用の記録で、リンク先は現在の文書だけとする。変更前全文はリポジトリ外の復元用退避に保持した。

| 変更前の配置 | 変更後の配置・正本 |
| --- | --- |
| README | 入口へ短縮。読む順序と所有場所は本索引、詳細仕様は専門文書へ |
| `01-requirements.md` | 01へ維持。監視詳細は06、設定係数は11、D1〜D9は01に一本化 |
| `02-architecture.md` §7 | 02へ移動。typed enqueueの応答表は08へ。導入例と生成順序を独立 |
| 同 §1〜3/5 | 03へ移動。共通UTCを保持、schedulerの暦文法は05を参照 |
| 同 §4（永続化/共有JSON/Redis操作） | 04へ移動。定義revisionとRedis ACKの正本 |
| 同 §4（resource/system error） | 06へ移動。04運用文書にあった詳細の重複を削除 |
| 同 §6 | 08へ移動。HTTP API/CLI一覧とenqueue応答を集約 |
| `03-execution.md` | 05へ移動。retry式は05、係数は11、JSON例は同値の具体例 |
| `04-operations-plan.md` §1/2 | 07には配備前checkの要約だけ。認証は10、RBAC/UIDは09、command意味は05が正本 |
| 同 §3 | 11の容量policyへ移動。envと重なる値はenv表を参照 |
| 同 §4 | 06へ移動。重複resource/error説明は既存の詳細契約へ統合 |
| 同 §5 | 07へ移動。systemd/dev/VPC/共有JSONの手順を維持 |
| 同 §6/7 | 14へ移動。試験/段階実装を運用手順から分離 |
| `05-references.md` と `06-security.md` §13 | 15へ集約。公式根拠と確認日を保持 |
| `06-security.md` §1〜12 | 09へ移動。Web sessionは10、D7〜D9表は01、公開workflowは13を参照 |
| `07-configuration.md` | 11へ移動。auth.session二重行/重複係数を解消、env56件を保持 |
| `08-release.md` / `09-controller-distribution.md` / `10-web-authentication.md` | それぞれ13 / 12 / 10。仕様と制約を保持し、全ページの相互リンクを更新 |

## 未決事項と今回の確認範囲

[判断台帳D1〜D9](design/01-requirements.md#design-decisions) と専門仕様の初期案を保持した。負荷/容量、Node・Redis・client版と耐久性/RPO/RTO、UTC scheduler対象年/計算予算、固定UID runner橋渡し、PKI、TOTP/QR/envelope library・KMS policy・Authenticator互換性、署名/監査/公開license等は出荷前の判断・実測が必要。今回の文書整理で採否や数値を新たに確定していない。

文書検証はローカルリンク/アンカー、見出し直下navigation、JSON例、shell構文、unit記述、env一覧、主要要件/例の対応を対象とする。belt実装・Redis/AWS/KMS/Authenticator/systemdの動作試験を実施した意味ではない。

今回の確認結果: 全17文書、ローカルリンク/アンカー412件、JSON例7件、shell例2件、unit INI例1件。移動前のコード/JSON/shell/図/unit計18ブロックは内容を変更せず保持し、環境変数56件の名前/順序と明示アンカー32個を維持した。反映後にもリンク・空白・配置を再確認する。
