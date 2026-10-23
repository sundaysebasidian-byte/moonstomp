# 2026-10-22 Linux 测试审计

结论：本轮 JS 与隔离真实 broker 检查通过，未发现产品源码缺陷；**全后端和正式打包验收未完成，不能保证没有 bug**。不把环境控制实验失败算成项目通过，也不把脚本 peer 算成真实 broker。

审计沿用现有私有候选，没有新建产品工程。入口是 GitHub `review/moonbit-20261015-sync`，提交 `62694580a9c58aec9eb2199e2e1f9685b5e30781`；开始与收尾只读核查远端均为该 SHA。进入时 208 个源码文件逐字节等于 Library v3 包，原 19 项私有改动全部保留。没有项目并发进程，没有覆盖他人提交，没有公开 push、PR、合并、发包、部署或报名。

环境为 Linux 6.18.55 x86_64 / glibc 2.41、Node 24.19.0、Python 3.12.14、现有 OpenJDK 21。使用原隔离 SDK：官方 Wasm 编译器 `0.10.16+b1a0e846e`，`moon`/`moonrun` 从官方源码 `6691f1825d7b8f3b9a43334f27ce5daf9d51f861` 构建（0.1.20261020）。这不是历史锁定 SDK，原 SDK 未被替换，本轮没有安装新工具。

交付包中 `evidence/linux-audit-20261022/environment-input.json` 固定环境、工具哈希、初始源码/包一致性、分支和生成器种子；`audit-results.json` 保留每一条原始命令、工作目录、UTC 时间、退出码、运行秒数、超时上限、预期和原始日志。主批次 15:44:30–15:46:16 UTC，38 个阶段，106.341 秒；另有源码消费者 11 个阶段和心跳补验 2 个阶段。**阶段数不是测试用例数**。分类结论为 `LINUX-RESULTS.json`，保留原始非零退出码。

## 实际通过的范围

| 命令或入口 | 实际结果 | 证据范围 |
|---|---|---|
| `moon check --target js -j 1`、`moon build --target js -j 1`，先执行 `moon clean` | 各退出 0 | 从本轮源码生成 JS bridge |
| `moon test --target js --package sundaysebasidian-byte/moonstomp -j 1` | 70/70，退出 0 | 单元、黑盒、白盒、边界与生成式测试 |
| `moon run examples/offline --target js -j 1` | 退出 0 | 离线公共 API 示例 |
| `python3 -m unittest discover -s scripts -p 'test_*.py'` | 16 项，退出 0 | 兼容性、profile/监听/演示证据守卫、后端选择 |
| `python3 scripts/broker-runner-test.py` 及 `python3 -O scripts/broker-runner-test.py` | 各 10 项通过 | runner 负面守卫，优化模式仍生效 |
| `node --test scripts/adapter-unit-test.cjs`、`node --test scripts/showcase-framing-test.cjs` | 16 项 / 4 项，退出 0 | 协议/socket 替身故障测试；中继二进制分帧 |
| `node scripts/bridge-test.cjs`、`transport-test.cjs`、`transport-quality-test.cjs`、`auth-transport-test.cjs`、`tls-transport-test.cjs`、`handles-test.cjs`、`transport-timeout-test.cjs` | 均退出 0 | 真实生成 bridge；脚本回环 TCP 生命周期 10 项、质量 4 项、认证 21 项、TLS 信任/主机名、三版本句柄、SEND/DISCONNECT 默认 5000ms 超时 6 项 |
| `node scripts/differential.cjs` | 退出 0 | 对固定 stompjs 7.2.0：401 个有效样本 / 1201 次分块；64 个增量客户端样本 / 256 次分块；严格性差异逐项保留 |
| `node scripts/cli-tls-test.cjs`、`python3 scripts/usability-test.py`、`python3 scripts/versions-example-test.py --targets js` | 均退出 0 | CLI 成功/非法参数/错误凭据脱敏；七 demo 与 golden、变异自检；JS 版本示例 |
| `source-consumer.py`（证据目录内） | 11 阶段退出 0，独立消费者 6/6 | 私有源码 ZIP 解压后，两模块 workspace 的 check/build/test/run、媒体任务/传感器/账本 API 场景、解压候选自行生成 bridge 与适配器测试 |

