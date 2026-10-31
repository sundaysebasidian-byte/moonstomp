# 源码复现与版本边界

本目录基于 `0e60fe353127260da105e82ccd683bfda535b27c`，不是新的 Mooncakes 发布版本。使用review/moonbit-20261030分支源码（非默认分支），配置 `review-toolchain.lock.json` 所列项目隔离工具链，不改全局 SDK。无需安装 npm 包。

```sh
moon test --target native
moon test --target js
moon test --target wasm
moon test --target wasm-gc
moon check --target native --deny-warn
moon build --target js bridge
node scripts/handles-test.cjs
```

历史本地验证的公开摘要见 `review-evidence/public-validation-summary.json`：四后端各79/79、严格检查、三版本句柄及修前失败阶段分别列明，并绑定源日志和关键源码SHA。原始日志/本机路径留在私人验收包，不作为公开文件。

真实 broker 需已有官方 Classic6.3.2发行包（SHA512必须匹配 `scripts/classic-release.sha512`）及JDK21；不从其他版本结果外推。

```sh
python scripts/classic-run.py --home /path/to/verified-activemq-6.3.2 --java-home /path/to/jdk21 --output /path/to/new-empty-output --port 62614 --processors 1 --tls --review-ack-matrix
```

仅用空闲本地回环端口；脚本生成短期测试证书、启动非持久化隔离broker，结束清理。`review-evidence/public-classic-summary.json` 为已发生本地真实运行的白名单摘要（不是本分支新commit的CI回执）：三版本互通及新增14个场景通过，端口关闭、测试私钥移除。`review_ack_matrix` 与旧 `interop` 独立列出：旧字段“transactional ACK rollback not claimed”属于旧脚本范围，新字段才是本轮ACK验证，不能混用。

新增14项包括8项事务ACK、4项只ACK第二条的累计/单条区别、2项多订阅取消隔离。ACK终态通过独立重新连接消费者和正向marker验证，另有150ms观察窗口。没有长期稳定性、持久化、完整NACK死信/重投策略或跨broker认证；Artemis/RabbitMQ历史回执仍绑定原提交。

本分支锁、CI引导及公开文案调整须在实际新commit上复验；旧本地证据不代表本分支CI。
