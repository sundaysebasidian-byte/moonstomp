# MoonSTOMP：10 月 24 日前的私有提交准备

这份材料供维护者审阅、复现和自行讲解。按 **2026 年 10 月 24 日北京时间**的提交窗口准备，尚未指定提交时刻；没有代为报名、接受协议或提交比赛。维护者随后授权公开独立开发分支供审阅，准确提交和 CI 状态以交付回执为准；不合并主分支或发版。它是 AI 辅助技术说明，不是声称本人独立撰写的最终申报书；季度评分权重尚未核实，不承诺获奖。

## 项目解决什么问题

把 STOMP 的增量字节解析和会话状态写成有界的 MoonBit 核心，让 Node 应用能在明确的协议状态和失败语义下收发消息。正文可含 NUL/任意字节；网络任意分帧不应改变解析结果。核心管理版本、订阅、ACK、事务、receipt 和心跳；Node 适配器提供 TCP/TLS、有限等待与清理。没有 npm 运行时依赖。

代表场景是**订单分发中的确认丢失**：消息已经被消费者观察到，生产者却没有收到 broker receipt；如果客户端直接重发，业务可能重复。这里用合成订单和真实隔离 broker 展示知识边界；没有实际用户采用、生产集成或性能优势证据。

## 用现有真实演示讲清楚

先按 README 从私有包生成 JS bridge，再运行既有的一条命令：

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

ACK 已在当前演示和三版本矩阵中使用；Classic 事务 ACK 回滚和 NACK 重投递未验收。演示显式关闭心跳以聚焦投递歧义；**不能声称这条命令演示了真实心跳**。心跳是已有单独实测证据：本次 Linux 审计中的认证 TCP broker 双向各 2 次心跳，随后回环中继丢 broker 流量，客户端报告 `heartbeat timeout` 并清理，未重连。两份证据分别展示，见 [Linux 审计](linux-audit-20261022.zh-CN.md) 与包内 `evidence/linux-audit-20261022/broker-heartbeat/results.json`。

## 此次新增贡献与历史分界

远端基线是 `review/moonbit-20261015-sync` 的 `62694580a9c58aec9eb2199e2e1f9685b5e30781`。基线已有多版本核心、认证/TLS、句柄和 CLI，不将这些全部算成本轮新写。本次私有增量是控制等待期限、receipt 的发送边界与未知结果上下文、EOF/超时错误、故障回归、真实 Classic TLS/断线/receipt 丢失演示及审计证据；此次提交准备仅补材料和最终包复现，没有扩展产品 API。

`moon.mod` 仍为 0.1.2，含候选修改的私有包不是已发布的 0.1.2。Git SHA 固定基线，私有 patch SHA256 与逐文件清单固定增量；既有 CI/registry 记录不能冒充此次候选通过。主命令与支持矩阵放在 README，独立公共 API 复现放在 [消费者说明](../validation/consumer/README.md)。

## 设计取舍与证据边界

- sans-I/O 将字节、协议状态、容量预算与时钟放在 MoonBit，方便用确定性切点/虚拟时间测试；Node 适配器因此限 Node，未承诺浏览器或 Wasm 网络层。
- receipt 等控制等待失败后关闭会话，避免迟到回执与后续操作混淆；普通观察超时不必关闭。只在尝试 socket 写入后标记未知结果，不能由客户端推断 broker 是否执行。
- 不做自动重放：网络错误不能替业务决定重试。事务只是当前 STOMP 会话中的消息事务，不是跨数据库的原子处理。
- 有界缓存和 fail-closed 清理优先于宽松容错；差分参考的宽松解析不作为放松长度/转义校验的理由。
- 本轮 Linux JS 70/70、私有源码消费者 6/6、真实 Classic TCP/TLS 检查通过；普通 Wasm/Wasm GC 的独立常量控制失败，native 缺 runtime，正式 `moon package` 缺 `mooncake`。这些失败保留，不列为当前已验证支持。

官方完整 SDK 的安装入口和校验方法仍在 [官方下载页](https://www.moonbitlang.com/download/)；此前该发行端点 HTTP403，未绕过或反复请求。官方 GitHub `v0.10.16+b1a0e846e` 发行物只列 Wasm 工具链和源码归档，本轮没有取得完整 native SDK/打包器，没有重新运行已知失败后端矩阵。

## 许可、来源与本人应能解释的内容

原创代码 MIT，保留 [LICENSE](../LICENSE)。stompjs 7.2.0 参考副本仅供差分测试，Apache-2.0 许可和元数据随仓库保留；规范归因 CC BY 3.0。Node 内建模块与 SDK/core、JDK、Apache broker 是外部组件；SDK/broker 二进制不随包分发，没有 npm 运行依赖。完整来源与校验值见 [来源说明](reference.zh-CN.md)。

[AI_USAGE.md](../AI_USAGE.md) 如实列明 AI 辅助设计、代码、测试、调试和文档。维护者应能现场解释：正文 octet 长度与 NUL、任意分帧、毒化/EOF 清理、ACK 与业务完成的区别、COMMIT/ABORT 的会话边界、心跳 MAX 协商、receipt 未知结果为何不自动重发，以及各类测试真正证明的范围。可以从 `examples/offline` 或独立消费者修改一个长度/时钟/receipt 用例观察失败；此建议不冒充已执行的新结果。

尚未验证生产 PKI、mTLS、代理、长时 soak、性能/内存基准、持久性、故障转移或真实用户采用。最终技术申报应由维护者理解、审阅并按届时官方要求自行完成。
