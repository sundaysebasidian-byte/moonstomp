# MoonSTOMP

[![CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/workflows/ci.yml/badge.svg)](https://github.com/sundaysebasidian-byte/moonstomp/actions/workflows/ci.yml)
[![Fresh clone](https://github.com/sundaysebasidian-byte/moonstomp/actions/workflows/fresh-clone.yml/badge.svg)](https://github.com/sundaysebasidian-byte/moonstomp/actions/workflows/fresh-clone.yml)
[![RabbitMQ](https://github.com/sundaysebasidian-byte/moonstomp/actions/workflows/rabbitmq.yml/badge.svg)](https://github.com/sundaysebasidian-byte/moonstomp/actions/workflows/rabbitmq.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

MoonBit STOMP 协议核心与 Node.js 客户端工具：**sans-I/O 增量编解码与会话状态机**，支持 STOMP 1.0 / 1.1 / 1.2，并已和 Apache Artemis、ActiveMQ Classic、RabbitMQ 三个真实 broker 互通。

MoonBit 核心接收字节，输出待发送字节和事件，维护协议会话；Node 适配器负责 socket 和时钟。仓库提供 Node TCP/TLS 适配器、`send` / `subscribe` 命令行及可运行示例。

**0.3.1 已发布到 mooncakes**，含有界异步 SEND 和心跳修复，版本说明见 [release-0.3.1](docs/release-0.3.1.zh-CN.md)，验证入口见[技术证据索引](docs/TECHNICAL_EVIDENCE.zh-CN.md)。

## 2026-10-30 源码分支源码（非默认分支）

本源码用于 `review/moonbit-20261030` 源码分支，尚未发布新的 Mooncakes 版本，不代表默认分支或新 release。此目录基于公开提交 `0e60fe353127260da105e82ccd683bfda535b27c`，新增同事务累计确认修复、回归矩阵与真实 Classic 验证。**不能通过安装旧 0.3.1 获取本次修复**；下文旧发包和 CI 记录仅属于其原版本。本源码四后端各 79/79，Classic 6.3.2 TLS 新增 14 场景通过，详情见[逐项回应](docs/review-response-20261030.zh-CN.md)。

本源码实际验证工具链是 MoonBit 0.10.18、Node 24.22.1/Linux，见 [review-toolchain.lock.json](review-toolchain.lock.json)。根目录 toolchain.lock.json 与本分支固定 CI 已同步至0.10.18；旧0.10.14性能/发布回执仅属于历史版本。固定SDK/core从官方HTTPS下载并校验记录SHA256（非另行厂商签名）。使用本分支源码而非重新 clone 默认分支来复现新修复；四后端命令与 broker 范围见[复现说明](docs/reproduce-review-20261030.md)。

## 历史发布版快速开始

以下仅展示旧默认分支的快速开始，旧发布测试用0.10.14及Node24；源码分支使用上文0.10.18锁，**不需要外部 broker**。

```sh
git clone https://github.com/sundaysebasidian-byte/moonstomp.git
cd moonstomp
moon test                                   # 单元 / 属性 / 对抗测试
moon build --target js                      # 构建 Node 用的 bridge
node tools/stomp-cli.cjs demo               # 进程内 demo broker：发一条、收一条
node examples/demo/01-pubsub.cjs            # 最后一行输出 PASS pubsub
moon run examples/versions --target js      # 1.0 / 1.1 / 1.2 协商与边界
```

在自己的 MoonBit 项目里使用：

```sh
moon add sundaysebasidian-byte/moonstomp@0.3.1
```

> [mooncakes 上的 0.3.1](https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp@0.3.1/)。从 0.1.x 升级时注意 `Client`、`Decoder`、`HeartbeatClock` 已改为抽象类型，见[迁移说明](docs/migration-master-20261023.zh-CN.md)。

## 可查询的事务本地结束结果

Node `Transaction.outcome` 提供只读冻结快照，区分结束命令未请求、等待、receipt已确认、写前未发送与结果未知。关闭会话或重复调用不会把未知误写为回滚；不自动重放，也不声称查询到了broker/业务真实状态。详情及运行证据见[使用指南](docs/guide.zh-CN.md#transactionoutcome可查询只读的本地结果)。此新增能力来自当前源码，旧Mooncakes版本不会因此变化。

## 用法

### MoonBit：喂字节，拿事件

```moonbit
let client = @stomp.Client::new()
let bytes = client.send(@stomp.connect("localhost"), 0) // 写给 socket
ignore(client.receive(b"CONNECTED\nversion:1.2\n\n\x00", 0))
ignore(client.send(@stomp.subscribe("sub-1", "/queue/jobs", ack="client-individual"), 0))

// 一个 MESSAGE 帧被 TCP 拆成两段到达
let first = client.receive(b"MESSAGE\nsubscription:sub-1\nmessage-id:m1\ndestination:/queue/jobs\nack:a1\ncontent-len", 0)
assert_eq(first.length(), 0) // 半包：还没有完整帧
let events = client.receive(b"gth:5\n\nhello\x00", 0)
match events[0] {
  @stomp.Message(frame) => assert_eq(frame.body, b"hello")
  _ => fail("expected a MESSAGE")
}
ignore(client.send(@stomp.acknowledge("a1"), 0))
```

最后一个参数是调用方提供的单调毫秒时钟，心跳由 `client.tick(now)` 驱动。这段代码在 [readme_test.mbt](readme_test.mbt) 中作为测试运行；更完整的离线流程（ACK/NACK、事务、DISCONNECT receipt）见 [examples/offline/main.mbt](examples/offline/main.mbt)。

### Node：连真实 broker

`transport/tcp.cjs` 把核心接到 `net` / `tls`，支持 `login` / `passcode`、强制证书链校验、默认主机名校验的 TLS、Subscription / Transaction 句柄和带 `code` 的结构化错误。用法速查见 [docs/guide.zh-CN.md](docs/guide.zh-CN.md)；0.3.0 起的有界 `sendAsync` 见[异步 SEND](docs/async-send.zh-CN.md)。Node 适配器按源码使用，不是 npm 包。高级 `tlsOptions.checkServerIdentity` 可替换默认主机名检查，调用方必须维护身份验证；详见[信任边界](docs/boundaries.zh-CN.md)。

```sh
node tools/demo-broker.cjs --port 61613 &
node tools/stomp-cli.cjs subscribe --port 61613 --destination /queue/jobs --count 1 &
node tools/stomp-cli.cjs send --port 61613 --destination /queue/jobs --body hello
# sent destination=/queue/jobs bytes=5 receipt=confirmed
```

### 场景示例

每个都自带回环 demo broker，退出码 0 即通过，输出与 [examples/demo/expected](examples/demo/expected) 逐字节一致。

| 场景 | 命令 |
| --- | --- |
| 发布 / 订阅（queue 与 topic） | `node examples/demo/01-pubsub.cjs` |
| receipt 可靠发送 | `node examples/demo/02-reliable-send.cjs` |
| 手动 ACK / NACK | `node examples/demo/03-ack-nack.cjs` |
| 事务 COMMIT / ABORT | `node examples/demo/04-transaction.cjs` |
| 心跳与断线检测 | `node examples/demo/05-heartbeat.cjs` |
| 1.0 / 1.1 / 1.2 协商 | `node examples/demo/06-versions.cjs` |
| 认证与结构化错误 | `node examples/demo/07-auth-errors.cjs` |
| 有界异步批量发送（0.3.0 起的 Node 适配器） | `node examples/demo/08-async-send.cjs` |

## 规范覆盖（STOMP 1.2，兼容 1.0 / 1.1）

| 规范要求 | 支持 |
| --- | --- |
| 全部客户端帧：CONNECT / STOMP、SEND、SUBSCRIBE、UNSUBSCRIBE、ACK、NACK、BEGIN、COMMIT、ABORT、DISCONNECT | ✅ |
| 全部服务端帧：CONNECTED、MESSAGE、RECEIPT、ERROR | ✅ |
| 头部转义 `\\` `\n` `\c` `\r`（1.2），CONNECT / CONNECTED 不转义；1.0 原样、1.1 无 `\r` | ✅ |
| `content-length` 与 NUL 结尾，正文可含二进制 NUL | ✅ |
| 增量（半包、粘包）解析，帧间 EOL | ✅ |
| 版本协商 `accept-version` / `version`，越界版本拒绝 | ✅ |
| 心跳协商 `heart-beat` 与超时检测 | ✅ |
| 订阅 ack 模式 `auto` / `client` / `client-individual`，按版本区分 ACK 头 | ✅ |
| receipt 跟踪、事务内的 SEND / ACK | ✅ |
| 行长、头数、正文、单次事件数上限（可配置 `Limits`） | ✅ |

## 真实 broker 互通

| Broker | 已验证 |
| --- | --- |
| Apache Artemis 2.57.0（另以 go-stomp 为对端） | 1.0 / 1.1 / 1.2 收发、分段二进制正文、receipt、ACK / 累计 ACK / NACK、事务 SEND、双向心跳、真实 ERROR |
| Apache ActiveMQ Classic 6.3.2 | login/passcode 认证、TLS、三版本二进制收发、版本化 ACK、事务 SEND 提交 / 中止、COMMIT 前断线不重放 |
| RabbitMQ 4.1.8（STOMP 插件，每次推送在 [CI](.github/workflows/rabbitmq.yml) 里跑） | login/passcode 认证与错误口令、1.0 / 1.1 / 1.2 二进制收发、转义头往返、事务 SEND 提交 / 中止、NACK 后重投递、以 `1000,1000` 请求心跳并收到两次服务端心跳、20 条异步 SEND 按序到达 |

已知差异：Artemis 不回滚事务内的 ACK，NACK 表现为丢弃；RabbitMQ 的 NACK 默认重新入队，消息带 `redelivered:true` 再次投递。复现命令（脚本只校验本地已有的官方发行包，不联网下载）和完整矩阵见 [docs/broker-interop.zh-CN.md](docs/broker-interop.zh-CN.md)；与 go-stomp 的功能对照见 [docs/FAIR_GO_STOMP_COMPARISON.zh-CN.md](docs/FAIR_GO_STOMP_COMPARISON.zh-CN.md)。

## 设计取舍

- **sans-I/O**：核心只做协议，I/O、定时器、重连策略都留给宿主。同一套核心可接 Node、Wasm 或别的运行时。
- **分层失败行为**：接收侧解码/协议错误、时钟倒退或接收资源超限会关闭会话；本地 `send` 参数、事务归属或容量校验失败则拒绝本次操作、不登记新意图，原状态保持（前提是调用中的时钟推进尚未触发致命关闭）。不要把可修正的本地验证失败都解释成断线。
- **不自动重发**：receipt 丢失时报告“结果未知”，由调用方决定，避免重复投递。
- 不做：服务端、WebSocket、自动重连、持久化 outbox、exactly-once。

详细边界见 [docs/boundaries.zh-CN.md](docs/boundaries.zh-CN.md)，公开接口见 [pkg.generated.mbti](pkg.generated.mbti)。

## 测试

- MoonBit 测试覆盖编解码、头部转义、心跳、会话状态、版本矩阵、属性测试和对抗输入。
- 与 stomp.js 7.2.0 解析器的差分测试（`scripts/differential.cjs`，按不同分段长度喂入），Node 适配器的生命周期 / TLS / 凭据测试。
- CI：[ci.yml](.github/workflows/ci.yml) 在官方 SDK 上跑完整验证（`scripts/verify.py --transport`）；[fresh-clone.yml](.github/workflows/fresh-clone.yml) 模拟新用户 `git clone` 后直接 `moon test`、本页快速开始和场景示例，并在最新 SDK 上同样跑一遍。异步示例和期限检查已在 [0.3.1 精确 head 常规 CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225200831)通过；真实 Classic TLS 心跳、短异步与五分钟源码场景见[固定 broker CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225233529)。[rabbitmq.yml](.github/workflows/rabbitmq.yml) 每次推送都在 Docker 里起 RabbitMQ 跑互通测试（`scripts/rabbitmq-interop-test.cjs`）。

本地完整验证：`python3 scripts/verify.py --output ../moonstomp-verification`。

## 性能

`moon bench --release` 实测，每项 5 组取平均；GitHub Actions ubuntu-24.04（Intel Xeon 6973P-C，4 核），moonc v0.10.14。负载为 100 条 MESSAGE 帧，每条正文 1 KiB，线上共 111,090 字节。

| 操作 | JS | native |
| --- | --- | --- |
| 编码 100 帧 | 942 µs | 254 µs |
| 解码，一次喂入 | 2.11 ms | 468 µs |
| 解码，按 64 字节分段喂入 | 2.31 ms | 490 µs |
| 客户端会话接收 100 帧（含状态机校验） | 2.54 ms | 485 µs |

native 解码吞吐约 238 MB/s，JS 约 53 MB/s；分段喂入只慢约 5–10%。数字只说明数量级，换机器会变。复现：`moon bench benchmarks --target native --release`；CI 见 [bench.yml](.github/workflows/bench.yml)，本表来自[这次运行](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40287603480)。

## 目录

| 路径 | 内容 |
| --- | --- |
| `frame.mbt` `headers.mbt` `decoder.mbt` | 帧、头部转义、增量解码 |
| `client.mbt` `heartbeat.mbt` `version.mbt` `api.mbt` | 会话状态机、心跳、版本协商、帧构造函数 |
| `bridge/main.mbt` | MoonBit 实现的 JS bridge 边界 |
| `transport/` | Node TCP / TLS 适配器与句柄 |
| `tools/` | 命令行与 demo broker |
| `examples/` | MoonBit 与 Node 示例 |
| `benchmarks/` | `moon bench` 基准 |

## 许可与来源

代码 MIT（[LICENSE](LICENSE)）。参考测试文件 Apache-2.0，STOMP 规范 CC BY 3.0，来源与使用范围见 [docs/reference.zh-CN.md](docs/reference.zh-CN.md)。
开发中 AI 的参与方式见 [AI_USAGE.md](AI_USAGE.md)。

For unsubscribe pre-write refusal and safe retry boundaries, see [Unsubscribe retry](docs/UNSUBSCRIBE_RETRY.md).
