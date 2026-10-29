# npm version・Git tag・release運用

ナビゲーション: [概要](../../README.md) ｜ [索引](../README.md) ｜ [要件・概念](01-requirements.md) ｜ [導入・SDK](02-project-integration.md) ｜ [構成・UTC](03-architecture.md) ｜ [永続化・反映](04-storage.md) ｜ [実行](05-execution.md) ｜ [ログ・監視](06-observability.md) ｜ [開発・運用](07-operations.md) ｜ [API](08-api.md) ｜ [セキュリティ](09-security.md) ｜ [Web認証](10-web-authentication.md) ｜ [設定](11-configuration.md) ｜ [controller分散](12-controller-distribution.md) ｜ **release（現在）** ｜ [検証・計画](14-validation-plan.md) ｜ [一次資料](15-references.md)

状態: **設計文書・未実装**。確定要件/採用契約と数値提案/未決を区別する。読む順序と正本は [設計索引](../README.md) を参照。

状態: **公開手順の設計 / 未実施**。調査日2026-10-27。実tag/commit/push/npm publish、token生成、registry/CI設定を今回行わない。package名beltは仮名で、所有/公開可否・scopeとaccessは初回公開前に確認する。

## version と互換性

公開versionはSemVerのMAJOR.MINOR.PATCHとし、例は0.3.0、0.3.1、1.0.0、1.1.0-rc.1。0.xは開発段階でも無通知の破壊変更を許す運用にせず、破壊変更はminorを上げてrelease notesへ明示し、patchは互換な修正だけにする。1.x以降は公開SDK型/CLI/HTTP API/設定の破壊変更をmajor、互換機能追加をminor、互換修正をpatchとする。TypeScriptの公開型変更や必須compiler/Node最低版変更も利用側のbuildを壊し得るため破壊変更判定に含める。security修正でも互換性影響を隠さない。

| version対象 | 契約 |
| --- | --- |
| npm公開SDK/CLI | 型付きAPI、command/option/exit code、設定schemaの互換性を宣言する。内部deep importは公開契約外 |
| HTTP/protocol | wire protocolVersionとAPI major、controller/worker/runnerの対応組合せを互換表に記録。初期は同一releaseの組合せを正式対応とし、不明版を拒否 |
| 永続/JSON schema | Redis key schema、manifest/config/schedule/journal schemaを個別識別。package versionから同一と推定せず、読取/書込対応とupgrade/restore条件を記す |
| job/release定義 | 利用側job version、bundle hash、desired/active revisionはframework SemVerと別。実行中runの版をframework更新で差替えない |

schema更新を伴う場合はdrain/backup/検証/有界migration/recoveryをreleaseの受入条件にする。npm versionだけ戻して書換済みRedis schemaを戻せるとは扱わない。下位互換を満たすadditive fieldもunknown-field拒否規則/rolling updateに影響しないか実契約試験する。

## 内部 package と dist-tag

初期推奨は内部workspaceを原則privateにし、公開facade/CLIを必要最小限にする。複数packageを公開する場合は初期lockstepで同じversionを一組としてreleaseし、内部依存を検証済み同一versionへ固定する。未公開workspaceやworkspace:*参照がtarballに残らないことを検査する。独立versionへの移行は将来の別判断で、公開module数だけrelease運用を増やさない。

stableの利用入口はnpm dist-tag latest、prereleaseはnextを使う。rc/betaはversion自体に-rc.N/-beta.Nを持ち、latestに付けない。stableも最初はcandidate等の非default tagで公開して全package/consumer smoke testを確認してからlatestへ昇格する提案。dist-tagは可動の参照でGit tagとは別であり、SemVerとして解釈される名前を使わない。publishのdefault tag任せでprereleaseがlatestを動かす事故を防ぐ。

## Git tag と release の対象

Git tagはv0.3.0、v1.0.0、v1.1.0-rc.1の形式でpackage versionと一対一にする。lockstepは一つのtagでrelease集合を示す。tag対象は承認済みrelease commitの完全SHA、CIはそのcommitをcheckoutしbranch先端を追わない。release commitにはpackage.json/公開workspaceのversionと内部依存、lockfile、CHANGELOG、必要な互換表を整合させる。

tagはannotatedとし、production公開tagは組織で承認したGPG/SSH等の署名方式・信頼鍵で署名/検証する方針。署名者/失効/鍵保管はD9で決め、CIがtag名だけを信用しない。公開tagは削除・上書き・force pushで別commitへ付け替えない。release失敗も同じtag/commitに対する結果として台帳へ残し、内容修正には新version/新commit/新tagを使う。tag署名はnpm tarballや実行job manifestの署名/provenanceとは対象が異なる。

## 公開前の gate と成果物

