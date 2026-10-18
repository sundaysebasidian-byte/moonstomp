# MoonSTOMP

## 状态一览（2026-10-18 整改后；先读这里）

本仓库同时含有**已发布的 0.1.2（仅 STOMP 1.2）**和**尚未发布的多版本候选（STOMP 1.0 / 1.1 / 1.2）**。`moon.mod` 仍写 0.1.2，候选没有新版本号。二者不要混读。

### 已实现 / 已验证 / 拟实现 / 不支持

| 功能 | 0.1.2 正式包 | 本分支候选（未发布） | 验证（含类型） | 
|---|---|---|---|
| STOMP 1.2 codec、会话、ACK/NACK、事务、receipt、心跳 | 已实现并发布 | 保留，默认 API 行为不变 | 0.1.2：先前发行记录（含 Linux 远端 CI、注册表安装）；候选：本地 68/68 |
| STOMP 1.0 / 1.1 协商与线格式 | **不支持** | 已实现：`Version` V10/V11/V12、`connect_versions`、`subscribe_versioned`、`acknowledge_message`、`encode_versioned`、`Decoder::new(version=…)` | 本地单测（含在 68/68）+ 离线示例 `examples/versions`（本轮实跑）；真实 broker 互通见下 |
| 按版本区分 ACK 头（1.0 `message-id`；1.1 `message-id`+`subscription`；1.2 `id`） | 否 | 已实现 | 离线示例输出逐版本显示；Go↔Artemis↔MoonBit 记录核对 |
| 版本边界拒绝（1.0 无 NACK、1.0 无 `client-individual`、1.1/1.2 订阅必须有 id、1.0 无心跳协商、broker 回复未提供的版本） | 不适用 | 已实现 | 离线示例逐条打印拒绝原因（本轮实跑） |
| Node TCP 适配器 `connect({versions})` | 仅 1.2 | 已实现，匿名连接 | 自造 peer 回环 10 项生命周期 + 4 项边界 + 6 项三版本超时控制（2026-10-18 本轮 `verify.py --transport` 实跑通过；不是 broker 互通） |
| 真实 broker 互通 | 仅 Artemis 2.57.0 的 1.2 | Go（go-stomp 固定提交 `c155a2d…`）↔ Artemis 2.57.0 ↔ MoonBit，1.0/1.1/1.2 双向 | **本轮实跑（2026-10-18）**：macOS arm64、`moonc v0.10.14+7d59c7ec9`（锁定）、Java 17（Temurin 17.0.20）、Go 1.27.1、Artemis 2.57.0（官方 SHA512 已核）、端口 62613。1.0/1.1/1.2 三个版本双向消息交换均通过，另有 3 例 + 5 项扩展。**先前记录（Linux x86_64、`moonc v0.10.15`、Go 1.26.8、Java 21，2026-10-15）**见[旧验收报告](docs/verified-multiversion-20261015.zh-CN.md)，两者环境不同，本轮结果不是旧记录的复述，旧记录也不证明本轮环境 |
| 登录凭据（login/passcode）的 Node 便利连接 | 不支持 | 不支持（通用 `Frame` 可携带认证头，但无凭据测试） | — |
| TLS、WebSocket、自动重连、持久 outbox、业务重试、exactly-once | 不支持 | 不支持 | — |
| 多 broker 交叉验证（RabbitMQ、ActiveMQ 等） | 无 | 无 | 未做 |

**拟实现（尚未开始，不是已有能力，也不构成承诺）**：①Node 便利连接支持 login/passcode；②再选一种 broker（如 RabbitMQ STOMP 插件）做互通；③基于 `node:tls` 的 TLS 适配；④带退避的重连辅助。WebSocket、服务端实现、持久 outbox 暂不计划。

### 验证结果分开列（候选）

