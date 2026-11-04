# 源码复现与版本边界

当前 `moon.mod` 为 **0.4.0 发行候选**，相关运行时代码已纳入默认分支；不是已核实发布的 Mooncakes 0.4.0 包。请按当前检出版本的 `toolchain.lock.json` 使用已有、项目隔离的精确工具链，不改全局 SDK，无需安装 npm 包。首次 2026-10-30 复核基线 `0e60fe353127260da105e82ccd683bfda535b27c` 及当时的 `review/moonbit-20261030` 分支信息仅保留为历史来源，不能作为当前源码身份。

完整本地验收入口如下；输出须在源码外且使用新的目录。`--transport` 启动脚本化本机回环测试对端，不是真实 broker，也不会发布软件包。

```sh
python3 scripts/verify.py --output ../moonstomp-verification --transport
```

`verification.json` 记录实际命令、退出状态、耗时及原始 stdout/stderr 路径。阶段超时会保留已捕获日志、标记 `timed_out: true`；未取得退出码时为 `null`，不记作成功。命令启动失败同样保留失败阶段；日志落盘失败不能记作通过。POSIX 环境下每个验收命令使用独立进程组；超时只终止该组及继承该组的后代，即使组长已退出，也不会仅结束组长后留下测试对端。清理等待上限另为 5 秒，结果记入 `timeout_cleanup`。主动脱离该组的后台进程不在该保证内；非 POSIX 平台只终止直接子进程。Python 异常（含 `KeyboardInterrupt`）也会尝试清理本组，但外部 `SIGTERM` / `SIGKILL` 直接终止验收器不在自动清理保证内。本机制不证明真实 broker 互通或远端 CI。

也可单独运行以下检查（不等价于完整验收）：

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

当前候选的源码锁、CI 引导及公开文案调整须在实际新 commit 上复验；旧本地证据不代表新提交的 CI。
