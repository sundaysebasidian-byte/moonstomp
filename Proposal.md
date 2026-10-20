# MoonSTOMP 客观技术事实（AI 辅助，非最终申报书；2026-10-18 重写，2026-10-20 同步凭据/TLS/句柄/Classic 事实）

本文只列事实，按状态分栏，申报时请逐项对应，不要把“已实现”和“拟实现”混写。申报书须由申请人人工撰写并按当期官方模板，本文不是申报书。

## 项目是什么

MoonBit 实现的 STOMP 无 I/O 编解码与客户端会话核心（帧、header 转义、`content-length`/NUL、订阅、ACK/NACK、事务、receipt、心跳、断连），外加一个 Node TCP 适配器（登录凭据、可校验证书的 TLS、Subscription/Transaction 句柄、带 `code` 的结构化错误）。核心不依赖 socket、系统时钟或 Node；MIT；AI 辅助范围见 AI_USAGE.md。

## 已发布（0.1.2，Mooncakes）

仅 STOMP 1.2。0.1.0 / 0.1.1 / 0.1.2 有各自的发布记录。0.1.2 的真实 broker 互通仅限 Apache Artemis 2.57.0 的 1.2 场景；其后候选的互通范围见下。

## 已实现、未发布（本分支候选）

- STOMP 1.0 / 1.1 / 1.2 协商与线格式、按版本区分的 ACK 头与边界拒绝（见 README 状态表）。默认 1.2 API 行为保持。
- CONNECT 的 `login`/`passcode`（MoonBit 构造器与 Node 适配器；省略与空值有区别）。
- Node 适配器的 `tlsOptions`（Node 标准 TLS，强制校验证书，拒绝 `rejectUnauthorized:false`）。
- JS 适配器的 Subscription / Transaction 句柄；错误带 `name`/`code`/`operation`（`STOMP_INVALID`、`STOMP_ARGUMENT`、`STOMP_BROKER_ERROR`、`STOMP_HANDLE`）。
- CLI `--login`/`--passcode-env`/`--tls`；示例 03/04 使用句柄，新增示例 07（认证与错误）。
- Python 3.9 可运行完整 `verify.py`（`downstream.py` 在无 `tomllib` 时用受限的身份字段解析）。

## 已验证（区分类型）

- 本地（2026-10-20 合并后候选，macOS arm64，同一锁定工具链，系统 Python 3.9.6）：JS 与 Wasm GC 各 70/70；完整 `verify.py` 的阶段与结果以其输出目录的 `verification.json` 为准（见本轮交付报告）。
- 本地（先前，2026-10-18，同一工具链）：JS 与 Wasm GC 各 68/68；`scripts/verify.py` 18 个阶段全部 PASSED，其中 `versions-example` 把 `examples/versions` 的 js / wasm-gc 输出与 golden 文件逐字节比对（native 另行实跑一致）；自造 peer 回环 10+4+6 项（不是 broker 互通）。
- 真实 broker（**本轮实跑**，macOS arm64、Java 17.0.20、Go 1.27.1、端口 62613、锁定 SDK）：Go（go-stomp 固定提交 `c155a2d699bb5bc1b2547a4382b3cdd7f4403648`，peer sha256 `0b69c4fc…`）↔ Artemis 2.57.0（官方 SHA512 已核）↔ MoonBit，1.0/1.1/1.2 均双向通过，二进制正文 `[65,0,255,13,10]`，各版 ACK 头核对，订阅/发送/确认/退订/断开回执；另有 3 个示例与 5 项扩展场景。
- 真实 broker（**先前记录，2026-10-15，非本轮**；Linux x86_64、`moonc v0.10.15`、Go 1.26.8、Java 21）：同一路径同样通过。两次环境不同，互不替代。
- 独立参考：`@stomp/stompjs 7.2.0` 差分（401 个合法帧、1201 个参考分段解析）；它不是 broker 互通。
- 远端 CI：候选未运行。注册表：候选未发布。

## 未验证 / 已知限制

- 真实 broker 两个：Artemis 2.57.0（匿名）与 ActiveMQ Classic 6.3.2（login/passcode 认证，仅回环）；无 RabbitMQ 等其他 broker。Classic 上只测了三版本二进制收发、版本化 ACK/NACK 构造、事务 SEND commit/abort；事务 ACK 与 NACK 重投递未测。
- TLS 只在本机脚本 peer 上测过信任/主机名（可信 CA 成功，不受信 CA 与错误主机名拒绝且未发出 CONNECT）；没有真实 broker 的 TLS、mTLS、代理或生产网络测试。
- Artemis 2.57.0 的事务 ACK 在事务外执行，ABORT 不恢复交付；NACK 行为依 broker 策略。
- 1.0 特殊 header 与 1.1 字面 CR 的规范语义由 MoonBit 字节测试覆盖；go-stomp 写入端统一转义，跨客户端测试无法证明这两点。
- 句柄是 JS 适配器的封装，没有纯 MoonBit 同名类型；1.0 下同一 destination 的多个订阅按 destination 路由，不保证区分。
- 没有自动重连；没有性能或内存基准。
- 候选在锁定 SDK 的 JS / Wasm GC 本地结果已有；其他平台、其他 SDK 版本未测。

## 拟实现（尚未开始，不是已有能力，也不是承诺）

1. 再选一种 broker（如 RabbitMQ STOMP 插件）做互通测试，或补测 Classic 的事务 ACK / NACK 重投递。
2. 对真实 broker 做 TLS 互通测试。
3. 带退避的重连辅助（需先明确 receipt 不确定、订阅恢复与事务重放的语义）。

## 明确不做

WebSocket、STOMP 服务端实现、持久化 outbox、业务重试、exactly-once 保证。

## 与 go-stomp 的关系

go-stomp 是成熟的 Go 客户端并支持 1.0/1.1/1.2；本项目是无 I/O 核心加 Node 适配器，不是其功能等价物。按固定提交 `c155a2d…` 源码核对：库内无 TLS 代码（只能把调用者建立的加密连接传给 `Connect`）、无自动重连、含登录选项和心跳选项，另带 STOMP 服务端包（该服务端不处理 1.0）；本项目均无服务端和重连；凭据与 TLS 已实现，其中 TLS 只在本机脚本 peer 上验证过。互通测试以 go-stomp 公共 API 作真实对端，不是自写替代实现。逐项对照表见 README。
