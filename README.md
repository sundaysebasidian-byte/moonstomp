# MoonSTOMP

[![CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/workflows/ci.yml/badge.svg)](https://github.com/sundaysebasidian-byte/moonstomp/actions/workflows/ci.yml)
[![Fresh clone](https://github.com/sundaysebasidian-byte/moonstomp/actions/workflows/fresh-clone.yml/badge.svg)](https://github.com/sundaysebasidian-byte/moonstomp/actions/workflows/fresh-clone.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

用 MoonBit 写的 STOMP 客户端：**无 I/O 的增量编解码 + 会话状态机**，支持 STOMP 1.0 / 1.1 / 1.2，并已和 Apache Artemis、ActiveMQ Classic 两个真实 broker 互通。

核心不碰 socket，只吃字节、吐字节和事件，所以能放进任何运行时；仓库另带一个 Node TCP/TLS 适配器、`send` / `subscribe` 命令行和 7 个一条命令就能跑的场景示例。

## 快速开始

需要 MoonBit 工具链（CI 锁定 `moonc v0.10.14+7d59c7ec9`，见 [toolchain.lock.json](toolchain.lock.json)）和 Node.js（CI 用 24），**不需要外部 broker**。

```sh
git clone https://github.com/sundaysebasidian-byte/moonstomp.git
cd moonstomp
moon test                                   # 71 个单元 / 属性 / 对抗测试
moon build --target js                      # 构建 Node 用的 bridge
node tools/stomp-cli.cjs demo               # 进程内 demo broker：发一条、收一条
node examples/demo/01-pubsub.cjs            # 最后一行输出 PASS pubsub
moon run examples/versions --target js      # 1.0 / 1.1 / 1.2 协商与边界
```

在自己的 MoonBit 项目里使用：

```sh
moon add sundaysebasidian-byte/moonstomp
```

> 已发布的 0.1.2 只支持 STOMP 1.2；多版本协商、认证、TLS 和句柄在当前源码中，尚未发布新版本。

当前 master 还将 `Client`、`Decoder`、`HeartbeatClock` 的字段收为抽象类型；依赖字段的外部代码需要迁移，虽然 `moon.mod` 仍写 0.1.2。升级前请读 [迁移说明与固定 SHA/CI](docs/migration-master-20261023.zh-CN.md)；未来 0.2.0 只是 PR 中的建议，没有因此发布新版本。

固定 master `636ef52…` 的本地接入续验已覆盖干净消费者6/6、真实Classic TLS三版本、receipt丢失不重发及真实心跳关闭。精确源码、SDK、命令与未测范围见 [当前源码接入回执](docs/integration-master636-20261023.zh-CN.md)；这与旧v5和已发布0.1.2分开报告。

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

`transport/tcp.cjs` 把核心接到 `net` / `tls`，支持 `login` / `passcode`、证书校验始终开启的 TLS、Subscription / Transaction 句柄和带 `code` 的结构化错误。用法速查见 [docs/guide.zh-CN.md](docs/guide.zh-CN.md)。

```sh
node tools/demo-broker.cjs --port 61613 &
node tools/stomp-cli.cjs subscribe --port 61613 --destination /queue/jobs --count 1 &
node tools/stomp-cli.cjs send --port 61613 --destination /queue/jobs --body hello
# sent destination=/queue/jobs bytes=5 receipt=confirmed
```

### 7 个场景示例

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

已知差异：Artemis 不回滚事务内的 ACK，NACK 表现为丢弃。复现命令（脚本只校验本地已有的官方发行包，不联网下载）和完整矩阵见 [docs/broker-interop.zh-CN.md](docs/broker-interop.zh-CN.md)。

## 设计取舍

- **sans-I/O**：核心只做协议，I/O、定时器、重连策略都留给宿主。同一套核心可接 Node、Wasm 或别的运行时。
- **失败即关闭**：协议错误、时钟倒退、超限都会让会话进入 `Closed`，不会带着坏状态继续收发。
- **不自动重发**：receipt 丢失时报告“结果未知”，由调用方决定，避免重复投递。
- 不做：服务端、WebSocket、自动重连、持久化 outbox、exactly-once。RabbitMQ 尚未实测。

详细边界见 [docs/boundaries.zh-CN.md](docs/boundaries.zh-CN.md)，公开接口见 [pkg.generated.mbti](pkg.generated.mbti)。

## 测试

- 71 个 MoonBit 测试：编解码、头部转义、心跳、会话状态、版本矩阵、属性测试和对抗输入。
- 与 stomp.js 7.2.0 解析器的差分测试（`scripts/differential.cjs`，按不同分段长度喂入），Node 适配器的生命周期 / TLS / 凭据测试。
- CI：[ci.yml](.github/workflows/ci.yml) 在官方 SDK 上跑完整验证（`scripts/verify.py --transport`）；[fresh-clone.yml](.github/workflows/fresh-clone.yml) 模拟新用户 `git clone` 后直接 `moon test`、本页快速开始和 7 个示例，并在最新 SDK 上同样跑一遍。

本地完整验证：`python3 scripts/verify.py --output ../moonstomp-verification`。
各轮验证的命令、环境和结果见 [docs/verification-20261022.zh-CN.md](docs/verification-20261022.zh-CN.md) 与 `evidence/`。

## 目录

| 路径 | 内容 |
| --- | --- |
| `frame.mbt` `headers.mbt` `decoder.mbt` | 帧、头部转义、增量解码 |
| `client.mbt` `heartbeat.mbt` `version.mbt` `api.mbt` | 会话状态机、心跳、版本协商、帧构造函数 |
| `bridge/` | MoonBit ↔ JS 边界 |
| `transport/` | Node TCP / TLS 适配器与句柄 |
| `tools/` | 命令行与 demo broker |
| `examples/` | MoonBit 与 Node 示例 |

## 许可与来源

代码 MIT（[LICENSE](LICENSE)）。参考测试文件 Apache-2.0，STOMP 规范 CC BY 3.0，来源与使用范围见 [docs/reference.zh-CN.md](docs/reference.zh-CN.md)。
开发中 AI 的参与方式见 [AI_USAGE.md](AI_USAGE.md)，技术方案见 [Proposal.md](Proposal.md)。
