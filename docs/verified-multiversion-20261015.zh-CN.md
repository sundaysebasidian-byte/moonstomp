# STOMP 多版本本地验收（2026-10-15）

本报告覆盖恢复包中的 `31d9c02bb730d1a469ee5da565602ebef3a0b411` 及本次测试工具兼容补丁。正式发行仍为 0.1.2；没有 push、远端 Actions、Mooncakes 发布或重申。本文为 AI 辅助工程记录，须由申请人审阅后用于申请。

## 已实际通过

- MoonBit JS 与 Wasm-GC 各 61/61，包含全部 17 项新增 1.0/1.1/1.2 测试；默认 1.2 API 保持原行为。
- check/build、离线三场景、Node bridge；stompjs 7.2.0 差分 401 个合法帧/1201 个参考分块运行、64 个增量客户端场景/256 个分块运行。
- 真实打包、独立模块消费：JS/Wasm-GC 各 6/6；解压候选包自身编译 bridge、4 项运输边界检查。
- 自造 TCP peer 的 10 项生命周期 + 4 项边界检查。它们不计作 broker 互操作。
- 真正 Go ↔ Apache Artemis 2.57.0 ↔ MoonBit 双向消息交换，分别强制 1.0、1.1、1.2。双方实际协商版本均核验；每向核验 5 octets 二进制正文 `[65,0,255,13,10]`；核验订阅/发送/确认/退订回执及断开。
- ACK 字段按版本核验：1.0 `message-id`；1.1 `message-id` + `subscription`；1.2 `id`。Header 覆盖：1.0 安全 ASCII；1.1 colon/LF/backslash/Unicode/空格；1.2 再含 CR。
- 原 Artemis 三个场景与五项扩展检查全部重跑。`lsof` 证实唯一监听为 `127.0.0.1:61613`；结束后进程退出、端口关闭。

## 工具与实际变更

本次为 Linux x86_64，官方 SDK `moonc v0.10.15+943464bfa`、`moon 0.1.20261012`、Node 24.19.0、Python 3.12、OpenJDK 21.0.12.1、Go 1.26.8。历史 toolchain.lock.json 保留不改，默认严格入口仍拒绝不匹配；新增 `--current-toolchain` 显式兼容模式，报告实际版本与差异，不能称为历史锁定工具链复验。

1. downstream 工具增加可选当前 `moon.mod` + `moon.work` 模式，选择 consumer 包进行 Wasm-GC 检查，避免把仅 JS 的 bridge 当作 Wasm 包。历史模式保留。候选包自身仍独立编译 bridge。
2. broker runner 接受 Java 17+ 并记录真实版本：[Apache 2.57.0 官方说明](https://artemis.apache.org/components/artemis/download/release-notes-2.57.0) 明确要求 17 或更高。Java 21 的通过结果不是 Java 17 的重现结果。
3. broker 的配置、实际监听、扩展结果和 ZIP CRC 检查改为明确拒绝，不能被 `python -O` 或 `PYTHONOPTIMIZE` 关闭；9项离线护栏/负控制在普通与优化模式各运行一次。
4. verify 入口接入已有真实 Go peer，使完整验收一次执行并保留完整日志。`moon info` 真正运行，公开 API 文件由工具生成；未手写接口清单。禁止把 Python 临时缓存打入候选包。

官方 [Artemis 下载页](https://artemis.apache.org/components/artemis/download/) 的二进制包已核对其 SHA512：`47d2193b4707bde8c856ee0f7ee623e87722559b8503aaef6ee015496499774a8c9b9492933cc0a52873e95dce73ff825222422996d2a8768a4936b015415e8c`。Go 1.26.8 linux-amd64 官方包 SHA256 为 `d0f743b33e8d8945e6b1f432edd15785c70507121d6e2a723b21285eddf8b57b`，已核验。go-stomp 是干净的真实上游固定提交 `c155a2d699bb5bc1b2547a4382b3cdd7f4403648`；peer 使用其公开 API，无替代协议实现。

## 范围与剩余差距

当前候选具有三个协议版本的 codec、协商及客户端命令/生命周期实现，并已有上述多版本单测和单一 broker 配置下的真实双向证据。不能将有限测试提升为所有 broker/配置的“完整协议认证”。

- Artemis 2.57.0 的事务 ACK 仍在事务外执行，ABORT 不恢复交付；NACK 行为依 broker 策略。本轮没有修饰为完整事务 ACK 互操作。
- 1.0 特殊 header 与 1.1 literal CR 的规范语义由 MoonBit 字节测试覆盖；go-stomp writer 对旧版仍统一转义，所以跨客户端测试不将这些差异掩盖成通过。
- 没有多个 broker 交叉验证、TLS/WebSocket、重连、持久 outbox、业务重试或 exactly-once 保证；Node 便利连接仍仅匿名；通用帧可携带认证头，但本次没有凭据测试。
- 1.0 无 id 订阅同 destination 重叠被有界客户端策略拒绝，显式 id 重叠若收到无 subscription 消息也会拒绝歧义。
- 历史锁定 SDK/Node 尚未在本次重跑。新版 `moon fmt --check` 提出包括 optional 参数 `?`→`~` 的语法迁移；现源码可正常编译运行，未把这种大范围工具升级混入本次补丁。格式检查不能记为通过。
- 正式公开包仍是原 0.1.2，不包含本次多版本候选；远端 CI、发布及重申均待单独授权。

## 重现

使用已验证可信工具链，提供已校验的官方 archive/checksum 和真实 Go peer：

```sh
python3 scripts/verify.py --current-toolchain --transport \
  --broker-archive /absolute/apache-artemis-2.57.0-bin.tar.gz \
  --broker-checksum /absolute/apache-artemis-2.57.0-bin.tar.gz.sha512 \
  --broker-java-home /absolute/java17-or-newer \
  --go-peer /absolute/go-peer-build/go-peer \
  --output /new/external/evidence-directory
```

Go peer 的固定来源、源码与二进制 hash 由 `build-go-peer.py` 生成并被 broker 测试重新核验。完整成功标准还包含源文件验前/验后 hash 不变、进程退出与端口关闭。初始工具链拒绝和下游兼容失败日志均保留，不删除失败历史。
