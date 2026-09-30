# 来源与许可

核心 MoonBit 实现原创，MIT，代码与测试由 Codex 辅助设计、编写和修复，见 AI_USAGE.md。

- STOMP 1.2 官方规范：https://stomp.github.io/stomp-specification-1.2.html ，CC BY 3.0。参考帧语法、转义、字节长度、命令、协商、心跳与 ACK/事务语义。规范文档未整篇复制进仓库；用例为自行编写的协议字节向量，来源在文档明确归因。
- MoonBit core 随固定 SDK 提供，Apache-2.0；仅用 UTF-8、JSON 及基础集合，没有复制 core 源码进发布包。
- Node.js 内建 net/perf_hooks/assert，MIT 及其第三方许可；没有 npm 运行时依赖。
- 独立差分参考：@stomp/stompjs 7.2.0，Apache-2.0，https://github.com/stomp-js/stompjs ，https://registry.npmjs.org/@stomp/stompjs/-/stompjs-7.2.0.tgz 。tests/reference/stompjs-7.2.0.umd.cjs 为该发行包 bundles/stomp.umd.js 的未改动副本，只用于差分测试；保留 LICENSE、包元数据与官方 npm SHA512 integrity。没有执行安装脚本。该参考不作为本库运行时或 MoonBit 实现来源。

401 组有效输入、1201 次参考解析分段比较通过（evidence/differential.json）。四项有意差异：参考会去掉 header 首尾空格、接受未知转义、带符号长度和错误终止字节；本库依 STOMP 1.2 保留空格并拒绝后三者。没有为了匹配参考实现而削弱协议校验。差分不等于真实 broker 验证。

样例任务文本、随机字节、ID、destination 为项目自造数据，不含真实个人或业务资料。未引入未经授权的闭源 fixture。
