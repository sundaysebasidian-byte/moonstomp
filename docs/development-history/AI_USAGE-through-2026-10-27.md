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

可运行 examples/offline 并修改长度、ACK 或时钟用例观察错误。代码与技术说明需要维护者理解和审阅；AI 协助情况在本文件披露。

2026-10-14：Codex接续原仓库的独立review分支。新增/修正STOMP多版本源码草案与针对测试，ODS只核生态、修正发行状态并记录reader/mbtexcel最小方案。包含独立只读源码审查及所发现问题的修正。官方SDK脚本HTTP403、moon/moonc缺失，新增MoonBit源码未编译或执行；不声称完成运行验证、ODS reader或跨格式消费。

2026-10-15：Codex接续原review分支并经独立只读审查。STOMP修混合offer并写真实go-stomp/broker测试glue；ODS只准备独立LODev外部样本、固定oracle和负控制，不冒称reader或跨格式实现。SDK官方请求仍403，17项MoonBit测试未执行；保留真实失败、静态与fixture结果各自范围。原恢复包和提交历史保留。

2026-10-20：Claude 辅助整合两条并行分支：核心补强（login/passcode、结构化 JS 错误、Subscription/Transaction 句柄、TLS、ActiveMQ Classic 6.3.2 认证互操作、Python 3.9 兼容）与可用性整理（README、示例、CLI）。随后让 CLI 和示例使用新 API，并按实测事实同步 README、Proposal.md 和状态/边界文档。未实现重连；TLS 只在本机脚本 peer 上验证，Classic 事务 ACK 与 NACK 重投递未测。

2026-10-20（私有隔离恢复）：Codex 基于 GitHub review/moonbit-20261015-sync 的 62694580a9c58aec9eb2199e2e1f9685b5e30781 补强 receipt/EOF/控制等待错误上下文、可配置控制期限、Classic TLS profile 与失败证据守卫、源码获取说明和设计取舍。适配器故障注入使用明确的协议/socket 替身；不是 MoonBit、真实 TCP 或 broker 互通证据。SDK 官方下载失败，未运行本次核心、脚本 peer 或真实 broker TLS 回归；未公开推送或发布。详见 https://github.com/sundaysebasidian-byte/moonstomp/blob/32090a84c0d4fd31359f764b4c92ffa16db7671c/docs/recovery-20261020.zh-CN.md。

2026-10-20（真实 broker 续验）：按官方 Wasm 工具链渠道恢复编译器及配套 moon/moonrun，Apache 官方 Classic 6.3.2 归档续传并经 SHA512 校验。当前源码 JS 核心70/70、实际TCP/TLS脚本peer、七demo/CLI及真实Classic TLS认证/三版本事务/提交前断线检查通过。当前兼容工具链的Wasm GC在独立常量断言模块也失败，保留失败，不声称全量或锁定工具链通过。只补测试和事实说明，未新增产品功能或公开推送。

2026-10-20（三分钟交付打磨）：Codex 复用既有 Classic runner，增加仅 STOMP1.2 的 --tls --demo 演示入口和演示专用回环 TLS receipt 丢弃中继；没有增加产品 API 或重跑完整三版本矩阵。实测真实认证/事务/receipt未知不重放、两条故意失败的清理与输出不泄露测试标记；演示边界/准备条件/三分钟讲解收拢在既有恢复说明。Wasm GC 失败不被本演示替代。

2026-10-22（Linux 审计与提交准备）：Codex 在同一历史源码保留原始改动，执行 JS70/70、源码 ZIP 独立消费者6/6、真实 Classic TCP/TLS三版本、receipt丢失不重放、真实心跳丢流量和失败清理检查；命令与原始回执见 https://github.com/sundaysebasidian-byte/moonstomp/blob/32090a84c0d4fd31359f764b4c92ffa16db7671c/docs/linux-audit-20261022.zh-CN.md 及交付 evidence。普通Wasm/Wasm GC独立控制模块失败、native runtime及mooncake缺失分别保留，不把源码ZIP当成正式package/registry安装。此次提交准备复用现有演示，只完善快速上手、独立消费者文档、贡献/取舍、许可来源和可解释边界；最终包的实际复现以新回执为准。本阶段未增加产品 API；测试不证明生产采用或跨实现性能优势。
