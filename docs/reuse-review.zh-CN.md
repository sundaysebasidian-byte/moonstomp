# 有界复用价值审查

2026-10-01 补充。针对父任务已核的 LogLens 初审退回事实，检查完成的 MVP 能否被另一模块使用，以及场景是否超出单一输入格式。本文为 AI 辅助技术事实，不能充当本人最终人工申报书。

## 独立下游消费路径

`scripts/downstream.py` 实际运行 `moon package --frozen`，复制官方工具生成的本地候选 ZIP，再解压到新目录 `candidate/`。另一模块 `independent/moonstomp-consumer` 的 manifest 仅以 `deps` 的 `path: ../candidate` 导入 `sundaysebasidian-byte/moonstomp`。公开 API 消费模板位于 `validation/consumer/`；它有自己的 manifest、构建目录、可执行 main 和三项场景测试，不在主模块测试内部调用私有函数，也不依赖主工程构建缓存。

该消费者仍由同一 AI 编写，独立指构建模块与依赖边界，不是第三方开发者实际采用。验证既不发布也不从 Mooncakes 安装，更不能替代真实 broker 互操作。

```sh
# 使用 README 指定的既有 SDK、Node 和 Python；每次使用新输出目录。
python3 scripts/downstream.py --output ../moonstomp-downstream
```

脚本对 JS、Wasm-GC 分别执行 check/build/test/run，原始日志、候选 ZIP 校验值、候选源码和消费者源码 SHA256 保存在输出中。`scripts/verify.py` 已包含这一步，CI 配置由同一脚本覆盖。当前 SDK 对兼容的 `moon.mod.json` 产生弃用提示；本地 package 因尚无公共仓库产生 repository 缺失提示。两者均如实保留在 stderr，不填假 URL，不宣称没有提示；编译器 `--deny-warn` 检查通过。

## 三个不同使用场景

三场景都执行 CONNECT → 订阅/业务操作 → UNSUBSCRIBE → DISCONNECT/receipt → Closed。传入的服务端帧是公开的自造 fixture。应用断言只证明协议会话的可复用行为，不证明图片处理、真实设备接入、账务持久化或 broker 处理结果。

| 场景 | 完整输入与公开 API | 输出与有效断言 | 复用点与边界 |
| --- | --- | --- | --- |
| 媒体任务调度 | destination `/queue/images`；二进制 `resize\0image` 为 12 octets。`Client::new/connect/subscribe(ack="client-individual")/send_message/receive/acknowledge`；两个 MESSAGE 的确认 ID 分别 `image-ok`、`image-bad`，发送 receipt `job-published`。 | `media-worker: bytes=12, ACK=1, NACK=1, pending=0`。解码实际 SEND 检查完整 NUL 正文与长度 12，MESSAGE 正文逐字节相等；成功 ACK、失败 NACK 命令及 pending 清零，receipt ID 关联与安全关闭均断言。 | 业务代码只选择目的地、正文和确认方式，复用二进制 codec 与会话；不实现图片转换，不承诺 NACK 重投递或业务 exactly-once。 |
| 传感器实时读数 | destination `/topic/temperature`、auto ACK；连帧正文 `25`、`26`，逐字节喂入。首帧两个 `x-label` 为转义后的 `room:one\nroom2` 和 `ignored`。握手双方心跳 `10,20` 与 `20,10`，输入时刻 5、tick 时刻 10。 | `sensor-feed: readings=2, values=25/26, duplicate-first, heartbeat=LF`。断言两帧完整有序、转义结果、重复 header 保留两个且首值有效、auto 无 pending ACK、tick 输出 LF。 | 复用分段处理、连帧、header 与假时钟；与任务队列的显式确认不同。数字读取用自造设备数据，不实现硬件驱动、真实 fanout 或统计数据库。 |
| 账目批次确认 | destination `/queue/ledger`、client 累计 ACK；两条 MESSAGE 正文 `debit/credit`，ID `l1/l2`。BEGIN `draft` → 事务 ACK `l2` → ABORT；独立 ACK `l1`；BEGIN `accepted` → SEND 审计 `/queue/ledger-audit` 正文 `batch-1` → ACK `l2` → COMMIT。receipt 为 `audit/committed`。 | `ledger-batch: staged=2, abort-restored=2, commit-pending=0, receipts=2`。断言暂存保留两条、ABORT 恢复可确认、独立 ACK 后剩一条、SEND 事务/目的地/正文、COMMIT 后本地 pending 清零、两个 receipt ID 及断连。 | 复用事务暂存、累计确认与关联回执；不宣称跨服务数据库原子性、真实账目平衡或服务端事务已生效。COMMIT 请求与 receipt fixture 是本地 API 契约证据。 |

## API 与范围审查结论

公开构造函数、`Frame`/`Bytes`、`Decoder`、`Client` 和调用者时钟能够由独立模块编译、运行及测试；不需要暴露或调用内部事务/订阅数组。传感器场景消费同一 Client 时可用 `auto`，媒体用单条 ACK，批次用累计 ACK 与事务；没有强制一种业务格式。通用 `Frame::new` 为 COMMIT 增加 receipt，说明便利构造器外仍有受校验的扩展入口。本轮不需要为凑功能新增协议 API。

README/Proposal 已将“生态填补”收窄为有限检索与可复用协议能力：目的地是不透明字符串，业务 payload/处理逻辑由消费者选择；现在只有 JS TCP 适配器，其他运输仅可对接 sans-I/O 核心，不能声称已支持 TLS/WebSocket 等。价值证据是上述本地候选消费成功，不是用户采用数量、性能认证、Mooncakes 安装或 broker 兼容认证。

剩余缺口：真实 broker 的生产消费、NACK 策略、事务及心跳互操作；远端 CI；公开仓库；正式 Mooncakes 发布和独立 registry 安装；本人最终申报与承诺。旧九月十提交条款不自动视为十月门槛，保留有效历史但不凑数。本次验收矩阵与交付中的最终 `verification/downstream/downstream.json` 为实际结果依据。
