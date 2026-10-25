# 有界异步 SEND（未发布开发分支）

`await client.sendAsync(destination, body, {headers, timeoutMs: 5000, signal})` 只发送 SEND，FIFO 串行处理，复制输入，等待本机写回调，并在 `socket.write()` 返回 false 时等 drain。成功返回 `{localWriteComplete:true, brokerReceipt:false}`，不代表 broker 接受、持久化或业务完成。默认最多64项、4MiB待发预算、每帧保守估算1MiB；通过构造参数 `maxPendingSends/maxPendingSendBytes/maxSendFrameBytes` 调整，单帧最多2MiB，自定义头最多126项；实际socket待写字节加新帧仍不得超过2MiB。估算含头转义上界，可能保守拒绝。

`timeoutMs` 包含排队与写入等待，范围1..30000ms。取消/超时在尝试 socket.write 前为 outcomeUnknown=false；尝试后为 true 并关闭连接，取消所有待发项，绝不重发/重连。队列上限和预取消拒绝不会关闭健康会话。`pendingSends/pendingSendBytes` 包括当前活动项，完成后归零。每项自有期限、AbortSignal监听均清除。

同步 send/ack/receipt 在异步队列存在时以 STOMP_ASYNC_BUSY 拒绝，调用者先 await 队列再做控制操作；Subscription/Transaction在busy预检时保留原状态和未完成读取，队列清空后可重试。disconnect 的 finally 会 stop，故排队时调用 disconnect 会取消全部待发项。同步原有2MiB缓冲保护保留。心跳在没有背压时可穿插在完整帧之后；tick始终检查入站死亡检测。若发送心跳到期而socket仍needDrain，则以STOMP_HEARTBEAT_BACKPRESSURE关闭，绝不追加字节或无限推迟检测；因此心跳可能早于SEND期限结束会话。该规则也覆盖仅由原同步写入产生的背压。

需要 broker 回执时仍使用独立 `receipt('SEND', ...)`（队列清空后）；sendAsync 不接收 receipt 头，避免把本机完成当 broker 回执。核心 MoonBit sans-I/O 状态机不变。

真实 TCP 暂停读取/恢复、持续不读、取消、断线与限制：`node scripts/async-send-test.cjs`。短真实 TLS broker 案例：既有 `classic-run.py --tls --async-send`，需合法缓存broker/JDK与新输出目录。二者不等于生产采用或长期稳定性。

依据 Node 官方 Writable 契约：write(false) 已接受该 chunk，应在 drain 后继续，不能重写同一帧：https://nodejs.org/download/release/v24.18.0/docs/api/stream.html#event-drain 。0.2.1 registry 包不含本分支新 API。
