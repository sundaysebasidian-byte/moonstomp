> 本页部分互通描述为历史范围；本轮事务累计ACK/NACK修复及Classic6.3.2真实验证见[复审回应](review-response-20261030.zh-CN.md)，不扩大为其他broker的实测。

# 支持边界与失败行为（0.3.1）

> **候选版本说明（2026-10-30）**：以下发布版记录保留其原日期；本目录未发布修复及新测试以 [本轮逐条回应](review-response-20261030.zh-CN.md) 和 [复现说明](reproduce-review-20261030.md) 为准。源码四后端 79/79 不等于旧 registry 包新增后端消费验证。

当前安装版为 [MoonSTOMP 0.3.1](https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp@0.3.1/)。支持 STOMP 1.0、1.1、1.2；Node 适配器提供 TCP/TLS、有界异步 SEND。发布提交、registry 消费与源码 CI 分别见[发布回执](release-0.3.1.zh-CN.md)和[技术证据索引](TECHNICAL_EVIDENCE.zh-CN.md)。

旧 0.1.2 的“仅 1.2、无真实 TLS 验证”属于历史状态，保留在[原提交](https://github.com/sundaysebasidian-byte/moonstomp/blob/3589fbdc2528a085b5937c4212029ffd8ca96836/docs/boundaries.zh-CN.md)，不适用于当前版本。

## 协议、传输与验证

| 范围 | 当前行为与限制 |
| --- | --- |
| 协议 | 按协商版本处理 CONNECT、头部转义及 ACK/NACK；正文是 Bytes，支持 NUL/二进制与 LF/CRLF。重复 header 保存、按首值解释。版本差异见[版本示例](../examples/versions/main.mbt)。 |
| codec 与会话 | encode/Decoder 检查帧语法；必需 header、方向和时序由 Client 检查。单独 encode 不受 Client 的容量预算保护。 |
| 核心后端 | 0.3.1 干净 registry 消费验证 JS、Wasm GC；native、普通 Wasm、Windows 消费者未验证。Node bridge 只用于 JS，不能把整个含 JS extern 的工程直接切换为其他后端。 |
| Node 适配器 | 支持认证、强制证书链校验、默认主机名校验的 TLS、Subscription/Transaction 句柄、结构化错误及 `sendAsync`。没有 WebSocket、自动重连或自动重发；按对应源码构建使用，不是 npm 包。 |
| Classic 6.3.2 | 真实回环 TLS 三版本、认证负控制、receipt-loss、100/1000ms 心跳观察及主动 drop 后关闭、短异步发送和清理已验证；源码另跑过五分钟场景。两类证据不能互相替代。 |
| RabbitMQ 4.1.8 | 当前源码 CI 验证三版本二进制/头部、事务 SEND、1.1/1.2 NACK 重投递；以 `1000,1000` 请求心跳，收到两次服务端心跳；20 条异步 SEND 有序到达。未定向截断任一心跳方向，也未做 TLS/持久化测试。 |
| Artemis 2.57.0 | 历史回环 TCP/go-stomp 互通记录见[对应 profile](broker-interop.zh-CN.md)。其 NACK 丢弃和事务 ACK 不回滚属于该配置，不能推成其他 broker 的行为。 |

上述 broker 均为隔离测试配置。没有生产 PKI、mTLS、故障转移、长期稳定性或真实用户采用证据。destination 是不透明字符串；receipt 不等于业务持久化，ACK 不等于数据库提交，STOMP 事务不提供跨系统原子性或 exactly-once。

## 容量与时钟

- Decoder 默认单行 8192 字节、128 headers、1 MiB 正文、每次 feed 1024 个事件；心跳也计事件。Client 使用默认 Decoder 限制。
- Client 每对 header 名值最多 2047 个 UTF-8 原始字节、最多 128 个最终 wire headers、正文最多 1 MiB；自动 `content-length` 占一个 header 槽。默认会话容量为各 256 个订阅/事务/receipt、1024 个待确认 delivery。
- Node 最多排队 1024 个事件、JSON 估算 4 MiB、256 个等待者；同步写缓冲上限 2 MiB。异步队列另限数量、字节和期限，等待 drain；具体契约见[异步 SEND](async-send.zh-CN.md)。这些预算不是 RSS、CPU 时间或吞吐保证。
- core 接收调用方的非负单调毫秒时钟，由 `tick` 推进。心跳按双方 MAX 协商，0 禁用方向。0.3.1 Client 接收容差为 `min(R+100ms, 2147483647ms)`，严格超过 `R+tolerance` 才关闭；独立 `HeartbeatClock` 默认容差仍为 100ms。任意事件循环阻塞仍可能超时。

## 失败与调用方责任

| 事件 | 可观察结果 |
| --- | --- |
| 非法帧、超限、截断 | Decoder 不返回该批部分成功；Client 关闭并清理协议状态。 |
| send 参数/容量错误 | core 不登记新操作意图；成功返回只代表本地意图，随后运输失败必须关闭。 |
| broker ERROR | Node 报 `STOMP_BROKER_ERROR` 并保留 frame，关闭运输和等待者。不要将原始敏感帧写进公开日志。 |
| 观察等待超时 | 普通 `waitFor` 只移除该等待者；CONNECT/receipt 等控制等待失败会关闭，避免迟到回执混淆。已尝试写入时可能为 `outcomeUnknown`，不能自动重放。 |
| 异步取消/超时/断线 | 区分排队未发送和已尝试写入；本机写入完成与 broker receipt 分开。取消不撤回 broker 已执行的命令。 |
| 退订 | 需要排空在途消息时等待 UNSUBSCRIBE receipt；无 receipt 退订立即移除本地订阅，随后未知订阅 MESSAGE 会关闭。 |
| 用户 predicate | 必须快速、同步返回 Boolean。已有队列匹配失败保留队列；接收路径匹配失败会关闭。没有任意回调隔离或线程安全保证。 |

完整 STOMP 一致性认证、事务 ACK 回滚、跨 broker 一致重投递、持久化和生产负载仍不在已验证范围。协议来源见 [STOMP 1.0](https://stomp.github.io/stomp-specification-1.0.html)、[1.1](https://stomp.github.io/stomp-specification-1.1.html)、[1.2](https://stomp.github.io/stomp-specification-1.2.html)；实现对照及归因见[对照文档](FAIR_GO_STOMP_COMPARISON.zh-CN.md)。

## TLS高级选项的信任边界

适配器拒绝 `rejectUnauthorized:false` 并强制设为true，因此证书链校验不能用该选项关闭；Node默认执行主机名校验。但高级 `tlsOptions.checkServerIdentity` 会传入Node，可由调用方替换主机名检查，不能声称所有配置下身份校验均不可弱化。高级TLS回调和信任CA由调用方负责；本轮真实TLS负控使用标准主机名校验配置。参考 [Node TLS checkServerIdentity](https://nodejs.org/api/tls.html#tlscheckserveridentityhostname-cert)。
