# MoonSTOMP 客观技术事实（AI辅助，非最终申报）

原创 MoonBit STOMP 1.2 增量 codec、会话与假时钟核心，Node TCP 适配器。正文 Bytes、header 转义/重复首值、content-length/NUL、订阅与 ACK/NACK、receipt、事务 SEND/确认及断连。协议与运输分层，主要核心为 MoonBit，MIT，AI 辅助范围见 AI_USAGE。

正式 0.1.0/0.1.1 已公开且有准确 CI 和全新官方安装证据；本仓库提供 0.1.2 源码，正式 Mooncakes 仍为 0.1.1，不将旧版本 CI 或安装结果当作新源码结果。新增协商期时钟检查、内部控制回执匹配及同步 Boolean predicate 约束，仍无 TLS/WebSocket/重连。

可复用场景：媒体二进制任务单条 ACK/NACK、传感器连帧/auto ACK/假时钟、批次 SEND COMMIT/ABORT。独立模块消费采用公开 API，不证明第三方采用。实际 Artemis 2.57.0 的 NACK 丢弃、事务 ACK 不随 ABORT 恢复；离线账目契约不能当作其真实回滚能力。

本文件仅为 AI 辅助的项目技术事实，不能作为本人撰写的竞赛最终申报书；实际源码、测试与 CI 状态见 README 和 docs/source-sync-0.1.2.zh-CN.md。
