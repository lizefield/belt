# 脅威モデル・認可・実行の安全境界

ナビゲーション: [概要](../../README.md) ｜ [索引](../README.md) ｜ [要件・概念](01-requirements.md) ｜ [導入・SDK](02-project-integration.md) ｜ [構成・UTC](03-architecture.md) ｜ [永続化・反映](04-storage.md) ｜ [実行](05-execution.md) ｜ [ログ・監視](06-observability.md) ｜ [開発・運用](07-operations.md) ｜ [API](08-api.md) ｜ **セキュリティ（現在）** ｜ [Web認証](10-web-authentication.md) ｜ [設定](11-configuration.md) ｜ [controller分散](12-controller-distribution.md) ｜ [release](13-release.md) ｜ [検証・計画](14-validation-plan.md) ｜ [一次資料](15-references.md)

状態: **設計文書・未実装**。確定要件/採用契約と数値提案/未決を区別する。読む順序と正本は [設計索引](../README.md) を参照。

状態: 実装に向けた設計提案 / 調査日: **2026-10-27**。記載は実装済みの防御やセキュリティ検証結果を意味しない。MVP の出荷条件と保証範囲を定義する。

## 脅威モデルと信頼境界

belt は指定ホストで TypeScript と command を実行する基盤であり、管理権限の侵害はコード実行に直結する。保護対象は host の実行権限、controller/worker の資格情報、job artifact と定義、業務 secret、共有実行状態、ログ/監査/backup。管理者・job 作者・Web 利用者・worker は異なる権限主体として扱う。

| 境界 | 信頼する対象と攻撃 | 必須の設計 |
| --- | --- | --- |
| Web/CLI → controller | 利用者の入力は不信任。token盗難、CSRF/XSS、IDの差替え、DoS | 認証必須、全操作の scope 認可、body/rate/計算上限 |
| controller → executor | ネットワーク/自己申告 hostname は不信任。worker偽装、報告再送、別 run の横取り | mTLS、登録済み identity、session/lease/token と割当 scope の一致 |
| supervisor → job runner → job | job 作者は許可された実行ドメイン内で任意コードを実行できる | UID/credential 分離、固定 runner 境界、cgroup/上限、manifest 制約 |
| CI/配備 → registry/import | 改変 artifact、混入依存、任意 import、署名鍵侵害 | 許可した配布元の署名、immutable payload hash、実行前の version 照合 |
| Web auth → S3/KMS/Redis | TOTP secret盗難、catalog rollback、OTP replay、旧cache失効漏れ | 非公開/envelope暗号・限定IAM、catalog CAS、共有replay/gate、復旧時session失効・replay隔離 |
| controller → Redis | Redis 管理者/host root の侵害は状態・監査にも及ぶ | 閉域、最小 ACL、TLS、noeviction、別 UID、復元時の世代変更 |
| JSON/log/spool → FS | path traversal、symlink race、誤権限、容量枯渇、ログ偽装 | ID→固定領域の内部 mapping、非共有の親 directory、atomic file、出力 escaping |

MVP は単一組織・信頼された job 作者・閉域の管理者/運用者を対象とする。project scope/namespace は認可の単位であり、敵対的テナントの隔離を保証しない。job 作者は、その job runner UID に与えたファイル・ネットワーク・業務 secret を使える。侵害された job/host が正しい処理結果を報告すると保証する仕組みではない。

