# MoonSTOMP

用 MoonBit 写的 STOMP 客户端：**无 I/O 的增量编解码 + 会话核心**（命令、订阅、ACK/NACK、事务、receipt、心跳），外加一个 Node TCP 适配器、一个 `send`/`subscribe` 命令行和六个可一条命令运行的场景示例。
*A sans-I/O STOMP codec and session core written in MoonBit, with a Node TCP adapter, a send/subscribe CLI and six one-command demos.*

> **先分清两个版本。** 本仓库含**已发布的 0.1.2（只支持 STOMP 1.2）**和**尚未发布的多版本候选（STOMP 1.0 / 1.1 / 1.2）**。`moon.mod` 仍写 0.1.2，候选没有新版本号，没有推送，没有远端 CI。下表“候选”列说的都是本分支源码，不是 Mooncakes 上的包。

## 能做什么、不能做什么

| 能力 | 状态 | 证据（命令 / 文件） |
|---|---|---|
| STOMP 1.2 编解码、会话、ACK/NACK、事务、receipt、心跳 | 0.1.2 已发布；候选保留 | `moon test --target js` 与 `moon test --target wasm-gc --package sundaysebasidian-byte/moonstomp`，各 68/68（候选，本地） |
| STOMP 1.0 / 1.1 协商、按版本区分的 ACK 头与版本边界拒绝 | **候选已实现，0.1.2 不支持** | 同上单测；`moon run examples/versions --target js` 对 [expected_output.txt](examples/versions/expected_output.txt) 逐字节比对 |
| Node TCP 适配器 `transport/tcp.cjs`（匿名连接，版本可选） | 候选已实现 | `python3 scripts/verify.py … --transport`（自造回环 peer，**不是** broker 互通） |
| 六个场景示例：pub/sub、receipt 可靠发送、手动 ACK/NACK、事务、心跳、版本协商 | 候选已实现，**跑在内置 demo broker 上** | `python3 scripts/usability-test.py`（输出与 [golden](examples/demo/expected) 逐字节比对并带变异自检），也是 `verify.py` 的 `demos-and-cli` 阶段 |
| 命令行 `tools/stomp-cli.cjs`（`send` / `subscribe`，1.0/1.1/1.2，事务，ACK/NACK） | 候选已实现，仅回环地址（`--allow-remote` 可放开） | 同上脚本里的 CLI 用例；对 Artemis 的 7 个用例见 `scripts/cli-broker-test.cjs` |
| 真实 broker 互通 | **只验证了** Apache Artemis 2.57.0（匿名、无持久化、ANYCAST）+ go-stomp `c155a2d`，STOMP 1.0/1.1/1.2 | [broker-interop](docs/broker-interop.zh-CN.md)；复现见下文 |

**明确的边界（没做、没测或有已知限制）**

- **Artemis 事务 ACK 不会回滚**：在已记录的 Artemis 2.57.0 profile 下，事务内的 ACK 在 ABORT 后没有被回滚（记录为 `CONFIRMED_BROKER_LIMITATION`）；NACK 表现为丢弃。示例里 NACK 的“重新入队”只是 demo broker 的行为，不代表任何真实 broker。
- **没有** TLS、WebSocket、自动重连、持久 outbox、业务重试、exactly-once。
- **没有** login/passcode 的便利连接（通用 `Frame` 可带认证头，但没有认证测试）；**没有**在 Artemis 之外的 broker（RabbitMQ、ActiveMQ 等）上测过。
- Node 适配器只在 Node（锁定 v24.18.0）上用；Wasm GC 目标只跑核心单测，没有 Wasm 传输层。
- 内置 demo broker 是测试对端，不是产品功能，也不是互通证据。
- 只在 macOS arm64 + 锁定工具链上本地实测；候选未跑远端 CI；其他系统与工具版本未实测。

