# Web UI アカウント・TOTP認証

ナビゲーション: [概要](../../README.md) ｜ [索引](../README.md) ｜ [要件・概念](01-requirements.md) ｜ [導入・SDK](02-project-integration.md) ｜ [構成・UTC](03-architecture.md) ｜ [永続化・反映](04-storage.md) ｜ [実行](05-execution.md) ｜ [ログ・監視](06-observability.md) ｜ [開発・運用](07-operations.md) ｜ [API](08-api.md) ｜ [セキュリティ](09-security.md) ｜ **Web認証（現在）** ｜ [設定](11-configuration.md) ｜ [controller分散](12-controller-distribution.md) ｜ [release](13-release.md) ｜ [検証・計画](14-validation-plan.md) ｜ [一次資料](15-references.md)

状態: **設計文書・未実装**。確定要件/採用契約と数値提案/未決を区別する。読む順序と正本は [設計索引](../README.md) を参照。

状態: **採用する設計契約・未実装**。調査日2026-10-28。外部identity serviceを必須にせず、閉域・少人数・低頻度のアカウント変更を対象とする。公開インターネットや高保証認証の要件を満たすという意味ではない。

<a id="auth-model"></a>

## 利用者と認証の境界

人間のWeb認証はランダム利用者ID＋個人別TOTP、成功後はRedis上のopaque sessionを使う。氏名/email/passwordは必須にしない。IDは暗号学的乱数128-bit以上の不透明値で、本人確認情報でも秘密の第二要素でもない。同一IDへの操作を追跡できるが実在人物を証明しない。端末内へのID保存は本人の明示選択とし、共有端末では保存しない。保存済みIDがある次回画面ではコードだけを入力できるが、要求にはIDを必ず含める。ID無しで全利用者の秘密鍵を総当たり照合しない。

