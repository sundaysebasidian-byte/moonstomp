# 0.1.2 正式发布与安装记录

2026-10-04。此版本包含存活状态单调时钟检查、CONNECTED/RECEIPT 内部优先等待、host 和同步 Boolean predicate 校验，以及四项解析生成回归和真正增量的外部参考比较。MIT，核心仍为 MoonBit；不扩 TLS/WebSocket/重连功能，不新增 tag。

发布准备基于已公开且 CI 成功的 2a7be523dd8965e90609b352342b4e1bd49c1b91；当前只修正 README 的新版安装流程和版本记录，运行实现、脚本与测试内容不变。最新准确提交的 CI 必须成功后才执行官方 CLI 发布。发布回执、准确 checksum、当前 registry version/versions 和干净缓存的两后端消费验证在实际完成后追加；本段准备状态不宣称已发布或已安装。

正式安装命令为 `moon add sundaysebasidian-byte/moonstomp@0.1.2`。验证应核实际 manifest/dependency 来源和版本，逐一比对正式 ZIP 文件摘要，并执行 JS/Wasm-GC check/build/test/run，各六项（三个业务场景与三个边界回归）。独立 package/path 消费不能替代 registry 安装；Node 适配器依赖的 JS bridge 需要在消费者自己的可写副本中构建。

原 Artemis 2.57.0 三例/五检查及事务 ACK 限制保留日期与提交；本次不重跑。其他 broker、真实事务 ACK 回滚支持、认证/TLS/持久化/高负载仍未测。