| 层面 | 结果 |
|---|---|
| 本地，锁定工具链（`moon 0.1.20260920 (914d7da)`、`moonc v0.10.14+7d59c7ec9`、Node v24.18.0，macOS arm64） | `moon test --target js` 与 `moon test --target wasm-gc --package sundaysebasidian-byte/moonstomp` 各 **68/68**；`examples/versions` 的输出与 `examples/versions/expected_output.txt` 逐字节比对，js / wasm-gc 已接入 `verify.py` 的 `versions-example` 阶段（该阶段另要求 6 条 `rejected`、3 条 `negotiated version`，并带变异自检）；native 目标另在本轮单独实跑，输出与 golden 逐字节一致，但不在脚本默认目标内 |
| 远端 CI | 候选**未运行**（未推送）。0.1.2 的旧 CI 记录见其发布记录 |
| 注册表 | 候选未发布，不适用。0.1.2 已先前核对，本轮用 `moon add …@0.1.2` 安装查看确认其为仅 1.2（无 V10/V11/connect_versions） |
| 真实 broker（Go go-stomp `c155a2d…` ↔ Artemis 2.57.0 ↔ MoonBit） | **本轮实跑通过**：`verify.py` 18 个阶段全部 PASSED（含 `versions-example`、`real-broker`，总状态 `PASSED_WITH_ARTEMIS_PROFILE_LIMITATION_AND_UNTESTED_REMOTE_CI`）。限制：事务 ACK 在该 Artemis profile 下为 `CONFIRMED_BROKER_LIMITATION`；未测 TLS、认证、其他 broker |

wasm-gc 的整包测试必须带 `--package sundaysebasidian-byte/moonstomp`：不带时会编译到 Node 专用 `bridge`，报 `extern "js" is unsupported in wasm-gc backend`，这是命令用法而不是测试失败。

### 与 go-stomp 的对照（依据固定源码 `c155a2d699bb5bc1b2547a4382b3cdd7f4403648` 逐项核对，2026-10-18）

go-stomp（https://github.com/go-stomp/stomp）是成熟的 Go 客户端。本项目**不是**其功能等价物：go-stomp 带自己的 I/O 与 goroutine 读写循环，MoonSTOMP 是无 I/O 的编解码+会话核心加一个 Node TCP 适配器。以下为对该固定提交源码的核对结果（不是对 go-stomp 的全面审计，也不含其测试覆盖率评价）：

| 项目 | go-stomp（固定提交） | MoonSTOMP 候选 |
|---|---|---|
| 协议版本 | README 声明 1.0/1.1/1.2；`Conn.Version()` 暴露协商结果 | 1.0/1.1/1.2，`Version` V10/V11/V12 |
| 连接方式 | `Dial`/`DialWithContext` 拨号；`Connect`/`ConnectWithContext` 接受任意 `io.ReadWriteCloser`（可自行传入 `tls.Conn`） | Node `net` TCP 适配器；核心接受任意字节流 |
| TLS | 库内**没有** `crypto/tls` 代码，不提供 TLS 选项；只能由调用者自备已建立的加密连接传入 `Connect` | 无 TLS；仅计划（未开始） |
| 登录凭据 | 有 `ConnOpt.Login` 连接选项 | Node 便利连接仅匿名；通用 `Frame` 可带认证头，无凭据测试 |
| 命令 | Send、Subscribe、Ack、Nack、Begin/Commit/Abort、Disconnect | 同类命令；按版本区分 ACK 头与边界拒绝 |
| 心跳 | 连接选项 + 读写超时与宽限倍数 | 核心含心跳协商与单调时间；1.0 offer 心跳被拒绝 |
| 自动重连 | 源码中**没有**重连逻辑 | 无 |
| 读缓冲 | `frame.Reader` 默认缓冲 4096 字节，可由 `ConnOpt.ReadBufferSize` 调整 | 默认单行 8192、128 个 header、1 MiB 正文、每次 feed 1024 事件，可经 `Limits::new()` 调整 |
| STOMP 服务端 | 含 `server` 包（队列、主题）；该服务端对 1.0 CONNECT 返回 `unsupported version`（源码注释“don't want to handle V1.0 at the moment”） | 明确不做 |
| 转义行为 | 写入端对所有版本统一转义 | 按版本区分；1.0 特殊 header 与 1.1 字面 CR 的规范语义仅由 MoonBit 字节测试覆盖，跨客户端测试无法证明这两点 |
| 运行时 | Go | MoonBit JS / Wasm GC（单测）；TCP 适配器仅 Node |

