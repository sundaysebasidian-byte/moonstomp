# AI 辅助使用说明

MoonSTOMP 核心、测试、Node glue、文档和验证脚本由用户指定需求后，使用 Codex 辅助设计、生成、调试及整理。不能声明全部手工编写。参考实现仅用于差分，没有将参考 parser 移植成 MoonBit。错误测试保留严格标准；开发曾修复错误的外部 enum 构造、字节 literal、公开 Limits 构造缺失、断连缓冲与握手 timer 清理等问题。

人工职责：核对功能边界、解释设计、审阅源码与测试证据，最终自行写一页申报书并决定是否发布。章程要求“申报书务必人工撰写”；Proposal.md 仅为 AI 辅助技术事实参考。未代填身份/银行卡/电话/学历资料，未签或接受参赛诚信承诺。

建议参赛者能亲自解释并演示：

1. 为什么 frame 正文用 Bytes，`content-length` 按 octet 而不是字符数；如何让嵌入 NUL 不终止正文。
2. decoder 的 command/header/body/terminator 四阶段如何在任意 chunk 边界保持状态；为什么致命输入后不可复用。
3. 重复 header 为什么取首值，为什么 CONNECT/CONNECTED 不转义，以及未知转义和空格应如何处理。
4. 心跳为何取 MAX，0 如何禁用；单调毫秒时钟、任意数据刷新和容差如何测试。
5. `client` 累计 ACK 和 `client-individual` 的区别；事务确认在 COMMIT/ABORT 时如何调整本地状态；receipt 与业务成功的区别。
6. sans-I/O 核心与 socket glue 的分工；写入失败、EOF、容量超限为什么清理会话、waiter、timer 和缓冲。
7. 为什么 33 项单元测试和 401 例独立差分本身不能宣称 broker 兼容；真实 Artemis profile 中 NACK 丢弃、事务 ACK 不支持的限制如何影响业务。

交付优化复查另外修复了订阅 ID 复用与未确认旧消息混淆、回执等待者满仍发送命令、旧队列回执误判以及无人消费的心跳积压。每项均保留有行为意义的断言；运输字节容量 fixture 曾因匹配现有等待者而误触发，调整为不匹配该等待者的 receipt 后重跑，容量上限和失败断言未降低。详见 docs/delivery-review.zh-CN.md。

可从 `moon run examples/offline --target js -j 1` 开始，修改一条长度/ACK/心跳用例观察报错，核对 scripts/verify.py 的原始日志。理解未完成时不要将技术参考直接提交为人工申报。

本轮边界复核仍由 Codex 辅助完成，实际发现自动长度 header 未计预算及退订回执前丢失在途订阅两项缺陷，先新增回归观察 36 项中 2 项失败，再本地修复并增加清理/运输回归。新增待退订记录受原订阅容量约束；未扩展 broker、TLS、重连等范围。先完成本地候选后，现获用户明确补充授权推进 0.1.1；已发布 0.1.0 的测试记录不代替新版本证据，源码与人工申报仍需用户理解和审阅。
