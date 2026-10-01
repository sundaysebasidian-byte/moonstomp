# MoonSTOMP

MoonBit 实现的 STOMP 1.2 增量字节流编解码与传输分层客户端。适合将 MoonBit 程序接入任务队列、事件通道或现有 STOMP broker。核心协议不依赖 socket、系统时钟或 Node；Node TCP 适配器仅负责连接、读写、事件等待和关闭。

当前为本地可审阅候选，版本 `0.1.0`。真实 broker 互操作尚未测试；不可将单元测试、参考差分或自造回环 peer 当作 broker 兼容性证明。没有公开仓库、远端 CI 或 Mooncakes 发布。

## 支持范围

- LF/CRLF，逐字节及任意分段输入、连帧与心跳；UTF-8 header，四种转义、重复 header 保留且取首值，首尾空格保留。
- `content-length` 按 octet 计数；二进制正文允许 NUL 和非 UTF-8 字节。编码非空正文自动补长度；接收必须包含最终 NUL。非法转义、长度、UTF-8、正文和超限输入报错。
- STOMP 1.2 的 CONNECT/STOMP、CONNECTED、SEND、SUBSCRIBE、UNSUBSCRIBE、ACK/NACK、BEGIN/COMMIT/ABORT、RECEIPT、ERROR、DISCONNECT。
- 仅协商 `1.2`；心跳间隔取双方最大值，0 禁用，任意收到的字节刷新存活时间；调用者提供单调毫秒时钟，默认接收容差 100 ms。
- `auto`、`client`、`client-individual` ACK 模式；累计 ACK/NACK 限同一订阅，事务确认提交前暂存，ABORT 恢复可确认状态。未知/重复 ID 与事务重叠会拒绝。
- receipt 关联；发送 DISCONNECT 后禁止再发帧，等待其 receipt 后关闭；EOF、ERROR、协议异常和运输故障清理本地状态。

不支持 STOMP 1.0/1.1、WebSocket、TLS、自定义未知命令、自动重连、持久化 outbox、业务重试或 exactly-once 保证。destination 是不透明字符串；队列命名、NACK 重投递、持久化和服务端事务语义取决于 broker。底层连接必须是可靠、有序的双向字节流。通用 Frame 可携带 CONNECT 凭据 header，TCP `connect()` 便利入口仅实现无凭据连接；不会读取系统凭据。

## 从源码运行

解压源码包并进入 `moonstomp/`。使用已经安装的可信 SDK，不需要 npm 安装或 registry 拉取。固定工具版本见 [toolchain.lock.json](toolchain.lock.json)：

- `moonc v0.10.14+7d59c7ec9 (2026-09-18)`
- `moon 0.1.20260920 (914d7da 2026-09-20)`
- 已验证 Node `v24.18.0`、Python `3.14.6`、macOS arm64；其他系统与版本未实测。

```sh
# 换成你的现有 SDK 路径；MOON_HOME 可指向本任务独立副本。
export MOON_HOME="/absolute/path/to/moonbit-sdk"
export MOON_BIN="$MOON_HOME/bin/moon"
export PATH="$MOON_HOME/bin:$PATH"
python3 scripts/verify.py --output ../moonstomp-verification
```

脚本检查固定版本，串行执行检查、构建、JS/wasm-gc 单元测试、离线示例、JS 边界与独立差分，将命令、退出码、日志和源码 SHA256 保存到新建的输出目录。输出必须在源码目录外，每次使用新目录。脚本不会安装软件或连接真实 broker。

如运行环境允许临时回环端口，追加 `--transport` 验证自造 peer 的连接、receipt、超时、EOF、握手错误及容量清理。这仍然不是 broker 互操作：

```sh
python3 scripts/verify.py --output ../moonstomp-verification-with-tcp --transport
```

## MoonBit 使用方式

本模块内可运行的外部 API 使用例在 [examples/offline/main.mbt](examples/offline/main.mbt)，其 `moon.pkg` 导入 `sundaysebasidian-byte/moonstomp` 为 `@stomp`。公开 API 的黑盒消费测试见 [api_test.mbt](api_test.mbt)。

```moonbit
let limits = @stomp.Limits::new(max_body=65536, max_events=64)
let decoder = @stomp.Decoder::new(limits~)
let frame = @stomp.send_message("/queue/tasks", b"job\x00payload")
let wire = @stomp.encode(frame)
let events = decoder.feed(wire)
// events 为 WireEvent；Frame 中 body 始终为 Bytes。
decoder.end()
```

协议会话由 `Client::new()` 创建，`send(frame, now)` 返回待写字节，`receive(chunk, now)` 返回事件，`tick(now)` 返回到期心跳。`now` 是从 0 起的单调毫秒 `Int64`，不是日期时间。成功 `send` 表示本地意图已登记，运输写入失败必须调用 `fail()`；服务端是否处理需等待 receipt。EOF 调用 `end()`；运输中断调用 `fail()`。终止后的会话和 decoder 不可复用。