本项目在互通测试中使用 go-stomp 的公共 API 作为真实对端（`scripts/build-go-peer.py` 构建，核对固定提交），不是自写替代协议实现。

### 多版本离线示例（本轮实跑）

```sh
moon run examples/versions --target js
```

服务端帧由示例提供，不是 broker 证据。三个版本各走一次 订阅→MESSAGE→ACK→带 receipt 的 SEND→RECEIPT→DISCONNECT→Closed。关键输出：

```text
[1.2] ACK      -> ACK\nid:a1\n\n\0
[1.1] ACK      -> ACK\nmessage-id:m1\nsubscription:s1\n\n\0
[1.0] ACK      -> ACK\nmessage-id:m1\n\n\0
rejected  NACK under 1.0: NACK unavailable in STOMP 1.0
rejected  client-individual under 1.0: invalid versioned acknowledgement mode
rejected  1.1/1.2 subscription without id: subscription id required
rejected  heart-beat offered with 1.0 only: STOMP 1.0 has no heartbeat negotiation
rejected  unsupported version 2.0: unsupported STOMP version
rejected  server answers with a version not offered: invalid version negotiation or CONNECTED EOL
```

---

以下为**已发布 0.1.2 版本（仅 STOMP 1.2）**的原说明；其中“不支持 1.0/1.1”只针对 0.1.2，候选见上表。

本仓库版本为 **0.1.2**。源码改进与准确 CI 见 [源码同步记录](docs/source-sync-0.1.2.zh-CN.md)，正式发布回执与独立安装结果见 [0.1.2 发布记录](docs/publication-0.1.2.zh-CN.md)。安装固定使用 `moon add sundaysebasidian-byte/moonstomp@0.1.2`；旧 0.1.0/0.1.1 发布证据保留。

MoonBit 实现的 STOMP 1.2 增量字节流编解码与传输分层客户端。适合将 MoonBit 程序接入任务队列、事件通道或现有 STOMP broker。核心协议不依赖 socket、系统时钟或 Node；Node TCP 适配器仅负责连接、读写、事件等待和关闭。

源码与 Mooncakes 正式版本 `0.1.2`、MIT；0.1.0/0.1.1 历史版本保留。已实跑 Apache Artemis 2.57.0 无凭据回环互操作：三个场景和五项补充检查通过；事务 ACK 在该 broker 不受支持，NACK 按丢弃处理。结果只适用于已测版本和配置，不是所有 broker 的兼容认证。源码地址为 https://github.com/sundaysebasidian-byte/moonstomp ，发布状态、远端 CI 和正式包安装证据以对应提交的发布记录为准。

0.1.1 修复自动 content-length 计入最终 header 预算，以及带 receipt 的退订保留在途消息至回执到来；0.1.0 未包含这两项修复。[边界与失败行为](docs/boundaries.zh-CN.md) 区分核心、JS 运输、后端、容量、时钟和已知未测项。此前 0.1.1 公开和发布已获明确批准且完成，准确 CI、正式包与独立安装状态见 [0.1.1 发布记录](docs/publication-0.1.1.zh-CN.md)，不覆盖 0.1.0。

2026-10-03 新增有界解析/分段回归与真正增量的外部参考比较，核心两后端各 44/44；实际候选包消费各 6/6。运行功能未变，真实 broker 本轮未重跑，保留原提交和时间。详见 [本轮质量复核](docs/overnight-review-20261003.zh-CN.md)。

