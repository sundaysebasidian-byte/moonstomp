# 2026-10-03 有界质量复核

本轮基于 0.1.2 本地候选 `ef94b5b57a962e20077befc358eb3df423101cbe`，只增加验证与准确说明，没有新增协议功能或运行时依赖。正式 Mooncakes 仍为 0.1.1；后续源码同步与 CI 见 source-sync-0.1.2.zh-CN.md。本页保留本轮验证的日期范围。

## 独立检查与新增回归

逐项复核 decoder 的阶段、UTF-8/转义、重复首值、content-length/二进制 NUL、EOF 与清理，以及 Client 的预算、receipt、确认和事务状态。此次未观察到新的运行时缺陷；既有真实 broker 与固定外部参考结果保留，不能把自造输入当作新 broker 测试。

`parser_property_wbtest.mbt` 增加四项有界确定性生成测试，JS/Wasm-GC 核心均由 40 项增至 44 项：

1. 独立手写 wire 模板产生 64 个 SEND/MESSAGE/ERROR 帧，正文长度 0—63，二进制字节、UTF-8/四种转义、LF/CRLF、重复 header 和重复长度首值。直接建立解码期望，不用本库 encode 生成期望。每个 wire 的全部二段切分，加 8 种含空 chunk 的确定性多段分割，共 512 次多段分割；还连入心跳和 ACK 帧。
2. 19 项明确无效 corpus，包括 overlong/surrogate/out-of-range/truncated UTF-8、非法/悬空转义、bare CR、符号/空白/非 ASCII 长度、超限长度、错误 terminator、截断、禁止正文与 header NUL。每个二段切分均须报错，验证 poisoned decoder 清空自有 line/header/body，并拒绝继续输入。
3. 512 个含 Unicode/emoji/空格/分隔符的 header 值，检查转义 round trip 及 wire 不含原始 CR/LF/冒号；NUL 和非法转义须拒绝。
4. 零正文/零 header 容量、CR 字节计算、每次 feed 的事件上限精确边界。资源限制仍按 README 的字节/记录口径，不是总 RSS 或所有输入的证明。

独立 `@stomp/stompjs 7.2.0` 比较保留原 401 帧/1201 次参考分段，并新增 64 个外部序列化 MESSAGE、256 次 MoonBit Client 真正分段接收（每字节、3、17、整段）。外部参考按每字节解析，逐项比较 headers/body。没有为匹配参考实现而 trim 本库结果或放宽四项已知严格差异。参考 Apache-2.0 许可与固定来源保留。

## 验证状态与时域

本轮在固定可信 SDK 上串行复验 check/build、核心 JS/Wasm-GC 各 44/44、桥接、离线三场景、外部差分、原有 10+4 运输回归和实际候选 ZIP 消费。独立消费者两后端各 6/6，实际解压候选自身生成 bridge、加载包内 Node 适配器并运行四项回环边界。消费者仍是本地 path 依赖，不是 0.1.2 registry 安装或第三方采用。

**真实 Artemis 此轮未重跑。** 原 2026-10-02、提交 `5bf17102fe2747a5e50184af2c63a62d0b20c87d` 的三例/五检查/事务 ACK 限制证据原样保留。核心运行实现、bridge/TCP、三个 broker 例与 runner 相比原实测提交没有变化；交付记录逐文件 SHA256 绑定这一事实，而不把旧测试时间改为本轮或宣称新提交完整 broker 复验。其他 broker、事务 ACK 回滚支持、认证/TLS/持久化/高负载仍未测。

## 记录范围

此有界生成 corpus 是自造测试资料，不是持续随机 fuzz、完整 STOMP 认证或所有输入的证明。来源和许可、源码运行流程、正式 0.1.1 安装与 0.1.2 本地 package 消费分别见 README 与 reference.zh-CN.md。竞赛技术记录不能代替本人撰写的最终申报。
