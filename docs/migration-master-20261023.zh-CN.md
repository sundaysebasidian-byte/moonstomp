# 从已发布 0.1.2 / 旧候选迁移到当前 master

本说明针对 **master `636ef52a8022991b15b366bf3da23ccd5c51e9a0`**。[PR #3](https://github.com/sundaysebasidian-byte/moonstomp/pull/3) 于 2026-10-23 09:28:49 UTC 合入；这只是读取到的事实，不推断操作者，也不是本次文档工作执行的合并。其他提交应重新核对 [公开接口](../pkg.generated.mbti)。

## 区分版本与来源

| 来源 | 应如何理解 |
|---|---|
| 历史发布的 0.1.2 | 仅 STOMP 1.2；见 [原发布记录](publication-0.1.2.zh-CN.md)。安装旧包不会取得新 master 的多版本功能或接口变更 |
| 旧候选 / Library v5 | 提交 `907bea9ed4b483426dada3cc1f080e743b8cb7d9`；保留当时源码、哈希和回执，不因合并自动变成新源码包 |
| 本文固定的 master | 已包含后续多版本开发与整理；`moon.mod` **仍写 0.1.2**，但没有因此发布新包，也不表示兼容旧包所有源码用法 |

PR 明示字段隐藏属于破坏性变更，建议未来发布时考虑 0.2.0；**0.2.0 不是已确定或已发布版本**。本补丁不改版本号。复现时锁定完整 SHA，不把移动的 master 或裸 `moon add` 当作这个候选。

## 有状态类型现在只公开方法

`Client`、`Decoder`、`HeartbeatClock` 在 `.mbti` 中为抽象 `type`，不再公开字段。相对 v5，这三个类型的公开方法签名保持不变；只用构造器和方法的用法可沿用。依赖字段的外部代码必须迁移；内部 `Delivery` 也不再出现在接口索引中。

| 旧字段依赖 | 当前公开契约 |
|---|---|
| `client.state`、`client.version` | 用 `client.state()`、`client.version()`；版本结果是 `Version?` |
| `client.receipts.length()`、`client.deliveries.length()` | 用 `pending_receipts()`、`pending_deliveries()`，不要保存内部数组引用 |
| `client.capacity`、`client.max_pending` | 用 `Client::new(capacity=…, max_pending=…)` 配置；要展示配置时应用自行保留传入值，没有新增 getter |
| `client.decoder`、订阅/事务数组、内部时钟等 | 没有等价的公开字段访问。通过 `send`、`receive`、`tick`、`end`、`fail` 和返回事件驱动会话，不自行改内部状态 |
| `decoder.limits`、`decoder.version` | 用 `Decoder::new(limits=…, version=…)` 配置并自行保留配置；会话协商交给 `Client`，没有可写版本字段 |
| decoder 的 `body`、`line`、`phase`、`failed` 等 | 没有缓存/解析阶段 getter。用 `feed` 的事件、`ProtocolError`、`end()` 的 EOF 校验判断结果；致命错误后不要继续复用该 decoder |
| heartbeat 的 `plan`、`sent`、`received`、`now` 等 | 自行保留协商计划和宿主单调时钟；用 `poll(now)`、`sent_data(now)`、`received_data(now)`，不读写内部时间戳 |

`HeartbeatClock::poll` 返回 `(应发送心跳, 对端已超时)`；实际写出数据后才调用 `sent_data`，收到数据后调用 `received_data`。它不自行发送网络数据或读取系统时钟，不应通过结构复制或强制转换恢复字段访问。

`State` 是只读枚举，观察 `state()` 应做模式匹配，不在外部构造 `Fresh` 等值；这与三个结构字段的隐藏是不同的接口约束。

并非所有数据类型都变成抽象类型：`Frame.body` 等公开帧数据仍可读取；`Limits` 与 `HeartbeatPlan` 仍为公开结构。不要把 MESSAGE 正文访问改成不存在的 getter。

下面片段只使用公开方法；示例模块需将本地候选导入为 `@stomp`，workspace 建法见 [消费者说明](../validation/consumer/README.md)：

```moonbit
test "migration: public constructors and observations" {
  let client = @stomp.Client::new(capacity=8, max_pending=4)
  match client.state() {
    @stomp.Fresh => ()
    _ => fail("expected a fresh client")
  }
  assert_eq(client.version(), None)
  assert_eq(client.pending_receipts(), 0)
  assert_eq(client.pending_deliveries(), 0)

  let limits = @stomp.Limits::new(max_body=1024)
  let decoder = @stomp.Decoder::new(limits~, version=@stomp.V12)
  assert_eq(decoder.feed(b"").length(), 0)
  decoder.end()

  let plan = @stomp.negotiate_heartbeat(10, 20, 30, 40)
  let clock = @stomp.HeartbeatClock::new(plan, 0, tolerance_ms=5)
  assert_eq(clock.poll(0), (false, false))
  clock.sent_data(0)
  clock.received_data(0)
}
```

本片段不是网络、事务或 broker 验证。本次文档校验和未运行范围随补丁单独交付，旧 v5 测试不重新标为本次运行。

## 当前 SHA 的 CI 与历史范围

- [checks 39932161429](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/39932161429)：本文 SHA 的 master push，completed / success；锁定 SDK 的 `scripts/verify.py --transport`，没有运行真实 broker。
- [fresh clone 39932161423](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/39932161423)：同 SHA 的 master push，completed / success。job 日志显示锁定 `moonc v0.10.14+7d59c7ec9`、当次最新 `v0.10.17+093cb8f9c` 均71/71，七个进程内 demo 各 PASS；锁定 job 格式/API 索引检查成功，latest 按配置跳过该检查。

“latest”只表示该次运行版本，不保证以后 SDK 都兼容。这是master的既有远端回执，后续review文档提交的CI必须对应其新的精确SHA另行核验。10月22日的70/70、消费者6/6、Classic TLS/receipt/真实心跳及当时0.10.16工具链失败属于[历史审计](linux-audit-20261022.zh-CN.md)，不能改写成此文档校验的新运行；后续当前源码的真实broker续验另见[接入回执](integration-master636-20261023.zh-CN.md)，不包含plain Wasm/native验收。

Node 适配器继续使用方法边界；抽象类型不改变 receipt 的知识语义：确认丢失仍可能结果未知，不自动重发，不承诺 exactly-once。生产 PKI、mTLS、代理、耐久性、故障转移、长时 soak 和性能基准也不能由这些 CI 推出。