## 0.1.2 支持范围（仅 STOMP 1.2）

- LF/CRLF，逐字节及任意分段输入、连帧与心跳；UTF-8 header，四种转义、重复 header 保留且取首值，首尾空格保留。
- `content-length` 按 octet 计数；二进制正文允许 NUL 和非 UTF-8 字节。编码非空正文自动补长度；接收必须包含最终 NUL。非法转义、长度、UTF-8、正文和超限输入报错。
- STOMP 1.2 的 CONNECT/STOMP、CONNECTED、SEND、SUBSCRIBE、UNSUBSCRIBE、ACK/NACK、BEGIN/COMMIT/ABORT、RECEIPT、ERROR、DISCONNECT。
- 仅协商 `1.2`；心跳间隔取双方最大值，0 禁用，任意收到的字节刷新存活时间；调用者提供单调毫秒时钟，默认接收容差 100 ms。
- `auto`、`client`、`client-individual` ACK 模式；累计 ACK/NACK 限同一订阅，事务确认提交前暂存，ABORT 恢复可确认状态。未知/重复 ID 与事务重叠会拒绝。UNSUBSCRIBE 后仍可确认旧消息，但旧消息未结清时不能复用同一订阅 ID。
- receipt 关联；发送 DISCONNECT 后禁止再发帧，等待其 receipt 后关闭；EOF、ERROR、协议异常和运输故障清理本地状态。

0.1.2 不支持 STOMP 1.0/1.1（候选已实现，见顶部状态表）；不支持 WebSocket、TLS、自定义未知命令、自动重连、持久化 outbox、业务重试或 exactly-once 保证。destination 是不透明字符串；队列命名、NACK 重投递、持久化和服务端事务语义取决于 broker。底层连接必须是可靠、有序的双向字节流。通用 Frame 可携带 CONNECT 凭据 header，TCP `connect()` 便利入口仅实现无凭据连接；不会读取系统凭据。

## 从源码运行

从本仓库获取源码并进入含 moon.mod 的项目根目录。0.1.0/0.1.1 tag 保留对应正式历史。使用已经安装的可信 SDK，不需要 npm 安装或 registry 拉取。固定工具版本见 [toolchain.lock.json](toolchain.lock.json)：

- `moonc v0.10.14+7d59c7ec9 (2026-09-18)`
- `moon 0.1.20260920 (914d7da 2026-09-20)`
- 已验证 Node `v24.18.0`、Python `3.14.6`、macOS arm64；已发布版本另有 Linux CI。真实 broker runner 仅 macOS 实跑，0.1.2 的准确远端 CI 状态见版本发布记录；其他系统与工具版本未实测。

```sh
# 换成你的现有 SDK 路径；MOON_HOME 可指向本任务独立副本。
export MOON_HOME="/absolute/path/to/moonbit-sdk"
export MOON_BIN="$MOON_HOME/bin/moon"
export PATH="$MOON_HOME/bin:$PATH"
python3 scripts/verify.py --output ../moonstomp-verification
```

脚本检查固定版本，串行执行检查、构建、JS/wasm-gc 单元测试、离线示例、JS 边界、独立差分和独立下游候选包消费，将命令、退出码、日志和源码 SHA256 保存到新建的输出目录。输出必须在源码目录外，每次使用新目录。脚本不会下载软件；默认流程不启动或连接真实 broker，额外指定官方发行包/校验文件和 Java 参数时才运行本地 broker。

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

Mooncakes 包名为 [sundaysebasidian-byte/moonstomp](https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp)。安装固定 `0.1.2`，并在 `moon.pkg` 导入该包为 `@stomp`。0.1.2 已通过空缓存正式安装，61 文件与发布 ZIP 一致，JS/Wasm-GC 各 6/6，安装包适配器四项回环通过；准确提交和校验和见 [发布记录](docs/publication-0.1.2.zh-CN.md)。旧 0.1.1 的 53 文件/两后端各 5 项与 0.1.0 的 49 文件/各 3 项证据保留，不代表新版安装结果。

