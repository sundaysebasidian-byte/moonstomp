# 2026-10-31 修复与发布前验收记录

本目录源自公开 review 分支提交 `033803fa027aa5e4cc62e5f5de4a1deb252e3f9a`（树 `7688876e0a5519dfc2160308208821aa54437613`），下述验收在推送前的隔离本地候选进行；此记录随修复更新到 review 分支，不是 master、Mooncakes 或比赛提交。

修复范围：
- 新订阅句柄不认领 SUBSCRIBE 请求前已排队的旧代 MESSAGE。保留旧事件供通用 `waitFor` 消费；它们继续计入队列预算，不自动清理。详见 `UNSUBSCRIBE_RETRY.md`。
- CLI 的错误诊断和 MESSAGE 展示转义 C0/C1、DEL、Unicode 行分隔符；text 模式保留普通文字，JSON 模式仍可 `JSON.parse` 还原原字段和正文，二进制正文保留 hex。
- 仅原生 `error.code === 'ECONNREFUSED'` 使用“无服务监听”建议；broker message 中出现同样字样不覆盖真实 ERROR 帧。

新增回归接入 `scripts/verify.py --transport`。TCP 脚本 peer 反例不冒充 broker 实证；本地验收时尚无该候选的远端 CI，也没有新 RabbitMQ/Artemis 验证；推送后的 CI 结果应另查对应提交，不由本记录预先保证。对应本地验收包另保留基线失败、独立复验、Classic TLS profile 与最终哈希。不是完整协议、安全、生产或长期稳定性认证。
