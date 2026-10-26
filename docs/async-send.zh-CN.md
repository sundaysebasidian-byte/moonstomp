# 有界异步 SEND（0.3.0 起，当前安装版本 0.3.1）

在包含本特性的源码根目录，使用已有MoonBit SDK和Node即可运行完整的[三条合成记录示例](../examples/demo/08-async-send.cjs)：

```sh
moon build --target js --frozen -j 1
node examples/demo/08-async-send.cjs
```

示例自带内存demo peer，仅监听随机回环端口；展示导入、连接、配置队列上限、一个有界批次的逐项结果、观察订阅消息及finally清理，不下载broker或npm依赖。三次本机写入成功均为`brokerReceipt:false`；随后观察到三条有序消息是另一项应用观察，不是持久化或逐条receipt证明。失败时检查每项`outcomeUnknown`且不重发整批；传输队列有界不代表调用方可以无限创建Promise和消息体，应用批次也须有界。慢读、取消与超时覆盖仍由下文专用测试提供。`moon add sundaysebasidian-byte/moonstomp@0.3.1` 添加 MoonBit 包依赖，不会直接导出 Node 适配器。`sendAsync` 已包含于 0.3.0/0.3.1 对应源码和发布归档；Node 使用方式是构建该版本 bridge 并导入 `transport/tcp.cjs`，不是 npm 安装或根包 MoonBit API。

`await client.sendAsync(destination, body, {headers, timeoutMs: 5000, signal})` 只发送 SEND，FIFO 串行处理，复制输入，等待本机写回调，并在 `socket.write()` 返回 false 时等 drain。成功返回 `{localWriteComplete:true, brokerReceipt:false}`，不代表 broker 接受、持久化或业务完成。默认最多64项、4MiB待发预算、每帧保守估算1MiB；通过构造参数 `maxPendingSends/maxPendingSendBytes/maxSendFrameBytes` 调整，单帧最多2MiB，自定义头最多126项；实际socket待写字节加新帧仍不得超过2MiB。估算含头转义上界，可能保守拒绝。

`timeoutMs` 包含排队与写入等待，范围1..30000ms。取消/超时在尝试 socket.write 前为 outcomeUnknown=false；尝试后为 true 并关闭连接，取消所有待发项，绝不重发/重连。队列上限和预取消拒绝不会关闭健康会话。`pendingSends/pendingSendBytes` 包括当前活动项，完成后归零。每项自有期限、AbortSignal监听均清除。

期限使用单调时钟，写前（包含编码后）及本机完成边界都会检查，不能仅靠可能延迟的定时器回调。事件循环被同步工作占住时，恢复后不会发送已经过期的排队项；已经尝试写入但完成观察逾期则保持未知结果。Node 不能抢占调用方同步工作，这不是实时调度保证。

同步 send/ack/receipt 在异步队列存在时以 STOMP_ASYNC_BUSY 拒绝，调用者先 await 队列再做控制操作；Subscription/Transaction在busy预检时保留原状态和未完成读取，队列清空后可重试。disconnect 的 finally 会 stop，故排队时调用 disconnect 会取消全部待发项。同步原有2MiB缓冲保护保留。心跳在没有背压时可穿插在完整帧之后；tick始终检查入站死亡检测。若发送心跳到期而socket仍needDrain，则以STOMP_HEARTBEAT_BACKPRESSURE关闭，绝不追加字节或无限推迟检测；因此心跳可能早于SEND期限结束会话。该规则也覆盖仅由原同步写入产生的背压。

需要逐条 broker 回执时，队列清空后把现有 `receipt('SEND', ...)` 作为该消息的唯一发送；它会实际发送另一条 SEND，不能对已 sendAsync 的同一消息补发以追认，否则可能重复业务。sendAsync 不接收 receipt 头，本机完成不当作 broker 回执。broker 测试的 receipt-fence 是另一个标记消息，只有该标记的回执，不是前16条的逐条回执。核心 MoonBit sans-I/O 状态机不变。

真实 TCP 暂停读取/恢复、持续不读、取消、断线与限制：`node scripts/async-send-test.cjs`。短真实 TLS broker 案例：既有 `classic-run.py --tls --async-send`，需合法缓存broker/JDK与新输出目录。二者不等于生产采用或长期稳定性。

依据 Node 官方 Writable 契约：write(false) 已接受该 chunk，应在 drain 后继续，不能重写同一帧：https://nodejs.org/download/release/v24.18.0/docs/api/stream.html#event-drain 。0.2.1 不含该接口；0.3.1 的精确 head 常规及真实 broker CI、实际 registry 包 Node 适配器消费均通过，见[发布回执](release-0.3.1.zh-CN.md)。短 TLS 异步案例与远端五分钟源码场景分别记录，不能等同生产采用或已安装包五分钟负载。
