# 0.1.0 发布门槛复核

用户已条件授权 GitHub 公开及按现有许可证发布 Mooncakes；2026-10-01 按已实现范围准备首发。真实 broker 的事务 ACK 限制和 NACK 丢弃策略维持明确声明，不将其改写为通过。

- 核心 MoonBit、资源上限、错误与时序、两个后端和独立候选消费可复现；实际 Artemis 三例/五项检查通过，事务 ACK 不支持已单列。
- 原创 MIT；仅测试的 stompjs 保留 Apache-2.0 LICENSE/来源/完整性；协议 CC BY 3.0 已归因。没有复制 SDK 或 broker 实现，没有 npm 运行时依赖。
- `sundaysebasidian-byte` 的 GitHub 数字 ID 与 Mooncakes 公共 profile 一致。同名 GitHub 仓库及 Mooncakes 模块在首发准备时不存在；包名/version 固定为 `sundaysebasidian-byte/moonstomp@0.1.0`，repository 指向本项目。
- 公开历史保留原 19 个真实阶段、消息、作者/提交时间及父子关系，仅将个人提交邮箱换为已核账号的 GitHub noreply，并把历史测试日志本机路径替换为 `<TASK_ROOT>/moonstomp`。提交 SHA 因这两项隐私清理改变；原历史保留在本地，不伪造研发进度。
- 检查全部历史和最终源码，不公开凭据、私钥、SDK、缓存或个人表单；公开第三方 fixture 中的作者/许可信息照原保留。`.moonignore` 排除比赛技术参考、阶段日志和工作流，GitHub 源码仍可审阅这些非私密材料。

首发必须等待准确远端提交的 CI check/build/test 成功，随后由正常 `moon publish` 使用已有认证，不提取/打印 token。发布后独立新工程须从 registry 安装并运行三个消费场景；本地 ZIP/path 消费不能替代这一项。缺少认证时停在官方安全登录流程，不生成 token 或代替用户接受协议。发布不等于比赛申报、验收或获奖。
