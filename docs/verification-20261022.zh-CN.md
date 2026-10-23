# MoonSTOMP 验证与证据记录（2026-10-22）

> 这是 2026-10-22 版 README 的完整验证说明，项目入口见 [README](../README.md)。

用 MoonBit 写的 STOMP 客户端：**无 I/O 的增量编解码 + 会话核心**（命令、订阅、ACK/NACK、事务、receipt、心跳），外加一个 Node TCP 适配器（支持 login/passcode、可校验证书的 TLS、Subscription/Transaction 句柄和带 code 的结构化错误）、一个 `send`/`subscribe` 命令行和七个可一条命令运行的场景示例。
*A sans-I/O STOMP codec and session core written in MoonBit, with a Node TCP adapter (credentials, verified TLS, subscription/transaction handles, structured errors), a send/subscribe CLI and seven one-command demos.*

> **先分清两个版本。** 本仓库含**已发布的 0.1.2（只支持 STOMP 1.2）**和**尚未发布的多版本候选（STOMP 1.0 / 1.1 / 1.2）**。`moon.mod` 仍写 0.1.2，候选没有新版本号；开发基线在 `review/moonbit-20261015-sync` 分支。本次恢复增量由开发分支精确提交及工程包/patch 固定；远端 CI 需对应同一提交另行核验。下表“候选”列说的都是本分支源码，不是 Mooncakes 上的包。

2026-10-22 Linux 复验：JS 核心 **70/70**、私有源码 ZIP 独立消费者 **6/6**、真实 Classic TCP/TLS 三版本矩阵、心跳丢流量超时、receipt 丢失不重发及失败清理通过。普通 Wasm/Wasm GC 的独立控制模块失败，native 缺 runtime，`moon package` 缺 `mooncake`；这次没有完成全后端或正式打包验收。完整命令、环境、退出码与未覆盖项见 [Linux 测试审计](linux-audit-20261022.zh-CN.md)。有限测试不能保证没有 bug。

## 2026-10-20 私有恢复改进与验证边界

以 GitHub `review/moonbit-20261015-sync` 的 `62694580a9c58aec9eb2199e2e1f9685b5e30781` 为基线，新增可配置控制等待上限、receipt 失败上下文、EOF/超时错误码、适配器故障注入单元测试及 Classic TLS runner。**这些改动没有发布到 Mooncakes。** 10 月 20 日及 Linux 审计原始回执中的“未推送”表示当时的私有状态；不能把历史回执日期改成新的测试结果。

续验已通过 MoonBit **官方 Wasm 工具链发行渠道**恢复编译器（0.10.16）与配套构建工具，Apache 官方 broker 归档续传完整且 SHA512 校验一致。本轮 Linux/Node 24.19 的 JS 核心 **70/70**、实际 TCP/TLS 脚本 peer、七个 demo/CLI、Classic 6.3.2 **真实 TLS+认证+三版本事务/断线**检查通过。**这不是历史锁定工具链验收**：当前 Wasm GC 测试失败，独立的常量断言模块也可复现，因此完整 `verify.py --current-toolchain` 仍退出 1。逐项命令和边界见 [恢复说明](recovery-20261020.zh-CN.md)。无需 SDK 可运行：

```sh
node --test scripts/adapter-unit-test.cjs   # 协议/socket 替身下的适配器单元测试，不是 MoonBit/TCP/broker 互通
python3 -m unittest discover -s scripts -p test_classic_profile.py # 只验证 profile 与监听守卫
node examples/error-context.cjs            # 显式模拟错误展示，不连接 broker
```

## 能做什么、不能做什么

