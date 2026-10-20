# 使用指南

面向第一次使用的人。能力边界以 [README](../README.md) 与 [边界文档](boundaries.zh-CN.md) 为准；这里只讲怎么用，并把每条用法指向能跑的东西。

## 1. 我想做什么 → 该看哪里

| 我想…… | 命令（仓库根目录；先 `moon build --target js`） | 说明 |
|---|---|---|
| 看一遍完整 API 走位，不起任何服务 | `moon run examples/offline --target js` | 纯 MoonBit：所有服务端帧由示例提供，不是 broker 证据 |
| 看 1.0/1.1/1.2 的 ACK 头差异与边界拒绝 | `moon run examples/versions --target js` | 纯 MoonBit，有逐字节 golden |
| 发布/订阅（topic 扇出、queue 分发） | `node examples/demo/01-pubsub.cjs` | 内置 demo broker |
| 带 receipt 的可靠发送；receipt 丢失意味着什么 | `node examples/demo/02-reliable-send.cjs` | 内置 demo broker |
| 手动 ACK / NACK | `node examples/demo/03-ack-nack.cjs` | NACK 是否重投由 broker 决定 |
| 事务 BEGIN/COMMIT/ABORT | `node examples/demo/04-transaction.cjs` | 内置 demo broker |
| 心跳与对端静默检测 | `node examples/demo/05-heartbeat.cjs` | 内置 demo broker |
| 同一套 API 跑 1.0/1.1/1.2 | `node examples/demo/06-versions.cjs` | 内置 demo broker |
| 命令行发一条/收一条消息 | 见 §4 | `tools/stomp-cli.cjs` |
| 对真实 broker 跑 | `node examples/1-tasks.cjs`（等） | 需要你自己的本地无凭据 STOMP broker，见 §5 |

所有 `examples/demo/*.cjs` 的输出与 `examples/demo/expected/*.txt` 逐字节比对，由 `python3 scripts/usability-test.py` 执行，也是 `scripts/verify.py` 的 `demos-and-cli` 阶段（CI 会跑）。

## 2. 两种用法

**A. 无 I/O 核心（MoonBit）**：`Client::send(frame, now_ms)` 返回要写出去的字节，`Client::receive(bytes, now_ms)` 返回事件，`Client::tick(now_ms)` 返回需要写出的心跳字节。你自己负责读写套接字与调度时钟（单调、毫秒、`Int64`）。可运行的完整走位是 `examples/offline/main.mbt`；公共 API 清单见 `pkg.generated.mbti`。版本相关入口：`connect_versions`、`subscribe_versioned`、`acknowledge_message`、`encode_versioned`、`Decoder::new(version=…)`。

**B. Node TCP 适配器（JS）**：`transport/tcp.cjs` 导出 `TcpClient`，内部调用 MoonBit 编译出的 bridge，因此必须先 `moon build --target js`。

```js
const {TcpClient} = require('./transport/tcp.cjs');
const c = new TcpClient({host: '127.0.0.1', port: 61613});
await c.connect({versions: ['1.2']});
await c.receipt('SUBSCRIBE', [['id', 'w'], ['destination', '/queue/jobs']]);
const incoming = c.waitFor(e => e.event === 'message');
await c.receipt('SEND', [['destination', '/queue/jobs']], Buffer.from('hello'));
console.log(Buffer.from((await incoming).frame.body).toString());
await c.disconnect();
```

### TcpClient 速查（以 `transport/tcp.cjs` 为准）

| 成员 | 行为 |
|---|---|
| `new TcpClient({host='127.0.0.1', port=61613, tickMs=25, maxQueue=1024, maxWaiters=256, maxQueueBytes=4 MiB})` | 参数非法立即抛错；一个实例只连一次 |
| `connect({virtualHost='localhost', versions=['1.2'], heartbeat='1000,1000'})` | 提供 1–3 个版本；等 CONNECTED 最多 5 s；仅匿名。仅提供 `['1.0']` 时默认 `heartbeat` 为 `'0,0'` |
| `send(command, headers, body)` | 发后不管，无回执 |
| `receipt(command, headers, body, id?)` | 自动加 `receipt` 头并等 RECEIPT（5 s）。**超时会关闭本连接**：结果未知，库不会替你重试 |
| `waitFor(predicate, timeoutMs=5000)` | predicate 必须同步返回 Boolean；超时只拒绝该等待，连接保持 |
| `disconnect()` / `stop()` | 带 receipt 的 DISCONNECT 后关闭 / 立即关闭 |
| `state()` / `version()` | `fresh｜connecting｜active｜disconnecting｜closed` / 协商版本字符串 |