完整的“已实现 / 已验证 / 拟实现”分栏、验证结果拆分和 go-stomp 逐项对照在 [docs/status-details.zh-CN.md](docs/status-details.zh-CN.md)；与 [go-stomp](https://github.com/go-stomp/stomp) 的对照也在那里（MoonSTOMP 不是 go-stomp 的功能等价物：它没有自己的 I/O 循环，也没有服务端和 TLS 选项）。边界与失败行为见 [docs/boundaries.zh-CN.md](docs/boundaries.zh-CN.md)。

## 30 秒上手（不需要 broker，不下载任何东西）

需要已安装的 MoonBit 工具链（版本见 [toolchain.lock.json](toolchain.lock.json)：`moonc v0.10.14+7d59c7ec9`、`moon 0.1.20260920`）和 Node（已验证 v24.18.0）。

```sh
git clone https://github.com/sundaysebasidian-byte/moonstomp && cd moonstomp
moon build --target js                    # 生成 Node 适配器要用的 bridge
node examples/demo/01-pubsub.cjs          # 预期最后一行：PASS pubsub
```

每个示例一条命令，退出码 0 表示通过，输出与 `examples/demo/expected/` 逐字节一致：

| 场景 | 命令 | 预期最后一行 |
|---|---|---|
| 发布/订阅（queue 与 topic） | `node examples/demo/01-pubsub.cjs` | `PASS pubsub` |
| receipt 可靠发送 | `node examples/demo/02-reliable-send.cjs` | `PASS reliable-send` |
| 手动 ACK / NACK | `node examples/demo/03-ack-nack.cjs` | `PASS ack-nack` |
| 事务 commit / abort | `node examples/demo/04-transaction.cjs` | `PASS transaction` |
| 心跳与断线检测 | `node examples/demo/05-heartbeat.cjs` | `PASS heartbeat` |
| 1.0 / 1.1 / 1.2 协商 | `node examples/demo/06-versions.cjs` | `PASS versions` |

示例自动在回环地址起一个内置 demo broker。想手动试 CLI，开两个终端：

```sh
# 终端 1
node tools/demo-broker.cjs --port 61613
# 终端 2
node tools/stomp-cli.cjs subscribe --port 61613 --destination /queue/jobs --count 1 &
node tools/stomp-cli.cjs send      --port 61613 --destination /queue/jobs --body hello
# send 默认等待 receipt；预期：sent destination=/queue/jobs bytes=5 receipt=confirmed
#       message destination=/queue/jobs body="hello"
```

CLI 退出码：0 成功，1 失败（连不上、超时、broker 拒绝），2 用法错误。完整用法、`TcpClient` 速查和各版本 ACK 头见 [docs/guide.zh-CN.md](docs/guide.zh-CN.md)。

## 全部检查一条命令

```sh
python3 scripts/verify.py --output ../moonstomp-verification   # 输出目录必须是新的、且在源码树之外
```

脚本检查固定工具版本，串行执行检查、构建、JS/Wasm GC 单测、离线示例、六个 demo 与 CLI、JS 边界、独立差分和下游包消费，并把命令、退出码、日志和源码 SHA256 写入输出目录。它不下载软件，默认不连接真实 broker。追加 `--transport` 运行自造回环 peer 的生命周期/超时测试。

## 真实 broker 复现

只有这条路径被验证过（需要你已有：官方 Artemis 2.57.0 发行包及其 SHA512、Java 17、固定提交的 go-stomp 构建出的 peer；脚本只做校验，不会联网下载，只绑定回环端口）：

```sh
python3 scripts/verify.py --output ../moonstomp-verification-broker \
  --broker-archive /path/to/apache-artemis-2.57.0-bin.tar.gz \
  --broker-checksum /path/to/apache-artemis-2.57.0-bin.tar.gz.sha512 \
  --broker-java-home /path/to/jdk17 \
  --go-peer /path/to/go-peer --broker-port 62613
```

它会启动 Artemis，运行三个真实 broker 示例（`examples/1-tasks.cjs`、`2-reliable.cjs`、`3-transactions.cjs`）、补充检查、go-stomp 互通和 7 个 CLI 用例，然后关闭 broker 并核对端口已释放。下载地址、校验值和 go-peer 构建方法见 [docs/broker-plan.zh-CN.md](docs/broker-plan.zh-CN.md)，已测 profile 与限制见 [docs/broker-interop.zh-CN.md](docs/broker-interop.zh-CN.md)。**本项目没有验证过任何 Docker 镜像**，所以不提供 Docker 路径。

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