| 能力 | 状态 | 证据（命令 / 文件） |
|---|---|---|
| STOMP 1.2 编解码、会话、ACK/NACK、事务、receipt、心跳 | 0.1.2 已发布；候选保留 | `moon test --target js` 与 `moon test --target wasm-gc --package sundaysebasidian-byte/moonstomp`，历史锁定工具链各 70/70；本轮兼容性续验 JS 70/70，Wasm GC 失败，不能当成双后端验收 |
| STOMP 1.0 / 1.1 协商、按版本区分的 ACK 头与版本边界拒绝 | **候选已实现，0.1.2 不支持** | 同上单测；`moon run examples/versions --target js` 对 [expected_output.txt](../examples/versions/expected_output.txt) 逐字节比对 |
| Node TCP 适配器 `transport/tcp.cjs`：`login`/`passcode`/`host`、`tlsOptions`（TLS）、版本可选；`transport/handles.cjs` 的 Subscription / Transaction 句柄；错误带 `code` | 候选已实现 | `python3 scripts/verify.py … --transport`：回环凭据、TLS、句柄、原 10+4+6 生命周期用例（自造 peer，**不是** broker 互通；TLS 见下方边界） |
| 七个场景示例：pub/sub、receipt 可靠发送、手动 ACK/NACK（句柄）、事务（句柄）、心跳、版本协商、认证与错误 | 候选已实现，**跑在内置 demo broker 上** | `python3 scripts/usability-test.py`（输出与 [golden](../examples/demo/expected) 逐字节比对并带变异自检），也是 `verify.py` 的 `demos-and-cli` 阶段 |
| 命令行 `tools/stomp-cli.cjs`（`send` / `subscribe`，1.0/1.1/1.2，事务，ACK/NACK，`--login`/`--passcode-env`，`--tls`） | 候选已实现，仅回环地址（`--allow-remote` 可放开） | `scripts/usability-test.py` 的 CLI/凭据用例；`scripts/cli-tls-test.cjs`（本地脚本 TLS peer）；对 Artemis 的 7 个用例见 `scripts/cli-broker-test.cjs` |
| 真实 broker 互通 | **两个**：Apache Artemis 2.57.0（匿名、无持久化、ANYCAST）+ go-stomp `c155a2d`，STOMP 1.0/1.1/1.2；Apache ActiveMQ Classic 6.3.2（**需要 login/passcode 认证**，仅回环，三个版本的二进制收发、版本化 ACK、事务 SEND commit/abort） | [broker-interop](broker-interop.zh-CN.md)；复现见下文（`verify.py` 的 `real-broker`、`real-broker-classic` 阶段） |

**明确的边界（没做、没测或有已知限制）**

- **Artemis 事务 ACK 不会回滚**：在已记录的 Artemis 2.57.0 profile 下，事务内的 ACK 在 ABORT 后没有被回滚（记录为 `CONFIRMED_BROKER_LIMITATION`）；NACK 表现为丢弃。示例里 NACK 的“重新入队”只是 demo broker 的行为，不代表任何真实 broker。
- **TLS 已在本机脚本 peer 和真实 Classic 6.3.2 回环 profile 上验证**：可信公证书+主机名通过，错误 CA/主机名在 CONNECT 前拒绝，匿名/错误凭据拒绝，三个协议版本收发/事务/断线检查通过。仍未测 mTLS、代理、生产 CA 或生产网络；本轮使用官方 Wasm 编译器兼容工具链，不是历史锁定工具链。
- **没有** WebSocket、自动重连（断线后需要调用者自己重建连接；receipt、订阅恢复与事务重放的语义没有承诺）、持久 outbox、业务重试、exactly-once。
- **没有**纯 MoonBit 的 Subscription/Transaction 高层类型：句柄是 JS 适配器的功能（`transport/handles.cjs`）。1.0 下同一 destination 的多个订阅按 destination 路由，不保证区分。
- **ActiveMQ Classic 只验证了认证、三版本收发、版本化 ACK 和事务 SEND**；Classic 上的事务 ACK、NACK 重投递**没有测**。RabbitMQ 等其他 broker 没测过。
- Node 适配器历史在 v24.18.0、本轮在 Linux v24.19.0 上实测；Wasm GC 历史只验证核心/独立消费，本轮控制测试失败，没有 Wasm 传输层。
- 内置 demo broker 是测试对端，不是产品功能，也不是互通证据。
- 历史在 macOS arm64+锁定工具链实测；本轮新增 Linux x86_64+官方 Wasm 编译器兼容性验证，JS 与 Classic TLS profile 通过、Wasm GC 未通过。候选未跑本轮远端 CI。没有做性能或内存基准。

