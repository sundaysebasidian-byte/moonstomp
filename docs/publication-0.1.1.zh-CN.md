# MoonSTOMP 0.1.1 发布记录

用户已明确补充批准：把经过本地复核的 STOMP 更新公开到原 GitHub，并正式发布 Mooncakes 0.1.1。沿用 MIT，不覆盖 0.1.0、不办理人工申报或接受新条款。

0.1.1 修复自动 content-length 未计入出站 header 数，以及带 receipt 的 UNSUBSCRIBE 提前删除订阅/拒绝在途消息/允许提前复用 ID。先 red 再修实现；核心两个后端各 37 项、10 项 TCP、401/1201 差分、独立本地包消费及原 Artemis profile 已在最终版本本地及准确 CI 复验。边界见 boundaries.zh-CN.md，0.1.0 证据在 publication.zh-CN.md，不能代替本版证据。

发布顺序：最终源/版本/包清单与许可核验 → 一个真实修复提交到原仓库 → 等待准确 SHA CI 成功 → 官方 moon publish 0.1.1 → 全新 registry/cache 安装及两个后端 check/build/test/run → 正式文件摘要和下游实际解析来源一致。准确 commit、CI 链接、registry checksum 和安装证据在完成后追加到本记录；记录未完成状态时不声称已发布或已安装。

registry manifest 端点在未存在的版本路径也可能返回 HTTP 200 并回落到旧版。因此检查响应中的 module/version、metadata.version、versions 清单、实际下载内容和 checksum，不将 URL 或 200 当成正式 0.1.1 证据。

其他 broker、真实事务 ACK 支持、认证/TLS/持久化/高负载仍未测；Artemis NACK 丢弃和事务 ACK 不随 ABORT 恢复、整工程 Wasm-GC 的 JS extern 不支持继续明确。公开/发布不等于获奖，申报书务必用户本人最终人工撰写。

## 正式完成的准确证据

| 项目 | 真实结果 |
| --- | --- |
| 源码与 tag | v0.1.1 → d4a7785a97226b126e00e6a9d6117bfe4d625b59；一个真实修复提交，不改时间；v0.1.0 保留 |
| 准确修复 SHA CI | https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/36849189511 ，headSha 精确为上述 d4a7785，success |
| 正式包 | sundaysebasidian-byte/moonstomp@0.1.1；https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp ；MIT、准确 repository、versions 含 0.1.1 和 0.1.0，build_status=success |
| 上传与 registry checksum | 6477b2b376c4f959d4aa20dadef9ad91cfc7079827ea12f87d72d38998ac10c3，与实际正式 ZIP SHA256 一致 |
| 全新 registry 安装 | 正常 moon add sundaysebasidian-byte/moonstomp@0.1.1；全新 index/cache 无 path override；consumer deps 字符串和已安装 moon.mod 均精确为 0.1.1 |
| 实际消费 | JS/Wasm-GC 分别 check/build/test/run；每后端 5/5：三个业务场景 + 自动 header 预算及退订 receipt 两项公开 API 回归 |
| 来源一致 | 编译器实际解析到 consumer/.mooncakes/sundaysebasidian-byte/moonstomp；53 个安装文件与正式上传 ZIP 逐一 SHA256 一致 |

公开原始摘录及消费源码在 evidence/publication-0.1.1/；仅去除本机路径，原始日志保留在私有交付。正式包是 tag 的固定源码；随后证据文档提交不重新发布同一 0.1.1 版本。README 的普通示例有三个业务场景；本证据追加的两个补丁回归可从 consumer-main.mbt.in 复现。整个工程 Wasm-GC 仍不支持 JS bridge；上述后端证明的是核心消费。

发布只用正常官方 CLI 现成认证，服务返回 200；未读取/打印/生成 token 或扩大权限，未接受新条款。未代填或提交比赛表单/诚信承诺。
