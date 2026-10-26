# MoonSTOMP 技术补审草稿（0.3.1）

2026-10-26，供审阅，未提交。本文整理项目技术事实，不含申请人的个人说明或诚信声明。历史 [Proposal](../Proposal.md)和[旧草稿](QUARTER_REVIEW_DRAFT.zh-CN.md)保留原日期及失败记录；AI 辅助范围见 [AI_USAGE.md](../AI_USAGE.md)。

## 版本支持与互操作

原反馈要求分清实现与计划，补充 go-stomp 对照、互操作和完整版本支持。已发布的 MoonSTOMP 0.3.1 支持 STOMP 1.0/1.1/1.2 的增量二进制编解码、版本协商、订阅、版本化 ACK、事务 SEND、receipt 及适用版本的心跳。核心不负责 I/O，Node 适配器负责 TCP/TLS；1.0 不提供规范中不存在的心跳或 NACK。

go-stomp 对照固定到源码提交，并明确它可以接入调用方建立的 `tls.Conn`。历史 go-stomp ↔ Artemis 三版本双向测试保留原日期。当前 Classic 6.3.2 TLS 三版本、认证负控制、receipt 丢失、心跳和短异步有各自 CI 与发布后消费记录；本轮没有重跑 Classic+Go 对端。[公平对照](FAIR_GO_STOMP_COMPARISON.zh-CN.md)和[证据索引](REVIEW_EVIDENCE_INDEX.zh-CN.md)列出具体范围。

0.3.0 起的 Node `sendAsync` 按 FIFO 等待 write callback/drain，限制队列数量、字节和期限，不自动重连或重发。本机写入完成不等于 broker receipt。0.3.1 修复 Classic 首次空闲心跳约 2R 后到达时的接收期限边界，增加有界调度余量；故障检测略晚，不能容忍任意调度延迟。原 0.3.0 registry 心跳失败保留，修复后另验 100/1000ms 心跳观察及主动 drop 后关闭。

## 发布与复现

```sh
moon add sundaysebasidian-byte/moonstomp@0.3.1
```

[官方 0.3.1](https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp@0.3.1/)已发布，[PR #10](https://github.com/sundaysebasidian-byte/moonstomp/pull/10)已合并。发布提交为 `dde74d2c0fb1a0ca60ec7bdab4c983065af7f5b7`；[候选 head 常规 CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225200831)、[fresh clone](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225200847)和[固定 broker CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225233529)通过。合后检查、checksum 和消费记录见[发布回执](release-0.3.1.zh-CN.md)。Node 适配器需按对应源码构建，不是 npm 包或 MoonBit 根包异步 API。

远端源码 head 的真实 TLS 场景运行 300005.330566ms，1400 条发送、交付、ACK、receipt 对应，无意外错误、超时或重复。这是限定低速的五分钟测试。发布后本地实际 registry 包通过 JS/Wasm GC 核心、三版本黄金、脚本传输/异步、真实 TLS 三版本、两档心跳正负控制及清理；没有对安装包再跑五分钟负载。

## 限制

尚未验证长期稳定性、生产 PKI、mTLS、故障转移、事务 ACK 回滚/NACK 重投递完整语义，以及 native/普通 Wasm/Windows 消费者。不提供 exactly-once 保证。旧 heartbeat fixture/hash 缺口保留，当前夹具有自己的源码身份。已有独立 AI 复审，尚无外部人类审查、真实采用或评委复审结论。
