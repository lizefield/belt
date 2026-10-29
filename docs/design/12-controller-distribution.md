# 複数controller・分散アクセス

ナビゲーション: [概要](../../README.md) ｜ [索引](../README.md) ｜ [要件・概念](01-requirements.md) ｜ [導入・SDK](02-project-integration.md) ｜ [構成・UTC](03-architecture.md) ｜ [永続化・反映](04-storage.md) ｜ [実行](05-execution.md) ｜ [ログ・監視](06-observability.md) ｜ [開発・運用](07-operations.md) ｜ [API](08-api.md) ｜ [セキュリティ](09-security.md) ｜ [Web認証](10-web-authentication.md) ｜ [設定](11-configuration.md) ｜ **controller分散（現在）** ｜ [release](13-release.md) ｜ [検証・計画](14-validation-plan.md) ｜ [一次資料](15-references.md)

状態: **設計文書・未実装**。確定要件/採用契約と数値提案/未決を区別する。読む順序と正本は [設計索引](../README.md) を参照。

状態: **設計契約・未実装** / 調査日2026-10-27。複数controllerが存在する場合にworkerが分散接続できることを要件とする。初期MVPのsingle配備は維持し、multi profileの提供段階/実装/受入は別に判定する。agentはMVP外で、将来同じclient契約を適用する。Redis複製・別backend・外部LB・無停止HAを必須化しない。

## single と multi の責務

singleはcontroller一つのowner guard、multiは複数controllerのactive-active API。全controllerは同じauthoritative Redis/deployment namespace・schema・protocol・auth/trust policy・有効definition revisionを使う。workerはそのいずれからでもclaim/started/renew/finish/log/telemetry/system errorを送れる。controller固有RAMにはconnection/一時cacheだけを置き、session/lease/枠/operation receipt/active revisionは共有Redisが正本。worker grant/失効はRedis、人間account/grant/失効の永続正本はS3で、Redisは検証済み版とgateを共有する。sticky sessionを要求しない。

