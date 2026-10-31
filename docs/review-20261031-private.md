# 2026-10-31 订阅与 CLI 修复

本目录源自公开 review 分支提交 `033803fa027aa5e4cc62e5f5de4a1deb252e3f9a`（树 `7688876e0a5519dfc2160308208821aa54437613`），以下修复位于源码分支，尚未包含在已发布 Mooncakes 版本中。

修复范围：
- 新订阅句柄不认领 SUBSCRIBE 请求前已排队的旧代 MESSAGE。保留旧事件供通用 `waitFor` 消费；它们继续计入队列预算，不自动清理。详见 `UNSUBSCRIBE_RETRY.md`。
- CLI 的错误诊断和 MESSAGE 展示转义 C0/C1、DEL、Unicode 行分隔符；text 模式保留普通文字，JSON 模式仍可 `JSON.parse` 还原原字段和正文，二进制正文保留 hex。
- 仅原生 `error.code === 'ECONNREFUSED'` 使用“无服务监听”建议；broker message 中出现同样字样不覆盖真实 ERROR 帧。

新增回归接入 `scripts/verify.py --transport`。TCP 脚本 peer 反例不冒充 broker 实证；提交 [3b12029](https://github.com/sundaysebasidian-byte/moonstomp/commit/3b12029b82f79da58e5392dc44e27203e34d0d5e) 的四条 CI（包含 RabbitMQ 互操作）通过；该轮未重新验证 Artemis。对应本地验收包另保留基线失败、独立复验、Classic TLS profile 与最终哈希。不是完整协议、安全、生产或长期稳定性认证。