当前六项消费模板在 `validation/consumer/`：三个业务场景、两个 0.1.1 边界回归和一个 0.1.2 单调时钟回归。旧 0.1.1 五项模板在 `validation/registry-0.1.1/`，不用于宣称新版验证。完整当前消费例可从源码或候选包根目录复制到新工程：

```sh
mkdir ../moonstomp-consumer
cp validation/consumer/main.mbt.in ../moonstomp-consumer/main.mbt
cp validation/consumer/moon.pkg.in ../moonstomp-consumer/moon.pkg
cat > ../moonstomp-consumer/moon.mod.json <<'JSON'
{"name":"independent/moonstomp-registry-consumer","version":"0.1.0","license":"MIT"}
JSON
cd ../moonstomp-consumer
moon add sundaysebasidian-byte/moonstomp@0.1.2
moon check --target js -j 1
moon build --target js -j 1
moon test --target js --package independent/moonstomp-registry-consumer -j 1
moon run . --target js -j 1
```

将最后四条的 `js` 换成 `wasm-gc` 可复验另一个后端。三个场景为媒体任务、传感器读数和账目批次；服务器帧是明确的离线 fixture，事务 ACK 回滚不能当作真实 Artemis 已支持。

独立消费本地 `moon package` ZIP 可运行 `python3 scripts/downstream.py --output ../moonstomp-downstream --transport`；该流程包含真实解压包自身的 Node bridge 构建、加载和四项回环边界测试。它仍是本地 path 依赖，不等于正式 registry 安装、真实 broker 或第三方采用。复用范围见 [docs/reuse-review.zh-CN.md](docs/reuse-review.zh-CN.md)。

## Node 适配器从候选包使用

安装 MoonBit 包不会自动生成 Node 适配器依赖的 `bridge.js`。候选 ZIP 解压到独立可写目录后，使用固定可信 SDK 运行 `moon build --target js --deny-warn -j 1`，再在该目录运行 Node 例或 `require('./transport/tcp.cjs')`。本版不分发预构建 JS；仅 `moon add` 然后直接 require 未构建的依赖目录会缺少 bridge。不要修改共享 SDK 或只读依赖缓存。

`python3 scripts/downstream.py --output ../new-candidate-consumer --transport` 对真正的候选 ZIP 解包，完成 JS/Wasm-GC 外部模块各 6 项测试、编译该包的 JS bridge、运行包内适配器与 4 项回环边界测试。六项为三个业务场景、两项 0.1.1 回归和一项 0.1.2 单调时钟回归；这些是本地候选消费，不是 0.1.2 registry 消费。

`connect()` 的 CONNECTED 及 `receipt()` 的特定回执由内部等待者优先处理，宽泛 `waitFor(() => true)` 不再抢走控制事件；其他普通等待者仍按注册顺序取首个匹配项。使用回执方法应读取其返回值，普通事件循环接收其余事件。host 必须是非空字符串，在创建连接前检查。

## 三个完整场景

离线演示一次走完三个场景与安全断连，服务器帧由样例提供，仅说明 API：

```sh
moon run examples/offline --target js -j 1
```

1. **任务生产消费**：订阅任务 destination → 发送含 NUL 的二进制任务 → 收到 MESSAGE → 按业务内容处理。对应 `examples/1-tasks.cjs`，真实 broker 例还检查 SUBSCRIBE/SEND/UNSUBSCRIBE receipt。
2. **ACK/NACK 可靠处理**：使用 `client-individual` → 成功任务 ACK → 失败任务 NACK → 等待处理 receipt。对应 `examples/2-reliable.cjs`。NACK 后的重投递或死信策略由 broker 决定，样例不承诺必然重试。
3. **事务 commit/abort**：BEGIN → 暂存 SEND → ABORT 后观察未投递 → 另一次 BEGIN/SEND → COMMIT 后收到发布内容。对应 `examples/3-transactions.cjs`；单元测试另外覆盖事务 ACK/NACK 的暂存、回滚及重叠拒绝。