enqueue定義のapply/activateは [共通API/JobRef契約](02-project-integration.md#typed-enqueue) に従い、どのcontrollerでも同じoperation ID/CASで共有登録する。現在activeに対応するapplied/readyを持たないcontrollerは新規enqueue/dispatchを503、既存control操作はcontrolReadyで扱う。次のdesiredが準備中でも、現在activeに対応済みならその版で受付を続けられる。ジョブごとのroute生成や全controllerへの手動登録は不要。

初期選択は同一versionを配備し、非対応schema/protocol/未反映releaseや必要な共有logを読めないcontrollerはreadyにしない。共有JSON配布/loaded/appliedの契約を継承する。controller.mode=singleが既定、multiは配備担当者が明示し受入済みbinaryだけが有効化する。単一起動guardを消すだけでmulti対応とはしない。

state engine/Store、UTC schedule計算、HTTP adapter、clientのendpoint selector、LogStoreを小さな境界で組み合わせる。独自の常駐manager/consensus service/Redis clientは追加しない。

## 外部 LB がない標準 client

controller.endpointsは管理者が固定するHTTPS originの1〜8件。clientは一覧をshuffleしたround-robinで新規要求/long pollの接続先を選び、workerのoutstanding claim pollは全endpoint合計一つに保つ。claim prefetchを増やす負荷分散ではない。per-endpoint socket/要求数と全体concurrencyをboundedにし、HTTP keep-alive/長接続があっても重要状態を接続へ閉じ込めない。

初期案はconnect timeout2秒、再接続base500ms/cap10秒+jitter。timeout/connect失敗/503/drainingを検出したendpointは一時冷却し、他の検証済みendpointへ切替える。healthは認証後の最小controller status/実要求結果で判断し、dispatchReadyとcontrolReadyを区別する。新規claimはdispatchReadyだけ、既存renew/finish/照会/log再送はdraining/dispatch未準備でもcontrolReadyなcontrollerへ送れる。ready失敗の詳細secretを公開しない。冷却後のprobeも有限rateとし、全滅時はbounded backoff/ローカル状態表示、leaseを延長できなければ既存の停止/held契約に従う。renew/started/finishの総deadlineはlease安全余裕内とし、長いclaim pollと別接続・予約枠を使う。

401/403、schema/入力違反は恒久エラーとしてfan-out再試行しない。証明書検証失敗を無視せず該当endpointを隔離・運用通知する。各endpointのDNS/IP SAN/CA/期限/用途と同一deployment identityを検査し、redirectや返却payloadから任意endpointを追加しない。接続先追加/rotationは管理者configと承認配備で行う。

```json
{
  "controller": {
    "endpoints": [
      "https://belt-c1.internal.example:8443",
      "https://belt-c2.internal.example:8443"
    ],
    "tls": {
      "caFile": "/etc/belt/pki/ca.pem",
      "certificateFile": "/run/credentials/belt-worker/client.pem",
      "privateKeyFile": "/run/credentials/belt-worker/client.key"
    }
  }
}
```

提案の設定断片で秘密値は含まない。workerにRedis credentialを配らず、job runnerに上記control credentialを継承しない。一件だけのendpointsも同じAPIで扱う。

## session・世代・時刻・operation の共有

共有deployment generationはrestore/状態損失で更新する全体世代。controllerは別の登録controller IDと起動epochを持ち、追加/再起動だけでdeployment generationや全worker sessionを無効化しない。singleのowner条件とmultiのmembership/起動epoch条件はprofileで分けてStoreが検査する。各controller ID/credentialを事前承認し、起動epochの登録/更新も原子的に行う。同じIDの二重起動・旧epochの報告を拒否し、controller数だけIDを自動生成して無制限登録しない。

workerのexecutor session/epoch、identity mapping、grant/失効、opaque Web sessionはRedisへ保存し、どのcontrollerでも検証する。endpoint変更/TCP再接続は有効sessionのresumeで、明示的な再登録/置換だけを原子的epoch更新にする。mTLS identity/credential/session/attempt/tokenのbindingを再検査し、別接続であることを別workerと扱わない。TLS session resumptionに認可を依存させない。別controllerではfull handshakeになってよく、TLS ticket鍵の共有を必須にしない。JWT/署名鍵同期は必須にしない。

Web TOTPは[S3 account/共有Redis gate・replay](10-web-authentication.md#auth-consistency)を使い、controller RAMの旧版で失効を回避しない。同step OTPの二重受理防止は共有原子操作、S3変更はcatalog CAS＋closed gateで調停。Redis restoreで使用済み記録が失われたらWebを停止してgeneration/隔離を復旧する。Webのclient証明書は必須にせず、worker/CLI mTLS listenerとは認証境界を分ける。

Webは選択originと__Host-/Secure/HttpOnly/SameSite/CSRFを維持する。複数hostname間へcookieを広げるものではない。Web入口は固定origin（任意LB含む）を使うか、別originへ移る際に再認証する。worker/CLIのendpoint failoverとbrowserのcross-origin cookieを混同しない。

lease expiry/claim eligibility/schedule due/retry期限など共有制御のnowUtcは、Store adapterがRedis TIMEから採るUTC epoch msを基準とする。返るseconds/microsecondsの単位を明示変換してsafe integerを検証し、時刻取得/ACL失敗時にcontroller時刻へ自動fallbackしない。原子的更新内でもRedis時刻と状態条件を照合し、controller時計のずれで期限を早めない。applicationは共有時刻snapshotを受けUTC候補を計算し、commit時にcursor/revision/現在dueを再検証する。TLS/OSの期限検査には各hostの正しい時計も必要。Redisの時計急変/巻戻りを検知したら共有dispatch保留を条件付き設定して照合し、自動的にslotを回収しない。プロセス内待ちは単調時計、Redis時計も無停止/強整合時刻サービスとは扱わない。[Redis TIME](https://redis.io/docs/latest/commands/time/)。

変更操作はdeployment/principal/operation種別にscopeしたoperation IDと検証済みpayload hashを使う。同じID/同じ入力は同じreceipt、異内容は409。payload hashは安定した検証済み入力から作り、受信controller ID/受信時刻/接続情報/通信試行trace IDを含めない。request IDは通信試行ごとでもoperation IDはendpoint切替で変えない。enqueue/claim/started/finish/definition apply等はreceiptを状態更新と同じ原子的操作に保存する。lease/epoch/revisionが変わった場合は状態を再検証し、receiptの存在だけで古いworkerへ権限を与えない。

応答喪失は未実行と断定しない。他controllerから同じoperation IDを照会/再送し確定run/attempt/receiptを確認する。controller障害を理由に新しいbusiness run/effectKeyで副作用jobを盲目的にretryしない。Redis不通/receipt損失/restoreはunknown/heldとして照合する。operation冪等性と外部副作用exactly-onceは別問題である。

## 複数 scheduler と dispatch/recovery

暫定選択はglobal leaderを置かず、各controllerが同じdue候補をboundedに読んでも、schedule revision/expected cursor/enabled/quota/overlap/共有時刻を一つの固定scriptでCAS検査する方式。occurrence key、run/queue、次due/cursor、監査/receiptを同時確定し、競合した側は進めず保存値を再読する。UTC scheduleの計算はpure module、controller間のRAM lock/独自時計を排他の根拠にしない。

claimは共有ready state/host・queue・executor枠を原子的に予約し、一attemptのleaseと単調fencing tokenを保存する。started/renew/finishはdeployment generation/executor epoch/attempt/token/revision/期限で条件更新する。回収/retry/DAG解放/cleanupもexpected state条件で二重処理を避け、長い処理は有界batch。APIが複数でもslotを二重開放しない。

将来global排他taskにleader方式が必要なら、共有leaseのowner/期限/単調fencingを使い、全書込で現owner/tokenを検証する。expired leaderが生存していても書けない契約と試験なしに追加しない。外部command/APIは独自fenceを受け付けない場合があり、停止未確認はheld。このため単純なlock TTLやAPI分散でexactly-onceを保証しない。schema migration/restoreは全controller/executorをdrain・保留した専用maintenanceで行い、通常API/schedulerへ並行させない。

<a id="distributed-logs"></a>

## log・telemetry・system error の重複と配置

job stdout/stderr本文はRedisへ大容量格納せず、LogStoreのimmutable chunkで保持する。singleはlocal FS、multiの初期案は全controllerで読み書きできる検証済み共有FS（NFS/EFS等）。各controllerのlocal diskだけへACKして他controllerから読めない配置はmulti起動gateで拒否する。JSON定義の共有sourceとlog本文の保存先は別責務。S3 log adapterやcontroller間proxyを必須追加しない。

chunk identity=(attemptId,stream,sequence)とhashを固定し、private temp→fsync→排他的immutable publish→親同期をLogStore契約とする。複数controllerから同時publishしても同ID/同hashは同じchunk、異hashは拒否。共有FSのroot/owner/mount/アクセス権を全controllerで照合し、job UIDに書換権限を与えない。共有FSのno-replace公開/耐久性を実測し、read→通常renameだけで排他できるとは仮定しない。payload durable後にRedis metadata/receiptを原子的登録し、間のcrashはhash/IDで再走査する。正しいscope/attempt leaseを検査してACKし、ファイル/Redisを跨ぐtransactionとはしない。log不完全/gapはjob状態と別表示し、renew/finishを大容量転送で塞がない。

telemetryはsource instance/epoch/sequence/resourceTargetで条件更新し、受理済みsampleのreceivedAt/bucketを共有receiptで固定する。同報告を別controllerへ再送してもlatestや1分bucketを二重加算しない。system errorsはeventId/内容hashのreceiptとgroup countを共有Redisで原子的更新する。receiptの最低再送期間と容量cap、drop/gap/unknown、resource48時間とerror暫定7日の別policyを継承する。受信controllerが変わっただけで新しいsource errorにしない。

## HTTPS/VPC と任意 LB

worker/CLIはprivate network + SG + 全endpoint mTLS、Webは固定origin HTTPS＋TOTP/session。外部LB不要でclient分散できる。LBを採用するならfrontend/backendの到達制御とhealth/readiness、keep-alive/long-poll/idle timeout、接続drainを合わせる。20秒poll/heartbeat/leaseの総deadlineより短いproxy timeoutで無用な再送stormを作らず、停止controllerは新規claimを503/drainingにして他へ誘導し、既存renew/finishを猶予中受ける。sticky cookieを正しさの条件にしない。

internal ALB+ACMは任意profileで、frontend TLSを終端する。HTTPS targetでもALBはtarget証明書を検証しない。ALB mTLS verify/trust store/失効とforwarded identityの専用adapter、backend SGによる迂回防止、偽装/重複header検証が必要。直接mTLSと同じidentity検証とは扱わない。end-to-end mTLSを保つなら直接接続、または承認したTCP passthrough等を別途選ぶ。設定を本作業で構築したとはしない。[AWSの通信例](07-operations.md#aws-vpc-transport) を参照。

## drain・配備・障害の限界

各controllerはreadinessを下げ新規受付/claim/scheduleを停止し、既存renew/finish/operation照会を猶予内で処理する。workerは同じsession/operation IDで他のready controllerへ切替える。LB healthもdispatch停止中に既存control操作をすべて失わないよう分離し、backend deregistration/接続drainとworkerの切替期限を試験する。controller再起動は新しいinstance epochで共有state/cacheを検証し、jobを再起動しない。相互対応version以外のrolling updateは受入れず、初期はdrain付き同一version配備。controller全停止は処理遅延とlease喪失/heldを生み得る。

controllerを増やしても共有Redis障害には耐えられない。Redis/耐久性/認可が使えなければ受付・claim・renew・変更を拒否し、workerはlease契約で停止/照合する。local RAM/JSONへ正本を切替えず、Redis複製/Sentinel/Cluster/自動failoverをこの要件へ追加しない。restore/状態損失では全controllerのdispatchを止め、deployment generation/credential/sessionを更新し、active/外部副作用とlogを照合後に再開する。エラー0/無停止/完全配送/exactly-onceを約束しない。

## 確定要件・提案・受入条件

確定するのは「複数controllerがある場合の分散接続」「共有authoritative Redis」「HTTPS/mTLS/認可の維持」「agentはMVP外」。client selector、leaderなしcursor CAS、共有FS LogStore、数値/出荷段階は初期提案で、対象Node/Redis/FSの受入を要する。追加外部serviceなしを優先しつつ、共有logの配備条件を隠さない。

故障試験はLBなし/stickyなしで全worker操作をcontroller間で切替え、claim/started/finish ACK消失/重複/遅延、同時scheduler/回収/定義activate、古いcontroller epoch/worker session、時計step/Redis停止/restore、共有FS停止/二重chunk、telemetry/system error再送、slow/draining endpoint・同時再接続storm・証明書失効・origin/header偽装を含む。一つの有効attempt/slot/occurrence/receipt、固定job revision、停止未確認held、正しい欠測表示を確認する。API分散だけでこれらが合格したとは扱わない。
