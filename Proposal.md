# MoonSTOMP 客观技术事实（AI 辅助，非最终申报书；2026-10-18 重写）

本文只列事实，按状态分栏，申报时请逐项对应，不要把“已实现”和“拟实现”混写。申报书须由申请人人工撰写并按当期官方模板，本文不是申报书。

## 项目是什么

MoonBit 实现的 STOMP 无 I/O 编解码与客户端会话核心（帧、header 转义、`content-length`/NUL、订阅、ACK/NACK、事务、receipt、心跳、断连），外加一个 Node TCP 适配器。核心不依赖 socket、系统时钟或 Node；MIT；AI 辅助范围见 AI_USAGE.md。

## 已发布（0.1.2，Mooncakes）

仅 STOMP 1.2。0.1.0 / 0.1.1 / 0.1.2 有各自的发布记录。真实 broker 互通仅限 Apache Artemis 2.57.0 的 1.2 场景。

## 已实现、未发布（本分支候选）

STOMP 1.0 / 1.1 / 1.2 协商与线格式、按版本区分的 ACK 头与边界拒绝（见 README 状态表）。默认 1.2 API 行为保持。

## 已验证（区分类型）

- 本地（本轮，2026-10-18，macOS arm64，`moon 0.1.20260920`、`moonc v0.10.14+7d59c7ec9`、Node v24.18.0）：JS 与 Wasm GC 各 68/68；`scripts/verify.py` 18 个阶段全部 PASSED，其中 `versions-example` 把 `examples/versions` 的 js / wasm-gc 输出与 golden 文件逐字节比对（native 另行实跑一致）；自造 peer 回环 10+4+6 项（不是 broker 互通）。
- 真实 broker（**本轮实跑**，macOS arm64、Java 17.0.20、Go 1.27.1、端口 62613、锁定 SDK）：Go（go-stomp 固定提交 `c155a2d699bb5bc1b2547a4382b3cdd7f4403648`，peer sha256 `0b69c4fc…`）↔ Artemis 2.57.0（官方 SHA512 已核）↔ MoonBit，1.0/1.1/1.2 均双向通过，二进制正文 `[65,0,255,13,10]`，各版 ACK 头核对，订阅/发送/确认/退订/断开回执；另有 3 个示例与 5 项扩展场景。
- 真实 broker（**先前记录，2026-10-15，非本轮**；Linux x86_64、`moonc v0.10.15`、Go 1.26.8、Java 21）：同一路径同样通过。两次环境不同，互不替代。
- 独立参考：`@stomp/stompjs 7.2.0` 差分（401 个合法帧、1201 个参考分段解析）；它不是 broker 互通。
- 远端 CI：候选未运行。注册表：候选未发布。

## 未验证 / 已知限制

- 仅一种 broker（Artemis 2.57.0）、一种配置；无 RabbitMQ、ActiveMQ 等交叉验证；未测 TLS、认证 broker。
- Artemis 2.57.0 的事务 ACK 在事务外执行，ABORT 不恢复交付；NACK 行为依 broker 策略。
- 1.0 特殊 header 与 1.1 字面 CR 的规范语义由 MoonBit 字节测试覆盖；go-stomp 写入端统一转义，跨客户端测试无法证明这两点。
- Node 便利连接只做匿名连接；通用 Frame 可携带认证头，但没有凭据测试。
- 候选在锁定 SDK 的 JS / Wasm GC 本地结果已有；其他平台、其他 SDK 版本未测。

## 拟实现（尚未开始，不是已有能力，也不是承诺）

1. Node 便利连接支持 login/passcode。
2. 再选一种 broker（如 RabbitMQ STOMP 插件）做互通测试并写入对照表。
3. 基于 `node:tls` 的 TLS 适配。
4. 带退避的重连辅助。

## 明确不做

WebSocket、STOMP 服务端实现、持久化 outbox、业务重试、exactly-once 保证。

## 与 go-stomp 的关系

go-stomp 是成熟的 Go 客户端并支持 1.0/1.1/1.2；本项目是无 I/O 核心加 Node 适配器，不是其功能等价物。按固定提交 `c155a2d…` 源码核对：库内无 TLS 代码（只能把调用者建立的加密连接传给 `Connect`）、无自动重连、含登录选项和心跳选项，另带 STOMP 服务端包（该服务端不处理 1.0）；本项目均无服务端，TLS、重连、凭据便利连接尚未实现。互通测试以 go-stomp 公共 API 作真实对端，不是自写替代实现。逐项对照表见 README。