不信任コード・相互に信用しない組織の job を同居させる運用は MVP 外。必要なら別 host/VM/厳密な container 境界、独立資格情報・ネットワーク・資源割当を設計して検証する。`node:vm`、worker thread、Node Permission Model は敵対的コードの sandbox としない。[Node VM](https://nodejs.org/api/vm.html) / [Node Permissions](https://nodejs.org/api/permissions.html)。

<a id="security-gates"></a>

## MVP 必須制御と起動・公開の条件

| 制御 | MVP 必須 | 後続の強化 |
| --- | --- | --- |
| 認証 | 閉域でも必須。管理 Web と remote executor は mTLS identity、Web は server-side session、automation は scope/期限付き token と mTLS | OIDC/SSO/MFA、組織の認証 gateway |
| 認可 | deny-by-default。action × project/job/version/queue/host/secretRef の交差、self grant 禁止 | 二者承認、細粒度 policy engine |
| 実行境界 | 非root、controller/supervisor/runner の credential 分離、OS が管理する固定 UID 境界、cgroup 上限 | per-attempt cgroup、強い workload isolation/attestation |
| artifact | 信頼鍵で検証した release manifest、hash/version/platform 固定、immutable 配置 | 透明性ログ・署名鍵の HSM 等 |
| Web/API | 非公開 bind、TLS、CSRF、CSP/escaping、validation/limits、機密応答 no-store | 外部境界での高度な検知・WAF |
| 状態/監査 | Redis ACL/TLS/閉域、atomic 更新、retention、backup/restore、危険操作の監査 | 外部の改ざん困難な監査保管、法的保存 |
| 更新 | lockfile/integrity、license/SBOM、脆弱性対応窓口と更新期限 | 自動署名検証・組織横断ポリシー |

controller/worker/runner が effective UID 0、認証未設定、期限なし資格情報、失効状態を確認できない、信用できない artifact、必要な runner 境界/資源上限がない場合、該当 listener または job dispatch を開始しない。検査不能を安全とみなす fallback は設けない。Redis 不通では認可キャッシュだけで変更や新規実行を継続しない。

Web/API は既定で loopback の明示 address にのみ bind し、loopback でも認証を省略しない。`0.0.0.0`/`::` の暗黙 bind はしない。閉域の remote bind は管理者が明示し、server証明書、worker/CLIのclient証明書とidentity mapping、Web TOTP/account基盤、scope、firewall/到達範囲、監査/容量/復元、対象 Linux の受入試験を満たすことを出荷条件にする。hostname/IP が private に見えるだけで公開されていないとは判定しない。

公衆インターネット公開は MVP の起動 profile で拒否する。公開や多組織利用には、標準認証基盤による SSO/MFA、信頼した ingress、ネットワーク制御、攻撃流量対策、更新/監査体制と独立したセキュリティレビューが必要。OS/firewall や外部 NAT の状態をアプリだけで証明できない項目は、配備担当者の確認と外部からの到達試験で検証する。単に config flag を立てれば公開条件を満たす設計にしない。

<a id="authentication"></a>

## TLS・identity・資格情報のライフサイクル

TLS は Node/OpenSSL と組織の PKI を使い、TLS 1.2 以上、証明書 chain/期限/用途と server hostname を検証する。TLS検証無効化、汎用の自己署名証明書自動受入、token の URL/query/argv 渡しは拒否する。client 証明書は許可 issuer と SAN 等の一意 identity を principal/worker ID に mapping し、CN/hostname の自己申告を認可に使わない。[Node TLS](https://nodejs.org/api/tls.html)。

### VPC と証明書の運用境界

AWS VPC 内も直接 HTTPS + mTLS を基本とする。private IP/内部 DNS でも private CA/既存 CA を信頼配布でき、public 証明書や ALB/AWS Private CA は不要である。SG/NACL は到達制御であり暗号化・worker identity・job/host/attempt の認可を代替しない。worker に Redis credential を渡さず、controller broker だけが共有 DB の更新と割当/報告の scope を検査する。

接続名に対応する DNS/IP SAN、chain/用途/期限を検証する。期限監視、更新時の接続確認、期限付き CA rollover、PKI と belt mapping の失効、既存接続/resumption の拒否までを運用責任に含める。更新失敗/失効確認不能時に平文 HTTP や検証無効化へ fallback しない。稼働 attempt の停止を確認できなければ held/照合にする。

internal ALB は任意の別 ingress profile であり、直接 mTLS identity と転送 header を混同しない。frontend TLS 終端後の HTTP 区間は平文、HTTPS target でも ALB は target 証明書を検証しない。採用には mTLS verify/trust store/失効、backend SG による迂回防止、header 偽装・重複・正規化の検証と専用 adapter の受入試験を要求する。未整備なら直接 mTLS profile を使う。[配備例と更新/失効手順](07-operations.md#aws-vpc-transport) を規範とし、そこに示す追加サービスを必須依存にしない。

### worker enrollment

1. admin は予定 worker/host ID、project/job/command 範囲、承認 certificate identity と fingerprint を登録する。job 作者や worker の自己申告で権限を増やさない。
2. host 上で秘密鍵を生成し、組織の PKI から client 証明書を取得する。belt は CA や鍵交換 protocol を作らない。秘密鍵は supervisor 専用 UID が読む credential に置く。
3. enrollment は mTLS と、対象 identity/host に束縛した一回限り token（既定10分）を併用する。token hash の使用済み化と identity 登録は原子的に行い、失敗・再送も同じ receipt で照合する。
4. sessionはmTLS identity/承認fingerprint、共有deployment generation、executor epochと束縛し、Redisに保存する。controller ID/TCP接続をbindingにせず、別controllerでも同じidentity/sessionを毎要求検証する。assignment/report はさらに project/run/attempt/lease/token に束縛し、他 worker や session の再送を拒否する。

再接続の永続認証は mTLS。enrollment token を長期 bearer credential に昇格させない。証明書期限・rotation 間隔は組織 PKI と D7 で確定し、初期案は30日以内、rotationで2本の証明書を許す期間は最大10分。新 fingerprint は承認後に有効化し、更新前credential/session を失効する。失効は毎要求・renew 時に Redis の状態で検査し、継続中のTLS connection/session resumption だけで失効を無視しない。resumptionでpeer identityを確定できなければfull handshakeを要求するか拒否し、自己申告headerで補わない。

失効後は新規 claim/renew を拒否して接続を閉じ、稼働 attempt に停止要求を保存する。通信断で停止確認できなければ held とし、資格情報の失効だけで job が停止したとは扱わない。証明書盗難時の有効期間内悪用を、mTLSだけで防げるとは主張しない。[UTC契約](03-architecture.md#utc-time-policy) に従い認証期限/監査/報告はZ明示または単位付きUTC epoch ms、プロセス内の待ち時間は単調時計で扱い、naive日時やlocal表示で権限期限を変えない。時刻同期/大きなclock stepで期限の検証を信用できない場合は、認証・session/credential発行・権限変更・新規dispatchを保留し、時刻と稼働状態を照合する。sessionのプロセス内経過監視には単調時計も使い、再起動後はUTCの検証なしに復活させない。

### 人間・automation の認証

管理Webは [ID＋個人別TOTP](10-web-authentication.md) とRedis opaque sessionで認証する。氏名/email/password、個人client証明書は必須にしない。IDは本人確認や第二要素ではなく、TOTPは単要素・非phishing耐性。初回adminは既存運用権限の明示CLIからpending→QR登録確認→active、public先着admin/self-signupを設けない。Web listenerとworker/automation mTLS routeを分離する。S3正本とRedis gate/replay/失効の検証不能時はWeb fail-closed。

automation/CLI の bearer token は、必要な場合に mTLS に追加する期限/用途/scope 付きランダム secret（256-bit 相当、初期有効期間1時間）。平文は一回だけ protected file に渡し、controller は hash、ID、expiry、scope、revokedAt を保存する。web の localStorage や job env に保存しない。refresh token・独自 JWT/HMAC 署名方式・独自 challenge protocol は MVP に入れない。標準の TLS/opaque session/Authorization と成熟した暗号 API を使い、更新が必要なら再認証/承認済み rotation を行う。

credential は controller/supervisor と runner の UID 間で読めないことを確認し、mode 0600/親0700、backups/diagnostics も含めて保護する。取得済み secret の安全な消去を Node の GC に保証させない。保護された PKI/session 実装に必要なライブラリは、依存数だけを理由に自作へ置き換えない。

<a id="authorization"></a>

## deny-by-default の認可と危険操作

認証済みでも権限はゼロから始める。role は action の候補であり、許可は principal の grant、project/job/version、queue、host/worker、secretRef、登録済み artifact、操作対象 state の交差で決定する。list/count/log/preview/export も含め、controller の毎要求・claim・started・renew で再検査する。[OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)。

| role / capability | 許す操作の例 | 制限 |
| --- | --- | --- |
| viewer | 許可範囲の定義/実行状態 | 生ログは別 `logs.read` grant。秘密値・資格情報・他projectの件数を公開しない |
| operator | grant がある job の enqueue/cancel/retry、対象 queue の pause/resume | target/command/secret を拡張不可。結果不明の解消権限は既定で付けない |
| admin | grant 範囲の定義/schedule 管理、worker 登録 | host の OS manifest/署名信頼鍵を API から書換え不可。自分の scope を広げない |
| 明示追加 capability | `runs.resolve`、`slots.release`、`principals.manage`、`credentials.revoke`、export/restore 等 | 個別付与・再認証・理由・監査。global 権限はローカル bootstrap/権限管理者が管理 |

controller を confused deputy にしない。enqueue に渡された target や secretRef が存在しても、利用者と job/host の両側で許可されなければ拒否する。jobnet の各 node、schedule が実行する version、retry の固定 artifact にも同じ認可を適用する。worker は割当済み attempt の報告しかできず、他 run の finish/cancel/ログ参照はできない。推測困難な ID を認可の代替にしない。

held を成功に解消、停止未確認 slot 解放、非冪等処理の再実行、資格情報/権限変更、定義有効化、backup restore は危険操作とする。Web は対象/影響/結果不明の理由を提示し、直近再認証、expectedRevision、理由、明示確認を要求。CLI の非対話操作も対象 ID と理由を必須とし、確認省略 option は権限や監査を迂回しない。大量操作は件数上限と対象 snapshot を持つ。金融等の二者承認要件は後続の追加制御として扱い、それが必須の業務は追加制御の完成まで運用対象にしない。mTLS再検証と確認操作を、人間の立会い/MFAの証明とはみなさない。

<a id="execution-boundary"></a>

## Linux の実行境界と停止

controller UID、worker supervisor UID、project/trust-domainごとのjob runner UID、Redis UIDを分離する。API credentialを持つ利用側producerもjob UIDからそのcredentialを読ませず、producer用とexecutor用のidentityを共有しない。controller は job registry を import せず業務 secret を読まない。supervisor は制御資格情報を持つが業務 JS を import しない。業務 JS の読込/実行と業務 secret の解決は runner 側に限定する。

登録済みOSコマンド/固定scriptはworkerの両方で対応する。job定義/制御のTypeScript必須とコマンド言語は別。shell:false+argv、固定interpreter/path、cwd/env/stdin/output/停止の [command契約](05-execution.md#os-command-execution) を守り、制御資格情報を継承しない。

**単に child_process を作っても UID や credential 境界は変わらない。** 非root Node から任意 UID へ変更できるとは仮定しない。MVP は OS 管理者が事前配置した、固定 project UID の runner service/限定 launch 境界を使う。supervisor→runner は filesystem 権限付き private Unix IPC を用い、許可した registry ID・引数・attempt だけを渡す。任意 executable/UID/systemd unit/パスの選択は許さない。起動橋渡しの実装・対応 Linux は D8 の出荷 gate とする。未整備なら同一 UID 実行へ fallback せず dispatch を拒否する。

IPC socket/親 directory は job UID に置換させない。systemd socket activation 等の OS 管理機構を利用し、Node 標準にない peer credential 検査や FD 機能を利用可能と決めつけない。必要なら狭く監査した helper を依存例外として検討するが、汎用 sudo/Polkit 許可、Docker socket、任意 transient unit 作成権を job に与えない。OS の service manager の権限と belt runtime の root 実行を区別する。

job UID に supervisor の秘密鍵/token/credential mount/Redis 接続情報を渡さない。child env は必要な名前だけを構築し、`NODE_OPTIONS`, `NODE_PATH`, loader/preload、`LD_PRELOAD`, 汎用 HOME/PATH 等を親から無条件に継承しない。stdin/stdout/stderr と必要な IPC 以外の FD を継承せず、制御 socket・証明書・backup FD を渡さない。jobが必要な業務secretはproject/handler/host grantに限定し、argv/コマンド行へ埋め込まない。control planeのNode inspector、任意preload/loader、TLS keylog、秘密を含むdiagnostic report/core dumpは運用profileで無効にし、診断が必要な場合も限定権限・保護された保存先・監査を要求する。

systemd/cgroup の service 単位で MemoryMax/TasksMax/CPUQuota/IO 制御、nofile、core dump 抑止、専用 writable directory/容量上限、read-only artifact、NoNewPrivileges、必要最小 capability を適用する。controller 用と runner 用の profile を分け、ジョブに必要なmount/networkだけを明示許可し、未指定のjob egressは拒否する。ネットワーク境界はOS/firewall等で適用し、Node側のURL検証だけを任意コードのegress制限にしない。ホスト root/OS侵害、kernel脆弱性、同じ trust-domain 内の悪意ある job に対する完全隔離は保証しない。[systemd execution](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) / [resource control](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html)。

cancel は AbortSignal/SIGTERM→猶予→SIGKILL を行い、process identity/子孫を照合する。service 終了時は `KillMode=control-group` で残存 tree を回収するが、これは単一 attempt を確実に止めた証明ではない。別 session 化した子孫、runner 障害、停止未確認は held。per-attempt cgroup を使うまで、service 全停止の他 job への影響と slot 保持を運用手順に含める。[systemd kill](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html)。

<a id="artifact-safety"></a>

## registry・artifact・JSON・ファイルの安全性

hash は同一性検査であり配布元認証ではない。MVP の release manifest は、project/job/version、platform/runtime、immutable payload の hash を結び付け、組織の release key の detached signature を持つ。controller は署名済みメタデータを検証し、runner は import 前に manifest signature と payload hash を検証する。署名対象は明確な manifest の byte列とし、署名そのものは detached として循環参照しない。

信頼鍵/algorithm/用途/project、鍵の失効・有効期間は OS 管理の read-only trust policy に固定し、API payload から信頼鍵を選ばせない。検証には [Node crypto.verify](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature) または組織の成熟した署名ツールを使い、独自署名/暗号 protocol を作らない。署名済みでも CI/作者/鍵の侵害、悪意ある依存を防ぎ切れない。署名失効や対象 artifact 侵害時は新規実行を止め、実行中は停止/照合へ進める。

manifest 生成は利用側の信頼した CI でのみ registry を import する。controller/supervisor は検査のためにも業務 config/module を import しない。runtime では既知 ID から配備済み registry を解決し、JSON/Redis/HTTP に含まれる source code、任意 import URL/path、loader option を実行しない。

artifact、executable、manifest、信頼鍵は runner/job UID が書換えできない immutable directory に置く。`realpath` の一回確認だけで TOCTOU を防げるとは扱わず、親 directory の所有権、symlink/実体/owner/mode の検査、更新不可の配置を組み合わせる。ESM import/spawn の path 解決と hash 検査の間に job がファイルを交換できる配置は拒否する。release は新しい immutable directory として配備し、進行中 run の参照を維持する。

JSON config/manifest/export/journal は schema version・byte/depth/配列上限を検証し、未知 field、危険な merge/prototype 操作を拒否する。文字列をコマンド・import・設定式として eval しない。改行/Unicode/重複 field の解釈が境界ごとに違う parser 構成を避け、署名対象 byte列の検証と利用する解析規則を固定する。必要な厳密 parser は成熟した実装を検討する。

ファイル名を API の path から生成せず、検証済み内部 ID→固定 root の mapping を使う。`..`、絶対 path、encoded separator、NUL、symlink を用いる範囲外参照を拒否。書込は protected parent 内の排他的 temp file（0600）→ fsync→atomic rename→directory fsync、破損時は隔離して照合する。`O_NOFOLLOW` は最終 component の制約であり親 directory の race を解決しない。Node が必要な OS primitive を公開しない箇所は、write 禁止配置か監査済み helper を前提にする。[Linux open](https://man7.org/linux/man-pages/man2/open.2.html)。

共有 JSON source は [公開/競合/有効化の契約](04-storage.md#shared-json-publication) を満たす。共有 FS は controller を read-only とし、署名鍵/credential と publisher の書込権限を分離する。親 directory/entry の owner・mount・symlink/置換・ネットワークと採用 FS の cache/耐久性を検証し、複数 writer を local lock の想定だけで許可しない。

任意 S3 adapter は TLS と対象環境の限定した IAM role/短期 credential を用い、長期 access key を JSON や job env に入れない。default credential chain のどの provider を許可するか固定し、別 credential への意図しない fallback を検査する。reader は固定 bucket/prefix の GetObject（固定 VersionId を使うなら GetObjectVersion）、必要時だけ限定 ListBucket、publisher は限定 PutObject/conditional write とし、Delete/ACL/Policy変更・他prefixへの権限を与えない。GC/restore は別運用権限。S3 Block Public Access、保管時暗号化、監査、必要な場合の限定 KMS decrypt を配備条件にし、controller reader の AWS credential を runner に渡さない。同一 EC2 の instance role/metadata endpoint に job が到達すると role が漏れるため、job UID/実行境界から metadata/credential endpoint への到達を OS 側で拒否できることを確認し、満たせない共有 host は採用しない。IAMだけで署名/入力検証を省略しない。

manifest 内の URL/endpoint/署名鍵指定を信頼せず、bootstrap の許可先に固定する。S3 SDK/SigV4/credential更新は成熟した実装に任せ、adapterだけに依存を閉じる。S3強整合性は multi-object transaction/認可/署名/fencing の代替ではない。配布停止・署名不一致・active版未検証を古い cache の無条件採用で隠さない。[S3 security](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html) / [AWS SDK credential](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html)。

schema migration/restore は配備管理者が drain/backup/検証後に実行し、unknown schema を黙って受入れない。export は secretRef 等の参照だけを含め、private key/token/平文 secret を含めない。JSON 定義 export は Redis runtime 状態/lease の backup の代替にならない。

<a id="web-security"></a>

## Web・API・SSRF・secret 出力

Webのsession/gate/account版・失効・cookie属性・rotation/logoutは [認証session契約](10-web-authentication.md#login-session) を正本とする。API automationは別mTLS identityとscopeで検証し、Web sessionとの混用で権限を広げない。

cookieはブラウザーが自動送信するため、認証だけでは CSRF を防げない。session発行後の変更要求は POST/PUT/DELETE + application/json、session に束縛した CSRF token の専用 header、正確な Origin 検査を必須にする。GET に副作用を持たせず、credential 付き CORS は既定拒否。API automation は明示 Authorization と client identity を検証し、browser session と混用しない。SameSite/CORS のみを CSRF 対策にしない。[OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)。

ログ・args・job名・error は text として描画し、innerHTML/eval/動的 script を使わない。CSP は default-src 'none'、script/style/connect は self、object/base-uri/frame-ancestors は none を基準にし、inline/eval/CDN を許さない。nosniff、機密 API の Cache-Control:no-store、attachment としての export を設定する。terminal表示ではANSI/control sequenceや改行による偽装を処理し、WebのHTML escapeと区別する。CSPだけに依存せず、出力先に応じたescapingと安全なDOM操作を必須にする。[OWASP XSS](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html) / [CSP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)。

JSON の unknown field/type/depth/数値範囲/正規化/状態を検証し、Content-Type/encoding/Content-Length/実byte数を整合させる。HTTP解析はNodeの標準実装を使い、insecure parserや曖昧なheader許容を有効にしない。proxyを導入する場合はrequest framingの解釈差も検証する。body64KiB・job入力32KiB・結果16KiBを基本に、header/URL/接続/handshake/read timeout、principal/IP/project 単位 rate/burst、長い poll・ログ転送・署名検証・schedule計算にも上限を設ける。圧縮 body を初期は受けず、巨大展開や slow request を避ける。初期案はprincipal/project単位で参照30 req/s・burst60、通常変更5 req/s・burst10、危険操作1 req/s・burst2、enrollment5回/分とし、全体上限も別に設ける。認証前はIP/接続単位、認証後はprincipal/host/projectで合算し、IP変更による回避を防ぐ。renew/finishの予約枠は維持し、上限の数値はD1と受入負荷試験で確定する。

controller は利用者指定 URL、artifact URL、callback、log link を自動 fetch しない。target は登録済み worker ID、controller/Redis/CA の接続先は管理者 config の許可先に限定する。redirect/任意 scheme/metadata endpoint へのアクセスを許す汎用 proxy を作らない。proxy 経由にする場合は信頼 peer を固定し、外部からの X-Forwarded/identity header を捨てる。job 自体の外向き通信は別の OS egress policy と業務 grant で制御する。[OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)。

secret は値ではなく参照を受け取り、必要な runner だけが解決する。request body、Authorization、cookie、env、argv、証明書 private key、credential URL を標準ログへ出さない。既知 secret の redaction、長さ制限、機密 field の allowlist を適用するが、変換/分割された未知 secret を完全に消せるとは約束しない。job 作者にもログへ秘密を出さない契約を課す。[OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)。

## Redis・監査・容量・重複実行

Redis は internet 非公開、専用 UID/volume、controller だけの runtime ACL、遠隔は TLS、default user の無権限化を必須にする。runtime に管理用 CONFIG/ACL変更/FLUSHALL/MODULE等の権限を与えない。Lua/必要 command と key prefix のアクセスに限定し、運用 backup/inspect は別 credential。認可や script の都合で broad ACL を無断付与しない。[Redis security](https://redis.io/docs/latest/operate/oss_and_stack/management/security/)。

namespace は事故防止と scope の補助であり、単一 Redis/host 内の敵対テナント隔離ではない。belt の認可を Redis key名の秘密性に依存させず、worker/job に Redis credential を渡さない。失効情報/認可の照合失敗、AOF/容量/整合性の異常では新規変更/claim を止める。noeviction と queue/spool/log/履歴/計算上限を保ち、監査・finish・renew 用の容量/接続枠を確保する。

監査は actor/action/target/result/reason/request ID/revision/credential ID を機密除去して残し、権限・定義・artifact・資格情報変更、held解消/slot解放、backup/restore を対象にする。Redis 内監査は Redis 管理者による改ざんに耐えない。MVP は別権限の定期 export・backup と復元演習を必須にし、改ざん不能性が必要なら外部の保護された保存先を別要件として gate にする。独自 hash chain だけで管理者改ざんを防げるとは言わない。

backup は暗号化/アクセス制御された別障害領域に保存し、復元担当者と日次運用者の権限を分ける。restore後はdeployment generationを更新し、token/session/credentialもこの世代に束縛する。復元したgrant/certificate mappingは再承認まで無効にし、消失したrevocationやtokenの再有効化を防ぐ。必要な失効/信頼情報は Redis backup だけに依存せず、PKI/管理台帳と突合する。全 active/held と外部副作用を確認するまで dispatch を許可しない。

retry、lease expiry、cancel は副作用 rollback でも exactly-once でもない。[retry契約](05-execution.md#retry-backoff) の単調非減少delay/上限・回数/経過予算・UTC nextEligibleAtを条件付きで永続化し、恒久エラー/認可拒否/cancel/unknownを無限retryしない。非冪等処理の結果不明を自動成功/再実行とせず held にし、停止確認なしの slot 解放や effectKey 変更を危険操作として扱う。期限切れ token/epoch の報告は evidence に留め、別 attempt を上書きさせない。

### 反映報告・telemetry の信頼境界

controller反映報告は登録controller ID/起動epochと対象revisionを照合し、stale/loadedだけ/部分反映をreadyにしない。desired/active変更は個別認可・expected revision・監査を要求する。反映ACKをscheduler leaderやjob実行権限の代替にしない。

resource telemetryの採取/分母/保持と欠測処理は [監視仕様](06-observability.md#resource-telemetry)、size/rateは [設定表](11-configuration.md) が正本。security境界はmTLS identityとserver/resourceTarget/scopeの照合、read-only採取、resources.read＋host grant。任意path/機密labelの公開や権限昇格を許さず、侵害済みhostの値を認可/OS制限緩和に使わない。heartbeat/leaseと混同しない。

system errorの [集約契約](06-observability.md#system-error-events) はcode/templateと小さなallowlist detailだけを受け、raw Error.message/stack/env/argv/秘密/個人情報を中央へ無条件保存しない。worker identityとcomponent/project/instanceを照合し、systemErrors.readとproject/host/component grant、projectなしinfraはdeployment運用grantで守る。size/rate/dedupe/保持/件数bytes/TTLと低優先度bufferを制限する。Redis停止時はlocal fallback・欠落表示、logger自身の失敗は再帰送信しない。best effortのerror記録でmandatory auditやjob状態保証を代替しない。

multi profileの [endpoint/session境界](12-controller-distribution.md) を適用し、複数controllerでもRedisのgrant/失効を毎要求検査する。JWTは必須にせずopaque sessionを共有し、RAM/stickyに認可を依存させない。全endpointのSAN/CA/登録identityを検証し、redirectや障害を理由にTLS/認可を弱めない。Web cookieはsame-origin境界を維持する。

[共通enqueue契約](02-project-integration.md#typed-enqueue) ではproducerが生成JobRef/専用接続設定だけを読み、job/registry/業務secret依存をimportしない。生成moduleのimport graphとpackをCIで検証する。controllerは登録済みschema/hash/version/grantを検証し、enqueueから自動登録・scope拡張・任意code読込をしない。trusted registry読込phaseと署名/公開phaseのcredentialを分離し、未登録/旧hash/反映遅延のエラーでpayloadや不可視jobの存在を漏らさない。

## 依存・release・セキュリティ更新

npm/Gitのversion・署名tag・tarball/provenance・公開失敗の照合は [release契約](13-release.md) に従う。MVPの開発起動は [dev CLI](07-operations.md#development-cli) でもTLS/UID/secret境界を維持し、Production常駐は [OS管理原本](07-operations.md#systemd-templates) を使う。

runtimeはRedis/node-redisに加え、採用Web profileのS3/KMS、標準TOTP/QRとenvelope encryption library/AWS SDKを用途限定adapterに閉じる。schedulerは標準DateのUTC演算（IntlはWeb表示だけ）。Node/OpenSSL/ICU、Linux/systemd、PKI、署名ツールも依存台帳へ含める。Nodeのsecurity releaseやOSのsecurity advisoryを監視し、対象版を固定した更新手順を持つ。依存を減らす目的で TLS/暗号、認証 protocol、RESP client を自作しない。必要な認証/検証 helper の追加は用途・保守・権限・license を審査し、core と adapter の境界に閉じる。

公式開発経路は本体/利用側ともTypeScriptのstrict型チェック成功を必須とし、型無しJS/transpile-onlyを正式buildにしない。型は実行時に消えるため、any/assertionや署名/provenanceを安全性の証明とせず、外部JSONの入力/結果/定義はruntime検証する。[型契約](02-project-integration.md#typescript-contract) を参照。

CIのlockfile/integrity/SBOM/license/署名・公開権限・更新手順は [release契約](13-release.md) を正本とする。job/不信任PRへ制御credentialを渡さず、runtimeのpackage installを必須にしない。セキュリティ更新責任者とD9の出荷gateを維持する。

脆弱性/侵害の担当者、通知経路、重大度判定、更新・再配備期限、稼働停止基準を出荷前に定める。初期運用目標は緊急情報を24時間以内に triage、悪用が疑われる対象 artifact/credential は即時停止・失効。修正未検証のまま自動更新して実行契約を変えず、更新が間に合わない場合は該当 listener/job を停止する。既知重大な問題の例外は責任者・期限・補償策を明記する。

<a id="security-tests"></a>

## Security acceptance tests と出荷 gate

下表は実装時の必須試験であり、試験済みという主張ではない。危険な Redis command/侵害ケースは disposable な検証環境で行い、稼働環境へ試行しない。

| 試験 | 合格条件 |
| --- | --- |
| 起動条件 | UID0、認証/CA/期限/scope/runner境界/上限未設定、危険 bind、PKI/Redis照合不可で該当機能が起動しない |
| 反映/telemetry | 別controller/epoch/revisionのready偽装、loadedのみの有効化、別server sample、任意path/label、巨大payload、resources.read/host grant越境を拒否。欠損時に権限拡張/無制限起動せず、telemetry飽和でもrenew/finish枠を維持 |
| 共有 source（採用時） | unsigned/改変/mixed release、競合/ACK消失、403/mount断/cache不一致、header/URL参照差替えを拒否。readerはpublish/delete不可、jobからsource credential/metadataへ到達不可。参照中versionのGCと失効済み署名のrestoreを拒否 |
| VPC/ingress | private DNS/IP でも証明書を検証。HTTP/verify=false への fallback 拒否、CA rollover と更新失敗を試験。ALB 任意 profile は mTLS verify・偽装 header/重複/迂回拒否・backend 区間を検証するまで無効 |
| TLS/enrollment | 不正 issuer/SAN/fingerprint/期限/EKU、wrong host、token再利用/期限切れで登録不可。並行 enrollment は一回だけ |
| 失効/rotation/replay | 接続継続・session resumption でも revoked は renew不可。別worker/runへの token/session/report再送拒否、timeout時の同一操作照合 |
| 認可/confused deputy | viewer変更、別project ID、target/secret/versionの差替え、他runログ/finish、node/schedule経由のscope昇格、自分へのgrant追加を拒否 |
| Web | 業務APIでcookie欠落・失効/gate closed・CSRFなし・cross-origin・GET変更を拒否。login/登録でもOrigin/pre-auth nonce/rate/replayを検証。worker/admin routeはWeb listenerからmTLS迂回不可。XSS/HTML/ANSI payloadを実行せず、機密response/cache/logへsecretが出ない |
| API/DoS | slow/巨大/圧縮/深いJSON、異常数値/merge keys、header/URL過大、poll/rate/署名/scheduler負荷で上限と回復が機能 |
| OS/secret/FD | job UIDからcontroller/supervisor/producer credential読取不可。余分なenv/FD、sudo/Docker socket/任意unitに到達不可。CPU/memory/fork/output/disk負荷を制限 |
| process/cancel | setsid/子孫・SIGTERM無視・runner異常・controller停止で虚偽canceledにしない。cgroup全停止の影響を示し、未確認はheld |
| artifact/path | 署名なし/信頼鍵不一致/失効/改変/異platform/versionをimport前に拒否。symlink/.. / encoded traversal/配置交換・TOCTOUを許す権限構成を拒否 |
| JSON/Redis | mode/owner/partial write/unknown schema、ACL不足/過大権限、noeviction/full disk/AOF失敗でも勝手に緩和しない。secretなしのexport |
| backup/audit | revocationを含む復元、generation更新、active照合、監査欠損/容量満杯の変更停止、限定権限での復元とRPO/RTO計測 |
| release | lockfile/SBOM/license/署名/依存更新手順と緊急停止を、controllerと利用側bundle両方で再現 |

MVPはcontrollerと複数ホストのworker/固定runner構成でこれらを満たしてから運用へ渡す。指定サーバー向け専用agentは後続で、MVPの認証/起動gateに含めない。loopback の検証環境にも無認証の管理面を設けない。製品機能のテスト成功と、対象 Linux/ネットワークへの安全な配備を別々に確認する。

<a id="security-operations"></a>

## 運用手順と残るリスク

- 配備前: D7〜D9を確定し、管理主体・許可job/host・PKI・署名鍵・UID/runner境界・Redis ACL・到達範囲・backupを検査。非機密な security-check の結果を保存して承認者を記録する。
- 通常運用: 証明書/token/署名鍵の expiry、失効反映、容量/AOF、失敗認証/rate、held/停止未確認、artifact脆弱性を監視。権限とcredentialの定期レビューを行う。
- credential/host侵害: 新規受付/割当を制限し、対象 identity/session/証明書/token を失効。停止要求とOS隔離を行い、実行中副作用・spool/ログ・監査を保全。停止確認前に別hostへ再実行しない。
- artifact/key侵害: 該当hash/versionと鍵をdenyし、必要な業務を停止。信頼源を回復し、新artifactを検証・配備してから影響runを照合する。
- restore: 別環境で整合性/credential/失効台帳を突合し、generationを更新。権限を復元前snapshotのまま再有効化せず、active/heldを確認して再開する。

残るリスクは trusted job 作者/CI/host root の侵害、業務 secret の意図的漏洩、外部副作用の重複、時刻/ネットワーク断、サービス単位 cgroup の粒度、Redis監査の管理者改ざん、供給元鍵/依存の侵害。これらを「完全隔離」「安全」と一般化しない。

<a id="security-decisions"></a>

## 判断台帳と出荷制約

D7（認証/PKI・Web account/復旧）、D8（Linux固定UID runner/IPC/cgroup）、D9（署名・依存・監査・承認）の判断台帳は [要件D1〜D9](01-requirements.md#design-decisions) を正本とする。本書のsecurity gateを満たせない配備では該当listener/dispatchを開始しない。TOTP library/envelope policy・Authenticator互換性等の未決詳細は [認証仕様](10-web-authentication.md#auth-operations-tests) に保持する。
