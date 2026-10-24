# master 636ef52 的本地消费者与真实 broker 接入

本页记录本地验收阶段以 **`636ef52a8022991b15b366bf3da23ccd5c51e9a0` + 文档补丁**为候选的结果。先将完整源码固定为 ZIP，解压到新的目录，从零生成 JS bridge；所有 broker 脚本和适配器都来自这份解压源码，未加载旧 v5 的构建产物。代码和版本号没有改动；迁移文档所述抽象类型保留。后续经授权的 review 分支交付不改变这些实测数据所属的源码与环境。

这是本地验收的实际运行，区别于旧候选 `907bea9…` 的历史回执。旧 v5 工程包、已交付的三份文档补丁包保持原样；新的完整本地候选与它们分开保存。验收时尚未推送，后续 review 推送也不代表发布软件包。

## 解决的接入问题

使用真实隔离 ActiveMQ Classic 的订单分发示例：生产者提交订单，消费者检查正文并手动 ACK；另发一条消息，TLS 中继只移除它的真实 broker RECEIPT。消息已经被观察到，但生产者只知道确认超时，不能直接推断投递失败后盲目重发。示例不执行数据库业务，不代表真实用户采用或 exactly-once。

## 环境与实际结果

沿用现有 Linux x86_64、Node24.19.0、Python3.12.14、OpenJDK21.0.12.1，以及隔离的官方 Wasm 编译器 `0.10.16+b1a0e846e` / moon、moonrun `0.1.20261020 (6691f18)`。没有安装或下载组件。Classic6.3.2官方归档重新核对SHA512一致，摘要与旧审计相同；本地临时profile无持久化/JMX/web，只监听127.0.0.1，使用合成测试身份与临时localhost证书。

| 入口 | 实际结果 | 范围 |
|---|---|---|
| `moon build --target js --frozen -j 1` | 退出0 | 从干净候选源码生成bridge |
| [独立消费者文档命令](../validation/consumer/README.md) | check/build/test/run均退出0，6/6 | workspace使用本地候选；媒体、传感器、账本三条预期输出全部匹配。输入server帧是fixture，不是broker |
| `scripts/classic-run.py … --port 62615 --tls` | 退出0，10375ms | 真实TLS1.0/1.1/1.2矩阵；二进制收发、手动/版本化ACK、事务SEND提交/中止、提交前断线、receipt与清理 |
| `scripts/classic-run.py … --port 62616 --tls --demo` | 退出0，5751ms | 真实TLS订单与receipt丢失：观察方收到消息，发送方`STOMP_RECEIPT_TIMEOUT`、`outcomeUnknown=true`并关闭；连接1、SEND1、丢receipt1，中继socket0；后续发送拒绝，没有自动重发 |
| 复用的有界真实TCP心跳fixture，62617 | 退出0 | 路径已明确换成本次解压候选；双向各2次心跳后丢broker流量，heartbeat timeout关闭，无重连，中继socket0；此项没有业务SEND |

TLS矩阵还验证错误CA/主机名在CONNECT前拒绝、匿名/错口令拒绝；事务包括COMMIT前100ms未送达、ABORT后250ms未送达及正控制消息，不能将有限负观察推广为无限期保证。NACK只验证发送，不主张重投递，Classic事务ACK回滚仍未测。

三个broker进程均已退出、对应端口不可连接，私钥删除或未创建。公开断言输出的合成凭据标记扫描通过；私有XML/调试记录仍含合成测试配置，不是生产脱敏日志，不应打印完整错误frame/cause。

完整测试批次36.321秒；时间只记录本次运行，不是性能基准。交付中的 `E2E-RESULTS.json` 保留每条命令、工作目录、UTC、退出码、超时上限和测试源码哈希；`cleanup-and-output.json` 保留结束后独立核查。源码ZIP消费与真实broker测试分别标记，不混称同一用例。

## 安装、版本与未测边界

已发布0.1.2只支持历史STOMP1.2；当前源码虽然`moon.mod`仍写0.1.2，包含尚未发布的新接口/功能，不能用registry旧包冒充本次候选。此次workspace中的`@0.1.2`只匹配本地模块身份，实际代码由成员目录和源码哈希固定，**没有执行registry安装或正式`moon package`**。

消费者命令新增`--frozen`禁止同步依赖；check加`--no-mbti`防止另一SDK重写候选接口索引。未新增运行时依赖或产品API。README与[迁移说明](migration-master-20261023.zh-CN.md)的公开方法边界继续适用。

本地验收没有重复71项完整核心矩阵，没有重跑已知失败的0.10.16 Wasm/Wasm GC控制，没有plain Wasm/native项目验收，也没有Artemis/go-stomp、生产PKI/mTLS/代理、长时soak、耐久性/故障转移或性能基准。所引用远端CI属于master636ef52；后续review新提交的CI需按其精确SHA另行核验，不能用master的CI代替。版本与结果仍按[提交状态表](submission-preparation.zh-CN.md)分别报告。

## 后续更新 review 分支

只在另行允许执行时，先重新核对remote/master/review头；从最新master创建隔离本地候选，应用并审阅文档补丁后提交，确认最新master和现有review头均为候选祖先，再正常快进推送到**原review分支**。若任何祖先检查失败或分支发生变化，停止并重新审阅，不force push，不用旧v5树覆盖master新增的抽象类型、71项测试和fresh-clone CI。

本地验收阶段只交付候选、差异和方案，没有执行公开操作；此后明确授权的交付阶段仅更新原review分支，不修改master，不创建或合并PR，不改版本号、发版或提交比赛。交付阶段的精确提交与CI以单独回执为准。
