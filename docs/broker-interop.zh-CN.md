# Artemis 2.57.0 实际互操作 profile

2026-10-01。使用官方校验过的真实 Apache Artemis 与现有 Java 17.0.20；不是自造 peer。仅无凭据回环 TCP、无持久化、ANYCAST 默认路由配置。全部串行，完整复验记录在 `verification/broker/`。

| 项目 | 实际状态 | 证据与断言 |
| --- | --- | --- |
| CONNECT/CONNECTED 1.2、receipt、DISCONNECT | 通过 | 实际 CONNECTED 的 version:1.2/server:ActiveMQ-Artemis/2.57.0，回执 ID 对应，实例与客户端最后关闭。 |
| 任务生产消费 | 通过 | 原示例 1，SEND 的 [65,0,255] 正文在真实 MESSAGE 逐 octet 一致，订阅/发送/退订 receipt 完成。 |
| 显式 ACK/NACK | 通过；NACK 为该 broker 的丢弃策略 | 原示例 2 的 ACK/NACK 均有真实 receipt；补充探针 NACK 后退订/重订阅，300 ms 未观察重投递。不可承诺 NACK 重试。 |
| SEND 事务 | 通过 | 原示例 3，ABORT 后 300 ms 未观察投递，另一 BEGIN/SEND/COMMIT 后实际收到 publish。有限观察窗口不是无限期不投递证明。 |
| 分段 binary/header 与重复首值 | 通过 | 60 次小段 write，含 NUL/255/CR/LF 的五字节正文完整；Unicode/冒号/换行/CR/反斜杠/首尾空格 header 一致，重复取首值。 |
| 累计 ACK | 通过 | client 模式两个 MESSAGE，确认第二条；退订/重订阅后 300 ms 未观察旧消息重投递。 |
| 实际双向心跳 | 通过 | 1000,1000 协商，观察两个 server LF、至少一个 client LF，会话 Active、心跳不积压队列。 |
| 真实 ERROR | 通过 | 向本地 broker 故意发非法 BOGUS；收到 ERROR，核心关闭，timer 清除。 |
| 事务 ACK | **该 broker 不支持，已确认限制** | BEGIN/ACK(transaction)/ABORT 后重订阅未恢复消息。该版本 onAck 告警后仍执行非事务确认。核心模拟暂存/ABORT 测试通过，不代表 Artemis 可回滚 ACK。 |

官方手册列出事务确认不支持，见 [STOMP 限制](https://artemis.apache.org/components/artemis/documentation/latest/stomp.html)。其“忽略 ACK”的措辞与固定 2.57.0 的实际处理不能混为一谈：[onAck 源码](https://github.com/apache/artemis/blob/2.57.0/artemis-protocols/artemis-stomp-protocol/src/main/java/org/apache/activemq/artemis/core/protocol/stomp/v12/StompFrameHandlerV12.java) 告警后执行确认，本轮 ABORT 探针与之相符。

NACK 由 [2.57.0 onNack 源码](https://github.com/apache/artemis/blob/2.57.0/artemis-protocols/artemis-stomp-protocol/src/main/java/org/apache/activemq/artemis/core/protocol/stomp/v11/StompFrameHandlerV11.java) 与实际观察交叉确认：它委托 onAck 丢弃，不自动重投递。需要业务重试时须自行制定流程，不把协议 NACK 当成重试保证。

历史失败保留：首次扩展 runner 漏导出 options，修正帮助模块；第二次错误假定 NACK 会重投递，等待超时。核固定版本官方源码后，测试实际丢弃策略和事务 ACK 不回滚限制，未放宽核心协议断言。历史和最终日志分开；最终三个例/五项检查通过，事务 ACK 标“不支持”。

唯一回环监听、配置、RSS 采样、SIGTERM 退出、端口释放、临时 runtime 删除均记录。RSS 采样不是峰值保证。未测其他 broker、认证/TLS/WebSocket、持久化/高负载，不宣称完整 STOMP 一致性认证、生产可靠性或比赛验收通过。
