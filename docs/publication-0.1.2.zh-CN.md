# 0.1.2 正式发布与安装记录

2026-10-04，Mooncakes 已正式发布 `sundaysebasidian-byte/moonstomp@0.1.2`，MIT。版本包含存活状态单调时钟检查、CONNECTED/RECEIPT 内部优先等待、host 和同步 Boolean predicate 校验，以及四项解析生成回归和真正增量的外部参考比较。核心为 MoonBit；不新增 tag。

发布源码为 `61e3eca6757b86737da316474f20f2a3ec8813ca`，[准确提交 CI](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/37177429538) 成功后，仅调用一次官方 `moon publish --frozen`，退出码 0、HTTP 200。发布前后 ZIP 的 SHA-256 相同：`b8a858475528b6a10c03ba3485421c5713535500169d736294c7c392989dda07`。正式包共 61 个文件；后续回执文档提交不改变已发布的不可变版本。

[官方注册表](https://mooncakes.io/api/v0/manifest/sundaysebasidian-byte/moonstomp/0.1.2) 返回实际 version、metadata.version、latest_version 均为 0.1.2，checksum 与发布 ZIP 相同，build_status 为 success；0.1.0/0.1.1 历史版本保留。不能仅凭 HTTP 200 判断版本存在：发布前此路径实际回退到 0.1.1。

正式安装命令为 `moon add sundaysebasidian-byte/moonstomp@0.1.2`。已从全新隔离索引和缓存安装，没有 path 覆盖或预置依赖。实际依赖 manifest 为 0.1.2，来自消费者 `.mooncakes` 目录；61 个文件摘要逐一与正式 ZIP 一致。JS、Wasm-GC 各完成 check/build/test/run，测试各 6/6：三个业务场景和三个边界回归。在正式安装包的可写副本中构建 JS bridge 后，桥接测试及 Node 适配器四项回环边界测试通过。消费例的服务端帧为明确离线 fixture，不计为真实 broker。

机器回执见 `evidence/publication-0.1.2/` 中的 publish-receipt.json、registry-manifest.json、registry-consumption.json、release-ci.json。原始日志和完整来源绑定保存在交付 ZIP，公共摘要省略本地文件系统路径。README、验收矩阵已同步当前版本事实。

原 Artemis 2.57.0 三例/五检查及事务 ACK 限制保留原日期与提交；本次不重跑。其他 broker、真实事务 ACK 回滚支持、认证/TLS/持久化/高负载仍未测。没有生成新凭据、接受新声明或提交比赛报名；申报书由用户本人最终撰写。
