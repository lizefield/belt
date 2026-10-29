# 利用側プロジェクトへの導入・型付きSDK

ナビゲーション: [概要](../../README.md) ｜ [索引](../README.md) ｜ [要件・概念](01-requirements.md) ｜ **導入・SDK（現在）** ｜ [構成・UTC](03-architecture.md) ｜ [永続化・反映](04-storage.md) ｜ [実行](05-execution.md) ｜ [ログ・監視](06-observability.md) ｜ [開発・運用](07-operations.md) ｜ [API](08-api.md) ｜ [セキュリティ](09-security.md) ｜ [Web認証](10-web-authentication.md) ｜ [設定](11-configuration.md) ｜ [controller分散](12-controller-distribution.md) ｜ [release](13-release.md) ｜ [検証・計画](14-validation-plan.md) ｜ [一次資料](15-references.md)

状態: **設計文書・未実装**。確定要件/採用契約と数値提案/未決を区別する。読む順序と正本は [設計索引](../README.md) を参照。

<a id="project-integration"></a>

## 利用側プロジェクトへの framework/library 導入

共通enqueue API＋型付きSDK、buildでの軽量JobRef/schema/manifest生成、producer/controller/supervisorと実行codeの分離は **採用する設計契約で、未実装**。以下のpackage名/細かなCLI表記も設計上の例である。利用者は自分のアプリへ `belt` を依存として導入し、業務 job をそのアプリの TypeScript でコーディングする。利用側 project の registry と公開 SDK を接点にする。

### 利用側の最小構成案

```text
orders-app/                      # 利用側project。以下は配置案
  tsconfig.json                  # jobs/producerのTypeScript project参照を束ねる
  tsconfig.jobs.json             # src/jobs, registry, build config。strict
  tsconfig.producer.json         # generated refs, client config, enqueue。jobsへ依存しない
  src/
    belt.config.ts               # trusted build専用: project/registry/output参照
    belt.registry.ts             # jobの明示登録と安定export alias
    belt.client.ts               # producerの接続先/credential参照だけ
    jobs/summarize-order.ts       # 利用者が書くschema/handler
    enqueue.ts                   # 利用者がSDKで投入する呼出し元
    belt.generated/job-refs.ts    # build自動生成、手編集禁止。関数/secretなし
  dist/
    jobs/                        # immutable job artifact/registry、producerへ配らない
    producer/                    # producerとcompiled JobRef/.d.ts、job業務依存なし
    belt.manifest.json           # 自動生成schema/定義メタデータ/job payload hash
    belt.manifest.sig            # trusted CIによる署名
```

公式対応は TypeScript 利用と型チェック済み build に限定し、型無し JavaScript を利用側の正式な開発経路にしない。compiled JS は配備成果物であり、手書きの型無し JS を対応言語にする意味ではない。利用側が選ぶ業務ライブラリは利用側 bundle の依存であり、belt core の依存予算と区別する。

```ts
// src/jobs/summarize-order.ts（提案）
import { defineJob } from 'belt';

export const summarizeOrder = defineJob({
  id: 'orders.summarize',
  version: 1,
  inputSchema: {
    type: 'object',
    properties: { orderId: { type: 'string', minLength: 1 } },
    required: ['orderId'],
    additionalProperties: false,
  } as const,
  resultSchema: {
    type: 'object',
    properties: { orderId: { type: 'string' }, status: { type: 'string', enum: ['summarized'] } },
    required: ['orderId', 'status'],
    additionalProperties: false,
  } as const,
  async run(args, context) {
    // args.orderIdはinputSchemaからstringとして推論する。
    context.log({ level: 'info', message: `summarize ${args.orderId}` });
    return { orderId: args.orderId, status: 'summarized' as const };
  },
});
```

```ts
// src/belt.registry.ts（提案）
import { defineRegistry } from 'belt';
import { summarizeOrder } from './jobs/summarize-order.js';

export default defineRegistry({ summarizeOrder });
```