1. release担当者がversion/変更区分/公開package集合/registry/access/互換表を承認する。clean treeの承認commitから隔離CIで実行し、ユーザーの未コミット変更をreset/stashしてrelease準備しない。
2. 固定Node/npm/TypeScriptとlockfileでnpm ci、mandatory typecheck/設定検査、domain/storage/security/fault等の当該release必須tests、buildを行う。--if-presentやtranspile-onlyで必須検査を省略しない。buildがtracked source/versionを変更したら失敗とし、出力は不変artifactとして保管する。
3. npm pack --dry-runで予定内容を検査し、実際にnpm packしたtarballを展開して再確認する。files allowlistでcompiled ESM、.d.ts、CLI bin、Web asset、必要なMVP3種unit原本/手順、LICENSE/README/必要metadataを限定する。実際のtarballにnode_modulesの不要物、runtime JSON、.env、.npmrc秘密値、CA秘密鍵/token、job/log/journal/backup、fixture秘密情報、任意local path/source mapの機密を含めない。package.json/license/exports/bin/engines/typesを検証する。
4. 検査した同一tarballを使い、空のconsumer projectへinstallしてstrict SDK型/CLI help・設定検証・template同梱をsmoke testする。consumerの生成JobRefがjob/registryや業務実行依存をimportせず、jobs→schema/refs→producerのstrict buildが通ることも確認する。public packageのinstall/postinstallでOS user作成/systemctl実行/Redis操作を行わない。公開物のruntime最小依存とSBOM/licenseも確認する。
5. release manifestの作成/公開/照合日時は [UTC契約](03-architecture.md#utc-time-policy) のZ終端または単位付きepoch msで記録する。Git tag署名対象の外部仕様byte列を日時表示のために書換えない。release manifestへ完全commit SHA、Git tag/tag署名、package名/version、tarball SHA-256とregistry integrity、build ID/toolchain、CI/provenance参照、互換表/CHANGELOGを記録する。digestは同一性であり出所認証そのものではない。pack後の内容再生成・署名後の差替えを拒否する。
6. 署名済みtagと承認対象commitを確認した公開jobだけがcandidate/nextへpublishし、registryのversion/integrity/provenanceを読戻して確認する。全packageの結果とconsumer試験を揃えてから承認付きdist-tag昇格を行い、Webのrelease notes/台帳を確定する。

複数packageの公開やGit/npm/dist-tagの更新を一つの原子transactionにはできない。依存順とrelease集合、途中状態を台帳で追い、stable昇格前に全体を照合する。

CIは固定lockfile/integrityで再現buildし、必要なlifecycle scriptだけを明示審査する。依存取得/buildと運用jobのネットワーク/credentialを分け、runtimeにpackage installを要求しない。integrity hashは配布元認証や無害性の証明ではない。

## CI の最小権限と trusted publishing

対応CIではnpm trusted publishing/OIDCを優先し、長期publish tokenを通常CIやpackage runtimeへ配らない。repo/正確なworkflow/承認environmentを限定し、PRや不信任forkのコードがpublish jobや署名鍵へ到達しないようにする。CI action/toolchainを固定し、build/testとpublishの権限を分離、必要なjobだけid-token発行を許可する。maintainerのMFAとowner権限も審査する。初回package所有/信頼設定は管理者の明示bootstrapであり、belt利用者にnpm公開credentialを要求しない。

確認時点の公式資料ではtrusted publishingはnpm CLI 11.5.1以上/Node22.14.0以上を要し、対応provider/runner/許可actionを設定する。GitHub Actions/GitLab CIでは自動provenanceが提供されるが、すべてのproviderで同一ではない。npm stage publish等のactionやdist-tag管理権限は別に存在するため、direct publish、stage、dist-tag操作の必要範囲を採用CI/registry版で再確認する。単にpublish権限があればdist-tag変更も可能と仮定しない。

trusted publishingの認証失敗時に手元のtokenへ無断fallbackしない。npm CLI自体にtoken fallback経路があるので、通常release jobから不要token/env/.npmrcを除き、利用認証経路を検査する。対応外の公開操作が必要なら承認した別job/短期最小権限credentialを設計し、token生成/registry設定を自動実施しない。npm provenanceはsource/buildとの関連を示し、コードの無害性・型安全・再現性を万能に証明するものではない。

## 失敗・再開・修正・rollback

同じpackage名/versionは一度公開すると再利用できず、unpublishしても上書き用に空け直せない。publish timeoutは失敗と断定せず、registryからversion/integrity/provenanceを取得し、保管済みtarball/台帳と一致すれば成功済みとして再開する。存在せず確実に未公開なら同一digestを再送できる。不一致/出所不明なら停止して調査し、無条件publish/上書きやtag移動をしない。

複数packageの途中公開では、公開済みを照合して未公開packageだけ同じrelease集合のtarballから再開する。欠落packageの内容修正が必要になったら不完全releaseはlatestへ昇格せず、新patch/prerelease versionで一組を再作成する。必要なら問題versionへdeprecate等の案内を別承認で行う。公開済みtarballの修正はpatch等の新versionで配布する。

dist-tagのrollbackはlatest/nextの参照先を既に検証したversionへ戻す操作で、既存install/lockfile/稼働processを自動で戻さない。利用側は互換表/永続schema/実行中runを確認し、明示的に依存更新・build・drain・配備する。schemaを戻せない場合の旧runtimeへのdowngradeは拒否し、前進修正/承認済みrestoreを検討する。Git tagはrollbackでも付替えない。

## 受入条件と根拠

将来のrelease自動化はclean tree/dirty tree拒否、version/tag/lock/changelog不一致、署名不正、pack内容漏洩、SDK型エラー、tarball再生成、不正CI/OIDC、同version既公開、ACK消失、部分公開再開、dist-tag誤昇格、既存install不変/schema非互換をdisposable環境で検証する。本作業ではnpm pack/publishやGit tag操作を実行していない。

公式資料（2026-10-27確認）: [SemVer](https://semver.org/)・[Git tag](https://git-scm.com/docs/git-tag)・[npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)・[dist-tag](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/)・[trusted publishing](https://docs.npmjs.com/trusted-publishers/)・[provenance](https://docs.npmjs.com/generating-provenance-statements/)。URLの最新版と採用するCI/Node/npm版を公開時に再確認する。
