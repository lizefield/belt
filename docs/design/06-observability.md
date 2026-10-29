# 履歴・ログ・監査・リソース監視

ナビゲーション: [概要](../../README.md) ｜ [索引](../README.md) ｜ [要件・概念](01-requirements.md) ｜ [導入・SDK](02-project-integration.md) ｜ [構成・UTC](03-architecture.md) ｜ [永続化・反映](04-storage.md) ｜ [実行](05-execution.md) ｜ **ログ・監視（現在）** ｜ [開発・運用](07-operations.md) ｜ [API](08-api.md) ｜ [セキュリティ](09-security.md) ｜ [Web認証](10-web-authentication.md) ｜ [設定](11-configuration.md) ｜ [controller分散](12-controller-distribution.md) ｜ [release](13-release.md) ｜ [検証・計画](14-validation-plan.md) ｜ [一次資料](15-references.md)

状態: **設計文書・未実装**。確定要件/採用契約と数値提案/未決を区別する。読む順序と正本は [設計索引](../README.md) を参照。

## 履歴・ジョブログ・監査


run は definition version、入力のマスク済み要約、target、queue、retry、effectKey、request principal、各時刻、最終理由を持つ。attempt は実ホスト、executor build/handler version、token、exit/signal、timeout/cancel の停止確認を持つ。「失敗」と「結果不明」を UI/CLI で区別する。

