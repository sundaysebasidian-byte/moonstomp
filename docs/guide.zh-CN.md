# 使用指南

面向第一次使用的人。能力边界以 [README](../README.md) 与 [边界文档](boundaries.zh-CN.md) 为准；这里只讲怎么用，并把每条用法指向能跑的东西。

## 1. 我想做什么 → 该看哪里

| 我想…… | 命令（仓库根目录；先 `moon build --target js`） | 说明 |
|---|---|---|
| 看一遍完整 API 走位，不起任何服务 | `moon run examples/offline --target js` | 纯 MoonBit：所有服务端帧由示例提供，不是 broker 证据 |
| 看 1.0/1.1/1.2 的 ACK 头差异与边界拒绝 | `moon run examples/versions --target js` | 纯 MoonBit，有逐字节 golden |
| 发布/订阅（topic 扇出、queue 分发） | `node examples/demo/01-pubsub.cjs` | 内置 demo broker |
| 带 receipt 的可靠发送；receipt 丢失意味着什么 | `node examples/demo/02-reliable-send.cjs` | 内置 demo broker |
| 手动 ACK / NACK（Subscription 句柄） | `node examples/demo/03-ack-nack.cjs` | NACK 是否重投由 broker 决定 |
| 事务 BEGIN/COMMIT/ABORT（Transaction 句柄） | `node examples/demo/04-transaction.cjs` | 内置 demo broker |
| 心跳与对端静默检测 | `node examples/demo/05-heartbeat.cjs` | 内置 demo broker |
| 同一套 API 跑 1.0/1.1/1.2 | `node examples/demo/06-versions.cjs` | 内置 demo broker |
| 登录凭据与结构化错误（被拒绝时怎么判断） | `node examples/demo/07-auth-errors.cjs` | 内置 demo broker 开启凭据检查 |
| 命令行发一条/收一条消息 | 见 §4 | `tools/stomp-cli.cjs` |
| 对真实 broker 跑 | `node examples/1-tasks.cjs`（等） | 需要你自己的本地 STOMP broker（Artemis 示例用匿名 broker；认证 broker 用 CLI 的 `--login`），见 §5 |

所有 `examples/demo/*.cjs` 的输出与 `examples/demo/expected/*.txt` 逐字节比对，由 `python3 scripts/usability-test.py` 执行，也是 `scripts/verify.py` 的 `demos-and-cli` 阶段（CI 会跑）。

## 2. 两种用法

**A. 无 I/O 核心（MoonBit）**：`Client::send(frame, now_ms)` 返回要写出去的字节，`Client::receive(bytes, now_ms)` 返回事件，`Client::tick(now_ms)` 返回需要写出的心跳字节。你自己负责读写套接字与调度时钟（单调、毫秒、`Int64`）。可运行的完整走位是 `examples/offline/main.mbt`；公共 API 清单见 `pkg.generated.mbti`。版本相关入口：`connect_versions`、`subscribe_versioned`、`acknowledge_message`、`encode_versioned`、`Decoder::new(version=…)`。

**B. Node TCP 适配器（JS）**：`transport/tcp.cjs` 导出 `TcpClient`，内部调用 MoonBit 编译出的 bridge，因此必须先 `moon build --target js`。