真实 broker 例要求你已运行一个支持 STOMP 1.2、无凭据的本地 broker。默认 `127.0.0.1:61613`；仅接受 `127.0.0.1` 或 `::1`，不会向公网发送测试。下面三条已在 Artemis 2.57.0 的已记录配置实跑通过：

```sh
moon build --target js -j 1
node examples/1-tasks.cjs
node examples/2-reliable.cjs
node examples/3-transactions.cjs
```

端口可用 `STOMP_PORT` 指定。复现 runner 使用已经下载的官方发行包和既有 Java 17，自动创建仅回环、无持久化/Web/JMX 的临时实例，运行三例和补充检查，结束停止并删除临时 runtime，不修改全局环境。本次只在 macOS arm64 实跑；runner 的监听/内存审计依赖本机 lsof/ps，其他平台未验证：

```sh
python3 scripts/verify.py --output ../moonstomp-with-artemis --transport \
  --broker-archive /absolute/path/apache-artemis-2.57.0-bin.tar.gz \
  --broker-checksum /absolute/path/apache-artemis-2.57.0-bin.tar.gz.sha512 \
  --broker-java-home /absolute/path/java17/Contents/Home
```

默认端口 61613 已被占用时，用 `--broker-port` 选择一个空闲回环端口（配置校验、监听校验、客户端与 wire trace 使用同一端口；`broker-run.py` 对应参数为 `--port`）。再加 `--go-peer` 即同时运行 Go ↔ Artemis ↔ MoonBit 三版本互通。2026-10-18 本轮实跑所用命令（`MOON_HOME` 指向锁定 SDK，`go-peer` 由 `scripts/build-go-peer.py` 用 Go 1.27.1 构建）：

```sh
python3 scripts/verify.py --output /new/empty/dir --transport \
  --broker-archive /absolute/path/apache-artemis-2.57.0-bin.tar.gz \
  --broker-checksum /absolute/path/apache-artemis-2.57.0-bin.tar.gz.sha512 \
  --broker-java-home /Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
  --broker-port 62613 \
  --go-peer /absolute/path/go-peer
```

runner 会校验官方 SHA512 和已锁定摘要；不会下载软件或连接公网 broker。官方下载信息与复现步骤见 [docs/broker-plan.zh-CN.md](docs/broker-plan.zh-CN.md)，已测 profile 与限制见 [docs/broker-interop.zh-CN.md](docs/broker-interop.zh-CN.md)。

## 分层与资源上限

| 层 | 文件 | 责任 |
| --- | --- | --- |
| 帧与 codec | frame.mbt / headers.mbt / decoder.mbt | 字节、header、正文、增量语法与致命错误 |
| 会话与时钟 | client.mbt / heartbeat.mbt / api.mbt | 命令、订阅、事务、ACK、receipt、协商与单调时间 |
| JS 边界 | bridge/main.mbt | 明确的 JSON header/event 与字节正文边界，隐藏编译器内部表示 |
| TCP glue | transport/tcp.cjs | Node net、有限等待/缓存、运输错误及关闭 |

默认单行 8192 字节（包含 CR，不含 LF）、128 个 header、1 MiB 正文、每次 feed 1024 事件（包括心跳）。可通过 `Limits::new()` 设置；Client 内部使用默认 Decoder。Client 出站**每对** header 名值 UTF-8 合计不超过 2047 字节，最多 128 个最终 wire headers、1 MiB 正文；0.1.1 将自动补的长度计入 header 预算。默认各 256 个订阅（含等待退订回执）、事务、待 receipt，1024 个待确认消息。单独 encode 不使用 Limits；这些上限不是总 RSS、返回事件总正文或调用者分配预算。

