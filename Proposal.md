# MoonSTOMP 技术事实与提案参考（AI辅助，非最终申报）

以 MoonBit 实现 STOMP 1.2 字节流协议库与传输分层客户端，提供可复用的消息帧、会话和时钟能力。可用于任务队列、传感器数据流和批次确认等场景；生态检索范围有限，不能断言整个生态没有同类或已填补所有集成缺口。原创实现，MIT；规范参考注明，不复制他人实现。

核心目标：增量帧解析与编码、UTF-8 header 转义、重复 header 首值、content-length 与含 NUL 二进制正文；连接协商、假时钟心跳、命令状态机、ACK/NACK、receipt、事务与安全断连。协议不依赖 socket；JS TCP 适配器连接用户指定的本地 broker。

三个完整下游场景：媒体任务的二进制生产消费与 ACK/NACK；传感器消息流的增量多帧解析和心跳；账目批次的事务 ACK、ABORT 恢复、COMMIT 和 receipt。独立模块消费 `moon package` 本地候选产物，不等于 Mooncakes 消费；其模拟服务端帧也不算 broker 验证。输入、API、输出、断言和复用分析见 docs/reuse-review.zh-CN.md。另已在真实 Artemis 2.57.0 验证三个原始示例、分段二进制/header、累计 ACK、NACK 的丢弃策略、心跳及 ERROR。该 broker 不支持事务 ACK，第三个下游的事务确认仅为核心 API 模拟验证，不可宣称可在 Artemis 回滚确认。完整 profile 见 docs/broker-interop.zh-CN.md。

仅独立新目录及本地 Git。公开仓库、Mooncakes 发布、报名与敏感身份字段待用户处理或批准。内部按 10/24 前准备，官网现显示 10/31，正式最终时刻未确认。

章程要求申报书人工撰写，参赛者须本人最终撰写与解释。本文仅提供技术参考；未接受诚信承诺。