```js
const {TcpClient} = require('./transport/tcp.cjs');
const c = new TcpClient({host: '127.0.0.1', port: 61613});
await c.connect({versions: ['1.2']});   // 需要认证时：connect({versions: ['1.2'], login: 'user', passcode: process.env.PASS})
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
| `connect({virtualHost='localhost', versions=['1.2'], heartbeat='1000,1000', login, passcode})` | 提供 1–3 个版本；等 CONNECTED 最多 5 s；`login`/`passcode` 省略时不发送，空字符串会发送，含 CR/LF/NUL 的值在打开 socket 前被拒绝。仅提供 `['1.0']` 时默认 `heartbeat` 为 `'0,0'` |
| `new TcpClient({…, tlsOptions})` | `tlsOptions` 非 null 时用 Node `tls.connect`，必须校验证书（`rejectUnauthorized:false` 与传入已连接 socket 被拒）；自签 CA 用 `{ca}`，IP 以外的 host 自动作 SNI，可设 `servername`。默认执行主机名检查；高级 `checkServerIdentity` 回调可替换该检查，调用方承担其正确性，不能据强制证书链验证推断所有配置都安全。**已在脚本 peer 与真实 Classic 6.3.2 回环 TLS profile 验证；不代表生产网络验收** |
| `await subscribe(destination, {id?, ack='auto', headers=[]})` | SUBSCRIBE receipt 后返回 Subscription：`next(timeout=5000)`、`ack(frame, {transaction?})`、`nack(…)`、`unsubscribe()`；`ack`/`nack` 只接受该句柄 `next` 返回的原 frame。存在 MESSAGE subscription 头时按 id 路由（含 1.0）；仅 1.0 缺该头时按 destination 回退，此时同 destination 多订阅仍有歧义 |
| `await beginTransaction({id?})` | BEGIN receipt 后返回 Transaction：`send(destination, Uint8Array, headers)`、`commit()`、`abort()` |
| `send(command, headers, body)` | 发后不管，无回执 |
| `receipt(command, headers, body, id?)` | 自动加 `receipt` 头并等 RECEIPT（5 s）。**超时会关闭本连接**：结果未知，库不会替你重试 |
| `waitFor(predicate, timeoutMs=5000)` | predicate 必须同步返回 Boolean；超时只拒绝该等待，连接保持 |
| `disconnect()` / `stop()` | 带 receipt 的 DISCONNECT 后关闭 / 立即关闭 |
| `state()` / `version()` | `fresh｜connecting｜active｜disconnecting｜closed` / 协商版本字符串 |

错误：协议/参数/broker ERROR/句柄误用抛出带 `name`、`code`、`operation` 的错误（`STOMP_INVALID`、`STOMP_ARGUMENT`、`STOMP_BROKER_ERROR`（保留 `frame`）、`STOMP_HANDLE`）；恢复版增加 `STOMP_EVENT_TIMEOUT`（普通观察等待，保持连接）、`STOMP_CONNECT_TIMEOUT`、`STOMP_RECEIPT_TIMEOUT`、`STOMP_PEER_EOF`、`STOMP_TRUNCATED_STREAM` 与 `STOMP_CONNECTION_CLOSED`。Node I/O 原始 code 保留。receipt 失败另有 `operation`（命令）、`receiptId`、`outcomeUnknown` 和 `cause`（只有开始调用 `socket.write` 后才标记结果未知；本地验证/写缓冲拒绝为 false），broker 的 `frame` 保留。其他参数错误仍可能没有 code。

`new TcpClient({controlTimeoutMs: 5000})` 同时限制 CONNECT 与每个 receipt 等待；必须是 1..2147483647 的整数，构造后只读。`waitFor`/`Subscription.next` 的观察期限独立设置。控制等待失败后会话关闭、未完成的等待被拒绝，不会自动重连或重发。原始 `event timeout` 文本保留，调用方应优先使用 code。

COMMIT receipt 超时后 `Transaction.state === 'failed'` 只说明客户端没有确认结果，**不能解释成已回滚**。现在可读取 `transaction.outcome`，无需一直保存异常对象：这是**本地已观察到的结束命令回执状态**，不是向 broker 查询事务真实状态。业务仍应使用业务 ID/应用状态查询对账，再决定下一步；不会自动重试。STOMP receipt 只确认 broker 对帧的处理，不等于消费端业务处理、落盘或 exactly-once。

### Transaction.outcome：可查询、只读的本地结果

`transaction.outcome` 返回冻结快照 `{status, operation, receiptId, errorCode}`；不含消息正文、broker错误正文、凭据或cause。每次状态改变产生新快照，旧快照保持原值；`state` 原有值不变，兼容旧调用。

| status | 精确含义 |
|---|---|
| `not-requested` | 此句柄尚未开始 COMMIT/ABORT；若会话先关闭，不因此声称事务已回滚 |
| `pending` | 已开始结束流程，尚无终态；不等于已写入网络 |
| `confirmed` | 匹配的 RECEIPT 已收到；operation 区分 COMMIT/ABORT，receiptId 为对应回执ID |
| `not-sent` | 此次 COMMIT/ABORT 在 socket.write 边界前被拒绝；不说明之前 SEND/ACK 的结果，也不自动允许重放整个事务 |
| `unknown` | 已尝试写入但未获确认，或缺少足够分类证据；不能当作提交失败、回滚成功或安全重试 |

`operation` 初值null，其余为`COMMIT`/`ABORT`。`receiptId` 未分配/尚不可得时null，`errorCode`没有错误时null。无效/重复finish调用不会覆盖原终态；确认后disconnect不会把confirmed改为unknown。开始前的句柄/异步繁忙检查若拒绝，则保留原快照。有效命令的receipt前置参数/等待者容量检查失败的异常现在也带`outcomeUnknown=false`，仍不关闭健康会话；后续socket写缓冲容量拒绝虽然同样是`not-sent`，仍按既有适配器规则关闭会话，不能仅凭`not-sent`推断连接可复用。

```js
const transaction = await client.beginTransaction();
transaction.send('/queue/jobs', Buffer.from('job payload'));
try {
  await transaction.commit();
} catch (error) {
  // Record only local evidence; do NOT automatically resend on failed/unknown.
  console.error(JSON.stringify(transaction.outcome));
  throw error;
}
console.log(transaction.outcome); // confirmed, operation=COMMIT
```

运行 `node scripts/transaction-outcome-test.cjs` 可复现三版本成功/回执丢失、写前容量拒绝、等待者上限、会话先关闭和快照不可变性。使用真实TCP脚本peer故意控制回执，不冒充真实broker状态查询或生产互操作验收。

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
| 通用 | `--host`（默认 127.0.0.1）、`--port`（默认 61613）、`--versions 1.0,1.1,1.2`、`--heartbeat cx,cy`、`--vhost NAME`、`--allow-remote` |
| 认证与 TLS | `--login USER` 配 `--passcode-env VAR`（推荐）或 `--passcode PASS`（命令行对本机其他用户可见）；`--tls`、`--tls-ca FILE`、`--tls-servername NAME`（证书校验始终开启）；带登录的非回环连接必须 `--tls` |

退出码：`0` 成功；`1` 运行失败（连接被拒、超时、broker ERROR、核心拒绝）；`2` 用法错误。非回环主机需 `--allow-remote`（带登录时还需 `--tls`），本项目只在回环上测过。认证失败时 stderr 显示错误类别和 broker 的原因（引号括起、限长），不回显口令。`--format json` 输出 `bodyHex`，二进制正文可无损取回。

## 5. 对真实 broker

`examples/1-tasks.cjs`、`2-reliable.cjs`、`3-transactions.cjs` 与 CLI 都可指向你自己的本地 STOMP broker（默认 `127.0.0.1:61613`，环境变量 `STOMP_PORT` 可改端口，命令行用 `--port`）。已验证 Apache Artemis 2.57.0、Apache ActiveMQ Classic 6.3.2 和 RabbitMQ 4.1.8 三种真实 broker；各自的认证、TLS、心跳和事务测试范围见 [README](../README.md#真实-broker-互通) 与 [互操作记录](broker-interop.zh-CN.md)。

Artemis 的已验证启动路径使用官方发行包和已有 Java 17，仅监听回环地址；本项目未验证 Artemis Docker 镜像。RabbitMQ 则通过官方 `rabbitmq:4.1.8` Docker 镜像在 CI 中启动，启用 STOMP 插件并绑定回环端口，见 [workflow](../.github/workflows/rabbitmq.yml) 与[通过记录](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40288647089)。

## 6. demo broker 是什么、不是什么

`tools/demo-broker.cjs` 是几百行 JS 的内存 STOMP 测试对端：支持 1.0/1.1/1.2 协商、queue（轮转分发）、topic（扇出）、三种 ACK 模式、事务、receipt、心跳。它**不是**一致性参照，不是本项目的产品功能，也**不能**证明与真实 broker 互通（真实互通见三种 broker 的[测试记录](broker-interop.zh-CN.md)）。它的 NACK 策略默认“重新入队”（`--nack discard` 可改），而已记录的 Artemis 2.57.0 profile 是“丢弃”，所以 `03-ack-nack` 同时展示了两种。解析器刻意独立于被测的 MoonBit 编解码。

### Outcome 的真实 broker 正控

本轮另在隔离 Classic 6.3.2 TLS 上执行1.0/1.1/1.2 × COMMIT/ABORT六项正控：收到真实RECEIPT后 `confirmed`、receiptId一致，断开连接后快照保持。确认不等于持久化或业务完成；回执丢失/unknown仍仅由明确标记的脚本peer故障试验覆盖。

复用脚本 `scripts/classic-transaction-outcome-test.cjs` 仅连127.0.0.1，需已由隔离runner创建的测试broker、`STOMP_PORT` 和 `STOMP_TLS_CA`；沿用runner固定的非生产测试身份。脚本不启动或停止其他broker，不应对生产运行。原本地源码提交4e8ee03的runtime哈希与真实测试逐字绑定；该新增脚本/文档不修改运行时实现。
