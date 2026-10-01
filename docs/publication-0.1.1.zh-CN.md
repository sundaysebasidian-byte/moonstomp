# MoonSTOMP 0.1.1 发布记录

用户已明确补充批准：把经过本地复核的 STOMP 更新公开到原 GitHub，并正式发布 Mooncakes 0.1.1。沿用 MIT，不覆盖 0.1.0、不办理人工申报或接受新条款。

0.1.1 修复自动 content-length 未计入出站 header 数，以及带 receipt 的 UNSUBSCRIBE 提前删除订阅/拒绝在途消息/允许提前复用 ID。先 red 再修实现；核心两个后端各 37 项、10 项 TCP、401/1201 差分、独立本地包消费及原 Artemis profile 将在最终版本复验。边界见 boundaries.zh-CN.md，0.1.0 证据在 publication.zh-CN.md，不能代替本版证据。

发布顺序：最终源/版本/包清单与许可核验 → 一个真实修复提交到原仓库 → 等待准确 SHA CI 成功 → 官方 moon publish 0.1.1 → 全新 registry/cache 安装及两个后端 check/build/test/run → 正式文件摘要和下游实际解析来源一致。准确 commit、CI 链接、registry checksum 和安装证据在完成后追加到本记录；记录未完成状态时不声称已发布或已安装。

registry manifest 端点在未存在的版本路径也可能返回 HTTP 200 并回落到旧版。因此检查响应中的 module/version、metadata.version、versions 清单、实际下载内容和 checksum，不将 URL 或 200 当成正式 0.1.1 证据。

其他 broker、真实事务 ACK 支持、认证/TLS/持久化/高负载仍未测；Artemis NACK 丢弃和事务 ACK 不随 ABORT 恢复、整工程 Wasm-GC 的 JS extern 不支持继续明确。公开/发布不等于获奖，申报书务必用户本人最终人工撰写。
