# MoonSTOMP 技术补审草稿（0.3.1）

2026-10-26，供用户审阅改写；未发送、未提交。本文只整理技术事实，不是申请人的个人说明或诚信声明。历史 [Proposal](../Proposal.md)与[旧草稿](QUARTER_REVIEW_DRAFT.zh-CN.md)保留原日期、候选状态和失败记录；AI 辅助范围见 [AI_USAGE.md](../AI_USAGE.md)。

## 对原问题的回应

原反馈指出材料混淆已实现和拟实现、范围偏窄，并要求参考 go-stomp、功能比较、互操作与完整版本支持。当前 MoonSTOMP 0.3.1 已正式发布，支持 STOMP 1.0/1.1/1.2 的增量二进制编解码、版本协商、订阅、版本化 ACK、事务 SEND、receipt 及适用版本的心跳。核心为 sans-I/O，Node 适配器负责 TCP/TLS；不声称 1.0 支持规范不存在的心跳或 NACK。

成熟实现对照固定 go-stomp 的提交和源码范围，明确其可接入调用者提供的 `tls.Conn`，不以缺少内建 TLS 选项误称“不支持 TLS”。历史 go-stomp ↔ Artemis 三版本双向互操作按原日期保留；当前 Classic 6.3.2 的真实 TLS 三版本、认证负控制、receipt 丢失不重发、心跳与短异步另有精确 CI 和发布后消费证据，不能混称本轮 Classic+Go 新实测。对应功能和边界见[公平对照](FAIR_GO_STOMP_COMPARISON.zh-CN.md)与[证据索引](REVIEW_EVIDENCE_INDEX.zh-CN.md)。

0.3.0 起的 Node 有界异步 SEND 保留同步接口，按 FIFO 等待 write callback/drain，限制队列数量、字节及期限，不自动重连或重发。本机写入完成不等于 broker receipt。0.3.1 修复 Classic 首次空闲心跳约 2R 后到达时的检查相位边界，增加有界调度余量；故障检测略晚，不保证任意调度延迟。原 0.3.0 实际 registry 心跳失败保留，修复后两档真实 TLS 心跳观察与主动 drop 关闭分别验证。

## 可安装版本与证据

```sh
moon add sundaysebasidian-byte/moonstomp@0.3.1
```

[0.3.1 官方版本](https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp@0.3.1/)已发布；[PR #10](https://github.com/sundaysebasidian-byte/moonstomp/pull/10)已合并，发布提交为 `dde74d2c0fb1a0ca60ec7bdab4c983065af7f5b7`。[精确 head 常规 CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225200831)、[fresh clone](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225200847)及[固定 broker CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225233529)成功。包 checksum、合后检查和实际 registry 消费边界见[发布回执](release-0.3.1.zh-CN.md)。Node 适配器按对应源码构建使用，不是 npm 包或根包 MoonBit 异步 API。

远端源码 head 的真实 TLS 五分钟场景为 300005.330566ms、1400 条发送/交付/ACK/receipt 对应、无意外错误/超时/重复；这是限定低速场景，不是已安装 registry 五分钟测试或长稳。发布后本地实际 registry 包通过 JS/Wasm GC 核心、三版本黄金、脚本传输/异步、真实 TLS 三版本、100/1000ms 心跳正负控制及清理。

## 保留的限制

没有生产 PKI、mTLS、故障转移、长期稳定性或 exactly-once 证明；事务 ACK 回滚/NACK 重投递完整语义、native/普通 Wasm/Windows 消费者未验证。旧 heartbeat fixture/hash 缺口不以新夹具冒充补齐。独立 AI 复审不是外部人类认可，尚无真实采用或评委重新审核结论。不以测试数、五分钟场景或发布成功推断获奖概率。
