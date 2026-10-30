# 10 月 30 日初审反馈对照与修订证据

这是 AI 辅助的公开技术修订说明，面向 `review/moonbit-20261030` 复审分支源码；不是默认分支、新 Mooncakes 版本、已提交申报书或符合性证书。源码基线为 `0e60fe353127260da105e82ccd683bfda535b27c`；旧0.3.1不含本次修复。

## 本次反馈与根因

评审技术反馈指出缺少 STOMP 1.1/1.2 事务、完整订阅管理、ACK/NACK 模式的重要说明。既有源码已有相关核心及 Node 句柄，但原说明没有给出逐版本行为、可复现证据和分层限制。这是申报验收映射缺口，不应再用无关功能或总测试数替代。

本次针对性审查还发现实际缺陷：同一事务中，client 累积 ACK/NACK 从较早消息扩展到较晚消息会被误报跨事务重叠。新测试在修复前 79 项中失败 1 项；修复后四后端各 79 项通过。修复只放行同一事务已暂存的前缀；跨事务或无事务操作仍拒绝，防止部分变更。

## 逐项能力与证据

| 评审关注项 | 1.1 / 1.2 实际行为 | 当前代码和验证 |
| --- | --- | --- |
| BEGIN / COMMIT / ABORT | 连接内唯一事务 ID；校验 SEND、ACK、NACK 的事务归属；结束后可复用 ID。核心记录本地发送意图，不把它当 broker 确认 | client.mbt；review_protocol_matrix_wbtest.mbt；Node Transaction.commit/abort 等 receipt 才进入完成状态 |
| 事务 ACK/NACK | 两版本均支持暂存；COMMIT 移除本地暂存交付，ABORT 恢复为可确认。client 累积只影响同订阅前缀；client-individual 只影响选中消息 | 新矩阵覆盖版本×模式×正/负确认×提交/回滚，以及同事务累积扩展和跨事务拒绝 |
| SUBSCRIBE | 支持多订阅、唯一 ID、destination、三种 ACK 模式，校验重复 ID 与资源容量；消息按 subscription 关联 | client.mbt、Node subscribe()/Subscription.next()；脚本验证两个订阅隔离 |
| UNSUBSCRIBE | 支持 receipt 屏障，处理此前在途消息；取消一个 Node 句柄的等待不取消其他订阅；未结清消息阻止危险 ID 重用 | 新核心生命周期矩阵、scripts/handles-test.cjs |
| auto | 不建立待手动确认状态；手动 ACK/NACK 被拒绝 | 新 auto 矩阵及句柄校验 |
| client | ACK/NACK 累积到同订阅所选消息；不跨其他订阅 | 核心 reliability 测试、新矩阵 |
| client-individual | 单条 ACK/NACK，不累积 | 核心及新矩阵 |
| 确认头差异 | 1.1 使用 message-id + subscription；1.2 使用 MESSAGE 的 ack 值作为 ACK/NACK 的 id | version_wbtest.mbt、新矩阵显式断言 |

1.0 另外支持其既有事务和订阅能力，但没有协议定义的 NACK、client-individual 和心跳；这不是 1.1/1.2 功能范围的替代说明。

## 不混淆的限制

- 本轮四后端核心矩阵各 79/79 和 Node 三版本句柄已重新执行；句柄单测是脚本化 peer。此外新增真实 ActiveMQ Classic 6.3.2 TLS 测试，原三版本互通及新 14 场景全部通过。
- 旧 Classic 脚本只验证 SEND 事务；新增 review-classic-ack-matrix.cjs 单独验证 1.1/1.2 × client/client-individual × COMMIT/ABORT 共 8 项 ACK 事务场景、4 项只确认第二条消息的模式差异、2 项多订阅隔离。真实重连消费者与正向 marker 共同确认结果。Artemis 未在本轮重测，既有记录有事务 ACK 限制，不推广 Classic 结论。
- Node Transaction.commit()/abort() 依赖 receipt；核心 send() 返回字节仅代表本地状态变化。网络失败可能结果未知，不自动重放。
- 核心保留退订前消息的 ACK 资格，但已关闭 Subscription 句柄不再允许 ack()/nack()；底层 TcpClient.acknowledge()/核心 API 与句柄边界不同，应由调用方在退订前完成结算。
- 新 broker 矩阵仅覆盖 Classic 6.3.2 非持久化 loopback 队列，150ms 附加观察窗口不是永久无消息证明。NACK 的所有 broker 重投/死信语义没有由此验证；不能写“全部协议互通已验证”，不证明业务持久化或 exactly-once。

## 可用于人工改写的申报补充草稿

MoonSTOMP 的协议核心与 Node 客户端按版本提供事务、订阅及确认能力：1.1/1.2 支持 BEGIN/COMMIT/ABORT、带事务的 SEND 与 ACK/NACK；支持多订阅、SUBSCRIBE/UNSUBSCRIBE 生命周期及 receipt 屏障；支持 auto、client 累积确认和 client-individual 单条确认，并区分 1.1 的 message-id/subscription 与 1.2 的 ack/id 确认头。核心状态测试、Node 句柄测试及真实 broker 测试分别列证，不以本地发送状态或 receipt 证明业务持久化。此次修订另修复同事务累积确认扩展的误拒绝，并保留跨事务冲突保护；修订源码位于复审分支，不能冒充原发布包或默认分支已包含修复。

## 复现与附件

在已固定 MoonBit 0.10.18+6c83a7f62 工具链下运行：

```sh
moon test --target native
moon test --target js
moon test --target wasm
moon test --target wasm-gc
moon build --target js bridge
node scripts/handles-test.cjs
```

历史验证公开摘要在 `review-evidence/public-validation-summary.json`，修前失败和最终通过阶段分开记录；原始日志私人保留。本材料不授权修改报名表或对外提交。

## 规范来源

- [STOMP 1.1](https://stomp.github.io/stomp-specification-1.1.html)：SUBSCRIBE、ACK、NACK、BEGIN、COMMIT、ABORT。
- [STOMP 1.2](https://stomp.github.io/stomp-specification-1.2.html)：相应章节及标识符/receipt 语义。

报名附件须本人理解并完成人工最终稿、核实提交版本；源码分支同步不等于报名已提交或评审已接受。

## 本轮真实 broker 回执

`review-evidence/public-classic-summary.json`：2026-10-30T08:34:55Z，白名单摘要 status PASSED，14/14 新场景通过，三协议版本实际协商值已核实，TLS 校验启用，端口关闭且临时私钥已移除。官方 Classic 6.3.2 二进制下载按 scripts/classic-release.sha512 校验一致；源码包不包含 broker 二进制或私钥。复现使用 `scripts/classic-run.py --home <已校验Classic目录> --java-home <JDK21目录> --output <新测试目录> --port <空闲loopback端口> --processors 1 --tls --review-ack-matrix`。

AI 辅助实现与测试；人工最终审阅及提交尚未完成。

## 追加功能检查：CLI正文来源

多个或重复正文参数过去静默采用最后一个，现改为拒绝歧义且不先读取stdin或文件。新增回归覆盖16个有序冲突、4个单来源、缺来源和两个保持stdin开放的真实CLI拒绝场景；全部通过。严格本地完整验收新增该项后29阶段通过；本次未重跑真实broker，不将旧broker证据改为新运行。