```ts
// src/belt.config.ts（未実装の設定契約例。trusted buildだけが読む）
import { defineProject } from 'belt';

export default defineProject({
  projectId: 'orders',
  build: {
    jobProject: './tsconfig.jobs.json',
    producerProject: './tsconfig.producer.json',
    registrySource: './src/belt.registry.ts',
    generatedRefsSource: './src/belt.generated/job-refs.ts',
    manifest: './dist/belt.manifest.json',
  },
});
```

build設定内のpathはCLIで指定するproject root（例はorders-app/）から解決し、artifact内の参照はmanifestの固定rootから別に検証する。コンパイル出力の所在から元project rootを推測しない。tsconfig.jobs/producerのrootDir/outDirと上記の生成先をCLIが検証し、graphへjob実行moduleが混入するproducer buildを拒否する。

```ts
// src/belt.client.ts（producer専用。実行registry/build設定をimportしない）
export default {
  deploymentId: 'production-main',
  projectId: 'orders',
  controller: {
    endpoints: ['https://belt.internal.example:8443'],
    tokenFile: '/run/credentials/orders-producer/api-token',
    tls: {
      caFile: '/etc/belt/pki/ca.pem',
      certificateFile: '/run/credentials/orders-producer/client.pem',
      privateKeyFile: '/run/credentials/orders-producer/client.key',
    },
  },
} as const;
```

credential pathはproducer専用の非機密参照例で、値/証明書を配布物に含めない。controller/admin/worker/runnerは別のOS管理JSON/credentialを使い、runnerへ制御credentialを渡さない。defineJob/defineRegistry/defineProjectは宣言用で、宣言だけでhandler実行/接続/登録をしない。ただしmoduleのtop-levelは実行され得るため、業務registryをimportするのは隔離したtrusted buildと固定runnerだけで、controller/worker supervisor/producerは読まない。

```ts
// src/enqueue.ts（共通APIのtyped SDK。job毎のHTTP handlerは不要）
import { createClient } from 'belt';
import config from './belt.client.js';
import { summarizeOrder } from './belt.generated/job-refs.js';

const client = createClient(config.controller, { deploymentId: config.deploymentId, projectId: config.projectId });
const run = await client.enqueue(
  summarizeOrder,
  { orderId: 'order-123' },
  { idempotencyKey: 'orders.summarize:order-123:v1' },
);
console.log(run.runId);
```

<a id="typed-enqueue"></a>

### 共通 enqueue API と自動生成 JobRef（確定した設計契約・未実装）

**job追加ごとのAPI handler/動的route作成は不要。** controllerは共通POST /v1/runsだけを公開契約とし、登録済みdefinition ID/version/hashでschema/queueとhandler ID/artifactのメタデータを解決する。controllerはhandlerをimport/実行しない。SDKはclient.enqueue(jobRef,args,{idempotencyKey,...})で型補完と入力検証を行い、関数/コード/任意module pathを送信しない。job別routeを自動増殖させず、Webも同じ登録済み定義から入力/起動する。ネットワーク公開や認証設定が自動で許可される意味ではない。

| 利用者が書くもの | frameworkが生成/提供するもの |
| --- | --- |
| defineJobのid/version、inputSchema/resultSchema、handler | 同じschemaからJobRef<Args,Result>とruntime schemaメタデータ |
| defineRegistry({ summarizeOrder })の明示登録/alias | src/belt.generated/job-refs.tsの安定named export、compiled JS/.d.ts |
| trusted build設定、producer接続設定、SDK呼出し | 署名対象manifest、型チェック/生成/build CLI、共通enqueue API |
| job/host/queue/secret範囲を承認する運用policy | scopeに沿うvalidate/apply/activate、監査、operation receipt |

registryのexport aliasはjob IDと別の安定TypeScript識別名とし、重複/予約語/危険名をcompiler/validatorで拒否する。例ではalias summarizeOrder→job ID orders.summarize/version1。生成物はproject/job ID/version、definition/input/result schema hash、限定runtime schema、artifact bindingを含む純粋な参照/型だけで、handler/import URL/業務module/秘密値/credential参照を含めない。runtime JSは自己完結のデータとSDK公開契約だけに依存し、job/registry/build configへのimportを生成しない。生成物は手編集せず再生成し、producerのdependency graph/packも業務実行依存を含まないことを検査する。

