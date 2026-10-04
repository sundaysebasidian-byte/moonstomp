# MoonSTOMP 0.1.0 正式发布证据

2026-10-01 正式发布记录；不代表协议认证、竞赛验收或第三方采用。

| 事实 | 准确证据 |
| --- | --- |
| GitHub 公开仓库 | https://github.com/sundaysebasidian-byte/moonstomp ，public/master |
| 正式版本与源码 | sundaysebasidian-byte/moonstomp@0.1.0；v0.1.0 指向 16343c8b8cc5704984335acb2837ab85c9a5f096 |
| 首发提交远端 CI | https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/36832378116 ，headSha 精确一致，success |
| 正式包页面 | https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp |
| registry 元数据 | module/version=上述坐标；MIT；repository=上述 GitHub；build_status=success |
| 发布 ZIP 的 SHA256 | cbbc9dd22239cd77beaeb9b1261870cd0020acf2c7bf65b627df7124f0b3b489，与 registry checksum 相等 |
| 下游真实安装 | 全新 SDK registry/index/cache；moon add sundaysebasidian-byte/moonstomp@0.1.0，日志明确 Downloading。consumer manifest 仅版本字符串依赖，无 path/local override |
| 下游运行 | JS 与 Wasm-GC 分别 check/build/test/run；每后端 3/3，媒体任务二进制 ACK/NACK、传感器逐字节连帧/心跳、账目批次事务状态/receipt |
| 来源一致性 | 编译器依赖图实际解析到 consumer/.mooncakes/sundaysebasidian-byte/moonstomp；全部 49 个安装文件的 SHA256 与正式上传 ZIP 一致 |

公开摘录在 `evidence/publication/`；只将本机路径替换为 `<TASK_ROOT>`/`<SDK_ROOT>`，原始私有日志保留于交付 ZIP。首发后的文档记录不修改已经上传的 0.1.0 包，源码以 release tag 为准。后续文档提交另由其准确 HEAD 的 CI 验证。

首轮 registry 核心检查/构建/测试/运行已经全部通过，但证据脚本错误假定目录叫 `.moon`，最终路径断言失败。按编译器实际依赖图改为 `.mooncakes` 后，在另一个全新缓存完整重跑通过，并核对 49 文件摘要；前一次失败记录未删除，也未降低功能测试标准。这是证据脚本错误，不宣称首次整轮成功。

正式 `moon publish --frozen` 成功，返回 200；准确 registry 版本、checksum 和独立安装另行核验。许可证与分发范围见 publication-gate.zh-CN.md。

真实 broker 验证独立于上述离线消费者：Artemis 2.57.0 三例/五项检查通过，但 NACK 为丢弃、事务 ACK 不支持 ABORT 恢复。其他 broker、认证/TLS/WebSocket/持久化/高负载仍未测；没有生产可靠性或 exactly-once 保证。最终人工申报和身份/承诺由用户处理。