ログchunkは(attemptId,stream,sequence)で重複排除し、LogStoreのdurable immutable publishとRedis metadataの耐久性確認後にACKする。singleはlocal file、multiは全controllerで読める検証済み共有filesystem実装を要し、ローカルfileへ暗黙fallbackしない。[分散log契約](12-controller-distribution.md#distributed-logs) を参照。ファイル append と Redis metadata の原子性は保証できないため、ID/checksum と framing を持つ chunk ファイルを使い、再起動時に未索引 chunk の再走査・末尾破損の切捨てを行う。ログの再構築は業務 queue の独自 DB 実装とは分ける。ログ loss/gap を隠さず、job 成功とログの完全性を別状態で返す。

監査は actor、操作、対象、before/after の機密除去済み差分、理由、request ID、受付元、結果を同じ Redis 原子的操作に記録する。定義変更、schedule 有効化、起動/cancel/retry、held 解消、worker 登録/失効、認可変更、保持設定、手動 slot 解放を対象とする。認証失敗は payload なしの rate limited security log に残す。Redis 内の監査に管理者改ざん耐性はない。法的保存・改ざん検知が必要なら外部の保護された保存先を後続要件にする。

controller/executor自体の運用診断は、以下の既存提案をresourceの3指標履歴と区別する。resourceへの追加収集・履歴系列化を意味しない。構造化JSONをstdoutへ出しjournaldで扱う。queue depth、最古待機時間、受付拒否、retry/held、offline worker、lease renewal latency、Redis command/script/AOF fsync latency、event loop lag、used_memory/maxmemory、evicted_keys、rejected writes、disk/spool/AOF/Redis スナップショット size を取得する。Prometheus/OpenTelemetry を必須にせず、JSON stats API と journald で開始する。外部監視 adapter は後付け可能にする。

<a id="resource-telemetry"></a>

## リソース収集・Redis 集約・Web 表示

MVPの正式な収集・保存・Web指標は **CPU使用率、メモリ使用率、ストレージ空き容量の3項目だけ**とする。controller/worker自身に組込む共通collectorがroot不要のread-only収集を行う。独立agentや外部監視サービスは必須にせず、controller/workerがないサーバーはMVP監視対象外。全host探索や任意remote path読取は行わない。以下は未実装の設計契約であり実機検証済み保証ではない。

#### scope・分母・計算の境界

CPU/メモリはhost-visibleまたはその実行環境のcontainer/cgroup scopeを明示し、一つのresource targetでは承認した同じscopeを使う。containerから物理host全体を観測できると仮定しない。分母/単位/source、観測区間、sample epoch、取得状態は表示解釈に必要な最小メタデータとして添える。permission_denied/not_exposed/unsupported/warming_up/reset等はunavailableとし、0%/空き0bytesと区別する。Node標準APIと読取可能な/proc/cgroup/statfsを使い、hiddenな情報のためroot昇格・mount公開・cgroup書込を要求しない。

| MVP指標 | 単位・計算 | 内部一時値と取得制限 |
| --- | --- | --- |
| CPU使用率 | %。host-visibleは/proc/stat累積差分のbusy/total、idle+iowaitは非busy、guest二重計上を避ける。containerはdeltaCpuTime/deltaMonotonicTime/effectiveCores×100 | cgroup v2 cpu.stat/cpu.max/cpuset、v1 cpuacct.usageとquota/period、可視の祖先quota/affinity等を検証。os.cpus() fallbackはsource差を明示。累積counter/used coresは計算用だけで別指標として送信/保存しない |
| メモリ使用率 | %。host-visibleは(MemTotal-MemAvailable)/MemTotal×100。containerは同じ採取scopeのmemory currentと検証済みeffective limitで割合化 | /proc/meminfo、cgroup v2 memory.current/max、v1の対応値をread-only取得。freeとavailableを混同しない。v1精度/親limit不可視/unlimitedで分母を確定できなければunavailable。current/limitは算式に必要な一時値/分母メタデータで、独立した使用量系列は保存しない |
| ストレージ空き容量 | bytes（非特権の実行UIDが利用できるavailable量）。fs.statfsのbsize×bavail | 管理者が登録したstate/log/spool等の保存先filesystemのみ、最大4個。同じfilesystemを重複加算しない。collectorとrunnerのUID/quotaで利用可能量が異なればそのscope/測定UIDroleを明示し、runner値を測れないときに代用しない。総容量/使用率/inode/IOは指標化せず、S3はstatfsしない |

CPU割合の分母effectiveCoresは可視のcpuset/affinity/online CPUと各祖先quota/periodを検証して求める。os.availableParallelism()は推定値で、fractional quotaや隠れた親limitの厳密な分母ではない。分母不明では割合もunavailableにし、raw used coresを代替公開しない。初回sample、再起動/epoch変更、counter巻戻り、hotplug/quota変更、suspendでは差分基準をresetし、架空の0%を作らない。短区間のquota burst等で100%超となる場合は無言でclampせずsource/区間を示す。

/proc/self/cgroupと許可mount情報から自分の可視範囲を解決する。hidepid/ProtectProc/mount・cgroup namespaceで読めなければunavailable。process RSS/heap、load average、network、disk IO、総storage容量等をMVPの収集・履歴・UI項目にしない。自己processだけのCPU割合をhost/container CPUと偽らない。runner/子jobの個別指標もこのMVPの対象外。

#### identity・送信・Redis の保持

server IDは管理者登録の不透明IDとし、hostname/IP/machine-idを自動公開しない。controller/worker instance IDと起動epoch/sequenceは送信元の識別・重複排除メタデータであり、process resource系列を作る意味ではない。同じhost/cgroup scopeは登録した代表collector一つから採用し、同一server上の複数worker分を加算しない。異なるcontainerは登録resourceTarget IDで区別し、生のcgroup/mount pathは送らない。各controller/workerがcollector機能を持ち、非代表は重複host sampleを蓄積しない。

workerはmTLS/HTTPS controller APIへ上限付き構造化sampleを報告し、controllerが登録identity/server/resourceTarget/scopeを検証してRedisに格納する。Redis credentialはworkerに渡さない。controller自身は同じcollector/validator/application格納use caseを内部呼出しし、self HTTPや認証迂回endpointを作らない。旧epoch/sequence・別serverへの報告は拒否する。侵害済みhostは値を偽装できるので、受信した割合を認可/強制上限緩和の根拠にしない。

初期案は10秒間隔+jitter、sample最大4KiB、固定3項目と空き容量の登録filesystem最大4個、送信元ごと1要求/10秒（burst2）。任意metric名/label/path、env/argv/機密hostname/IPを受け付けない。割合は非負の有限number、空きbytesは非負値で安全整数を超える場合は検証済みdecimal string。割合の分母とbytesの実行UIDrole等のmetadataをschemaで限定する。計算用の累積値/currentはprocess内だけで保持し、telemetry payloadやhistoryへ別指標として追加しない。

収集read量/時間/並列数を制限し、1周期未完了なら重ねない。network mount等のhung statfsを必ずabortできるとは仮定せず、滞留probeを停止/隔離してheartbeatを巻込まない。telemetryは低優先度とし、飽和時はbounded drop/backoffとgap表示を許容、無制限spool/履歴や古いsampleの大量再送をしない。renew/finish/監査を優先する。

latestは受信時刻から30秒超でstale、keyTTL120秒。実行leaseのheartbeatとは別で、telemetryだけでleaseをrenewしない。**履歴はMVPで最長48時間、全窓を表示できるよう既定も48時間（2880分）とする。** 設定は整数0〜2880分（0は履歴無効）で起動検証。10秒sample全部を保存せず、server受信時刻の1分bucketごとに最後の有効な3項目と観測件数/coverage・最小metadataを含めbucket全体も最大4KiBとして保存し、resourceTargetあたり最大2880点とする。未観測分/停止/再起動/基準resetを0%で埋めずgapにする。

履歴はtimestamp付きSorted Set/indexとpayload等を用い、書込時と定期cleanupで **now-設定保持時間より古いentryの時刻範囲削除**と **最大点数を超える古い順削除**を行う。LIMIT付き取得と固定batchのindex/payload削除でLua/要求をboundedにし、削除backlog中もAPIは期限外を返さない。履歴keyにも最終書込から保持時間以内のTTLを付け、無通信targetを後片付けする。active keyのTTL更新だけでは内部の古いentryは消えないため、entry削除・件数cap・keyTTLを別々に試験する。Redis停止/cleanup遅延中の物理削除時刻までは保証せず、論理windowと容量capを守る。latestがTTLで消えても過去履歴は残り得るが、onlineの証明にはしない。

履歴memoryは `登録resourceTarget数 × min(historyMinutes,2880) × bucket payload上限` とindex/object/allocator overheadに比例する。最大4KiB/bucketなら2880点でpayloadだけでも約11.25MiB/targetとなる。controller/worker process数が増えた際の登録/heartbeat metadataも含め、D1でresourceTarget/instanceの登録数cap、総点数cap、telemetry.historyByteBudgetを明示設定し実Redisでoverheadを測る。履歴有効時のbudget未設定は起動拒否、超過時は新target/履歴受付を抑制しgapを表示する。noevictionの業務状態/finish予約分を侵食しない。48時間は最大窓で連続保存保証ではない。ジョブログ/監査/終端runの保持契約は変更しない。

#### Web と制御の責務

WebはCPU使用率/メモリ使用率/ストレージ空き容量だけを認証API経由で表示する。host/container scope・分母・単位/source・最終受信時刻・stale/unavailable/gapは必要最小限の補足。resources.readとserver/project/host scopeを毎要求検査し、共有hostの他project活動を推測できる情報をproject権限だけで自動公開しない。保存先は不透明ID/承認表示名だけで、生pathや機密labelは出さない。

表示/queryは最大48時間（設定保持が短ければその窓）・targetあたり最大2880点・target数/pagination・5秒以上pollで制限する。停止/再起動/欠測を0使用率や線形補間で隠さない。監視と負荷による自動admission/動的concurrencyは別段階とし、MVPの原子的な固定slot/認可とOS cgroup強制上限を維持する。

<a id="system-error-events"></a>

## 運用・システムエラーの Redis 集約と Web 表示

MVPでcontroller/worker/scheduler/definition load/通信/Redis・file storage等の運用エラーを構造化し、Redisへ有界集約してWebで確認できるようにする。独立agent/外部log serviceは不要。job失敗のrun/attempt記録、操作のaudit、3項目のresource telemetryとは別のsystem error eventであり、必要なIDで相互参照する。debug/info全文やjob stdout/stderrをこの経路へ複製しない。system error記録はbest effortで、audit必須の変更を許可する根拠やjob成功の条件にはしない。

| 最小field | 契約 |
| --- | --- |
| schemaVersion/eventId | 固定schema版、送信元で一度発行するランダムID。同一報告再送は同じID/内容 |
| occurredAt/receivedAt | 発生元のUTC Z日時とcontroller受信UTC Z日時を分ける。時計不確実/遅延はflagで示し、順序/保持はreceivedAt基準 |
| component/instance/epoch | controller/worker/scheduler/definition/transport/storageの固定分類、登録instance/起動epoch。workerがcontrollerを詐称しないようidentityから検査/補完 |
| category/code/severity | 固定分類・安定error code、warn/error等の有限enum。任意metric/labelを増やさない |
| projectId/correlation | projectは任意。request/operation/release/run/attempt ID等を必要時だけscope検査して関連付け。未関連のsystem errorをjob失敗へ捏造しない |
| message/detail | codeに対応する機密除去済みtemplateとallowlistの小さなdetail。template message最大512文字、event全体最大2KiB。stack/cause chainは既定で送らず、生Error.message/URL/env/argvを無条件に保存しない |

未知エラーは安全な一般code/templateへ写し、secret/token/鍵/個人情報/入力本文/生path/接続URLをdetailへ入れない。credential/endpointは値ではなく登録alias、project等は検証済みIDだけにする。redactionは防御の補助で、任意の未知secretを完全検出するとは約束しない。stdout全文やstackの追加を運用者が無制限に有効化するMVP設定は設けない。Webはtextとしてescapeし、エラーメッセージのHTML/ANSI/URLを実行・自動fetchしない。

workerは既存mTLS/HTTPSの `POST /v1/executor/system-errors` へ最大4件/8KiB（envelope込み）のbatchを送る。上限を超える場合はbatchを分割し、単一eventもsize検証する。controllerは自身の同じvalidator/ingestion/application serviceを内部呼出ししてRedisへ格納し、self HTTP/認証迂回用listenerを作らない。Redis credentialはworkerに渡さず、job runnerに報告用control credentialも渡さない。未登録/期限切れ/認可失敗時やbootstrap前はremote送信せずローカル記録する。

同じerror code/template/component/instance/認可project/correlation範囲の反復は60秒windowで集約し、first/last UTCと件数を表示する。秘密文字列を含む生messageからgroup keyを作らず、ID/有限分類だけを使う。再送eventIdのreceiptはwindowとは別に保持し、同じevent再送で件数を二重加算しない。receipt/index/payload/countの条件更新を同じ原子的Store操作で行い、eventIdに異なる内容は拒否する。group件数は受理できたevent分であり、sourceがdropした分を正確な中央件数と偽らない。

system errorの保持/件数/bytes/rate/再送係数の正本は [systemErrors設定](11-configuration.md#json-policy)。期間・件数・byte上限の早い境界で古いsystem eventを有界削除し、index/receiptも整合させる。receiptは再送猶予以上を覆い、未期限receiptを容量不足で先行削除せず新規error受付を抑制/dropする。payload削除後も有効receiptへの再送を新eventとして復活させない。期限超過報告を無条件に再投入しない。keyTTLは無通信groupの後片付けで、古い時刻entry削除と件数/byte capも併用する。allocator/index overheadをD1で実測し、noeviction/finish/renew/audit予約領域を優先する。欠落範囲とretention境界をUIに示す。resource48時間・job file log・auditとは別policy。

### 集約先停止・再送・欠落

Redis停止/書込拒否では中央へ記録できないため、sanitizedな構造化イベントを各processのstderr/journaldへローカル記録する。workerのHTTPS不通/429/5xxは、メモリ内queue最大1000 events/4MiB・最長5分の範囲だけ同じeventIdで有界再送する。恒久認証/形式エラーは再送せずdrop計数し、復旧のためjobを自動retryしない。controllerも同じ上限の内部bufferを使い、Redis不通時はローカルを正直な一次出力にする。再送は低優先度・上限付きbackoffで、job claim/renew/finishや監査の処理を待たせない。

buffer上限/期限/プロセス終了/再起動では未送信分が失われ得る。永続spool/完全配送をMVPで約束せず、drop数・最初/最後のUTC・lastSuccessfulReportを有界counterとして持ち、次に成功した報告へgap summaryを同梱する。再起動で正確なdrop数も失った場合はunknownな欠落区間として表示する。local journaldの保持/転送はOS運用の別責務で、中央7日保存を保証するものではない。

logger自身の送信/Redis/書込失敗を同じ中央loggerへ再帰投入しない。local fallback writerにもqueue/byte/rate上限と失敗guardを置き、stderrが詰まればdrop計数する。失敗状態のlocal要約は最大1回/60秒等に抑制し、無限retry/同期I/Oでevent loopやjob処理をブロックしない。Redis不通によるjobの受付/dispatch停止は既存の状態整合policyであり、log送信待ちがその理由ではない。

### Web API と閲覧権限

`GET /v1/system-errors` と `.../:id` はUTC期間/component/project/category/code/instanceで絞り込み、cursor pagination・最大100件/page・detail2KiBを上限にする。既定表示24時間、最大は設定保持範囲で7日等（resourceの48時間制限を流用しない）。Webはfirst/last時刻、発生/受信差、件数、機密除去detail、関連run/definition等への権限付きlinkを表示する。表示JSTはprojectionだけで、保存/絞込境界はUTC。

毎要求で `systemErrors.read` とdeployment/project/host/component範囲を検査する。projectなしのstorage/PKI等のinfra errorは別のdeployment運用grantを必要とし、project利用者へ自動公開しない。関連job/log/auditを開く際も各機能のgrantを再検査する。取得0件を「エラー無し」の証明とせず、last received/report、source offline、drop/gap/unknown、retention/capによる欠測を表示する。Redis/API不通時は表示取得不能を示し、空一覧で正常と偽らない。

次は未実装schemaの安全な単一event例。receivedAtや認可済みidentityはcontrollerが付与/照合し、client値をそのまま信用しない。

```json
{
  "schemaVersion": 1,
  "eventId": "b23da5af-e867-407d-b415-98e36c586ab9",
  "occurredAt": "2026-10-27T09:00:00Z",
  "component": "worker",
  "instanceId": "worker-main",
  "epoch": "7",
  "category": "definition",
  "code": "release_hash_mismatch",
  "severity": "error",
  "projectId": "orders",
  "correlation": { "releaseId": "orders-release-1" },
  "message": "Registered release verification failed."
}
```