schemaのsource of truthはjob内の宣言的な限定JSON schema。TypeScript compilerだけから任意のTS型を完全なruntime validatorへ変換する機能は約束しない。InferSchema相当の型推論は対応subsetに限り、同じschema byte/正規化規則/hashをref/manifest/controller/runnerで共有する。Date/class/function/BigInt/循環値、未対応keyword/外部参照等は拒否し、重いschema libraryを必須にしない。TypeScript型が消えた入力はSDK/HTTP/controller/runner境界でunknownから検証し、clientの型や自己申告schemaを認可/登録の代わりにしない。

### 生成順序・登録・権限

buildは(1)jobs側strict型検査/不変job出力→(2)隔離trusted buildでcompiled registryを読み、handlerを呼ばずschema/manifest/軽量JobRef source生成→(3)生成sourceを含むproducer側strict型検査/build→(4)manifest/ref/hash/出力一致確認→署名/配備の順。生成前のproducer importを先に解決しようとする循環を避け、TypeScript project境界を分ける。build/typecheckはproject rootの設定entry（例src/belt.config.ts、build専用--configで明示）をjobs側でstrictコンパイルし、compilerの出力mappingから設定/registryを解決する。これはruntimeコマンドのOS管理JSON --configとは別のtrusted build境界。typecheckコマンドも同じ依存順で必要な一時job build/参照生成を行ってproducer型を検証し、未生成/陳腐化したrefを古いdistで補わない。生成は決定的にし、job payload hashに後から生成するproducer refs/host config/manifest自体を循環的に含めない。

CIは実行codeを読むためtrusted author/配布元だけを使い、productionのRedis/API/PKI/署名秘密鍵を業務moduleの読込phaseへ渡さない。署名phaseは検証済み成果物だけを受ける別の限定権限で行う。top-levelで業務副作用を起こさない規約とするが、任意job authorをsandbox化した保証ではない。

worker側registryの配備だけではcontrollerの登録にならない。manifestを認可付きvalidate/applyで共有Redisへ不変version登録し、desired revision、各controllerのloaded/applied/ready、activeへのactivateを通す。applyはどのready control endpointでも同じoperation ID/expected revisionで実行でき、同job/version/同hashは冪等、異内容は409。controller個別に登録routeを作らず、全台手動applyも不要。有効revision未対応controllerは新規enqueue/dispatchを503にして他の対応済みcontrollerへ委ね、operation照会/既存finishはcontrolReadyの契約を使う。

登録で権限は自動付与しない。新jobはproducerのproject/job/queue/target grantとhost/secret許可の両方を満たす必要があり、CIのapply権限とproducerのenqueue権限は分ける。運用者が承認したproject/対象範囲のpolicy内ならジョブ追加を通常のCI applyで扱えるが、job作者/producerが自分のscopeを拡張しない。共通APIにはproject ID、job definition ID/version/definitionHash、JSON args、許可されたoptionとidempotencyKeyだけを送り、input/result schema全体を要求ごとに押し付けない。

### enqueueの失敗と配備順