事件形状：`{event:'message', frame:{command, headers:[[k,v]], body:number[]}}`、`{event:'receipt', id}`、`{event:'heartbeat'}`、`{event:'error', frame}`。`frame.body` 是字节数组，用 `Buffer.from(frame.body)` 还原。

## 3. 版本相关的 ACK 头

| 协商版本 | ACK/NACK 头 |
|---|---|
| 1.2 | `id` = MESSAGE 的 `ack` 头 |
| 1.1 | `subscription` + `message-id` |
| 1.0 | `message-id`（无 NACK；无 `client-individual`） |

`examples/demo/06-versions.cjs` 与命令行 `--versions` 展示了三者；核心会拒绝不合版本的组合（见 `examples/versions`）。

## 4. 命令行 `tools/stomp-cli.cjs`

两个终端（或把 broker 放后台）：

```sh
node tools/demo-broker.cjs --port 61613                      # 终端 1：内置 demo broker
node tools/stomp-cli.cjs subscribe --destination /queue/jobs --ack client-individual   # 终端 2：等一条
node tools/stomp-cli.cjs send --destination /queue/jobs --body 'hello 你好'              # 终端 3
```

| 子命令 | 常用选项 |
|---|---|
| `send` | `--body TEXT｜--body-file F｜--body-hex HEX｜--stdin`、`--header k=v`（可重复）、`--no-receipt`、`--tx commit｜abort` |
| `subscribe` | `--count N`、`--ack auto｜client｜client-individual`、`--nack-if SUBSTR`、`--timeout MS`、`--format text｜json` |
| 通用 | `--host`（默认 127.0.0.1）、`--port`（默认 61613）、`--versions 1.0,1.1,1.2`、`--heartbeat cx,cy`、`--allow-remote` |

退出码：`0` 成功；`1` 运行失败（连接被拒、超时、broker ERROR、核心拒绝）；`2` 用法错误。非回环主机需 `--allow-remote`，且连接是明文、匿名的，本项目只在回环上测过。`--format json` 输出 `bodyHex`，二进制正文可无损取回。

## 5. 对真实 broker

`examples/1-tasks.cjs`、`2-reliable.cjs`、`3-transactions.cjs` 与 CLI 都可指向你自己的本地 STOMP broker（默认 `127.0.0.1:61613`，环境变量 `STOMP_PORT` 可改端口，命令行用 `--port`）。本项目验证过的真实 broker 只有 Apache Artemis 2.57.0 的无认证、无持久化 profile；可复现的启动与验证命令见 [README](../README.md#真实-broker-复现) 与 [broker-plan](broker-plan.zh-CN.md)。

用 Docker 起一个 Artemis 只是常见做法，**本项目没有验证过任何 Docker 镜像**，所以不把它写成已验证路径；已验证路径是 `scripts/verify.py … --broker-archive` 那条（官方发行包 + 已有 Java 17，仅回环）。

## 6. demo broker 是什么、不是什么

`tools/demo-broker.cjs` 是几百行 JS 的内存 STOMP 测试对端：支持 1.0/1.1/1.2 协商、queue（轮转分发）、topic（扇出）、三种 ACK 模式、事务、receipt、心跳。它**不是**一致性参照，不是本项目的产品功能，也**不能**证明与真实 broker 互通（那由 Artemis + go-stomp 的记录负责）。它的 NACK 策略默认“重新入队”（`--nack discard` 可改），而已记录的 Artemis 2.57.0 profile 是“丢弃”，所以 `03-ack-nack` 同时展示了两种。解析器刻意独立于被测的 MoonBit 编解码。
