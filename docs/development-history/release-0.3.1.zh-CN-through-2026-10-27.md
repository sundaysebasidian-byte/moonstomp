# MoonSTOMP 0.3.1 发布回执

状态核对：2026-10-26。0.3.1 已于 2026-10-25 正式发布。

```sh
moon add sundaysebasidian-byte/moonstomp@0.3.1
```

- [Mooncakes 精确版本](https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp@0.3.1/)；[registry manifest](https://mooncakes.io/api/v0/manifest/sundaysebasidian-byte/moonstomp@0.3.1)。
- [PR #10](https://github.com/sundaysebasidian-byte/moonstomp/pull/10) 已合并；测试 head `5b5c99653aaa0ce8e4771d6d79ee4a7f750afedc`。
- 发布合并提交：[dde74d2c0fb1a0ca60ec7bdab4c983065af7f5b7](https://github.com/sundaysebasidian-byte/moonstomp/commit/dde74d2c0fb1a0ca60ec7bdab4c983065af7f5b7)，与测试 head 的 tree 相同。
- 官方 CLI 单次发布退出 0、HTTP 200 OK；manifest HTTP 200、build_status 为 success。[官方 ZIP](https://download.mooncakes.io/user/sundaysebasidian-byte/moonstomp/0.3.1.zip) 的 SHA256 与 metadata 一致，155 个文件与审计后的合并源码和实际安装文件一致：

```text
00f837a168cb4f4ba116a88e25607a5fb89ceb0f89a8c44fb1bfa5f224359083
```

## 修复及已有功能

0.3.0 的 Mac 真实 registry TLS 消费者在主动 drop 前超时；独立观察器看到 Classic 6.3.2 首个空闲心跳约在 2R 后，再加调度延迟，原 Client 的 2R 期限可能先关闭。0.3.1 改为 `tolerance=min(R+100ms,2147483647ms)`，严格在 `elapsed > R+tolerance` 时关闭。常见 R 下为 2R+100ms；公共 HeartbeatClock 默认 100ms、方向禁用和重连/重发策略不变。代价是故障检测略晚，不保证任意调度延迟。

测试夹具仍转发全部 EOL，仅在 CONNECTED 至少一个协商周期后的空闲窗口计数，排除尾随换行。100/1000ms 均先观察双向心跳，再主动丢弃 broker 心跳，检查超时、无重连及清理。原 0.3.0 失败和发布包保持不变；[根因记录](https://github.com/sundaysebasidian-byte/moonstomp/blob/32090a84c0d4fd31359f764b4c92ffa16db7671c/docs/heartbeat-phase-margin.zh-CN.md)保留本地诊断阶段身份。

0.3.0 起的有界 Node `sendAsync` 已随源码与归档发布，0.3.1 保留。`moon add` 添加 MoonBit 依赖，Node 适配器按对应源码构建 bridge 后使用；不是 npm 包或根包 MoonBit 异步 API。详见[异步 SEND](async-send.zh-CN.md)。

## 已执行的验证

| 证据 | 适用提交或版本 | 结果与边界 |
| --- | --- | --- |
| [精确 head 常规 CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225200831) / [fresh clone](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225200847) | `5b5c996…` | 核心、三版本、脚本 TCP/TLS、异步/期限/示例与 pinned/latest SDK 成功 |
| [固定 broker CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225233529) | 同一 `5b5c996…` | 真实 Classic 6.3.2 TLS 三版本、receipt-loss、100/1000ms 心跳正负控制、短异步和清理成功；完整官方归档 SHA512 锁定于[校验清单](https://github.com/sundaysebasidian-byte/moonstomp/blob/5b5c99653aaa0ce8e4771d6d79ee4a7f750afedc/scripts/classic-release.sha512) |
| [合后常规 CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225826108) / [fresh clone](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40225826099) | `dde74d2…` | 成功；5 个合前 run 和 2 个合后 run 共 10 个 job 成功，不是本次文档分支的新 CI |
| 发布后干净 registry 消费（本地发布回执） | 精确 `0.3.1`，无 workspace/path 覆盖 | JS/Wasm GC 核心各 9/9；三版本黄金、实际包 Node bridge/脚本传输/异步成功；真实 Classic TLS 三版本、100/1000ms 心跳观察后 drop 关闭、短异步及清理均成功 |

远端源码 head 的五分钟场景为 300005.330566ms，1400 次发送/交付/ACK/receipt 对应，意外错误、超时、重复均为 0；另有 1 次预期负控制观察超时。**这不是已安装 registry 包的五分钟测试或长稳结果。**

实际 registry 包的短异步场景为 16 次本机写入加另一条 receipt-fence，观察到 17 条有序交付；fence 只确认自身，不是前 16 条逐条 receipt。两档心跳均无业务 SEND，检查的是心跳与关闭。端口关闭、私钥清除均通过。

完整本机发布/消费者日志保留私有；不冒充公开附件或本次重新运行。发布后的文档修订不改变发布归档中的旧文档。

## 未验证边界

native/普通 Wasm/Windows 消费者、生产 PKI、mTLS、故障转移、长期稳定性、事务 ACK 回滚/NACK 重投递完整语义未验证。脚本 peer、真实 broker、源码 CI、registry 消费分别记录。[评审证据索引](https://github.com/sundaysebasidian-byte/moonstomp/blob/32090a84c0d4fd31359f764b4c92ffa16db7671c/docs/REVIEW_EVIDENCE_INDEX.zh-CN.md)列出剩余缺口。
