# MoonSTOMP 项目提案

以 MoonBit 实现 STOMP 1.2 字节流协议库与传输分层客户端，填补任务队列与现有 STOMP broker 集成的生态入口。原创实现，MIT；规范参考注明，不复制他人实现。

核心目标：增量帧解析与编码、UTF-8 header 转义、重复 header 首值、content-length 与含 NUL 二进制正文；连接协商、假时钟心跳、命令状态机、ACK/NACK、receipt、事务与安全断连。协议不依赖 socket；JS TCP 适配器连接用户指定的本地 broker。

至少三个完整场景：任务生产消费；显式 ACK/NACK 可靠处理；事务 COMMIT/ABORT。测试任意切分、连帧、错误输入与资源上限；真实 broker 互操作是验收必需项，缺少官方 broker 时如实列未测。

仅独立新目录及本地 Git。公开仓库、Mooncakes 发布、报名与敏感身份字段待用户处理或批准。内部按 10/24 前准备，官网现显示 10/31，正式最终时刻未确认。
