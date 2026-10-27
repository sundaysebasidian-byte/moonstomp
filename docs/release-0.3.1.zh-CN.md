# MoonSTOMP 0.3.1

发布日期：**2026-10-25**。[Mooncakes 精确版本](https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp@0.3.1/)。

```sh
moon add sundaysebasidian-byte/moonstomp@0.3.1
```

## 本次更新

修复 Classic 空闲心跳的调度余量：协商接收周期为 R 时，Client 容差为 `min(R+100ms,2147483647ms)`，严格在 `elapsed > R+tolerance` 时关闭，常见周期下保留 100ms 余量，期限为 2R+100ms。独立 HeartbeatClock 的默认容差仍为 100ms。

保留 STOMP 1.0/1.1/1.2、有界核心和 0.3.0 起的 Node `sendAsync`。receipt 丢失仍可能是结果未知，不自动重放；本机写入完成不等于 broker 回执。迁移及使用见[适配器指南](guide.zh-CN.md)、[异步 SEND](async-send.zh-CN.md)。

## 已执行验证

以下均为原发布轮结果，本次文档整理没有重跑这些测试。

- 测试 head `5b5c99653aaa0ce8e4771d6d79ee4a7f750afedc`：[常规 CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225200831)、[fresh clone](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225200847)。
- 同一 head 的[真实 Classic 6.3.2 TLS CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225233529)：三版本、receipt-loss、100/1000ms 心跳正负控制、短异步及清理。
- [PR #10](https://github.com/sundaysebasidian-byte/moonstomp/pull/10) 合并为 [dde74d2](https://github.com/sundaysebasidian-byte/moonstomp/commit/dde74d2c0fb1a0ca60ec7bdab4c983065af7f5b7)：[合后常规](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225826108)、[fresh clone](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225826099)通过。
- 正式发布获 CLI HTTP 200，registry metadata 与 ZIP checksum 一致。全新 registry 消费者无 workspace/path 覆盖：JS/Wasm GC 核心各 9/9，三版本、实际包 Node 传输/异步及真实 Classic TLS、两档心跳观察后 drop 关闭通过。

## 使用范围

Node TCP/TLS 适配器按该版本源码构建 bridge 后使用，**不是 npm 包**。真实 broker、脚本 peer、源码 CI 与安装包分别记录。五分钟、1400 次对应发送/交付的结果来自源码 head，不是 registry 包的五分钟测试或长期稳定性证明。

native、普通 Wasm、Windows 消费者及生产 PKI、mTLS、故障转移、事务 ACK 回滚等边界见[支持范围](boundaries.zh-CN.md)。接收余量不能保证任意事件循环阻塞下不断线。

## 完整回执

[原发布页完整快照](development-history/release-0.3.1.zh-CN-through-2026-10-27.md)保留 checksum、逐项范围、原失败及固定证据链接；本机原始日志仍保留原交付身份。更多案例见[技术证据索引](TECHNICAL_EVIDENCE.zh-CN.md)。
