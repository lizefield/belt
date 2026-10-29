# 開発起動・Linux運用・配備・復旧

ナビゲーション: [概要](../../README.md) ｜ [索引](../README.md) ｜ [要件・概念](01-requirements.md) ｜ [導入・SDK](02-project-integration.md) ｜ [構成・UTC](03-architecture.md) ｜ [永続化・反映](04-storage.md) ｜ [実行](05-execution.md) ｜ [ログ・監視](06-observability.md) ｜ **開発・運用（現在）** ｜ [API](08-api.md) ｜ [セキュリティ](09-security.md) ｜ [Web認証](10-web-authentication.md) ｜ [設定](11-configuration.md) ｜ [controller分散](12-controller-distribution.md) ｜ [release](13-release.md) ｜ [検証・計画](14-validation-plan.md) ｜ [一次資料](15-references.md)

状態: **設計文書・未実装**。確定要件/採用契約と数値提案/未決を区別する。読む順序と正本は [設計索引](../README.md) を参照。

## 配備前の境界確認

認証・認可と実行UIDの必須条件は [セキュリティ](09-security.md#security-gates)、OSコマンドの意味は [実行契約](05-execution.md#os-command-execution)、容量・保持設定は [設定表](11-configuration.md) を正本とする。認証/固定runner/署名/上限が未整備なら該当機能を開始しない。Web accountの初回作成・失効・復旧は [認証手順](10-web-authentication.md#registration-flows) を使い、job復旧だけで認証を再開しない。

## Linux サービス運用

### Production の常駐方式と同梱テンプレート

Linux VM/EC2ではsystemdのserviceとしてforegroundのbelt processを起動する方式を推奨する。Linux VM/EC2向けsystemdテンプレートと手順の同梱は提供物の設計に含めるが、個々の配備先での方式選択・サービス登録/起動済みという意味ではない。systemdはboot時起動・process再起動・UID/credential・journald・cgroup資源上限を担当し、beltはjobのretry/lease/認可/drain/recoveryを担当する。processが再起動しただけでjob完了や二重実行防止が成立するとは扱わない。

PM2は必須依存にしない。既存のPM2運用を選ぶ場合も、起動時復元/Node更新/停止signal/timeout/UID・子processの境界を検証し、OSによるrunner分離を省略しない。PM2のcluster modeでcontrollerを複製してもHA設計の代わりにならない。常駐用の独自daemon化・watchdog・process supervisorは作らず、belt内のjob supervisorとは区別する。systemdと別managerの二重restart loopを作らない。ECS等を採用検討する場合は常駐/再起動を基盤に委任し、その停止猶予・権限・volume・runner境界を別profileで検証する。

systemdではRestart=on-failureを初期提案とし、RestartSecとStartLimitIntervalSec/StartLimitBurstで起動失敗の無限高速再試行を避ける。自動再起動で署名/PKI/設定/結果不明の出荷条件を迂回しない。実行中の固定artifact/versionとjournal/Redis照合を復帰条件とする。[systemd.service 256](https://www.freedesktop.org/software/systemd/man/256/systemd.service.html) / [PM2 startup](https://pm2.keymetrics.io/docs/usage/startup/)（調査日2026-10-27、採用OS/版で再確認）。

推奨配置案: `/etc/belt/`（管理設定）、`/var/lib/belt/`（worker journal/spool と運用 manifest）、`/var/log/belt/`（bounded job log）、`/opt/belt/`（belt runtime と利用側 project の読み取り専用 job artifact/registry を分離配置）。controller と実行サービスは別 UID。executor からは controller への HTTPS だけを許可し、worker に inbound port を要求しない。Redis は controller と運用管理者だけが接続できる閉域/loopback に置き、専用 UID・ACL・key/command scope を適用する。リモート接続は TLS、秘密値は protected credential で配布し、Web/worker に Redis credential を渡さない。Redis 用の永続 volume、RAM、AOF/Redis スナップショット用ディスクを確保する。[Redis security 公式](https://redis.io/docs/latest/operate/oss_and_stack/management/security/)。

OSの境界・credential/FD分離と資源制限を検証したsystemd unit templateを正式提供物として `examples/linux/systemd/` に同梱する（[MVP3原本と手順](07-operations.md#systemd-templates)、未実装）。必要条件は [セキュリティ要件](09-security.md#execution-boundary) を満たす。提案設定は `User=`, `Group=`, `StateDirectory=`, `LogsDirectory=`, `UMask=0077`, `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, `ProtectHome=true`, 明示 `ReadWritePaths=`, `Restart=on-failure`, `KillMode=control-group`, `MemoryMax=`, `TasksMax=`, `LimitNOFILE=`。command の業務用 mount/network 制約と両立するようホスト別に検証する。

SIGTERM時はdraining/readiness=falseへ移行し、新規受付・schedule dispatch・claimを停止する。既存attemptのrenew/finish/log報告は停止猶予内で受け続け、executorは新規取得を止めて期限付きdrainを行う。初期案はshutdown.drainMs=60000で、期限後は既存のTERM→kill grace→KILLと停止確認・journal保存へ進める。終了報告のRedis耐久性ACK後にcontroller接続を閉じる。停止未確認のslot/leaseを先行解放して別attemptを開始させず、未完了はheld/次回reconciliationで照合する。controller自体が先に停止した場合もexecutorはlease喪失の停止契約に従い、外部副作用を未実行と断定しない。

controller/supervisorと別UIDのrunner serviceは別unit/cgroupなので、supervisor unitのKillMode=control-groupだけではrunnerの子job停止を保証できない。OS管理の固定runner停止境界とunit間のdrain/停止順序を設計し、runner service全停止が他attemptへ与える影響も明記する。SIGKILL/host crashでdrainが走らない場合はjournalとRedisの照合へ戻す。Redis 自体を停止する場合はその後に永続化を確認して正常停止する。systemd の `TimeoutStopSec` は drain + kill grace + 報告/flushの余裕より長くし、対象unitすべてと整合させる。上限到達時の強制killを正常なjob取消完了とは記録しない。待ち切れない場合は停止理由と未確認 attempt を残し、次回 recovery へ渡す。upgrade は drain、Redis backup、key schema version 検査、bounded migration、readiness 確認の順。対応外 key schema を持つバイナリからの更新を拒否する。migration は再開可能な marker を持ち、大きな一括 script を避ける。

backup は Redis 公式のスナップショット（バイナリ形式）/AOF 手順で行い、完了した Redis スナップショットと、採用版で必要な AOF base/increment/manifest の整合したセットを扱う。稼働中の一部 AOF ファイルだけのコピーを backup としない。定期 Redis スナップショット（バイナリ形式）を別障害領域へ保存し、AOF とログファイル/manifest の整合性と欠落範囲を復元試験で確認する。AOF rewrite、fork/Copy-on-Write、buffer を含む RAM と一時ディスクの余裕、last save/AOF error を監視する。AOF は job ログや改ざん不能監査の代替ではない。定義/設定の JSON export は可読性・配布用であり、active attempt/lease/token を含む Redis 全状態の backup を代替しない。JSON export/import と運用 backup/restore を別の操作にする。暗号化・アクセス制御された backup を推奨するが外部 object storage は必須にしない。[Redis persistence 公式](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)。

restore は controller と executor を停止・隔離し、整合性検査後に新たな deployment generation と credential/session を発行し、復元前の endpoint/資格情報の再利用を止める。Redis の snapshot/AOF 復元や failover で fencing token・receipt・schedule cursor が巻き戻り得るので、token だけを信用して再開しない。復元した active/held はすべて照合対象にし、外部副作用と残存プロセスを確認するまで dispatch しない。RPO/RTO は D6 の合意と復元演習で測定する。

時刻同期を運用前提にする。[UTC契約](03-architecture.md#utc-time-policy) に従い、保存/通信/API/Redis/構造化ログ/監査/telemetry/実行instantはUTC。Z終端文字列または単位付きepoch msを使う。表示既定はUTC、JST等への変換表示はzoneを明示し、表示変更で実行日時を変えない。lease期限はcontroller層のStoreで共有Redis UTC時刻により判断、executor の経過監視は単調時計。controller は wall clock と monotonic の乖離を検知し、大きな時計変更では schedule dispatch/lease recovery を保留して運用者に確認させる。scheduler の UTC due/cursor を正とし、timer は起床手段に限る。詳細は [時計と scheduler](05-execution.md#native-scheduler) を参照。

<a id="systemd-templates"></a>

### 同梱する unit template の契約（未実装）

`examples/linux/systemd/` に以下のunit template原本、role別hardening例、置換項目チェックリスト、手動運用手順を同梱する。npm/package配布物にも含める。belt CLIは配布物の所在表示/設定検証までを担当し、root操作やuser作成、systemctl実行を自動化しない。正式サポートするsystemd/OS版はD8で固定し、原本を置換せずそのままenableすることはできない。

| 同梱原本 | foregroundのExecStart（配備時に@...@を置換） | 固定非root User/Group・設定 |
| --- | --- | --- |
| belt-controller@.service | @NODE_BIN@ @BELT_ENTRY@ controller start --config /etc/belt/controller/%i.json | belt-c-%i / 同group、controllerのみRedis credential |
| belt-worker@.service | @NODE_BIN@ @BELT_ENTRY@ worker start --config /etc/belt/worker/%i.json | belt-w-%i / 同group、mTLSと限定runner IPC、業務module importなし |
| belt-runner@.service | @NODE_BIN@ @BELT_ENTRY@ runner-service start --config /etc/belt/runner/%i.json | belt-r-%i / 同group、project/trust-domain固定、制御credentialなし |

MVPの提供物は上表の3原本とrole別profile/手順。後続の指定サーバー向け専用agentを実装する時点でbelt-agent@.service、agent start、agent用JSON/credential/登録/権限を追加設計する。agent原本はMVP配布・起動・resource監視の必須条件にしない。

これらのCLIも設計上の未実装API。@NODE_BIN@は対応版Nodeの絶対path、@BELT_ENTRY@は型チェック/署名検証した配備artifactの絶対entry path、@RELEASE_DIR@はread-onlyの不変release directoryとする。シェル/PATH/npm/npx/ts-nodeやtranspile-only経由でdaemon化しない。%iは運用instance名で小文字英数字・hyphenの1〜16字に限定し、登録ID/UID名を任意文字列から生成しない。実際のdeployment/server/controller/executor/project IDは各host管理JSONに記載しmappingを照合する。

各原本は次の共通形をroleの値で展開する。これはservice登録済み設定ではなく、配布時に検証する提案原本の仕様である。

```ini
[Unit]
Description=belt @ROLE@ instance %i
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=exec
User=@ROLE_USER_PREFIX@%i
Group=@ROLE_USER_PREFIX@%i
WorkingDirectory=@RELEASE_DIR@
ExecStart=@NODE_BIN@ @BELT_ENTRY@ @ROLE_COMMAND@ --config /etc/belt/@ROLE@/%i.json
Restart=on-failure
RestartSec=5s
KillSignal=SIGTERM
KillMode=control-group
TimeoutStopSec=120s
UMask=0077
StateDirectory=belt/@ROLE@-%i
StateDirectoryMode=0700
LogsDirectory=belt/@ROLE@-%i
LogsDirectoryMode=0700
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

@ROLE@はcontroller/worker/runner、@ROLE_USER_PREFIX@は表のbelt-c-/belt-w-/belt-r-、@ROLE_COMMAND@はcontroller start/worker start/runner-service start。role単位で原本に固定しruntime入力で自由指定させない。テンプレートを置換する手段自体にroot汎用実行権限を与えず、運用者が内容を検査してroot所有のunitへ配備する。Type=execは実行開始の確認で、Redis/PKI/runner準備完了の証明ではない。起動後はbelt readinessも確認する。network-online.targetもcontroller/Redis/CAの疎通保証ではない。

StateDirectory/LogsDirectoryの実path（例:/var/lib/belt/worker-main、/var/log/belt/worker-main）をrole別JSONのpaths.state/logへ明示して揃え、共通既定directoryへ複数UIDが書く配置にしない。artifact/entry/WorkingDirectoryはrootまたは配備管理者が所有し、job UIDは書込不可。mTLS鍵/Redis credentialは当該controller/supervisor UIDだけが読むprotected fileとして別配置する。runner JSON/IPCにはそのpathやFDを配らない。EnvironmentFileを任意に使う場合も非機密BELT_*と参照だけ、owner/modeを検証し、ExecStartの明示--configがBELT_CONFIG_FILEより優先されることを運用者に示す。

#### role 別 hardening と runner の停止境界

controller/workerはNoNewPrivileges、ProtectSystem、ProtectHome、PrivateTmp、ReadWritePaths、MemoryMax/TasksMax/CPUQuota/LimitNOFILE等の検証済みdrop-inを同梱する。数値/書込先/到達先は各roleのD1/D8 profileで決め、すべてのjobへ同じ制限を無検討に適用しない。controllerはstate/log/metadata以外を書かず、supervisorはjournal/spool/固定IPCのみ。runnerはjobに必要なcwd/data mount/許可egressを明示し、そのprojectのartifact/業務secret読取と上限を検証する。profileがjob要件と衝突すれば管理者が審査して限定的に調整し、API/job入力から緩和しない。必須UID/credential分離と上限が満たせなければ起動/dispatch拒否。

別UID runnerは別unit/cgroupであり、supervisorのKillModeではrunnerを回収できない。固定runner serviceのlaunch/drain/status/stop IPCとOS側unit依存/停止手順をD8で検証する。汎用sudo、任意unit名のStart/Stop、systemd socketをsupervisor/jobへ渡さない。runnerが共有する全attemptを停止する場合の影響を運用者に提示する。単一attemptの完全なper-cgroup停止は後続要件であり、process groupだけで全子孫停止を保証しない。

SIGTERMのdrain初期60秒 + kill grace10秒 + 報告/flush余裕に対してTimeoutStopSec=120秒を原本初期案とする。job要件と停止予算に応じrole別に同時調整し、systemdの強制kill後もjobを成功/canceledと偽らずheld/recoveryへ渡す。単一hostの管理停止は新規投入停止→supervisorの新規claim停止とdrain→runner終了確認→finish ACK→supervisor停止→controller停止の順を基本とする。runnerを先に止める自動依存設定で正常drainを壊さない。host電断/並行unit停止も故障試験に含める。

#### 運用者が行う手動操作

1. **install**: 固定user/group、read-only release、role別JSON/credential/書込directory、runner境界をOS管理者が配備する。原本を置換・role別profile確認し、systemd-analyze verify等とbeltの設定検証を行う。unitを/etc/systemd/system/へroot所有で配置し、systemctl daemon-reloadを実行する。unit/credential/所有権をbelt runtime自身に変更させない。
2. **enable**: OS管理者が必要なinstanceだけsystemctl enableでboot起動対象にする。初期single配備はcontroller一つ。multi配備は [分散profile](12-controller-distribution.md) のmembership/共有LogStore/受入を満たして明示承認し、複数instance enableだけでHAにしない。enableとstartは別操作。
3. **start/status**: runner準備→controllerのRedis/PKI/定義準備→必要なworkerの順を配備構成に合わせて検証する。systemctl start/status、journalctlとbelt readiness/APIを併用する。systemctl activeだけではdispatch可能と判断しない。
4. **stop**: 上記drain順でsystemctl stop。停止deadlineを超えたら残存runner/外部副作用を確認し、slot/leaseを先行解放しない。再起動はjournal/Redis照合から行う。
5. **update**: 投入停止/drain、Redis・参照manifestのbackup、jobs strict build→JobRef/schema/manifest生成→producer strict build/署名済み新releaseを検証。新job artifactをrunnerへ先に配備し、definition差分apply→desired/applied/ready→activate→対応refsを持つproducer配備を行う。必要なunit/drop-in/JSONだけレビューしてdaemon-reload、順序付きstart/readiness確認。有効runのversionを差替えず、Node更新も絶対path/ABI/SDK/原本を再検証する。
6. **uninstall**: drain/停止・結果不明の照合後にsystemctl disable、対象unit/drop-inの登録解除とdaemon-reloadをOS管理者が行う。state/journal/log/credential/userは保持・復旧/監査要件を確認して別の承認操作で処理し、package削除が自動で消さない。runnerの他job/instanceへ影響させない。

systemctl/journalctl/systemd-analyzeはOSのCLI、belt CLIはアプリの設定/定義/操作CLIである。例やunitを文書化しただけでサービス登録やOS権限変更を実施したとは扱わない。実装時にはMVP3原本すべての置換/設定/実起動/再起動/停止/更新/解除と非root/secret非継承を対象Linuxで受入試験する。

<a id="development-cli"></a>

### Development の起動 CLI（正式提供物の設計・未実装）

利用側TypeScriptプロジェクトに導入したbelt CLIで、controller/workerをまとめてforeground起動する `belt dev start --config /absolute/path/dev.json` を提供する。Web UIはcontroller組込の静的assetとAPIを使い、別dev server/processは必須にしない。agentはMVPに含めず起動しない。Productionの常駐はsystemd/採用基盤へ委任し、この開発限定orchestrationを独自Production supervisorにしない。自動restart無限loopやdaemon化は提供しない。

提案CLIは `belt config check --config ...`、`belt project typecheck --project ./tsconfig.json --config ./src/belt.config.ts`、`belt project build --project ./tsconfig.json --config ./src/belt.config.ts`、`belt dev start --config ... [--watch]`。個別起動は `belt controller start --config ...` と `belt worker start --config ...`、固定runnerはOS管理の `runner-service start`/unitを使う。CLI名は未実装の設計契約。jobs strict build→軽量JobRef/schema/manifest生成→producer strict build→署名/成果物検証→設定/Redis/TLS/固定runnerの確認→controller起動→認可付きapplyでdesired登録→対応controller ready確認/activate→worker ready→producer利用可能の順に調整する。新worker待ちは受理済みrunをpendingにできるが、互換codeを代用しない。build失敗時に残ったdistを使わない。

開発用dev.jsonはローカルbootstrapとして、jobs/producer project参照を持つtsconfig・trusted build設定entry/承認済みbuild出力、controller/workerのrole別JSON参照、固定role launcher/runner IPC、watch対象の許可source rootだけを持つ。制御credentialやPKI秘密値を直接格納しない。CLI/env/local JSON/defaultの優先順位は [設定契約](11-configuration.md) に従い、role固有の環境を組み立てて別roleのRedis/API/署名credentialを子へ丸ごと継承しない。Web表示origin/portは設定値を使い、port競合を検出しても既存processをkillせず、無断で別portへ切替えない。bind時の競合も起動失敗として扱う。

**開発でもUID/credential境界を暗黙に緩めない。** 通常の非rootCLIがcontroller/worker/runnerを自由に別UIDへspawnできるとは仮定しない。別UID roleをまとめて起動するには、D8でOS管理者が事前承認した固定role/config/pathだけを扱う限定launcherを用意し、その実装/権限を検証する。launcherは起動ハンドル/終了/ログ/stopの限定IPCを返し、汎用sudo・任意unit・任意実行ファイル/UID選択を許さない。CLIが直接作成できる補助processだけをchild_processで管理する。境界未整備なら一括起動を拒否し、事前配置した別role端末/unitとの個別起動を使う。同一UIDで本番同等の境界があると装うfallbackはしない。これは開発者向け初期準備が必要な設計上のトレードオフであり、手元のOSを自動変更しない。

Redisは起動済みの明示接続先・専用deployment namespaceを使う。既存DBのFLUSH/他namespace削除、既存controllerの乗っ取り、既存port利用processのkillはしない。Redisの自動install/download/起動は基本経路に含めない。container helperを後続検討する場合も明示選択・既存engine・限定resource/volumeと所有確認を必要とし、外部サービス契約や無断導入をしない。

開発でもHTTPS/mTLSと証明書検証を維持する。初回CA/鍵/個別証明書の生成、trust storeへの追加、user/credential配備は管理者が明示して実施する独立手順とし、dev startで自動生成/OS信頼変更しない。未準備なら不足項目と手順を提示して停止する。証明書更新/失効失敗時にHTTP/verify=falseへ落とさない。開発release署名鍵もjob UIDから隔離し、署名を無効化するdev flagは用意しない。

orchestratorはrole/instance/process epoch/request ID付きの構造化ログを同じ端末へ多重化し、stdout/stderrのbyte/line上限・redactionを守る。secret/credential/全env/configを表示しない。終了/起動失敗はrole名と限定error codeを示す。部分起動失敗時は今回の起動ハンドルだけへ停止要求を出し、既存runner/serviceや別sessionを止めず、残存状態を示して非zero終了する。port検査からbindまでの競合やcontroller ready前のworker起動も試験する。

Ctrl-C/SIGINTはdrainingへ移行し、workerの新規claimとcontrollerの新規受付/schedulerを止め、既存renew/finishを残して期限付きdrainする。期限後は固定runnerの停止手順・子process group/exit確認・journal保存を行い、停止未確認はheldのままにする。自分が作った子だけを回収し、別UIDprocessは承認済みlauncherのstop IPCを使う。二回目Ctrl-Cも破棄/slot先行解放の許可とはせず、強制終了で残ったprocess/attemptの照合方法を表示する。orchestrator crash時もleaseとOS境界からrecoveryし、端末終了だけで全job停止を保証しない。

watchは既定false。明示--watch時もsource変更をdebounce/coalesceし、jobs型検査/build→JobRef/schema/manifest再生成→producer型検査/build→署名/整合検証を通った新しいimmutable開発releaseだけを候補にする。型エラーなら現在の検証済み版を維持して失敗を表示する。成功時は新規claimを止めてdrainし、実行中jobのmoduleをhot swapしない。期限切れは停止確認/heldへ進め、新artifactの配備と認可付きapply/activate、worker再登録/epochを照合後に新規実行を再開する。controllerのbootstrap変更はrestartを要し、Redisのrun/version/cursorをresetしない。継続稼働中にコードだけを上書きして同じversion/hashに見せない。

受入条件は統一起動/個別起動、strict失敗、TLS/UID未準備、port競合、Redis停止、部分失敗、Ctrl-C/drain期限/launcher残存、watch中のlong job/型エラー/高速変更、secret非継承を実Linuxで検証すること。開発の利便性とProductionのservice管理の責務を別に保つ。

### 共有 JSON source の配備・公開・復旧

controller 並列運用を検討する場合、共通定義/非機密設定の配布先を共有フォルダまたは S3 等にできる。payload→manifest→published-ref の順の公開、競合検出、Redis apply/activate、各 controller の version cache は [共有 JSON 契約](04-storage.md#shared-json-publication) に従う。OS管理の bootstrap と秘密鍵/credential は共有 JSON に集約しない。S3 は任意 adapter とし、bucket/IAM を本設計作業で構築したとは扱わない。

配備手順は、source の root/prefix・reader/publisher・署名信頼鍵を承認 → 不変 release を公開 → 競合/全参照の取得検証 → 認可付き apply（desired登録） → Redisのdesiredと各controllerのloaded/applied/status・epoch/heartbeatを確認 → 少なくとも一台の生存readyを確認してactivate → 各 controller の active revision/readiness を確認。更新は一操作として監査し、不明な ACK は公開先と Redis の receipt を照合する。共有 FS では単一 publisher の直列化と基底 revision の確認、S3 では conditional PUT の成功を確認し、競合に対する無条件上書きを禁止する。

配布先の 403/停止/timeout、mount断、cache不足、改変、不整合、controller の版遅れを監視する。新規 controller は active release を検証できるまで ready にしない。既存 controller は Redis の active版と一致する検証済み cache に限り使用し、未取得 active版の処理を止める。運用者に deploymentのdesired/active revision、controllerごとのloaded/applied revision・反映status・最終報告時刻・heartbeatのstale・失敗理由を表示する。秘密値・token は表示しない。

共有 release/署名/published-ref履歴も backup/保持対象とし、active・進行中 run・rollback 対象から参照される version を自動削除しない。S3 lifecycle や FS cleanup に参照中 payload を消させない。未公開の orphan payload は猶予期間後に、公開処理と競合しない別権限の GC で削除する。JSON source の復元と Redis の復元は別手順で、参照 version/hash・署名/失効を突合し active を再承認する。S3 versioning や共有 folder が Redis backup を代替するとは扱わない。複数controllerのAPI/scheduler CAS/共有log/復旧は [分散profile](12-controller-distribution.md) の出荷条件とし、JSON反映だけで許可しない。

<a id="aws-vpc-transport"></a>

### AWS VPC 内の HTTPS 運用例

これは通信経路の配備例で、ALB/Private CAを必須依存にしない。Web account profileが別途S3/KMSを使うこととは区別する。基本形は `worker supervisor → private DNS/private IP の controller:HTTPS(mTLS) → Redis`。管理 Web/CLI も認証付き API を使い、controller が取得可能な project/job/version/queue/host と割当済み attempt の報告権限を検査する。Redis credential は controller と権限を分けた運用者だけに配り、worker/runner/Web browser に渡さない。controller 経由にする理由は、このアプリ認可と状態更新の窓口を限定するためである。

VPC の private subnet、SG、NACL は到達制御であり、通信暗号化や worker identity の確認を代替しない。SG は controller の HTTPS port への接続元を executor/管理用 SG 等に限定し、Redis 側は controller/許可運用元のみとする。private IP、NAT 配下、AWS 上という理由で平文を許可しない。AWS の一部基盤通信の暗号化を VPC 全経路の暗号化保証と一般化しない。実際の route/peering/ingress/egress は配備担当者が確認する。[SG](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html) / [EC2 データ保護](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/data-protection.html)。

#### 最小案: controller で直接 TLS を終端

Node 標準 https/tls と、既存社内 CA または運用管理する private CA を使う。ALB、AWS Private CA、public CA、internet 公開 listener は必須ではない。CA の発行/更新ツールは成熟した既存のものを使い、belt は CA や独自暗号 protocol を実装しない。既存 PKI がなければ発行責任者・信頼配布・失効・更新の運用を D7 で決める。手動 CA 管理にも運用負担があり、「外部サービス不要」は「証明書管理不要」を意味しない。

1. controller の接続名を固定する。内部 DNS 名なら対応する DNS SAN、private IP へ直接接続するなら対応する IP SAN を含む server 証明書を用意し、serverAuth/clientAuth 等の用途も分ける。単に証明書の CN が同名という理由で通さない。
2. 各 supervisor に信頼する CA bundle と個別の client 証明書・秘密鍵を protected credential として配布する。CA 秘密鍵は runtime に配らず、job UID から鍵/制御 FD を読めないことを検査する。server/client の chain・期限・用途、server の接続先名、client の登録 identity/fingerprint を検証する。
3. 起動前に正しい相手への接続と、wrong SAN/issuer/用途/期限切れ/未登録 identity の拒否を確認する。`rejectUnauthorized: false` や `NODE_TLS_REJECT_UNAUTHORIZED=0`、任意自己署名証明書の自動信頼は許可しない。private CA の信頼 anchor を明示配布することと、検証を無効化することは異なる。
4. 証明書/CA の期限と更新担当者を監視し、期限前に新 credential を配備・承認して正常な full handshake を確認する。CA rollover は D7 で定めた期限付きの旧/新 trust bundle 重複期間を設け、client leaf の最大10分の重複期間と区別する。切替後に古い credential/session を無効化し、古い CA の受入れを期限内に終了する。
5. 盗難/失効時は PKI と belt の identity/credential mapping を両方更新し、既存接続・session resumption を含め毎要求/renew で拒否する。CRL 等は対象 runtime の実際の対応と更新手順を検証し、自動照会が存在するとは仮定しない。更新失敗・期限切れ・失効確認不能では該当接続/新規 claim を拒否し、HTTP へ自動 fallback しない。通信を失った実行中 job は停止確認まで held/照合とし、証明書失効だけで停止済みにしない。

内部用に public CA の証明書が取れなくても、private CA を信頼配布すれば HTTPS は使える。DNS/CA 到達性が閉域である場合も配布・更新方法を計画する。[内部 CA](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html#use-an-appropriate-certification-authority-for-the-applications-user-base) / [Node TLS](https://nodejs.org/api/tls.html)。

#### 任意案: internal ALB と ACM

既に AWS の証明書/入口管理を運用する場合の選択肢であり MVP の必須サービスではない。所有する公開ドメインの名前について public DNS の検証 CNAME を設定し、VPC 内の DNS では internal ALB に解決させれば、アプリを internet 公開せず ACM の public 証明書を利用できる。public 証明書の名前は公開され得るため機密名を含めない。private 名だけなら既存 CA の証明書や AWS Private CA を検討する。ALB/Private CA の料金・追加サービス・鍵/更新/失効責任を採用前に確認する。[ACM DNS 検証](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html) / [Private CA 料金](https://aws.amazon.com/private-ca/pricing/)。

ALB は frontend TLS を終端する。HTTPS listener だけで ALB→controller まで暗号化されたとは扱わず、HTTP target の区間には引数/token/出力が平文で流れる。この例では HTTPS target を要求するが、**ALB は target 証明書の chain/期限等を検証しない**。AWS はこの区間の VPC packet-level 保護を説明しているが、belt の直接 mTLS と同じ相手検証ではない。この性質と SG による backend 隔離を受け入れる別 profile としてレビューする。直接の end-to-end mTLS が要件なら最小案を選ぶ。[HTTPS listener](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html) / [target 証明書の扱い](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html)。

ALB を使うだけでは worker の client 証明書を検証しない。採用時は mTLS verify mode と trust store/失効手順を設計し、backend は承認した ALB 経由の到達だけを許す。転送された client 証明書情報を検査する ingress adapter と直接 TLS identity を明確に区別し、外部入力の同名 identity/Forwarded header、重複/不正 encoding は拒否する。header 正規化/差替えと controller への迂回接続拒否を実機で確認するまで有効化しない。ALB の mTLS passthrough mode は証明書 chain を HTTP header で渡す方式であり、TCP の TLS passthrough や検証済み identity と混同しない。どの方式でも controller の登録 identity・期限/失効・grant の毎要求検査は残す。[ALB mTLS](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/mutual-authentication.html)。この ingress adapter は未実装の任意拡張であり、MVP の直接 mTLS 契約を黙って緩和しない。

#### HTTP とローカル IPC の扱い

VPC/LAN 平文 HTTP を remote 取得の標準にしない。bearer credential や業務引数/出力の盗聴、割当/結果の改竄は実行権限に直結する。HMAC のみでは秘匿できず、replay/正規化を含む自作 TLS 代替は作らない。SSH/VPN 等の既存暗号 tunnel を使う例外が必要なら、全経路、終端後の区間、鍵/再接続、接続元認証と belt 認可を別途レビューする。remote transport の選択肢を MVP に無条件追加しない。

同一 host の supervisor→固定 runner の private UDS はローカル実行 IPC であり、remote job 取得の代替ではない。pathname socket と親 directory の owner/mode・置換禁止を使い、loopback HTTP でも他 local process への認証を省略しない。Linux peer credential 検査は Node 標準で使えると仮定せず D8 で検証する。[Linux unix(7)](https://man7.org/linux/man-pages/man7/unix.7.html)。

上記は設計・運用手順案。AWS account/VPC/CA/ALB を変更・作成した結果ではなく、公式資料の調査日も 2026-10-27。対象 Node/Linux と採用する AWS profile での接続・拒否・更新・故障試験を出荷前に行う。
