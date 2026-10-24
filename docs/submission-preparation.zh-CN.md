# MoonSTOMP：10 月 24 日提交准备与源码状态核对

这份材料供维护者审阅、复现和自行讲解。按 **2026 年 10 月 24 日北京时间**的提交窗口准备，尚未指定提交时刻；没有代为报名、接受协议或提交比赛。它是 AI 辅助技术说明，不是声称本人独立撰写的最终申报书；季度评分权重尚未核实，不承诺获奖。

## 2026-10-23 核实的提交状态

[PR #3](https://github.com/sundaysebasidian-byte/moonstomp/pull/3) 已于 **2026-10-23 09:28:49 UTC** 合入 master，当前核实 SHA 为 [`636ef52a8022991b15b366bf3da23ccd5c51e9a0`](https://github.com/sundaysebasidian-byte/moonstomp/commit/636ef52a8022991b15b366bf3da23ccd5c51e9a0)。这是既有状态，不推断操作者；本次文档工作没有执行合并。随后明确授权的交付只更新原review分支，不代表进一步合并、发版或提交比赛权限。

| 来源与精确版本 | 可引用的事实 | 不能混用的范围 |
|---|---|---|
| 历史发布的0.1.2 | 仅STOMP1.2，原发布记录保留 | manifest同为0.1.2不代表registry包含新master |
| 旧候选 `907bea9ed4b483426dada3cc1f080e743b8cb7d9` / Library v5 | 当时消费者6/6、Classic场景、本地SDK边界；该SHA的CI39826182007成功 | v5保留原源码、哈希与回执，旧实测不改写为master新测试 |
| master `636ef52a8022991b15b366bf3da23ccd5c51e9a0` | [checks 39932161429](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/39932161429)与[fresh clone 39932161423](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/39932161423)均为该SHA的push、completed/success；fresh clone锁定0.10.14、当次最新0.10.17均71/71、七demo通过 | 不代表未推送文档补丁已有CI，也不代表本次重跑broker/plain Wasm/native矩阵 |

三个有状态类型已改为抽象类型，对旧字段调用方存在破坏性变更。`moon.mod` 仍为0.1.2；PR中的0.2.0只是未来发布建议，未自动定版或发包。字段到方法的迁移及没有公开替代的内部信息见 [迁移说明](migration-master-20261023.zh-CN.md)。

**后续本地接入续验**：同一master636ef52加文档补丁，干净消费者6/6、真实Classic TLS三版本、receipt未知不重发和真实心跳关闭均已执行通过，详见[接入回执](integration-master636-20261023.zh-CN.md)。这是新一轮本地证据；下面提到的旧v5以及此前“仅文档、未跑broker”保留原日期范围，不代表此次续验没有执行。

## 项目解决什么问题

把 STOMP 的增量字节解析和会话状态写成有界的 MoonBit 核心，让 Node 应用能在明确的协议状态和失败语义下收发消息。正文可含 NUL/任意字节；网络任意分帧不应改变解析结果。核心管理版本、订阅、ACK、事务、receipt 和心跳；Node 适配器提供 TCP/TLS、有限等待与清理。没有 npm 运行时依赖。

代表场景是**订单分发中的确认丢失**：消息已经被消费者观察到，生产者却没有收到 broker receipt；如果客户端直接重发，业务可能重复。这里用合成订单和真实隔离 broker 展示知识边界；没有实际用户采用、生产集成或性能优势证据。

## 用现有真实演示讲清楚

若选择当前 master 作为提交来源，应先固定上述完整 SHA，再按 README 生成 JS bridge。此前文档收尾仅引用旧v5回执；当前源码的订单场景已在后续本地接入续验单独执行，结果见上面的接入回执，不把不同轮次混为一份测试：

```sh
python3 scripts/classic-run.py --home /path/to/apache-activemq-6.3.2 \
  --java-home /path/to/jdk --output ../moonstomp-order-evidence \
  --port 62616 --tls --demo
```

要求已有官方 SHA512 核验的 Classic 6.3.2、JDK/keytool、lsof、Node/Python；输出目录必须是源码树外的新目录。不会联网安装。只启动自己创建的回环 broker、临时证书和演示中继；不用真实身份，不关闭 TLS 校验。详细前提、三分钟讲稿和失败清理复用 [既有演示说明](recovery-20261020.zh-CN.md#三分钟真实演示与交付)，不另造产品流程。

| 现场阶段 | 代码实际做什么 | 可以与不能得出的结论 |
|---|---|---|
| 建连 | 校验 TLS 证书/主机名，拒绝错口令，建立认证 STOMP 1.2 会话 | 验证本机测试身份和 PKI；不是生产 CA 或 mTLS 验收 |
| 事务与处理 | ABORT 合成 cancelled-order；COMMIT confirmed-order；消费者校验正文后调用手动 ACK | COMMIT 前 100ms、ABORT 后 150ms 的有限负观察；ACK 表示协议确认，未执行数据库业务或分布式事务 |
| 丢失 receipt | TLS 中继移除一条真实 broker RECEIPT；直连消费者收到 receipt-lost-order 并调用 ACK | 生产者 600ms 后得到 `STOMP_RECEIPT_TIMEOUT`、`outcomeUnknown=true`；观察到送达不等于所有生产故障下都送达 |
| 安全失败 | 发送方关闭；后续发送被拒；中继连接/SEND/丢 receipt 各 1 | 没有自动重发或重连；应用需稳定业务 ID、幂等约束和对账，不能声称 exactly-once |
| 清理 | finally 关闭客户端、中继、自己启动的 broker，删除私钥并验证端口关闭 | 失败回执仍可见；公开输出白名单不打印 raw frame/cause 或任意消息正文 |

ACK 已在旧 v5 演示和三版本矩阵中使用；Classic 事务 ACK 回滚和 NACK 重投递未验收。演示显式关闭心跳；**不能声称这条命令演示了真实心跳**。10月22日另有真实认证TCP心跳实测：双向各2次后中继丢broker流量，客户端heartbeat timeout并清理、未重连。两份历史证据分别见 [Linux审计](linux-audit-20261022.zh-CN.md) 与旧v5包内 `evidence/linux-audit-20261022/broker-heartbeat/results.json`。

## 此次新增贡献与历史分界

早期私有增量以 review 分支的 `62694580a9c58aec9eb2199e2e1f9685b5e30781` 为基线，随后形成 `907bea9…`；当前提交来源应指明 master `636ef52…`，不能继续把旧基线当最新版。已有增量包含控制等待期限、receipt发送边界与未知结果、EOF/超时错误、故障回归、Classic TLS/断线/receipt演示及审计证据。后续PR #3另含格式/README整理、fresh-clone CI、README测试及抽象类型，不归为此次文档补丁实现。

`moon.mod`仍为0.1.2，旧私有包和当前master都不能冒称已发布的新版本。前一轮独立文档补丁包保持不变；接入续验另交付基于`636ef52…`的完整本地候选与新回执，不修改master，不混入或更新旧v5包。独立公共API的workspace命令见 [消费者说明](../validation/consumer/README.md)，换用新SHA时先遵守迁移契约。

## 设计取舍与证据边界

- sans-I/O 将字节、协议状态、容量预算与时钟放在 MoonBit，方便用确定性切点/虚拟时间测试；Node 适配器因此限 Node，未承诺浏览器或 Wasm 网络层。
- receipt 等控制等待失败后关闭会话，避免迟到回执与后续操作混淆；普通观察超时不必关闭。只在尝试 socket 写入后标记未知结果，不能由客户端推断 broker 是否执行。
- 不做自动重放：网络错误不能替业务决定重试。事务只是当前 STOMP 会话中的消息事务，不是跨数据库的原子处理。
- 有界缓存和 fail-closed 清理优先于宽松容错；差分参考的宽松解析不作为放松长度/转义校验的理由。
- 10月22日旧候选的本地Linux JS70/70、消费者6/6、Classic TCP/TLS通过；当时0.10.16兼容工具链的Wasm/Wasm GC控制失败、native runtime与mooncake缺件仍保留。新master已存在的远端CI单列在上表，不把不同SHA、SDK和测试范围互相替代。

SDK入口仍见 [官方下载页](https://www.moonbitlang.com/download/)；此前本地HTTP403失败保留，远端runner安装成功不代表本地缺件恢复。本次只校验文档，不安装依赖、不取新权限、不重跑已知失败后端矩阵。

## 许可、来源与本人应能解释的内容

原创代码 MIT，保留 [LICENSE](../LICENSE)。stompjs 7.2.0 参考副本仅供差分测试，Apache-2.0 许可和元数据随仓库保留；规范归因 CC BY 3.0。Node 内建模块与 SDK/core、JDK、Apache broker 是外部组件；SDK/broker 二进制不随包分发，没有 npm 运行依赖。完整来源与校验值见 [来源说明](reference.zh-CN.md)。

[AI_USAGE.md](../AI_USAGE.md) 如实列明 AI 辅助设计、代码、测试、调试和文档。维护者应能现场解释：正文 octet 长度与 NUL、任意分帧、毒化/EOF 清理、ACK 与业务完成的区别、COMMIT/ABORT 的会话边界、心跳 MAX 协商、receipt 未知结果为何不自动重发，以及各类测试真正证明的范围。可以从 `examples/offline` 或独立消费者修改一个长度/时钟/receipt 用例观察失败；此建议不冒充已执行的新结果。

尚未验证生产 PKI、mTLS、代理、长时 soak、性能/内存基准、持久性、故障转移或真实用户采用。最终技术申报应由维护者理解、审阅并按届时官方要求自行完成。
