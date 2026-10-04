# AI 辅助使用说明

MoonSTOMP 的 MoonBit 核心、测试、Node 适配器、文档和验证脚本使用 Codex 辅助设计、生成、调试与整理。不能声明全部手工编写。固定参考 @stomp/stompjs 仅用于独立差分测试，没有将其 parser 移植成 MoonBit；来源和许可见 docs/reference.zh-CN.md。

开发过程保留严格的正常/错误/容量断言。曾修复长度预算、订阅 ID 复用、退订回执前在途消息、回执等待者、握手定时器和失败缓冲清理问题。0.1.2 增加所有存活状态的单调时钟检查、内部 CONNECTED/RECEIPT 优先等待、非空 host 与同步 Boolean predicate 合约；空字节 tick 调用曾被测试计数器误当作实际发送，修正为只计非空写入，仍要求被拒绝的命令零发送。

2026-10-03 增加四项有界生成解析测试，以及 64 个外部 MESSAGE、256 次真正增量接收比较。核心两个后端各 44 项；实际 package 消费两后端各 6 项，Node 运输 14 项。有限测试不能证明所有输入或完整协议兼容；真实 Artemis 实测的版本、时间、NACK 策略和事务 ACK 限制另行记录。

维护者及使用者应能解释和演示：

1. Bytes、octet 长度与正文中的 NUL；header 四种转义、重复首值和 CONNECT/CONNECTED 例外。
2. decoder 的四阶段、任意 chunk 边界、poisoning 与错误/EOF 清理。
3. 双方 MAX 心跳协商、零值禁用、单调时钟和接收容差。
4. client 累计 ACK 与 client-individual、事务 COMMIT/ABORT 和 receipt 的协议含义。
5. sans-I/O 核心与 TCP 的职责、容量预算、连接失败和等待者/定时器清理。
6. 自造 peer、独立参考、实际包消费与真实 broker 各自证明什么，以及未测范围。

可运行 examples/offline 并修改长度、ACK 或时钟用例观察错误。代码与技术说明需要本人理解和审阅；竞赛最终申报须本人按官方要求撰写。本文件与 Proposal.md 是 AI 辅助技术资料，不是人工申报书。