完整的“已实现 / 已验证 / 拟实现”分栏、验证结果拆分和 go-stomp 逐项对照在 [docs/status-details.zh-CN.md](status-details.zh-CN.md)；与 [go-stomp](https://github.com/go-stomp/stomp) 的逐项对照（依据固定提交 `c155a2d…` 的源码）也在那里。摘要：

| | go-stomp | MoonSTOMP 候选 |
|---|---|---|
| 协议版本 | 1.0 / 1.1 / 1.2 | 1.0 / 1.1 / 1.2 |
| I/O 与定位 | 自带 I/O 与读写循环，另有 STOMP 服务端包 | 无 I/O 的编解码+会话核心，另有 Node TCP 适配器；不做服务端 |
| 登录凭据 | 有 | 有（Node 适配器 `login`/`passcode`/`host`，CLI `--login`/`--passcode-env`；Classic 6.3.2 认证实测） |
| TLS | 库内无 TLS 代码，需调用者传入已加密连接 | 有（`tlsOptions`，强制校验证书；本机脚本 peer 与真实 Classic 6.3.2 TLS profile 已验证；未测生产网络） |
| 自动重连 | 没有 | 没有 |
| 运行时 | Go | MoonBit（当前 Linux JS 通过；Wasm GC 本轮失败；TCP 适配器仅 Node） |

MoonSTOMP 不是 go-stomp 的功能等价物：没有服务端、没有重连、没有纯 MoonBit 句柄层，且 TLS 仅验证一个真实 broker 回环 profile；互通测试中 go-stomp 的公共 API 被用作真实对端。边界与失败行为见 [docs/boundaries.zh-CN.md](boundaries.zh-CN.md)。

## 获取候选

历史已发布的 `moon add sundaysebasidian-byte/moonstomp@0.1.2` 仅支持 STOMP 1.2。审阅候选使用专用开发分支，取得后将 HEAD 与交付回执中的精确提交核对，不能把默认分支或将来移动后的分支头当作此次已测候选：

```sh
git clone --branch review/moonbit-20261015-sync --single-branch https://github.com/sundaysebasidian-byte/moonstomp.git
cd moonstomp
git rev-parse HEAD                       # 应等于本次交付回执的 candidate SHA
```

另一种重建方法是在干净的基线 `62694580a9c58aec9eb2199e2e1f9685b5e30781` 副本中，先 `git apply --check /path/to/moonstomp-recovery.patch` 再 `git apply /path/to/moonstomp-recovery.patch`。不要在已经含本次增量的分支上重复应用。

私有恢复源码 ZIP 已包含 patch 的改动，不要重复应用。从同一 Library 附件取得最新版后，在新的目录解压（外层日期是文件身份，不代表最新版日期）：

```sh
unzip moonstomp-private-recovery-20261020.zip -d moonstomp-candidate
cd moonstomp-candidate/moonstomp-private-recovery-20261020/source/moonstomp
```

`source/moonstomp` 是完整源码；`evidence/test-results.json` 指向最新回执，外层 `SHA256SUMS` 固定每个文件。附件不是正式 Mooncakes 包，没有打包 SDK、broker 或预构建 bridge。上游基线与私有修改、历史通过与本次未运行的测试分别记录。

## 快速上手（已有 SDK，无需外部 broker）

**前置条件**

| 要做什么 | 需要 |
|---|---|
| 跑本次 Linux JS 示例和命令行 | 已有可运行的 SDK：本轮 `moonc 0.10.16+b1a0e846e`、`moon/moonrun 0.1.20261020 (6691f18)`，Node 24.19.0；不需要 npm 安装或账户 |
| 跑 Python 检查、真实 Classic 场景 | 本轮 Python 3.12.14；真实 broker 另需官方已校验 Classic 6.3.2、现有 JDK/keytool、lsof；未打包这些组件 |
| 历史锁定工具链 | [toolchain.lock.json](../toolchain.lock.json) 记录 macOS arm64 的 0.10.14 / Node 24.18；保留历史，不冒充本次 Linux 全后端验收 |

SDK 安装渠道见 [MoonBit 官方下载说明](https://www.moonbitlang.com/download/)，优先使用完整官方发行物并核验官方校验和。本工作区的完整 SDK 下载曾返回 HTTP403；官方 GitHub Wasm 发行物只恢复了本轮 JS 路径，仍缺 native runtime 和打包用 `mooncake`。本包不带自动安装脚本，不保证在任意新机器上无前提安装。先确认 `moon version --all`、`node --version` 可运行；不要把编译器版本不同或 `moon package` 失败记为通过。

```sh
# 已在上方解压后的 source/moonstomp 目录；先确认 SDK 已安装且在 PATH
moon version --all
node --version
moon build --target js -j 1               # 从本包源码生成 bridge
node tools/stomp-cli.cjs demo             # 进程内测试 broker，发一条再收一条
# 预期：demo: in-process demo broker on 127.0.0.1:<端口> (a test peer, not a real broker)
#       sent destination=/queue/demo bytes=20 receipt=confirmed
#       message destination=/queue/demo body="hello from MoonSTOMP"
#       demo: ok
node examples/demo/01-pubsub.cjs          # 预期最后一行：PASS pubsub
```

这条路径只验证本包的 JS 示例。需要验证公共 MoonBit API 的独立消费时，使用 [干净消费者的文档命令](../validation/consumer/README.md)；这与受阻的正式 `moon package` / registry 安装分开报告。

| 当前 Linux 路径 | 本次结论 |
|---|---|
| JS 核心 / Node TCP、TLS / 私有源码消费者 | 通过；具体版本和范围见审计 |
| Wasm GC / 普通 Wasm 核心 | 独立常量控制模块失败；不列为本次已验证支持 |
| native 核心 | 缺 SDK runtime，未完成项目运行 |
| `moon package` / 新候选 registry 安装 | 缺 `mooncake`；新候选未发布，不用历史 0.1.2 包代替 |

连接被拒（broker 没启动）时，CLI 和示例会说明下一步该做什么，而不是只给 `ECONNREFUSED`。

每个示例一条命令，退出码 0 表示通过，输出与 `examples/demo/expected/` 逐字节一致：

| 场景 | 命令 | 预期最后一行 |
|---|---|---|
| 发布/订阅（queue 与 topic） | `node examples/demo/01-pubsub.cjs` | `PASS pubsub` |
| receipt 可靠发送 | `node examples/demo/02-reliable-send.cjs` | `PASS reliable-send` |
| 手动 ACK / NACK（Subscription 句柄） | `node examples/demo/03-ack-nack.cjs` | `PASS ack-nack` |
| 事务 commit / abort（Transaction 句柄） | `node examples/demo/04-transaction.cjs` | `PASS transaction` |
| 心跳与断线检测 | `node examples/demo/05-heartbeat.cjs` | `PASS heartbeat` |
| 1.0 / 1.1 / 1.2 协商 | `node examples/demo/06-versions.cjs` | `PASS versions` |
| 认证与错误：匿名/错误口令被拒、正确凭据通过，错误带 `code` 且不含口令 | `node examples/demo/07-auth-errors.cjs` | `PASS auth-errors` |

示例自动在回环地址起一个内置 demo broker。想手动试 CLI，开两个终端：

```sh
# 终端 1
node tools/demo-broker.cjs --port 61613
# 终端 2（subscribe 也可写作 listen）
node tools/stomp-cli.cjs subscribe --port 61613 --destination /queue/jobs --count 1 &
node tools/stomp-cli.cjs send      --port 61613 --destination /queue/jobs --body hello
# send 默认等待 receipt；预期：sent destination=/queue/jobs bytes=5 receipt=confirmed
#       message destination=/queue/jobs body="hello"
```

带认证的 broker：用环境变量传口令（命令行参数对本机其他用户可见）。demo broker 也可以要求凭据，用来在本机试认证路径：

```sh
export DEMO_PASS=s3cret
node tools/demo-broker.cjs --port 61613 --login alice --passcode "$DEMO_PASS" &   # demo broker 只接受 --passcode（本机测试用口令）
node tools/stomp-cli.cjs send --port 61613 --destination /queue/jobs --body hi --login alice --passcode-env DEMO_PASS
# 缺凭据或口令错误：退出码 1，stderr 为 MoonSTOMPBrokerError code=STOMP_BROKER_ERROR，broker 的原因被引号括起来显示，口令不会出现在输出里
```

TLS：`--tls`（可加 `--tls-ca FILE`、`--tls-servername NAME`），证书校验始终开启，没有关闭校验的开关；带登录的非回环连接必须配 `--tls`。CLI TLS 在本机脚本 peer 上验证；底层 TcpClient TLS 另有真实 Classic 6.3.2 回环 profile 证据，不代表 CLI 对真实 TLS broker 的独立验收。

CLI 退出码：0 成功，1 失败（连不上、超时、broker 拒绝），2 用法错误。完整用法、`TcpClient` 速查和各版本 ACK 头见 [docs/guide.zh-CN.md](guide.zh-CN.md)。

## 全部检查一条命令

```sh
python3 scripts/verify.py --output ../moonstomp-verification   # 输出目录必须是新的、且在源码树之外
```

脚本检查固定工具版本，串行执行检查、构建、JS/Wasm GC 单测、离线示例、七个 demo 与 CLI（含凭据、TLS）、JS 边界、独立差分和下游包消费，并把命令、退出码、日志和源码 SHA256 写入输出目录。它不下载软件，默认不连接真实 broker。追加 `--transport` 运行自造回环 peer 的生命周期、凭据、TLS 和句柄测试。

## 三分钟真实演示（一条命令）

已有官方已校验的 Classic 6.3.2、Java/keytool、lsof、Node/Python，且已 `moon build --target js` 后：

```sh
python3 scripts/classic-run.py --home /path/to/apache-activemq-6.3.2 \
  --java-home /path/to/jdk --output ../moonstomp-demo-evidence --port 62616 --tls --demo
```

它只跑一个 STOMP 1.2 场景：校验 TLS/拒绝错口令 → 事务 COMMIT 与 ABORT → 回环 TLS 中继丢弃一条真实 broker RECEIPT。观察方收到消息，发送方报告结果未知并关闭；断言连接/SEND/丢弃计数各一次，没有自动重发。实测约 3.9 秒，包含启动与清理。输出不含测试凭据，Wasm GC 的既有失败保持可见；不重跑三版本矩阵，也不代表全量验收。准备条件、三分钟讲法、有界断言与失败清理见 [演示说明](recovery-20261020.zh-CN.md#三分钟真实演示与交付)。

## 真实 broker 复现

被验证过的真实 broker 有两个。脚本只做校验，不会联网下载，只绑定回环端口。

**Artemis 2.57.0 + go-stomp**（需要你已有：官方发行包及其 SHA512、Java 17、固定提交的 go-stomp 构建出的 peer）：

```sh
python3 scripts/verify.py --output ../moonstomp-verification-broker \
  --broker-archive /path/to/apache-artemis-2.57.0-bin.tar.gz \
  --broker-checksum /path/to/apache-artemis-2.57.0-bin.tar.gz.sha512 \
  --broker-java-home /path/to/jdk17 \
  --go-peer /path/to/go-peer --broker-port 62613
```

它会启动 Artemis（匿名），运行三个真实 broker 示例（`examples/1-tasks.cjs`、`2-reliable.cjs`、`3-transactions.cjs`）、补充检查、go-stomp 互通和 7 个 CLI 用例，然后关闭 broker 并核对端口已释放。

**ActiveMQ Classic 6.3.2（认证）**：在上面的命令上追加三个参数，会额外跑 `real-broker-classic` 阶段（需要你已解压的官方 Classic 6.3.2 发行目录和 Java 17；`scripts/classic-run.py` 只运行你给的目录，不下载。官方归档 SHA256 为 `543e9ca8a234d118a8c195d802a110994a59b7973d75ae0a7ccd47dc2cc2c5c1`，它是在 `core-20261020` 交付中下载并与官方 SHA512 核对的，不在本仓库内）：

```sh
  --classic-home /path/to/apache-activemq-6.3.2 \
  --classic-java-home /path/to/jdk17 --classic-port 62614
```

阶段内容（`scripts/classic-interop-test.cjs`）：用测试账号认证，错误口令被拒；1.0/1.1/1.2 各一次二进制收发；版本化 ACK；事务 SEND 的 commit 与 abort；关闭 receipt。Classic 的事务 ACK 和 NACK 重投递没有测。

**Classic TLS 验证入口（本轮已通过，限回环测试 profile）**：官方归档经校验解压、SDK 构建 bridge 后，运行：

```sh
python3 scripts/classic-run.py --home /path/to/apache-activemq-6.3.2 \
  --java-home /path/to/jdk --output ../classic-tls-evidence --port 62615 --tls
# 或 verify.py 的 Classic 参数同时追加 --classic-tls
```

仅一个回环 `stomp+ssl` 监听，生成两天有效的临时 localhost 测试证书，校验 CA/主机名，测试认证和三版本二进制收发、ACK、事务 SEND 提交/中止及 COMMIT 前断线不重放。结束后删除临时私钥，保留公证书和日志。未测 mTLS、生产 CA、事务 ACK 回滚。runner 需要 Java/keytool、lsof、Node 与预先构建的 bridge，不自动下载安装依赖。

两个 broker 的下载地址、校验值和 go-peer 构建方法见 [docs/broker-plan.zh-CN.md](broker-plan.zh-CN.md)，已测 profile 与限制见 [docs/broker-interop.zh-CN.md](broker-interop.zh-CN.md)。**本项目没有验证过任何 Docker 镜像**，所以不提供 Docker 路径。

## 代码布局

| 层 | 文件 | 责任 |
|---|---|---|
| 帧与 codec | `frame.mbt` `headers.mbt` `decoder.mbt` | 字节、header、正文、增量语法与致命错误 |
| 会话与时钟 | `client.mbt` `heartbeat.mbt` `api.mbt` `version.mbt` | 命令、订阅、事务、ACK、receipt、版本协商与单调毫秒时间 |
| JS 边界 | `bridge/main.mbt` | JSON header/事件与字节正文边界 |
| Node TCP | `transport/tcp.cjs` | `net` 连接、有限等待/缓存、关闭 |
| 工具与示例 | `tools/` `examples/` | demo broker、CLI、场景示例 |

默认限制：单行 8192 字节、128 个 header、1 MiB 正文、每次 feed 1024 事件，可经 `Limits::new()` 调整。在 MoonBit 中直接使用核心的例子见 [examples/offline/main.mbt](../examples/offline/main.mbt)，公共 API 见 `pkg.generated.mbti`。0.1.2 的发布细节见 [发布记录](publication-0.1.2.zh-CN.md)，安装已发布版本：`moon add sundaysebasidian-byte/moonstomp@0.1.2`（仅 1.2）。

## 许可与 AI 使用

原创代码 MIT（[LICENSE](../LICENSE)）；参考测试文件 Apache-2.0，STOMP 规范 CC BY 3.0，来源与范围见 [docs/reference.zh-CN.md](reference.zh-CN.md)。AI 辅助事实见 [AI_USAGE.md](../AI_USAGE.md)。[Proposal.md](../Proposal.md) 是技术参考，不是符合人工撰写要求的报名材料。