未登録/入力違反/定義hash不一致/未active/反映遅延/旧version/対応worker未配備の応答と待機状態は [enqueue応答表](08-api.md#enqueue-responses) を正本とする。SDKは同じ検証と型補完を使い、未知jobを自動登録せず、別versionへ自動変換しない。

rolling job deployは新artifact/registryを不変配置してcapabilityを検証→manifest差分apply/activate→対応JobRefを含むproducerを配備の順を推奨する。旧run/retryに必要なartifact/schema/registryを保持し、workerは広告したversion/hashだけを実行する。job/schema/code/artifact bindingが変わる同一versionを上書きしない。共通bundleのhash変更が既存definition bindingも変える場合は、その定義も新versionにするか固定旧artifactを明示保持し、generatorが無断で再bindしない。refsだけ新しくしてcodeをhot swapしない。

新旧producer/workerの共存はjob versionを明示して行う。framework protocol/compiler/SDK互換性はrelease契約に従い、未検証のframework rolling updateまでjob rollingと同一視しない。ACK消失は同じidempotency/operation IDのreceiptを照合し、blindに新run/effectKeyを発行しない。job retryの待ち/予算・UTC・log/secret境界は変更しない。

<a id="typescript-contract"></a>

### TypeScript 必須の開発・build 契約

belt本体、consoleのsource、利用側のjob/registry/config/jobnet宣言はTypeScriptに統一する。公式SDK/CLI/CIは型チェックを成功させたbuild/manifest/artifactのみを正式経路とする。Nodeが実行するESM JavaScriptや依存libraryの内部言語までTypeScriptへ変換する要件ではない。host管理のsystem commandは別kindとして維持し、TSの型付き定義でargs/result/実行制約を宣言する。任意JSの実行を技術的に完全禁止できるとは保証しない。

必須tsconfig案はstrict=true、noImplicitAny=true、strictNullChecks=true、noUncheckedIndexedAccess=true、exactOptionalPropertyTypes=true、useUnknownInCatchVariables=true、allowJs=false、noEmitOnError=true。strict系flagの個別無効化はCLI/CIの有効設定検査で拒否する。NodeNext等のmodule/targetとcompiler版はD2/P0で固定する。必要なTypeScript compilerと@types/nodeは開発依存であり、runtimeにtranspilerやts-nodeを要求しない。Nodeの型消去実行やtranspile-onlyだけでは型チェック完了としない。

CI/CLIのbuild段階は有効compiler設定検査→jobsのstrict型検査/build→schema/JobRef/manifest生成→producerのstrict型検査/build→成果物一致確認→署名/配備の順とし、失敗時に残った古いdistを署名しない。manifestはsource revision、compiler版/設定hash、型検査を行ったbuild ID、payload hashを結び付ける。trusted CIの署名/provenanceは出所の証拠であり、静的型の正しさやコードの無害性の万能証明ではない。controllerがmanifestの自己申告typechecked=trueだけを信用する仕組みにしない。

Job args/resultは限定JSON schemaを単一の宣言源とし、defineJobがInfer<typeof schema>相当でhandler引数/返値とJobRef<Args, Result>を結び付ける契約。任意generic型だけを指定してschemaと乖離させるAPIは避ける。client.enqueue(jobRef, args)、defineWorkflowのjob参照/node入力はこの型を使い、存在しないfield/誤った型を型エラーにする。型推論で十分な箇所への冗長annotationは強制せず、型安全な契約を必須にする。

MVPの静的jobnetは型付きjob参照と静的args、依存edgeのみ。将来の結果bindingは許可したselectorを使い、upstream resultの型とdownstream argsの割当可能性をbuild時に検査し、JSONへlowerしたselectorとschemaをapply時・実行時にも検証する。任意式/evalや型無しstring pathで安全性を装わず、binding機能自体は後続のまま。外部JSONのjobnetにも同じruntime schemaと参照整合検査を要求する。

noImplicitAnyは明示anyやas/ts-ignore等の迂回を禁止するものではない。job/公開契約でのany、ts-nocheck/ts-ignore、検証なしのas/二重assertionを規約とCI/lintで拒否する。schema宣言のas constはliteral保持であり許可する。必要なlintは監査した開発依存の例外とし、型の抜けを設定一つで完全排除できるとはしない。外部値はunknownからruntime検証し、anyを受信データの入口にしない。

```ts
// 提案APIの型契約例。未実装。jobのschemaからArgs/Resultを推論する。
const node = defineWorkflowNode({ job: summarizeOrder, args: { orderId: 'order-123' } });
// orderId: 123 や resultの未宣言fieldへの参照はCIの型エラーfixtureとする。
```

### schema と型の境界

TS の型はネットワーク上の入力検証にならない。SDK の開発時型チェックに加え、controller は保存済み schema で unknown JSON を検証し、executor も同じ schema/version/hash を検証してから handler を呼ぶ。不一致は実行せず、秘密値を除いた理由を報告する。入力検証はジョブコードを import せず実行できなければならない。

MVP は JSON Schema 形式の限定 subset（object/array/string/number/integer/boolean/null、properties/required/additionalProperties、enum、長さ・件数・数値範囲等）を contracts に実装する提案。正確な対応キーワードと TS 推論範囲を P0 で確定し、未対応 keyword/外部参照を黙って無視しない。完全な JSON Schema 準拠や任意の TS 型からの自動 schema 生成は約束しない。高度な schema が必要なら、標準 validator の依存例外を別途判断する。

Date、class instance、BigInt、関数、循環参照は enqueue しない。型推論が表せない制約は runtime 検証を正とする。直接 HTTP の入力にも同じ検証・上限・認可を適用する。resultSchema も必須の公開契約とし、JSON結果をrunner/受信側で検証してから確定する。

### registry / discovery / manifest

MVP は明示 import の registry を正とする。project/job ID/version の重複を build/startup 時に拒否する。無制限 glob、Redis が指定する module path、remote URL の import、directory 内の全 JS 自動実行は行わない。開発時 discovery は将来の補助であり、採用する場合も build 時に明示 registry/manifest へ固定する。

manifest/JobRef生成はproject buildの正式phaseで、利用側のtrusted build環境だけがcompiled registryを読み、関数を除いたdefinition JSONとartifact ID/hashを生成する。`belt project manifest --project ... --check`は成功buildの生成物/整合を検査する提案CLIで、controller/producerからregistry読込を再実行しない。module 読込は任意の top-level コードを実行し得るため、controller/Web がリクエストに応じてこの処理を実行しない。job module の top-level で副作用を起こさないことを利用側規約とする。bundle hash は compiled JS と固定依存等の immutable payload を対象にし、生成 manifest 自身の hash フィールドやホスト別 config/secret を循環的に含めない。manifest自体は別content hashと、project/version/platform/payload hashを束縛するrelease署名で定義と紐付ける。hashのみを配布元認証とみなさない。署名方式・信頼鍵・失効/改ざん/TOCTOUの境界は [artifact要件](09-security.md#artifact-safety) を満たす。

| 種別 | 内容 | 保存/配備先 |
| --- | --- | --- |
| JobDefinition | project/job ID/version、kind、schema、handler ID、bundle ID/hash、retry/timeout/queue 等 | JSON manifest → 認可済み apply → Redis。不変メタデータ |
| RunInput | orderId 等の JSON、idempotency key、予定時刻・許可された target | enqueue API → Redis。コードや module path は不可 |
| JobBundle / code artifact | compiled JS、利用側の必要な dependencies、registry、manifest、runtime 互換情報 | 利用側 CI/通常の artifact 配備。Redis に業務コード本体を保存しない |

### 起動と同じ bundle の配備

```sh
# 以下も提案 CLI。すべて利用側 project 内のローカル導入済み CLI を使う。
# 信頼したCIで型チェック成功のbuild/manifest生成を完了し、release署名を作成する。
# 提案buildコマンドはtsconfig検査と型チェックを省略不可とする。
./node_modules/.bin/belt project build --project ./tsconfig.json --config ./src/belt.config.ts
# runtimeのadmin/executor JSON、署名信頼鍵、別UID runnerはhost管理者が事前配備する。
./node_modules/.bin/belt project manifest --project ./tsconfig.json --check
./node_modules/.bin/belt definition validate --manifest ./dist/belt.manifest.json
./node_modules/.bin/belt definition apply --config /etc/belt/orders-admin.json --manifest ./dist/belt.manifest.json --signature ./dist/belt.manifest.sig
# desired/applied/readyを確認後、同じ認可経路でexpectedRevision付きactivateする。
# release/revisionは例で、実際はbuild/apply結果の値を使う。
./node_modules/.bin/belt definition activate --config /etc/belt/orders-admin.json --release orders-release-1 --expected-desired-revision 1 --expected-active-revision 0
./node_modules/.bin/belt worker start --config /etc/belt/orders-executor.json
# remote host へ同じ artifact を事前配備・host 登録した後、該当ホストで起動する。
./node_modules/.bin/belt worker start --config /etc/belt/orders-executor.json
```

controllerは専用JSON service configで起動し、job registryを読まない。worker supervisorはmTLSと署名済みメタデータを扱い、OS管理の別UID runnerがsignature/payload hashを検証してからregistryをimportする。そのcapabilityをproject/job/version/bundle hash、protocol version、Node runtimeとして報告する。claim は許可 host と一致する能力だけに配り、未知の bundle や hash 不一致なら起動しない。

同じjobを複数ホストのworkerで動かすときは同じ bundle ID/hash と不変 job version を使用する。native dependency がある場合は target OS/architecture 向けに build し、同じ release の platform artifact hash を manifest に明示する。全 platform で同一バイナリになるとは仮定しない。

artifact の配布は利用側 CI/運用者の通常配備に任せ、belt は任意 npm install/コード download/コード配送サーバーを初期必須にしない。rolling deploy では新 artifact を先に配備・検証し、新 definition version を apply、進行中 run/retry が固定参照する artifact は drain または保持する。不一致で最新版に黙って差し替えない。

### Web console と system command job

Web consoleはloopback/閉域の明示bindと認証を必須にする。登録済み project/job/version を選び、schema に従う引数で起動・監視・retry/cancel する。エディターで JS を書いて Redis に保存し任意実行する仕組みは提供しない。業務コードの変更は利用側 repository と CI 配備を通す。

通常の TypeScript 業務は `kind: node` の job。ホスト上の batch/script/外部ツールを指定ホストで動かす場合は `kind: command` とし、ホスト管理者が事前登録した command ID/argv 制約を使う。MVPのworkerは両kindを実行できるが、command の executable/UID/secret 許可を job registry の登録だけで獲得できない。ホスト側 manifest と controller 認可の両方を要求する。スクリプトは固定interpreter/pathで登録し、stdin/argv/cwd/env/出力/停止を [OS command契約](05-execution.md#os-command-execution) で制約する。OSコマンドの言語までTypeScriptには限定しない。

### 同じ job の単独実行と jobnet での再利用

上記 `summarizeOrder` は SDK からそのまま単独 enqueue できる。同じ job を jobnet に参照として置く場合も、業務関数を複製したり workflow 専用に改造したりしない。利用側の `workflows/` 等で型付きTypeScriptとして別管理し、buildで生成して配布するJSONの案は次のとおり（未実装）。JSONは保存/配信形式であり、型チェック経路を省くauthoring APIにはしない。

```json
{
  "schemaVersion": 1,
  "projectId": "orders",
  "id": "orders.summary-jobnet",
  "version": 1,
  "condition": "allSuccess",
  "failurePolicy": "skipDependents",
  "nodes": [
    {
      "id": "first",
      "job": { "id": "orders.summarize", "version": 1 },
      "args": { "orderId": "order-1" }
    },
    {
      "id": "second",
      "job": { "id": "orders.summarize", "version": 1 },
      "args": { "orderId": "order-2" }
    },
    {
      "id": "after-both",
      "job": { "id": "orders.summarize", "version": 1 },
      "args": { "orderId": "order-3" }
    }
  ],
  "edges": [["first", "after-both"], ["second", "after-both"]]
}
```

`first` と `second` は並列実行可能で、両方成功すると `after-both` を実行する。各 node の結果は WorkflowRun に別々に保存し、失敗時は依存 node を skip、独立 branch は継続する。例の `after-both` は順序制約を示すだけで、先行 result を自動で引数に変換する意味はない。

workflow は validate/apply して `/v1/workflow-runs` または対応 CLI から起動する。起動時に job version と bundle を固定し、node の args をその job の schema で検証する。jobnet からの実行も単独 enqueue と同じ認可・実行先・retry・冪等性の契約を使う。任意結果条件・引数 binding・部分再実行は後続、loop は上限や終了条件を別途決めるまで MVP 外とする。
