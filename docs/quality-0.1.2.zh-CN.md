> 本文记录 2026-10-02 的修复与完整实测。2026-10-03 的新增属性测试、增量差分、实际候选消费与规则再读见 [有界质量复核](overnight-review-20261003.zh-CN.md)，其 broker 历史仍保留原实测时间。

# 0.1.2 本地候选质量记录

记录日期：2026-10-02，以下是公开前的修复/验证历史。基线为 `f7aa474586798c5004706ebd93195ad5f7c28706`，正式 Mooncakes 仍为 0.1.1。当前 0.1.2 源码同步及准确 CI 状态见 source-sync-0.1.2.zh-CN.md。

## 修复及证据

| 问题 | 原行为与失败证据 | 候选行为与回归 |
| --- | --- | --- |
| 非 Active 状态的时钟倒退 | `tick` 在 Fresh、Connecting、Disconnecting 状态提前返回；协商或优雅关闭期间倒退的调用时间被漏检。先添加两项白盒测试，原实现 39 项中 2 项失败。 | 所有未关闭状态校验并推进单调时钟；倒退会失败并清理。Closed 状态轮询保持无操作。补充独立公开 API 用例，核心 JS/Wasm-GC 各 40/40。 |
| 泛用等待者抢走控制事件 | 先登记的 `waitFor(() => true)` 可以消费 CONNECTED 或 RECEIPT，令 `connect()`、`receipt()` 超时。原运输回归失败。 | 内部连接/回执等待优先登记；`receipt()` 返回对应 RECEIPT 事件，`connect()` 在处理 CONNECTED 后返回 TcpClient，其他事件继续遵循泛用等待者的先到先匹配规则。已通过脚本 peer 的真实回环 socket 回归。 |
| 异步匹配误投递与未处理拒绝 | Promise 被当成真值，事件被错误消费；拒绝的异步回调产生未处理 Promise。原回归同时记录此失败。 | 匹配必须返回 Boolean；原生 async/generator 回调在登记前拒绝，普通回调返回 Promise/对象也拒绝。原生 Promise 拒绝被接收处理。已有队列匹配失败返回 rejected Promise 并保留事件；实际接收时匹配失败关闭连接并清理。新增四项运输测试全部通过且未处理拒绝列表为空。 |
| 无效 host 延迟失败 | null、对象、数字或空白 host 可绕过构造时校验，稍后导致不恰当的网络参数或同步错误。 | 在任何网络操作前拒绝非字符串、空字符串和纯空白字符串。有效地址仍由 Node 网络层解析。 |

运输四项新回归分别验证 host、异步/非 Boolean 合约、保留 CONNECTED/RECEIPT，以及接收时 Promise 谓词失败的清理；它们使用脚本 peer，不能代表真实 broker 对这些 race 的覆盖。未扩展公共 MoonBit API、TLS、WebSocket、自动重连或旧协议支持。

最终打包复验另发现原有 receipt 运输测试的计数器把空字节的定时器轮询也计为发送，导致一次 `2 !== 1` 假失败。失败原始日志保留，计数修正为实际非空写入，仍要求失败 receipt 不发送任何命令，不放宽零 I/O 断言。最终结果以重新绑定提交的完整流程为准。

## 实际验证范围

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| 固定工具链 check/build、JS 桥接和离线示例 | 通过 | moonc 0.10.14+7d59c7ec9、moon 0.1.20260920、Node 24.18.0、Python 3.14.6；串行运行。 |
| MoonBit 核心 | JS 40/40，Wasm-GC 40/40 | 正常、分段/连帧、重复 header、转义、长度/NUL、假时钟、状态和容量边界。整工程包含 JS extern，仍不支持整工程 Wasm-GC。 |
| 独立参考实现差分 | 401 个有效帧、1201 次分段比较通过 | 固定 @stomp/stompjs 7.2.0，保留 Apache-2.0 许可；严格边界差异仍明确。 |
| 源码 TCP 回归 | 原有 10 项及新增 4 项通过 | 实际数字回环 socket，脚本 peer；没有向公网 broker 测试。 |
| 实际候选包消费 | 两后端各 6/6 | 从本次 `moon package` ZIP 解压，独立 MoonBit 模块执行三个业务场景、两项 0.1.1 回归和新时钟回归；本地 path 依赖，不是 registry 安装。 |
| 包内 Node 适配器 | 构建/加载与 4 项 TCP 回归通过 | 在实际解压候选中生成 JS bridge，然后加载包内适配器；没有分发预编译 JS，也没有依赖原工作区的 bridge。 |
| 真实 Artemis 2.57.0 | 三个示例及五项补充检查通过 | 官方发行包 SHA512 双校验，匿名、无持久化、ANYCAST、127.0.0.1:61613、256 MiB 堆和 2 处理器上限。结束关闭端口并清理临时 runtime。 |
| Artemis 事务 ACK 探针 | 确认 broker 限制 | ABORT 未恢复已确认消息；不能宣称事务 ACK rollback 通过。NACK 在此 profile 丢弃，不能推广为所有 broker 重投递规则。 |
| 0.1.2 远端 CI / 正式 registry | 未测 / 未发布 | 保留 0.1.1 的准确 CI、发布 ZIP 与 53 文件 registry 一致性证据；这些历史结果不代表 0.1.2。 |

真实三个 broker 示例为任务生产消费、ACK/NACK 可靠处理、事务 SEND commit/abort。补充检查为 binary/转义/重复 header、NACK 策略、累计 ACK、真实心跳和真实 ERROR。事务 SEND 的 commit/abort 通过与事务 ACK 的已知限制分别记录。

## 从交付包复现

优先阅读 `moonstomp-candidate/README.md`。安装可信固定工具链后，在候选目录执行：

```sh
python3 scripts/verify.py --output ../verification-new --transport
```

`--output` 必须是源码目录外的新目录。真实 broker 是可选独立阶段：只有已获授权并具有现有官方 Artemis 2.57.0 archive、其 SHA512 文件和 Java 17 时，才向上述命令添加 README 中三个 broker 参数。不自动下载或安装 broker。Node 消费者须在自己的可写解压目录执行 `moon build --target js -j 1`，再加载 `transport/tcp.cjs`；`moon add` 不生成预编译 bridge，且正式 registry 目前仍是 0.1.1。

## 未测范围

其他 broker、支持事务 ACK rollback 的 broker、认证/TLS/持久化/高负载、浏览器、native/LLVM/旧 Wasm 和其他工具链未测。0.1.2 尚未正式发布至 Mooncakes，真实 registry 安装验证仍属于 0.1.1；源码及本地 package 消费各自记录。有限回归与差分不是完整一致性认证。
