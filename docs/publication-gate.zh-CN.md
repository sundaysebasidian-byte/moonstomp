# 发布范围与验证

发布包以 MoonBit 为主体，原创 MIT；固定 stompjs 测试参考保留 Apache-2.0 许可与来源。SDK、broker 二进制、构建缓存和个人材料不属于分发内容。历史开发和提交时间保留真实记录。

源码 check/build/test、实际 package 消费、准确提交 CI 与正式 registry 安装分别报告。只有实际正式上传且独立安装核验的版本才称为正式包；本地 ZIP/path 消费不能代替 registry 证据。历史 0.1.2 发布记录见 publication-0.1.2.zh-CN.md；当前多版本私有候选虽仍写 0.1.2，未作为新版发布，不能用历史 registry 安装替代候选验收。

2026-10-22 当前边界：JS 和真实 Classic TCP/TLS 检查通过，Wasm/Wasm GC 独立控制失败，native 缺 runtime，`moon package` 缺 `mooncake`。正式包生成与新候选 registry 安装未完成；完整原始失败保留在 Linux 审计。维护者已另行允许推送独立开发分支供审阅；这不代表正式包发布、合并、提交比赛或接受协议。

真实 broker 保留已测 Artemis profile 及事务 ACK/NACK 限制；通过工程验证不等于标准认证或竞赛验收。版本记录见 publication.zh-CN.md、publication-0.1.1.zh-CN.md、source-sync-0.1.2.zh-CN.md。
