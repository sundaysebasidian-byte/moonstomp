# 来源与许可

核心 MoonBit 实现原创，MIT，代码与测试由 Codex 辅助设计、编写和修复，见 AI_USAGE.md。

本页保留历史测试记录；当前私有候选的支持/失败矩阵以 README 和 linux-audit-20261022.zh-CN.md 为准。开发工具、外部测试服务与库运行依赖分开列出，不能把外部组件算成 MoonSTOMP 的原创实现。

- STOMP 1.2 官方规范：https://stomp.github.io/stomp-specification-1.2.html ，CC BY 3.0。参考帧语法、转义、字节长度、命令、协商、心跳与 ACK/事务语义。规范文档未整篇复制进仓库；用例为自行编写的协议字节向量，来源在文档明确归因。
- MoonBit core 随固定 SDK 提供，Apache-2.0；仅用 UTF-8、JSON 及基础集合，没有复制 core 源码进发布包。
- Node.js 内建 net/perf_hooks/assert，MIT 及其第三方许可；没有 npm 运行时依赖。
- 当前适配器和演示还使用 Node 内建 tls/fs/crypto；Python 只用于构建/验证流程，JDK/keytool/lsof 只用于临时 broker 与证书/监听检查。沿用现有安装，不随源码包分发这些工具或其二进制。
- 独立差分参考：@stomp/stompjs 7.2.0，Apache-2.0，https://github.com/stomp-js/stompjs ，https://registry.npmjs.org/@stomp/stompjs/-/stompjs-7.2.0.tgz 。tests/reference/stompjs-7.2.0.umd.cjs 为该发行包 bundles/stomp.umd.js 的未改动副本，只用于差分测试；保留 LICENSE、包元数据与官方 npm SHA512 integrity。没有执行安装脚本。该参考不作为本库运行时或 MoonBit 实现来源。

401 组有效输入、1201 次参考解析分段比较通过（evidence/differential.json）。四项有意差异：参考会去掉 header 首尾空格、接受未知转义、带符号长度和错误终止字节；本库依 STOMP 1.2 保留空格并拒绝后三者。没有为了匹配参考实现而削弱协议校验。差分不等于真实 broker 验证。

样例任务文本、随机字节、ID、destination 为项目自造数据，不含真实个人或业务资料。未引入未经授权的闭源 fixture。

真实互操作另使用官方 Apache Artemis 2.57.0，Apache-2.0，只在临时测试运行，不作为库依赖或二进制随包分发。生成配置保留 ASF 许可头；运行证据同时保留发行包 LICENSE/NOTICE。来源为官方 https://artemis.apache.org/components/artemis/download/ 与固定 2.57.0 官方源码；摘要固定于 broker-run.py。没有复制 broker 的 Java 实现到 MoonBit，源码只用于核行为差异。字节记录为自造数据的实际回环运输观察。

2026-10-03 有界复核另增加 64 个外部序列化 MESSAGE 和 256 次 MoonBit Client 分段接收，对比固定参考的每字节解析。所有实际结果直接逐项比较，未 trim 本库结果或放宽已知严格差异；脚本纳入固定验证流程，真实 broker 此轮未重跑。

2026-10-20/22 的 Classic 6.3.2 续验使用 Apache 官方完整发行物（Apache-2.0 及发行物内第三方 LICENSE/NOTICE）：https://archive.apache.org/dist/activemq/6.3.2/apache-activemq-6.3.2-bin.tar.gz ，校验文件为同地址追加 `.sha512`。归档 SHA256 `543e9ca8a234d118a8c195d802a110994a59b7973d75ae0a7ccd47dc2cc2c5c1`，官方 SHA512 及 jar 哈希见 Linux 审计。只运行临时、无持久化、无 JMX/web 的回环 profile，真实测试不等于把 broker 作为库运行依赖；完整 LICENSE/NOTICE 保留在私有证据，broker 二进制未打包。

当前兼容 SDK 的官方方法：https://www.moonbitlang.com/blog/moonbit-wasm-toolchain ；固定发行物：https://github.com/moonbitlang/moonbit-compiler/releases/tag/v0.10.16%2Bb1a0e846e ，Wasm 归档 SHA256 `59295638e4009e5cdd103520a2766a351bd7d6c98301acef1f5b674f1fd19fbb`。配套 `moon`/`moonrun` 来自官方 https://github.com/moonbitlang/moon 的 `6691f1825d7b8f3b9a43334f27ce5daf9d51f861`（仓库 Apache-2.0）；core 随该发行物。没有复制或重新分发 SDK，不能将编译器发行物整体的许可混称为本项目 MIT；完整 SDK 与 mooncake 未恢复的限制保留。

历史 go-stomp 互操作使用 tests/interop/go-peer/main.go 的项目自有 glue 调用固定上游 `github.com/go-stomp/stomp/v3`，固定提交和构建步骤见 broker-plan.zh-CN.md、status-details.zh-CN.md；该 Go 包不是 MoonBit 库的依赖，也未将其 parser 移植进核心。本轮没有重跑 go-stomp，不将旧回执改写为本轮通过。
