# MoonSTOMP 中文验收矩阵

记录日期：2026-10-01。状态描述本地、真实回环 broker、准确远端提交 CI 和正式 registry 消费的实际证据，不能据此宣布比赛验收通过。GitHub 与 Mooncakes 0.1.0 已发布；未报名、未替参赛者签署承诺。真实 Artemis 2.57.0 的限定 profile 已测；其他 broker 和真实事务 ACK 支持仍有缺口。

## 九项终验要求

| 要求 | 当前状态 | 证据与限制 |
| --- | --- | --- |
| 1. 公开代码仓库 | **已公开** | https://github.com/sundaysebasidian-byte/moonstomp ；v0.1.0 对应准确提交 16343c8b8cc5704984335acb2837ab85c9a5f096。隐私清理后保留全部 19 个真实开发阶段和时间，另有发布准备提交。 |
| 2. 主要实现为 MoonBit，源码清晰 | **本地通过（限定范围）** | 核心帧、编解码、心跳和 Client 状态机均为 MoonBit；Node 仅桥接/TCP，第三方 JS 仅测试参考。README 明示不支持 TLS、WebSocket、重连和旧协议。真实 Artemis 2.57.0 的八项例/检查通过；事务 ACK 不受该 broker 支持。 |
| 3. README 目标、安装、用法可复现 | **本地与正式 registry 消费通过** | 源码和本地候选消费通过；全新缓存通过 moon add 安装正式 0.1.0，独立模块 JS/Wasm-GC 分别 check/build/test/run，各三个业务场景通过。安装的 49 个文件 SHA256 与正式发布 ZIP 一致，非 path 依赖。 |
| 4. CI 包含 check/build/test | **准确首发提交远端通过** | [运行 36832378116](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/36832378116) 的 headSha=16343c8b8cc5704984335acb2837ab85c9a5f096，Linux CI check/build/test/示例/差分/回环 TCP 全部成功；官方固定 SDK、Node、Python。远端没有运行真实 broker，真实 broker 证据为本地已实跑结果。 |
| 5. 可运行示例 | **离线、独立下游和三个真实 broker 场景通过** | 独立消费者完整执行媒体任务、传感器读数、账目批次，输入/API/输出/断言见 `reuse-review.zh-CN.md`；原三个例另在实际 Artemis 实跑通过。自造 peer 证据仍与真实 broker 分开。 |
| 6. 核心正常、错误、边界与资源测试 | **本地通过；非完整一致性认证** | JS 33/33、Wasm-GC 核心 33/33；覆盖分段/连帧/重复 header/非法转义与长度/NUL 正文/假时钟/状态与容量，以及未结清订阅 ID 复用的累计确认边界。最终 ZIP 的原始日志和 SHA256 对应最终源码。有限用例不能证明所有输入。 |
| 7. Mooncakes 发布 | **0.1.0 正式发布及独立安装通过** | https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp ；registry metadata 为 MIT、准确 repository、0.1.0，checksum 与实际上传 ZIP 一致；独立缓存实际下载安装并运行。 |
| 8. OSI 开源许可 | **声明完成** | 原创代码 MIT；测试参考 @stomp/stompjs 为 Apache-2.0，保留原包许可；外部来源和规范许可记录于 `docs/reference.zh-CN.md`。 |
| 9. 引用与原创性合规 | **来源及 AI 披露完成；用户理解待确认** | 官方协议作为行为规范，未复制整篇规范；固定参考版本、来源、完整性及差异明确。`AI_USAGE.md` 如实披露 AI 辅助，提供解释问题；不能声称参赛者手写。 |

## 初审与准备条件

