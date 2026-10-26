# MoonSTOMP 技术证据索引

核对日期：2026-10-26。当前安装版 **0.3.1**。复审重点是完整版本支持、成熟实现对照及真实互通，已实现与未验证范围分列。

| 项目 | 内容与证据 |
| --- | --- |
| 旧基线 | 0.1.2 的单版本及早期 TLS 限制属于历史；当前支持 STOMP 1.0/1.1/1.2，见[版本示例](../examples/versions/main.mbt)和[当前边界](boundaries.zh-CN.md)。 |
| 本期贡献 | 多版本有界核心、Node TCP/TLS、有界异步 SEND、0.3.1 心跳调度余量修复；[go-stomp 功能对照](FAIR_GO_STOMP_COMPARISON.zh-CN.md)按实际接口及测试范围比较，不作速度胜负结论。 |
| 当前安装版 | `moon add sundaysebasidian-byte/moonstomp@0.3.1`；[官方包](https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp@0.3.1/)、[发布提交 dde74d2](https://github.com/sundaysebasidian-byte/moonstomp/commit/dde74d2c0fb1a0ca60ec7bdab4c983065af7f5b7)。Node 适配器按对应源码构建，不是 npm 包。 |
| 复现 | `moon run examples/versions --target js`；`node examples/demo/08-async-send.cjs` 使用脚本 peer。真实 Classic TLS 入口：`python3 scripts/classic-run.py --tls`，环境与选项先看 `--help`、[手动 workflow](../.github/workflows/broker-integration.yml)。不要将脚本 peer 当作真实 broker。 |
| CI | 发布 head：[常规](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225200831)、[fresh clone](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225200847)、[真实 Classic TLS](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225233529)。文档修订前 `3589fbd`：[常规](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40288647118)、[RabbitMQ](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40288647089)。 |

发布轮干净 registry 消费已验 JS/Wasm GC 核心、实际包 Node 适配器和真实 Classic TLS。100/1000ms 两档先观察心跳，再主动 drop 后检查关闭；源码远端五分钟场景与 registry 短场景分别见[发布回执](release-0.3.1.zh-CN.md)。这不代表长期稳定性或生产采用。

当前 RabbitMQ 源码测试以 `1000,1000` 请求心跳，直接收到两次服务端心跳，并检查 20 条异步 SEND 有序到达；没有独立统计客户端线上心跳或定向截断方向。NACK 重投递只适用于该 RabbitMQ profile。[其他 broker 记录](broker-interop.zh-CN.md)按日期区分。

尚缺 native/普通 Wasm/Windows 消费、生产 PKI/mTLS、故障转移、持久化及长期负载证据。receipt 不保证业务持久化，不提供自动重连/重发或 exactly-once。竞赛表单和个人说明由用户完成；辅助工具披露见 [AI_USAGE](../AI_USAGE.md)。