脚本名在上表简写处均位于 `scripts/`。分帧覆盖每个切点与确定性分块、CRLF、NUL/非 UTF-8 二进制 body、重复头、content-length 的 0/负数/带符号/溢出/错长度/终止符、1MiB 上界、EOF、非法转义和资源释放。心跳核心覆盖 1.1/1.2 协商、空 chunk 不刷新 liveness、部分帧刷新，以及虚拟时钟超时。实际执行都归属于这次 JS 的 70 项；不重复把内部生成样本数当成额外单元测试数。

生成器种子见环境 JSON：差分种子 `0x12345678`，更新式 `(imul(seed,1664525)+1013904223) >>> 0`；二进制属性 `run=0..63`、`trial=1..8`、初值 `(run+1)*trial`，后续 `(seed*17+31)%997`；头部属性 `run=0..511`。broker queue 的进程/时间/UUID 只用于隔离关联，不是覆盖种子。`PYTHONHASHSEED=0`。

## 真实 broker、丢失与清理

沿用 Apache 官方 ActiveMQ Classic 6.3.2 完整归档，重新核验官方 SHA512：

```
30df66a98916fd448db6f29d591b24dd75584f58bafbe059377df923a65190a9dabfa036503bd35bc1469546360704e6942c5f922322e2b89e261bd45cad128a
```

只启动任务目录中的临时 profile，合成测试身份、无持久化/JMX/web，逐次 `lsof` 断言唯一监听为 `127.0.0.1`。真实命令：

```sh
python3 scripts/classic-run.py --home "$CLASSIC_HOME" --java-home "$JAVA_HOME" --output "$AUDIT_OUT/broker-tcp" --port 62614
python3 scripts/classic-run.py --home "$CLASSIC_HOME" --java-home "$JAVA_HOME" --output "$AUDIT_OUT/broker-tls" --port 62615 --tls
python3 scripts/classic-run.py --home "$CLASSIC_HOME" --java-home "$JAVA_HOME" --output "$AUDIT_OUT/receipt-loss-demo" --port 62616 --tls --demo
```

三个命令退出 0，分别 3872/5177/3772ms。TCP/TLS 都验证 1.0、1.1、1.2：认证、5 字节二进制、订阅作用域、版本化 ACK，BEGIN 后未 COMMIT 不可见、COMMIT 送达、ABORT 后有限窗口未送达，连接中断后未提交事务不可见、不重放、旧句柄拒绝操作；UNSUBSCRIBE/DISCONNECT 的 receipt。匿名和错口令拒绝；TLS 错 CA/主机名在 CONNECT 之前拒绝。

三分钟演示实际经过双腿验证 TLS 的回环中继，**在发送端 decoder 之前移除一条真实 broker RECEIPT**：观察方收到订单，发送方报告 `STOMP_RECEIPT_TIMEOUT` / `outcomeUnknown=true` 并关闭。中继统计连接 1、SEND 1、丢 receipt 1，后续调用被拒绝，没有自动重发。故障注入 `NODE_OPTIONS=--require=.../force-key-failure.cjs`、`force-relay-failure.cjs` 两次按预期退出 1（2885/2804ms）；这是负面测试通过，原始演示 JSON 的 `FAILED` 保留。注入脚本副本和原始日志一并交付。

补验 `python3 heartbeat-run.py`（证据目录内）：复用仓库 profile/监听守卫，62617 端口的真实认证 TCP broker，1.2 `100,100` 心跳。先观察双向各 2 个心跳，再由回环中继丢弃后续 broker 流量（实际丢 2 字节），客户端 `MoonSTOMPProtocolError` / `STOMP_INVALID` / `heartbeat timeout`，关闭且清空 timer/waiter；连接 1、中继 socket 0。未发送业务 SEND，此项不主张业务投递结果。

