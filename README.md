# MoonSTOMP

用 MoonBit 写的 STOMP 客户端：**无 I/O 的增量编解码 + 会话核心**（命令、订阅、ACK/NACK、事务、receipt、心跳），外加一个 Node TCP 适配器（支持 login/passcode、可校验证书的 TLS、Subscription/Transaction 句柄和带 code 的结构化错误）、一个 `send`/`subscribe` 命令行和七个可一条命令运行的场景示例。
*A sans-I/O STOMP codec and session core written in MoonBit, with a Node TCP adapter (credentials, verified TLS, subscription/transaction handles, structured errors), a send/subscribe CLI and seven one-command demos.*

> **先分清两个版本。** 本仓库含**已发布的 0.1.2（只支持 STOMP 1.2）**和**尚未发布的多版本候选（STOMP 1.0 / 1.1 / 1.2）**。`moon.mod` 仍写 0.1.2，候选没有新版本号，没有推送，没有远端 CI。下表“候选”列说的都是本分支源码，不是 Mooncakes 上的包。

## 能做什么、不能做什么

| 能力 | 状态 | 证据（命令 / 文件） |
|---|---|---|
| STOMP 1.2 编解码、会话、ACK/NACK、事务、receipt、心跳 | 0.1.2 已发布；候选保留 | `moon test --target js` 与 `moon test --target wasm-gc --package sundaysebasidian-byte/moonstomp`，各 70/70（候选，本地；`verify.py` 的 `test-js` / `test-wasm-gc` 阶段） |
| STOMP 1.0 / 1.1 协商、按版本区分的 ACK 头与版本边界拒绝 | **候选已实现，0.1.2 不支持** | 同上单测；`moon run examples/versions --target js` 对 [expected_output.txt](examples/versions/expected_output.txt) 逐字节比对 |
| Node TCP 适配器 `transport/tcp.cjs`：`login`/`passcode`/`host`、`tlsOptions`（TLS）、版本可选；`transport/handles.cjs` 的 Subscription / Transaction 句柄；错误带 `code` | 候选已实现 | `python3 scripts/verify.py … --transport`：回环凭据、TLS、句柄、原 10+4+6 生命周期用例（自造 peer，**不是** broker 互通；TLS 见下方边界） |
| 七个场景示例：pub/sub、receipt 可靠发送、手动 ACK/NACK（句柄）、事务（句柄）、心跳、版本协商、认证与错误 | 候选已实现，**跑在内置 demo broker 上** | `python3 scripts/usability-test.py`（输出与 [golden](examples/demo/expected) 逐字节比对并带变异自检），也是 `verify.py` 的 `demos-and-cli` 阶段 |
| 命令行 `tools/stomp-cli.cjs`（`send` / `subscribe`，1.0/1.1/1.2，事务，ACK/NACK，`--login`/`--passcode-env`，`--tls`） | 候选已实现，仅回环地址（`--allow-remote` 可放开） | `scripts/usability-test.py` 的 CLI/凭据用例；`scripts/cli-tls-test.cjs`（本地脚本 TLS peer）；对 Artemis 的 7 个用例见 `scripts/cli-broker-test.cjs` |
| 真实 broker 互通 | **两个**：Apache Artemis 2.57.0（匿名、无持久化、ANYCAST）+ go-stomp `c155a2d`，STOMP 1.0/1.1/1.2；Apache ActiveMQ Classic 6.3.2（**需要 login/passcode 认证**，仅回环，三个版本的二进制收发、版本化 ACK、事务 SEND commit/abort） | [broker-interop](docs/broker-interop.zh-CN.md)；复现见下文（`verify.py` 的 `real-broker`、`real-broker-classic` 阶段） |

**明确的边界（没做、没测或有已知限制）**

