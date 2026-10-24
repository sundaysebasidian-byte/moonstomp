# MoonSTOMP 0.2.0 提交准备说明

供用户审阅的修正草稿，未发送、未提交。事实核对日期：2026 年 10 月 24 日。

## 当前结论

MoonSTOMP 0.2.0 已正式发布，包含 STOMP 1.0/1.1/1.2 增量编解码与有界、传输无关客户端核心。材料应指向 0.2.0，不把历史 registry 0.1.2 的范围当最新版。Node TCP/TLS 适配器与核心后端范围分开记录。

```sh
moon add sundaysebasidian-byte/moonstomp@0.2.0
```

- [包页面](https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp)
- 发布提交：`39043afeca8953c05ff8089b15cc27bfc6c19f20`
- 本稿固定文档提交：`69623eebcb10451168d7d19f66e0c0a704ce911a`
- [版本 PR #6](https://github.com/sundaysebasidian-byte/moonstomp/pull/6)

## 解决的问题

核心按字节增量解析 STOMP 帧，处理任意分帧、正文 NUL/二进制字节、版本协商、订阅、ACK、事务、receipt、心跳。协议状态、容量预算与时钟由 MoonBit 核心管理；Node 管理 TCP/TLS、等待期限和连接清理。没有 npm 运行依赖。

代表场景是订单 receipt 丢失：消费者已观察到消息，生产者却未收到 broker receipt，不能推断 broker 未执行，也不能忽略重复风险自动重发。既有演示以合成订单和隔离 broker 展示 outcomeUnknown、失败后关闭、不自动重放；不声称 exactly-once 或数据库事务。

## 发布与消费验证

0.2.0 获 CLI HTTP 200，registry 实际版本、metadata 和 checksum 一致。全新 registry 消费者无 workspace/path 覆盖；JS/Wasm GC 核心各 6/6、多版本黄金输出与已安装包 TCP/TLS 检查通过。

发布 ZIP SHA256：`3c7d15ca2ee91f179d5006f3ae3d8d9495aaf863fa9e961b0a4748c18bbe5ef2`。

PR #6 精确 head 与合后 CI 通过，文档 PR #7 已合并。上述主分支检查：

- [核心及本地传输验收](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40114375646)
- [锁定/最新 SDK fresh clone](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40114375647)

这些是发布轮证据。该轮未重跑真实 broker；native/普通 Wasm 消费者和 Windows 未验，不能从 JS/Wasm GC 推断。本轮私有补丁和命令另行记录，主分支绿不代表私有新补丁已通过。

## 真实 broker 历史证据

历史回执记录 ActiveMQ Classic 6.3.2 真实 TCP/TLS、多版本、receipt 未知结果与清理；保留原 SHA、SDK、日期，不改称发布轮新实测。[历史接入说明](https://github.com/sundaysebasidian-byte/moonstomp/blob/69623eebcb10451168d7d19f66e0c0a704ce911a/docs/integration-master636-20261023.zh-CN.md)。

`classic-run.py --tls` 与 `--tls --demo` 可用于复现，但需既有 broker/JDK/证书/新输出目录。订单 receipt-loss 演示关闭心跳，不能证明真实心跳；历史心跳必须单独引用。普通 CI 尚未接入真实 broker，绿徽章不是 broker CI 已完成。手动配置准备未执行时也不能写成 CI 已绿。

## 迁移与取舍

0.2.0 三个有状态类型通过方法暴露行为，旧字段调用方需迁移。保留历史但不继续写“manifest 仍为 0.1.2”或“0.2.0 只是未发布建议”。见[迁移说明](migration-master-20261023.zh-CN.md)。

核心采用有界资源和 fail-closed；receipt 等控制等待失败后的关闭避免迟到回执混淆。普通观察超时和控制超时应区分。ACK 不是业务持久化，STOMP 事务不是跨数据库原子事务。

## 尚未证明

没有实际采用、生产接入、性能领先、长稳、生产 PKI、mTLS、故障转移或持久性保障证据。Classic 事务 ACK 回滚与 NACK 重投递不能因一般事务/ACK 通过就算验收。

下一步固定官方完整发行包与校验值，复用既有入口准备有界、手动 broker CI，再做明确速率/窗口的负载测量。负载未执行，本稿无吞吐/延迟/内存数字，不以计划代完成；本轮不跑五分钟负载。

## 来源与审阅

保留 MIT、参考实现和协议规范归因；SDK/JDK/broker 不改称项目原创。AI 辅助按 AI_USAGE.md 如实说明。本文供用户理解、审阅、改写，不冒充用户独立写作；没有向第三人发送、提交比赛、接受协议，不承诺初审或季度奖。

[修正前草稿原文](https://github.com/sundaysebasidian-byte/moonstomp/blob/69623eebcb10451168d7d19f66e0c0a704ce911a/docs/submission-preparation.zh-CN.md) 保留 2026-10-20/22/23 原证据日期与源码，不作为本轮候选新实测。历史真实心跳若无原 fixture/hash，只能称历史本地证据，不能以模拟 demo 代替。
