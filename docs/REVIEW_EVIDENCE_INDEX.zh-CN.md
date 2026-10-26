# MoonSTOMP 评审问题证据索引

核对日期 2026-10-26。供用户审阅和改写，未发送、未提交比赛；AI 辅助范围见 [AI_USAGE.md](../AI_USAGE.md)。不把测试通过当作评委认可或获奖概率。

当前已发布 **0.3.1**：[精确安装、提交、checksum 与验证范围](release-0.3.1.zh-CN.md)。当前源码链接固定到发布提交 `dde74d2c0fb1a0ca60ec7bdab4c983065af7f5b7`，真实 broker CI 固定到同一候选 head `5b5c99653aaa0ce8e4771d6d79ee4a7f750afedc`；两者 tree 相同。

| 原始顾虑 | 已有证据与复现入口 | 仍有边界 |
| --- | --- | --- |
| 申报材料混淆已实现与拟实现 | [0.3.1 发布回执](release-0.3.1.zh-CN.md)分开列 registry、源码 CI、本地消费及未验项；[PR #10](https://github.com/sundaysebasidian-byte/moonstomp/pull/10)已合并 | Proposal 和旧复审草稿保留历史身份，不能按其中“候选”推断当前未发布 |
| 范围偏窄，需要完整 STOMP 版本 | sans-I/O 核心支持 1.0/1.1/1.2，含二进制增量编解码、版本化 ACK、事务、receipt；[三版本示例](https://github.com/sundaysebasidian-byte/moonstomp/blob/dde74d2c0fb1a0ca60ec7bdab4c983065af7f5b7/examples/versions/main.mbt)；[真实 Classic TLS CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225233529) | 不宣称 1.0 支持规范不存在的心跳/NACK；事务 ACK 回滚与 NACK 重投递完整语义未验 |
| 参考 go-stomp、提供功能对比 | [固定源码公平对照](FAIR_GO_STOMP_COMPARISON.zh-CN.md)，上游固定为 [c155a2d…](https://github.com/go-stomp/stomp/tree/c155a2d699bb5bc1b2547a4382b3cdd7f4403648)；Go 可接调用者提供的 tls.Conn | 对照保留 2026-10-25 和 0.2.0 范围；不把旧表当 0.3.1 同版实测或性能胜负，Node 异步新增范围另见[说明](async-send.zh-CN.md) |
| 需要互操作证据 | [历史 go-stomp ↔ Artemis 三版本记录](https://github.com/sundaysebasidian-byte/moonstomp/blob/dde74d2c0fb1a0ca60ec7bdab4c983065af7f5b7/docs/broker-interop.zh-CN.md)保留原日期；当前 Classic 6.3.2 TLS 三版本有精确 head CI 及发布后实际 registry 消费 | 历史 Go 对端不是本轮 Classic+Go 新实测；脚本 peer 与真实 broker 分列；不是所有 broker 认证 |
| 可靠性、错误及安全边界 | 同一真实 broker CI 含 CA/hostname 与认证负控制、receipt-loss 不重发、心跳 100/1000ms 观察后 drop 关闭、短异步及清理；[夹具](https://github.com/sundaysebasidian-byte/moonstomp/blob/dde74d2c0fb1a0ca60ec7bdab4c983065af7f5b7/scripts/classic-heartbeat-test.cjs) | 同步安全保护保留，异步本机写完不是 broker receipt；不保证 exactly-once、持久化、生产 PKI/mTLS 或故障转移 |

## 证据身份与未完成项

[常规 CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225200831)与[fresh clone](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225200847)属于 `5b5c996…`；合后检查属于 `dde74d2…`，详见版本回执。上述 CI 不为后续文档提交提供新运行回执。

远端五分钟是真实 Classic TLS **源码 head** 的限定低速场景，300005.330566ms、1400 条一致收发；不是已安装 registry 五分钟或长稳。已安装 0.3.1 的本地短 TLS 场景验证三版本、两档心跳和异步，完整本机日志保留私有，不冒充公开附件。0.3.0 的真实 registry 心跳失败保留，0.3.1 的修复后通过另有对应版本回执。

[历史 Proposal](../Proposal.md)、[旧矩阵](REVIEW_CONCERNS_MATRIX.zh-CN.md)、[旧复审草稿](QUARTER_REVIEW_DRAFT.zh-CN.md)按原日期阅读。旧 heartbeat fixture/hash 缺口未被补造，当前夹具使用自身固定源码身份。native/普通 Wasm/Windows 消费者、生产环境、长期稳定性、外部人类审查、采用者及评委重新认可仍未完成；独立 AI 复审不能代替它们。