六个 profile 最终均确认对应 PID 不存在、端口不可连接、临时私钥删除或未创建；broker 的 SIGTERM 退出 143 是 runner 的预期清理。公开/子演示输出扫描合成身份与注入的敏感标记均未命中。**私有 profile 和调试记录仍含合成测试配置；结构化错误的完整 frame/cause 不能当作已脱敏日志随意输出。** 没有真实用户凭据。详情在 `cleanup-postcheck.json` 与最终分类 JSON。

## 失败、阻塞与未覆盖

| 动作 | 实际退出 | 结论 |
|---|---|---|
| 独立 `1==1` 控制模块，`moon test --target wasm-gc -j 1` | 2，0/1 | `StringBuilder` 分配 `requested new array is too large`，断言前失败；未再跑项目矩阵 |
| 同模块 `--target wasm` | 2，0/1 | `StringBuilder` 初始化调用链 `RuntimeError: unreachable`；std bundle 退出 0 不代表测试通过 |
| 同模块 `--target native` | 255 | SDK 缺 `lib/runtime` / `lib/runtime.c`；std bundle 退出 0 不代表 native 可运行 |
| `scripts/downstream.py --workspace-dependencies --targets js --transport ...` 内的 `moon package --frozen` | moon 101，包装脚本 1 | SDK 缺外部 `mooncake`，没有生成正式包，也没有消费正式包。独立源码 ZIP 测试是另一项证据 |

控制模块不引用 MoonSTOMP，因此当前证据不能把这些失败归因于项目源码，也不能确定是编译器、runner 或版本组合的哪一项缺陷。没有无变化重复失败矩阵，没有重试先前被拒绝的 SDK 下载地址。官方 `moon` 源码中 `mooncake` crate 只有 library；一次有界官方 GitHub 检索没有取得可用组件（同名仓库 404），没有用替身伪造打包成功。完整 `verify.py` 没有本次成功回执；历史失败仍保留。

本轮没有重新验证 Artemis/go-stomp/真实 broker CLI（之前证据保留）；没有真实 broker 事务 ACK 回滚、NACK 重投递语义验收；没有 mTLS、代理、生产 PKI/网络、持久性、故障转移、长时间 soak、性能基准。有限的 100/150/250ms 未收到观察不等价于无限期保证。

## 本次改动与复现前提

只对 `scripts/downstream.py` 增加显式 `--targets` 选择并记录到报告，默认仍是 JS+Wasm GC；新增 3 项选择守卫测试，保留上次适配器候选。产品代码未改。当前 SDK 生成的 `pkg.generated.mbti` 仅 `Int` → `Int32` 元数据漂移已记录 diff 并恢复，避免把生成器差异混入补丁。

需要已有官方 SDK、JDK、校验后的 Classic 目录及 Node。将 SDK 的 `bin` 加入 PATH 并设定 `MOON_HOME`；`CLASSIC_HOME` 指向完整 Classic 目录，`JAVA_HOME` 指向现有 JDK，`AUDIT_OUT` 为源码树外的新目录。不会下载或启动系统服务。证据中的 `audit.py`、`source-consumer.py`、`heartbeat-run.py` 固定了本次工作区路径；在其他机器复现前应调整文件开头路径和相应绝对 fixture 引用，不可直接声称通用安装成功。每个输出目录必须不存在，避免覆盖回执。

交付包含完整源码、相对于基线的私有 patch、逐文件哈希与原始/分类结果；完整源码无需重复应用 patch。重建只在干净的同 SHA 副本中 `git apply --check` 后再应用。没有提交或推送本轮变化，SHA 表示基线，补丁 SHA256 固定私有候选。