无 I/O 的 codec 只检查帧语法；必需 header 和命令时序由 Client 校验。decoder/feed 同一批中后续出现非法输入时整批报错，先前事件不会作为部分成功返回，调用者应关闭运输。出站 API 校验错误不会将核心 Client 自动毒化；TCP 便利适配器采取关闭策略。

独立应用安装到 Mooncakes 的流程目前未验证，包尚未发布；本源码包不要求 `moon add`。库发布后才应增加经过实测的 registry 安装例，不能把当前不存在的包写成可安装依赖。

## 三个完整场景

离线演示一次走完三个场景与安全断连，服务器帧由样例提供，仅说明 API：

```sh
moon run examples/offline --target js -j 1
```

1. **任务生产消费**：订阅任务 destination → 发送含 NUL 的二进制任务 → 收到 MESSAGE → 按业务内容处理。对应 `examples/1-tasks.cjs`，真实 broker 例还检查 SUBSCRIBE/SEND/UNSUBSCRIBE receipt。
2. **ACK/NACK 可靠处理**：使用 `client-individual` → 成功任务 ACK → 失败任务 NACK → 等待处理 receipt。对应 `examples/2-reliable.cjs`。NACK 后的重投递或死信策略由 broker 决定，样例不承诺必然重试。
3. **事务 commit/abort**：BEGIN → 暂存 SEND → ABORT 后观察未投递 → 另一次 BEGIN/SEND → COMMIT 后收到发布内容。对应 `examples/3-transactions.cjs`；单元测试另外覆盖事务 ACK/NACK 的暂存、回滚及重叠拒绝。

真实 broker 例要求你已运行一个支持 STOMP 1.2、无凭据的本地 broker。默认 `127.0.0.1:61613`；仅接受 `127.0.0.1` 或 `::1`，不会向公网发送测试。下面三条目前**未跑真实 broker**：

```sh
moon build --target js -j 1
node examples/1-tasks.cjs
node examples/2-reliable.cjs
node examples/3-transactions.cjs
```

端口可用 `STOMP_PORT` 指定。库自身没有安装 broker 的脚本。待批准安装方案与限制见 [docs/broker-plan.zh-CN.md](docs/broker-plan.zh-CN.md)。

## 分层与资源上限

| 层 | 文件 | 责任 |
| --- | --- | --- |
| 帧与 codec | frame.mbt / headers.mbt / decoder.mbt | 字节、header、正文、增量语法与致命错误 |
| 会话与时钟 | client.mbt / heartbeat.mbt / api.mbt | 命令、订阅、事务、ACK、receipt、协商与单调时间 |
| JS 边界 | bridge/main.mbt | 明确的 JSON header/event 与字节正文边界，隐藏编译器内部表示 |
| TCP glue | transport/tcp.cjs | Node net、有限等待/缓存、运输错误及关闭 |

默认单行 8192 字节（包含 CR，不含 LF）、128 个 header、1 MiB 正文、每次 feed 1024 事件。可通过 `Limits::new()` 设置；事件数上限按一次 feed 计算，调用者须选择合适的分块与上限。Client 出站 header 名值 UTF-8 合计不超过 2047 字节（转义后仍受 8192 行预算），最多 128 header、1 MiB 正文；默认各 256 个活跃订阅/事务/待 receipt、1024 个待确认消息。

TCP 默认缓存最多 1024 个事件且 JSON 估算总量不超过 4 MiB，最多 256 个等待者，写缓冲最多 2 MiB。超限会拒绝或关闭；不无限排队。每个 Client 对应一次连接，不复用已关闭实例。CPU 测试脚本始终 `-j 1`。

## 验证与许可

本地脚本覆盖正常、错误、边界、资源上限、所有三段切分点与 200 组多段切分、1 MiB 正文、假时钟、状态机、公开 API、连接清理。独立参考 `@stomp/stompjs 7.2.0`：401 个有效用例、1201 次参考分段解析比较；四项严格性差异保留在报告中。差分不会证明真实 broker 互操作或替代它。

GitHub Actions 配置见 [.github/workflows/ci.yml](.github/workflows/ci.yml)，覆盖 check/build/test/示例/差分/回环 TCP。当前远端 CI 未运行。通过、失败、未测的中文验收矩阵见 [docs/acceptance.zh-CN.md](docs/acceptance.zh-CN.md)。

原创核心 MIT；参考测试文件 Apache-2.0，规范 CC BY 3.0，来源、范围和许可见 [docs/reference.zh-CN.md](docs/reference.zh-CN.md)。AI 辅助事实与需要参赛者理解的技术问题见 [AI_USAGE.md](AI_USAGE.md)。[Proposal.md](Proposal.md) 是技术参考，不是符合人工撰写要求的最终申报书。