- **Artemis 事务 ACK 不会回滚**：在已记录的 Artemis 2.57.0 profile 下，事务内的 ACK 在 ABORT 后没有被回滚（记录为 `CONFIRMED_BROKER_LIMITATION`）；NACK 表现为丢弃。示例里 NACK 的“重新入队”只是 demo broker 的行为，不代表任何真实 broker。
- **TLS 只在本机脚本 peer 上验证过**（`tlsOptions` 走 Node 标准 TLS，必须校验证书，`rejectUnauthorized:false` 被拒绝；`scripts/tls-transport-test.cjs`、`scripts/cli-tls-test.cjs`：可信 CA + 正确主机名成功，不受信 CA / 错误主机名在发出 CONNECT 前被拒）。**没有**对任何真实 broker 做过 TLS 互通，也没测 mTLS、代理、生产网络。
- **没有** WebSocket、自动重连（断线后需要调用者自己重建连接；receipt、订阅恢复与事务重放的语义没有承诺）、持久 outbox、业务重试、exactly-once。
- **没有**纯 MoonBit 的 Subscription/Transaction 高层类型：句柄是 JS 适配器的功能（`transport/handles.cjs`）。1.0 下同一 destination 的多个订阅按 destination 路由，不保证区分。
- **ActiveMQ Classic 只验证了认证、三版本收发、版本化 ACK 和事务 SEND**；Classic 上的事务 ACK、NACK 重投递**没有测**。RabbitMQ 等其他 broker 没测过。
- Node 适配器只在 Node（锁定 v24.18.0）上用；Wasm GC 目标只跑核心单测，没有 Wasm 传输层。
- 内置 demo broker 是测试对端，不是产品功能，也不是互通证据。
- 只在 macOS arm64 + 锁定工具链上本地实测；候选未跑远端 CI；其他系统与工具版本未实测。没有做性能或内存基准。