TOTPは標準RFC6238に従う保守された実績あるlibrary、QRはローカル生成libraryを使い、独自OTP/暗号/認証protocolを作らない。採用library/版/license/推移依存と検証結果は出荷前に固定する。対応otpauth URIは相互運用の慣行であり、任意Authenticatorで動くことを無試験で保証しない。初期案はHMAC-SHA1、6桁、30秒、T0=0、個別乱数secret160-bit以上。対応アプリの実機試験を行い、パラメータはaccountに固定する。[RFC6238](https://www.rfc-editor.org/rfc/rfc6238) / [Authenticator URI](https://github.com/google/google-authenticator/wiki/Key-Uri-Format)。

これは単要素・非phishing耐性の認証であり、IDを追加してもMFAにならない。番号の中継、端末/secretの複製・盗難、サーバー側secret漏えいを防ぎ切れない。Authenticatorの端末ロックだけからサーバーが第二要素を検証したとも扱わない。[NIST OTP要件](https://pages.nist.gov/800-63-4/sp800-63b.html)を設計根拠とし、NIST適合/AAL取得を主張しない。MVPは閉域HTTPS・到達制限必須。高リスクな公開やphishing耐性/MFA必須の組織ではこのprofileを使わず、別認証profileの審査を要する。

ブラウザーにはserver認証HTTPS＋TOTPを提供し、個人client証明書は必須にしない。worker/automation/管理CLIは既存mTLS契約を維持する。listener/origin/routeと認証middlewareを明確に分離し、Web用TLS listenerがworker/admin APIのmTLSを迂回しない。Web loginは狭い例外routeだけ、業務APIは有効session＋RBAC/CSRFを要求。TLS自動無効化やHTTP fallbackはない。Cognito等の外部利用者管理は必須にしないが、当面このprofileのS3/KMSとSDKは明示的な追加依存になる。

<a id="account-store"></a>

## S3正本と交換可能な境界

**当面、Webアカウントの永続正本は非公開S3。** Redisが唯一の正本という範囲はjob実行状態に限定する。Web accountと実行状態を同じ情報の二重正本にしない。保存先は将来再検討可能とし、AccountStoreのreadSnapshot / compareAndSwap(expectedETag, expectedRevision, operationId, next) portにS3 adapterを閉じ込める。domainへAWS型を出さず、認証serviceとruntime Storeを分離する。AccountStoreは複数key transactionやrename/lockを仮定しない。

初期構成は一deploymentの小さいaccount catalog JSONを単一固定keyに保存し、全体revision/更新operation ID/初回管理者状態/全accountを同じCAS対象にする。初回If-None-Match:*（不存在かつ認可済み初期化時のみ）、更新If-Match:ETag、409/412は再読・競合報告、timeoutはoperation ID/revisionを読戻して照合し、無条件PUTしない。ETagは比較用でhashではない。少人数低変更向けの上限案は1000 accounts / catalog 2MiB（暗号文含む）で、超過時は追加拒否し別storeを検討する。S3強整合性もRedisとの分散transactionを提供しない。[条件付き書込](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)。

| 最小catalog/account field | 契約 |
| --- | --- |
| schemaVersion / catalogRevision / lastOperationId / authGeneration | schema、単調revision、更新照合、復旧/全session失効の世代。UTC時刻と別型 |
| bootstrap | neverStarted / pending / completed、operation ID、期限、対象account ID。completedを通常操作で未初期化へ戻さない |
| accountId / status | 不透明ID、pending / active / revoked。削除より失効記録を優先 |
| roles / grants | viewer/operator/adminの機能候補＋project/job/host等のscope。IDを知るだけで権限なし |
| totp | secretVersion、encryptedSecret、暗号形式/key参照、algorithm/digits/period/T0。平文やsecret hashのみを正本にしない |
| pending enrollment | ticketHash/account/secretVersion/用途/期限。平文ticketなし、交換/消費receiptはRedis。Redis喪失時pending ticketも全失効・再発行 |
| revision / revocationVersion | account CAS識別、session照合に使う単調失効版 |
| createdAt / updatedAt / activatedAt / revokedAt / pendingExpiresAt | 該当時のみZ終端UTC。最終login時刻を毎回S3へ書く設計にしない |

TOTP検証には復号できるsecretが必要で、passwordのような一方向hashだけでは成立しない。難読化/base64/非公開URLは保護の代わりにしない。S3 account/public-access blockを有効にし、ACL無効のbucket owner enforced、限定prefix IAM、TLS、SSE-KMSを要求する。一般の定義publisher/worker/runner/ブラウザーにはaccount objectやKMS decryptを許さない。controllerは必要prefixのreadと限定decrypt、更新は認可済みauth管理経路/専用運用roleに限定。EC2等の標準role credential chainを使い、恒久AWS鍵を作成/埋込みしない。[S3公開遮断](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html) / [SSE-KMS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html)。

採用する保護層はSSE-KMSに加え、secret fieldを標準envelope encryption library（AWS Encryption SDK等）で暗号化する方式。KMS key/復号権限はcatalogと別管理し、deployment/accountId/secretVersionを検証する暗号contextで取り違えを拒否する。独自cipher format/nonce設計をしない。暗号文もブラウザーに返さず、復号は限定login/登録経路で一件ずつ行う。plainsecretのRedis保存、一括起動load、長期RAM cache、dump/diagnosticへの出力は禁止。Node GCによる完全消去は保証できない。[Encryption SDK](https://docs.aws.amazon.com/encryption-sdk/latest/developer-guide/introduction.html)。

S3 versioning/backupとKMS keyの復旧・保管期限を合わせ、過去versionも同じ機密として保護する。失効前catalogを単純復元するとsecret/roleが復活するので、Web gateを閉じた運用復旧でauthGeneration更新・session全失効・失効台帳照合/必要な再登録を通す。S3/KMS管理者とcontroller侵害では復号/改ざんリスクが残る。暗号化はcontrollerの正当な復号権限を奪うものではない。

<a id="auth-consistency"></a>

## Redis照合・失効・障害

RedisはWeb session、rate、OTP replay使用済みstep、認証gate/世代、最小account metadata cache（ID/status/roles/grants/revocationVersion/catalogRevision・ciphertext参照）を保持する。復号前の対象account検索はIDに限定し、secret plaintextを常駐させない。metadata/ciphertext cacheはcatalog上限以内で有界、catalog参照の再確認を初期案30秒以内に行うので通常loginごとのS3 GETは必須ではない。KMS復号失敗時はlogin拒否、既存sessionの認可はfreshなmetadata/gateがある範囲だけ継続する。

失効を30秒のpoll遅延へ委ねない。**全account変更は一つの認証更新serviceを通し、Redis Web-auth gateを原子的にclosedにしてからS3 CAS更新する。** mutation ID、expected catalog revision、owner epoch/fencingを記録する。closed中は全controllerでWeb login/登録確認/業務要求を拒否する（小規模・低変更向けの可用性トレードオフ）。検証済み新catalog metadataは上限付きbatchでRedisの新namespaceへstageし、全内容を検証したmarkerを使う。失効version/authGenerationによるsession無効化・監査receipt・cache revision pointer・gate openを一つの有界atomic操作で確定する。全session走査を単一scriptに入れず、旧keyはTTL/有界掃除で削除する。各要求はgate/generation/account版を毎回検証し、変更APIの最終Redis mutationにもその条件を含める。変更完了ACK以後に古いscope/sessionを受けない。すでに認可・確定したjobや外部副作用の取消までは保証せず、別cancel/held手順で扱う。

S3へのIAM直書きを通常手段にせず、break-glassもgateを閉じる同じ運用経路を使う。外部書換え/古いrevision/不一致を検出したらgateを閉じ再照合する。不正なout-of-band変更がpollまで見えない可能性を即時失効保証で隠さない。S3/KMS read失敗でcatalog freshnessが30秒を超えたらWeb gateを閉じる。世代検証不能なcontrollerはcacheだけで継続しない。worker用identity/leaseは別namespaceで、Web gateの変更だけでは停止しない。

S3とRedisを跨ぐ全成功のatomicityは約束しない。S3成功・Redis反映失敗はclosedのまま、operation IDと最新ETagを照合して再開する。S3 ACK不明/競合/中断もclosed維持。更新owner lease timeoutだけでgateを自動openせず、旧writer停止とin-flight S3要求の結果を確定し、最新catalog/operationを照合してから運用reconcileする。遅延旧writerの無条件再送を禁止、S3 CASとexpectedRevisionで新しい版を上書きさせない。監査intent/結果はoperation IDで関連付け、S3成功後監査保存失敗も完了ACKにしない。

Redis停止/restore/使用済みstepやrate/sessionの状態損失時はWeb fail-closed。StoreはRedis接続/再接続時に承認済みserver instance（run_id等）とgate世代を検証し、接続喪失・instance変更・状態marker欠落をWeb recovery条件にする。再接続直後に復元snapshotのopen gateをそのまま信用しない。通常のcontroller単独再起動では共有instance/世代/markerとS3正本を確認し、他の有効sessionを無条件破棄しない。Redis管理操作で同一instance内に状態を巻戻す場合も事前gate閉鎖を必須とし、侵害管理者の検出不能な改変を完全検出できるとは主張しない。単に空のRedisを初期化してログインを再開しない。S3正本照合、authGenerationのS3 CAS更新、全session破棄、rate制限再初期化とOTP replay隔離を運用recoveryとして実施する。隔離案は信用できる復旧UTC時刻のstep+1をrecoveryFloorとし、そのstep以下は受理せず、少なくとも現在±1step窓が全てfloorを超えるまで待つ。時計逆行/同期不明なら再開しない。監査欠落範囲を示し、S3も巻戻った場合は影響accountのsecret再登録を要求する。generation変更だけで同じTOTP値の再利用を防げるとはしない。

<a id="registration-flows"></a>

## 初回管理者・追加・再登録

1. **初回開始**: 管理者が既存OS/AWS運用権限とmTLS管理経路で提案CLI `belt auth bootstrap --config /etc/belt/auth-admin.json` を明示実行する。AWS credential/秘密をargvに渡さない。public Webにbootstrap/first-admin作成routeは置かない。bootstrap完了の運用markerを保護された配備記録にも残し、catalog key不存在を空の初回と自動解釈しない。不存在と権限拒否/取得失敗を区別し、運用者が新品deploymentと確認した一回限り初期化だけを許す。固定deploymentのcatalog bootstrapがneverStartedのときだけ、Redis gate＋S3 CASでpending adminを一件作る。複数controller/CLIの競合は一つだけ成功。同じoperation IDは結果照会、別IDの再実行は競合としadminを増やさない。
2. **安全な登録**: pending期限は初期案10分、ランダム256-bit一回限りenrollment ticketはhashだけ記録しaccount/secretVersion/期限/用途へ束縛する。QR/otpauth URIはsecret本体と同等。本人が操作する保護端末・ログ非保存のローカル表示、または本人確認した安全な対面/暗号化経路で一回限り登録ticketを渡す。QRを第三者サービスで生成せず、URL query・email・Slack・共有ログ・CI artifactへ載せない。初回の本人確認は運用管理者が担う。登録画面はticketをPOST bodyで交換し、短命pending session/CSRFでQRをno-store表示する。ticketのログ/Referer漏えいと再使用を拒否する。
3. **確定**: 対応Authenticatorでscanし確認コードを入力。pending sessionと最新catalog版を確認し、Redis原子replay消費＋gate closed→S3 CASでpending→activeとbootstrap completedを同一objectに確定→Redis metadata反映/監査→gate open。S3未確定ならactive sessionを発行しない。確認に使ったstepはloginにも再使用不可、次stepを待つ。ACK不明は同operation IDのstatus照会で確認し、重複作成/OTP再受理をしない。
4. **中断**: 期限切れpendingではlogin不可。管理経路で古いticket/secretを失効し、CASでpendingの新revision/secretを作り直せるが、completedは戻さない。途中S3/Redis/QR表示失敗は状態を照合し、秘密の再表示を通常の回復手段にしない。コード検証後のS3失敗はclosed/reconcileのまま、次stepや管理再登録で再開する。
5. **通常追加**: principals.manageのadminが直近TOTP再認証・対象scope/理由/expectedRevisionでpending accountを作成し、安全にticketを本人へ渡す。viewerが既定、権限拡張は明示承認。初回完了後も匿名self-signupはない。初回専用CLIはcompletedで拒否する。
6. **権限変更・失効・logout**: role/grant変更や失効は上記gate/CAS/revocationVersion増加＋全該当session破棄。logoutはRedis sessionを即失効しcookie削除、S3更新不要。最後のactive adminを通常操作で失効/降格できないようcatalog CASで検証する。並行admin降格でも少なくとも一件を保持する。
7. **紛失・再登録**: 残存adminの本人確認付き承認、または全admin紛失時のOS/AWS運用権限による明示CLI recoveryだけを使う。旧secret/全sessionをまず失効し、新secret/ticketをpendingへ、確認後active。最後のadminのrecoveryもbootstrap completedを保持し、audit intent/理由/運用主体を残す。無認証fallbackや「S3空なら誰でもadmin」はない。MVPで利用者向けrecovery codeは発行せず、将来導入するなら一回限りhash保存と別承認を設計する。ID紛失も運用確認へ戻し、secret総照合はしない。

管理CLIは既存の限定運用権限から使い、一般job runnerに実行権/鍵を与えない。全管理者を失った際の復旧権限自体が強いtrust boundaryなので、作業者確認・変更承認・監査とbackupを運用に含める。

<a id="login-session"></a>

## login・replay・Web防御

loginはPOST /v1/sessionへIDと6桁文字列（先頭0保持）を送る。正確なOrigin/JSON/content-type/専用header、短命pre-auth session＋CSRF nonceを必須にしてlogin CSRFも防ぐ。既存の運用sessionへ別IDを上書きしない。未知/失効/未確認/誤コードは同じ一般エラーとし、account存在やschema/secret詳細を漏らさない。ID記憶は非機密IDだけ、session/QR/secret/OTPをlocalStorageへ保存しない。

controllerは対象一件を復号し、信用できる共有UTC基準（StoreのRedis TIME、同期/clock-step監視付き）で現在±1stepを候補にして照合する。受理stepとsecretVersion/account/generationを特定し、**同じstepのOTPを複数controllerで一回だけ**受ける。Redisの有界scriptでgate/revision/status/失効/制限を再確認し、secretVersion別lastAcceptedStepより新しいstepであることを確認し、使用済み化・session発行・監査receiptをまとめる。同じ6桁が複数候補stepに衝突する場合も使用済みstepを候補から外して別stepとして受け直さず、曖昧な一致は拒否する。未受理でも過去stepへ巻戻さず、code/secretの平文をreplay keyにしない。再認証/登録確認も同じreplay契約を共有し、同じstepで連続login/危険操作する場合は次のコードを待つ。これはjob exactly-onceとは別の限定保証。lastAcceptedStepは有効secretごと一件の有界metadataとして保持し、認証cacheのTTLと一緒に消さない。secret失効後の受理窓終了とsession無効化確認後に有界削除する。状態消失は前節のrecovery対象。

rate案はID bucket容量5/refill1毎60秒、IP容量30/refill1毎10秒、deployment容量100/refill100毎60秒を連続補充（成功も計数）。未知ID/IPキーは形式/件数/TTLを制限し、全体キーが先に制限、キー総数cap10000/expiry10分を超える新規keyは拒否する。固定カウンタの短時間二倍burstを避ける有界token bucket等の契約を検証する。上限到達は最大5分のcooldownで、永続account lockはしない。共有NAT/意図的lockoutの可用性リスクを残し、trusted proxyだけがsource IPを設定できる。OTP検証前に制限しKMS費用/復号DoSを抑え、並列検証数もcontrollerあたり4（許容1..16）を上限とする。rate値は実測/運用受入で確定し、総当たり対策を無効にする設定は拒否する。

成功時opaque乱数sessionをrotationし、Redisにはhash/account/revocationVersion/authGeneration/created/lastSeen/expiryとCSRFを保持する。session上限案はaccountあたり10件/全体10000件・metadata合計16MiBで、超過は新規発行拒否、期限keyTTL＋有界掃除を行う。idle15分・absolute8時間、__Host-/Secure/HttpOnly/SameSite=Strict/Path=/、Domain無し、no-store。全APIで毎要求gate/account版/grantを検証する。dangerous actionは直近5分以内のTOTP再認証を提案し、再認証は同一要素の再確認であってMFAではない。閲覧/実行/取消/管理をviewer/operator/admin＋個別scopeで分け、登録・復旧がscopeを自動拡張しない。セッション発行ACK不明ではOTP再利用から別sessionを作らず、残存sessionは上限付きexpiryへ、利用者は次stepで再loginする。

既存のCSP/XSS escape/CSRF/CORS deny/HTML出力escape/サイズ制限/SSRF/安全なcookie方針を維持する。Web originは一つとし、multi-controllerでも同じRedis session/replay/rate/gateを使う。LB/別originへのcookie拡散やsticky RAMへ依存しない。OTPはHTTPSがあってもphishing relayされ得る。

<a id="auth-operations-tests"></a>

## 監査・設定・受入条件

監査は不透明account/運用主体、operation/correlation ID、UTC、結果code、機密除去したrole/status/revision変更を記録する。失敗認証はrate制限し、攻撃で監査容量を枯渇させない。secret/復号鍵/OTP/QR/otpauth URI/ticket/session/recovery値はrequest body、error stack、S3 metadata、トレース、stdout/journald、スクリーンショット自動保存へ出さない。QR応答はno-store/Referrer-Policy:no-referrer、第三者script無し。任意文字列をログ化せず固定template/allowlistを使い、redactionだけに依存しない。監査90日やsystem error7日とresource48時間を混同しない。

設定は [設定契約](11-configuration.md#web-auth-policy) のJSONに集約し、新しい秘密envを増やさない。S3/KMS/信頼role/limitsが未整備ならWeb listener/loginを拒否するが、独立worker経路を匿名化しない。準備用CLIだけからbootstrapでき、pending中はticketを持つ登録確認routeだけ利用でき、通常Webログイン可能になるのはactive管理者が確定した後。D7でlibrary版、envelope/key policy、対応Authenticator、数値制限、時刻同期閾値、復旧実測、権限/IAM分離を確定する。

| 受入ケース | 確認する条件 |
| --- | --- |
| 登録/bootstrap | public first-admin不可、二台同時CLIで一件、再実行/期限切れ/QR漏えい抑止、確認前login不可、最後admin同時降格拒否 |
| 正確性 | RFC test vector、先頭0、時刻境界/±1step/clock逆行、同一OTP別controller/登録確認/login/再認証で二重受理不可 |
| 失効/更新 | cache旧版/並列login/権限変更/再登録、S3 CAS競合・ACK消失、S3成功Redis失敗・owner crash・遅延旧writer。closed中拒否・reconcile後のみ再開 |
| 復旧 | Redis replay/rate喪失、S3過去version、KMS拒否/失効/backup喪失、quarantineとgeneration/secret再登録。復旧で旧sessionが復活しない |
| Web/RBAC/DoS | login CSRF/悪意Origin/nonce再送/ID列挙/総照合禁止、secret/QRのログ漏えい、account/IP/global上限、非admin追加拒否/危険scope確認、cookie/rotation/logout |
| 運用境界 | worker/runner/一般定義publisherにS3 account/KMS権限なし、bucket非公開/暗号検証、依存SBOM/licenseと脆弱性更新、実Authenticator互換試験 |

この文書は認証実装・IAM適用・account/secret生成の完了を意味しない。S3更新時にWebを短時間停止する選択と、KMS/共有Redis障害で認証を継続しない選択を受入条件とする。