0.1.1 中，带 receipt 的 UNSUBSCRIBE 直到收到相应回执才移除订阅，保留回执前在途 MESSAGE 的原 ACK 模式；禁止重复退订、提前 ID 复用。已经交付的消息在退订后仍能 ACK/NACK。`unsubscribe(id)` 无 receipt，立即移除；之后收到该 ID 的 MESSAGE 会关闭，因此需要排空时应通过 Frame 设置 receipt 或用 TCP receipt 便利方法。详细严格策略见边界文档。

TCP 默认缓存最多 1024 个业务/回执事件且 JSON 估算总量不超过 4 MiB，最多 256 个等待者，写缓冲最多 2 MiB。心跳已由核心更新存活时间，仅交付给当前匹配等待者，未观察的心跳不积压进业务队列。超限会拒绝或关闭；不无限排队。每个 Client 对应一次连接，不复用已关闭实例。CPU 测试脚本始终 `-j 1`。

JSON 队列预算不等于 raw body 预算，1 MiB 高 octet 正文及元数据可能超过 4 MiB 排队估算；应预先注册业务等待者。`waitFor` 超时不撤销已发送意图，服务端结果可能不确定；predicate 必须同步返回 Boolean、快速且无副作用；async/generator 函数在注册时拒绝，普通函数返回 Promise/非 Boolean 也报错。已有队列匹配报错返回 rejected Promise 且保留队列；实际接收路径匹配报错仍关闭连接。详细失败/关闭和诊断边界见 [边界文档](docs/boundaries.zh-CN.md)。

`receipt(command, headers, body, id)` 自行设置 receipt header：传入 header 不能再包含 receipt，body 须为 Buffer/Uint8Array。等待者已满、参数类型/结构无效、重复 receipt header 或同 ID 的旧回执尚未消费时，拒绝调用且不发送命令；先消费旧回执再复用 ID。`waitFor(predicate, timeout)` 的 predicate 须为函数，timeout 和 tickMs 不超过 Node 定时器的 2147483647 ms 范围。这些便利方法的预校验拒绝保留健康连接；后续核心协议校验、发送或运输故障仍采取关闭策略。

## 验证与许可

本地脚本覆盖正常、错误、边界、资源上限、所有三段切分点与 200 组多段切分、1 MiB 正文、假时钟、状态机、公开 API、连接清理。独立参考 `@stomp/stompjs 7.2.0`：401 个有效用例、1201 次参考分段解析比较；四项严格性差异保留在报告中。差分不会证明真实 broker 互操作或替代它。

GitHub Actions 配置见 [.github/workflows/ci.yml](.github/workflows/ci.yml)，覆盖 check/build/test/示例/差分/回环 TCP。首发提交 `16343c8b8cc5704984335acb2837ab85c9a5f096` 的 [远端 CI 已成功](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/36832378116)。0.1.0 的历史见 [首发证据](docs/publication.zh-CN.md)；0.1.1 准确提交/CI/安装见 [新版证据](docs/publication-0.1.1.zh-CN.md)，通过、失败、未测的中文验收矩阵见 [docs/acceptance.zh-CN.md](docs/acceptance.zh-CN.md)。

本地交付复核与已修复的生命周期边界见 [docs/delivery-review.zh-CN.md](docs/delivery-review.zh-CN.md)。真实 broker 已测范围有限，特别是该版本不支持事务 ACK；不能宣称完整兼容或比赛验收通过。

原创核心 MIT；参考测试文件 Apache-2.0，规范 CC BY 3.0，来源、范围和许可见 [docs/reference.zh-CN.md](docs/reference.zh-CN.md)。AI 辅助事实与需要参赛者理解的技术问题见 [AI_USAGE.md](AI_USAGE.md)。[Proposal.md](Proposal.md) 是技术参考，不是符合人工撰写要求的最终申报书。