| 条件 | 当前事实 |
| --- | --- |
| 初始化工程与生态价值 | 已完成独立 MoonBit 模块、协议/运输分层、MIT 和技术事实参考。站内搜索未观察到直接同类，不能推断整个生态完全无同类。 |
| 至少三个完整使用场景 | 已提供且离线运行通过；独立下游三个不同业务场景、本地候选包消费通过，非第三方实际采用；原三个真实 broker 场景已在 Artemis 实跑通过。 |
| 有效研发历史 | 保留按模型、编码、解析、测试、会话、桥接、示例和消费验证推进的非空提交，清单及 bundle 在交付中。旧九月十提交条款是否适用于十月未最终确认，不将其自动列为十月硬门槛，不凑数。 |
| 人工申报书 | **未完成，必须由用户本人最终撰写**。`Proposal.md` 仅 AI 辅助技术参考；不代写并冒充人工申报、不代签诚信承诺。 |
| 身份与表单 | 未提交，身份证、银行卡、电话、学籍和协议由用户本人处理。 |
| 日期和奖励 | 官网与旧章程冲突已记录于规则说明；内部提前准备不等于已确认截止时刻。150 初审 + 350 验收均有条件，不保证收入。 |

## 证据分级

- **通过**：最终完整验证记录中退出码 0 的阶段；原始 stdout/stderr 独立保存。JS 桥接实跑，401 个有效差分用例/1201 次参考分段解析比较；四项严格性差异不改为参考实现的宽松行为。
- **通过但限定用途**：9 项运输生命周期/API 边界测试，其中回环连接采用脚本 peer；覆盖 receipt、等待、EOF、错误、容量、定时器清理、失败回执调用不发送、旧回执防误判和心跳不积压。不能当成真实 broker 互操作。
- **通过但限定消费来源**：独立下游模块从实际 `moon package` 候选 ZIP 以本地路径依赖消费，JS/Wasm-GC 各三项场景测试、可执行输出与公开 API 编译通过；原始日志在 `verification/downstream/`。本地候选消费不等于 registry 消费。
- **历史失败已修复**：外部示例枚举匹配、测试语法/参考边界与生命周期等缺陷按实际日志修正实现；没有降低测试标准。旧证据文件为阶段历史，以交付 `verification/` 的最终完整流程为准。
- **真实 broker 通过**：官方 SHA512 已核的 Artemis 2.57.0，三个完整示例 + 五项补充检查：分段 binary/header/重复首值、NACK 丢弃策略、累计 ACK、实际心跳、真实 ERROR。命令、退出码、实际字节、配置、监听、RSS 采样与停止/清理在 `verification/broker/`。
- **broker 限制已确认**：事务 ACK 不支持；该版本源码对 transaction ACK 告警后仍非事务确认，运行探针观察 ABORT 后未恢复。此项不是“事务 ACK 通过”，是能力限制。NACK 的不重投递策略也不推广到所有 broker。
- **未测/未完成**：其他 broker、支持事务 ACK 的真实互操作、认证/TLS/WebSocket/持久化配置、库的 TLS/WebSocket/重连等为明确不支持项。

## 真实 broker 实测与剩余缺口

用户已明确批准本地测试；官方 48,869,723 字节发行包经官方和锁定 SHA512 双校验，复用 Java 17.0.20，只有 127.0.0.1:61613 STOMP 监听，无持久化/Web/JMX，堆上限 256 MiB，处理器限制 2。三例、五项补充检查和事务 ACK 限制探针均记录；结束停止、确认端口释放并删除临时 runtime。没有向公网 broker 发测试。复现与限制见 `broker-plan.zh-CN.md`、`broker-interop.zh-CN.md`。

最终交付 ZIP 包含 `moonstomp/` 源码、`verification/` 原始命令日志与 JSON、`history/` Git bundle/提交清单、顶层交付清单。`verification.json` 记录工具版本、退出码、源码 SHA256 和未测项。源码及历史不包含 SDK、用户凭据、构建缓存或个人表单；broker 创建命令中的 local-test-only 是自造且未用于客户端登录的测试占位值。

本次交付优化的具体缺陷、修复与测试边界见 delivery-review.zh-CN.md。已完成公开、远端 CI 与正式包下游消费，具体证据见 publication.zh-CN.md；剩余协议限制与人工申报条件仍明确，不宣称比赛验收通过。