完整的“已实现 / 已验证 / 拟实现”分栏、验证结果拆分和 go-stomp 逐项对照在 [docs/status-details.zh-CN.md](docs/status-details.zh-CN.md)；与 [go-stomp](https://github.com/go-stomp/stomp) 的逐项对照（依据固定提交 `c155a2d…` 的源码）也在那里。摘要：

| | go-stomp | MoonSTOMP 候选 |
|---|---|---|
| 协议版本 | 1.0 / 1.1 / 1.2 | 1.0 / 1.1 / 1.2 |
| I/O 与定位 | 自带 I/O 与读写循环，另有 STOMP 服务端包 | 无 I/O 的编解码+会话核心，另有 Node TCP 适配器；不做服务端 |
| 登录凭据 | 有 | 有（Node 适配器 `login`/`passcode`/`host`，CLI `--login`/`--passcode-env`；Classic 6.3.2 认证实测） |
| TLS | 库内无 TLS 代码，需调用者传入已加密连接 | 有（`tlsOptions`，强制校验证书；**只在本机脚本 peer 上验证**，没有真实 broker TLS 测试） |
| 自动重连 | 没有 | 没有 |
| 运行时 | Go | MoonBit（JS / Wasm GC 单测；TCP 适配器仅 Node） |

MoonSTOMP 不是 go-stomp 的功能等价物：没有服务端、没有重连、没有纯 MoonBit 句柄层，且 TLS 证据弱于“真实 broker”；互通测试中 go-stomp 的公共 API 被用作真实对端。边界与失败行为见 [docs/boundaries.zh-CN.md](docs/boundaries.zh-CN.md)。

## 30 秒上手（不需要 broker，不下载任何东西）

**前置条件**

| 要做什么 | 需要 |
|---|---|
| 跑示例和命令行 | 已安装的 MoonBit 工具链（`moonc v0.10.14+7d59c7ec9`、`moon 0.1.20260920`，见 [toolchain.lock.json](toolchain.lock.json)）+ Node（已验证 v24.18.0）。不需要 Python |
| 跑 `scripts/usability-test.py` | Python 3（在 3.9 和 3.14 上实测通过） |
| 跑 `scripts/verify.py`（全量验证） | Python 3.9 或更新（`scripts/downstream.py` 在没有 `tomllib` 时用受限的身份字段解析；在 macOS 自带 `/usr/bin/python3` 3.9.6 上做过完整验收，`scripts/test_python_compat.py` 在 3.9 / 3.14 上通过） |

```sh
cd moonstomp                              # 含 moon.mod 的本分支源码根目录（候选未推送，不在 GitHub 默认分支上）
moon build --target js                    # 生成 Node 适配器要用的 bridge；忘了这步会得到一行提示
node tools/stomp-cli.cjs demo             # 无需任何 broker：进程内起测试 broker，发一条再收一条，约 0.1 秒
# 预期：demo: in-process demo broker on 127.0.0.1:<端口> (a test peer, not a real broker)
#       sent destination=/queue/demo bytes=20 receipt=confirmed
#       message destination=/queue/demo body="hello from MoonSTOMP"
#       demo: ok
node examples/demo/01-pubsub.cjs          # 预期最后一行：PASS pubsub
```

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

TLS：`--tls`（可加 `--tls-ca FILE`、`--tls-servername NAME`），证书校验始终开启，没有关闭校验的开关；带登录的非回环连接必须配 `--tls`。这条路径只在本机脚本 peer 上验证过（`node scripts/cli-tls-test.cjs`，不是真实 broker）。

CLI 退出码：0 成功，1 失败（连不上、超时、broker 拒绝），2 用法错误。完整用法、`TcpClient` 速查和各版本 ACK 头见 [docs/guide.zh-CN.md](docs/guide.zh-CN.md)。

## 全部检查一条命令

```sh
python3 scripts/verify.py --output ../moonstomp-verification   # 输出目录必须是新的、且在源码树之外
```

脚本检查固定工具版本，串行执行检查、构建、JS/Wasm GC 单测、离线示例、七个 demo 与 CLI（含凭据、TLS）、JS 边界、独立差分和下游包消费，并把命令、退出码、日志和源码 SHA256 写入输出目录。它不下载软件，默认不连接真实 broker。追加 `--transport` 运行自造回环 peer 的生命周期、凭据、TLS 和句柄测试。

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

两个 broker 的下载地址、校验值和 go-peer 构建方法见 [docs/broker-plan.zh-CN.md](docs/broker-plan.zh-CN.md)，已测 profile 与限制见 [docs/broker-interop.zh-CN.md](docs/broker-interop.zh-CN.md)。**本项目没有验证过任何 Docker 镜像**，所以不提供 Docker 路径。

## 代码布局

| 层 | 文件 | 责任 |
|---|---|---|
| 帧与 codec | `frame.mbt` `headers.mbt` `decoder.mbt` | 字节、header、正文、增量语法与致命错误 |
| 会话与时钟 | `client.mbt` `heartbeat.mbt` `api.mbt` `version.mbt` | 命令、订阅、事务、ACK、receipt、版本协商与单调毫秒时间 |
| JS 边界 | `bridge/main.mbt` | JSON header/事件与字节正文边界 |
| Node TCP | `transport/tcp.cjs` | `net` 连接、有限等待/缓存、关闭 |
| 工具与示例 | `tools/` `examples/` | demo broker、CLI、场景示例 |

默认限制：单行 8192 字节、128 个 header、1 MiB 正文、每次 feed 1024 事件，可经 `Limits::new()` 调整。在 MoonBit 中直接使用核心的例子见 [examples/offline/main.mbt](examples/offline/main.mbt)，公共 API 见 `pkg.generated.mbti`。0.1.2 的发布细节见 [发布记录](docs/publication-0.1.2.zh-CN.md)，安装已发布版本：`moon add sundaysebasidian-byte/moonstomp@0.1.2`（仅 1.2）。

## 许可与 AI 使用

原创代码 MIT（[LICENSE](LICENSE)）；参考测试文件 Apache-2.0，STOMP 规范 CC BY 3.0，来源与范围见 [docs/reference.zh-CN.md](docs/reference.zh-CN.md)。AI 辅助事实见 [AI_USAGE.md](AI_USAGE.md)。[Proposal.md](Proposal.md) 是技术参考，不是符合人工撰写要求的报名材料。
