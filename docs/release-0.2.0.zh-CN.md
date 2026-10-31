# 0.2.0 发布回执

2026-10-24 使用获授权 Mac 上既有官方 SDK、mooncake 和 `sundaysebasidian-byte` 登录态发布；未创建账户、凭据或持续权限。官方 `moon publish` 返回 `Server status: 200 OK`，registry 实际 version 和 metadata.version 均为 `0.2.0`。历史 `0.1.2` 保留。

```sh
moon add sundaysebasidian-byte/moonstomp@0.2.0
```

- [Mooncakes](https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp)
- [版本 PR #6](https://github.com/sundaysebasidian-byte/moonstomp/pull/6)，精确测试 head：`5f222f83d90521708b6387685802962f119bcbd4`。
- 发布 commit：`39043afeca8953c05ff8089b15cc27bfc6c19f20`。合并内容与测试 head 一致；[合后完整 Checks](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40113994300) 和 [合后 Fresh clone](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40113994305) 均成功。
- Registry checksum / 发布 ZIP SHA-256：`3c7d15ca2ee91f179d5006f3ae3d8d9495aaf863fa9e961b0a4748c18bbe5ef2`。

`Client`、`Decoder`、`HeartbeatClock` 从公开字段改为抽象类型，对依赖字段的外部调用方属于破坏性变更，因此从 0.1.x 升至 0.2.0。升级前阅读[迁移说明](migration-master-20261023.zh-CN.md)。原准备提交 `841da29` 的 Checks 因测试仍硬编码旧版本而失败，已在上述精确新 head 修正；旧失败结果不作为本轮通过证据。

实际 ZIP 共 131 项，全部与发布源码匹配；排除了凭据、环境文件、私钥、构建/依赖目录、证据和无关归档。Registry 安装后的全部文件摘要与该 ZIP 一致。已发布 ZIP 保留发布前的候选状态文字；本页和 GitHub README 记录发布后事实，没有覆写已发布版本。

全新消费者只通过 `moonstomp@0.2.0` registry 版本依赖安装，无 workspace/path 覆盖；依赖树确认 `source.kind=registry`、精确版本 0.2.0、非 workspace member。JS 和 Wasm GC 各通过 6/6 核心场景测试，并运行完整场景；多版本示例在两后端均与黄金输出逐字一致，包含 STOMP 1.0/1.1/1.2 三次协商与六项版本边界拒绝。

Node 适配器是 registry 包内的源码 glue，需要从已安装包运行 `moon build bridge --target js` 生成 bridge，并非预置 JS 二进制。该实际安装包的 bridge、TCP 认证、TLS 信任 CA/主机名和拒绝不可信证书、句柄、传输质量与控制超时脚本均通过。测试使用真实 localhost TCP/TLS socket 和脚本模拟 peer；**本轮没有重跑真实 broker**，不能替代 broker 互操作证据。

本轮未验 Windows、native/Wasm 消费者、生产 PKI/mTLS/代理、持久性/故障转移、长时 soak 和性能。历史 SDK/真实 broker 验证仍按各自源码与环境单独报告，不外推至本发布。
