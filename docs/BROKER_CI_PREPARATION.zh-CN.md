# 手动真实 broker CI 准备（Draft）（2026-10-24）

基线 `69623eebcb10451168d7d19f66e0c0a704ce911a`；版本保持 0.2.0。配置未推送、未 dispatch、未远端执行，不是新 CI 绿证据；本轮无五分钟负载或新负载工程。

broker-integration.yml 只有 workflow_dispatch，无 push/pull_request/schedule；单 job、不并发取消、10 分钟上限。锁 Ubuntu 24.04（标准托管镜像标签，不声称不可变镜像摘要）、Temurin 17.0.20+8、Node 24.18.0、Python 3.14.6、官方 SDK 0.10.14+7d59c7ec9、Classic 6.3.2。编译 -j1、Java active processors=1，顺序复用 classic-run.py --tls 和 --tls --demo；保留原入口默认 processors=2 的历史行为。

完整归档： https://archive.apache.org/dist/activemq/6.3.2/apache-activemq-6.3.2-bin.tar.gz

官方校验清单：同 URL 加 `.sha512`；2026-10-24 只读取得并将完整值固定于 scripts/classic-release.sha512。SHA512 为：

```
30df66a98916fd448db6f29d591b24dd75584f58bafbe059377df923a65190a9dabfa036503bd35bc1469546360704e6942c5f922322e2b89e261bd45cad128a
```

必须先对完整压缩包 sha512sum --check 成功再解压；既有 runner 的 JAR manifest 版本核对和 JAR SHA256 **不是完整发行包校验**。本机未找到可复用完整 Classic 缓存，不为本准备工作下载 broker。Java/SDK 在未来 workflow 中由官方已有安装入口取得，本轮未安装。请求失败即失败，不重试或改镜像。

export_classic_evidence.py 仅导出固定断言字段，要求 TLS 三版本、认证负控制、demo receipt-loss 的 outcomeUnknown/no automatic replay、port_closed 与临时私钥删除；always 上传 summary.json，retention=1 天。profile、broker stdout/stderr、raw frame、私钥和任意错误 cause 均不上传。失败/缺失用失败摘要保留，不能把无回执写成通过。

真实 heartbeat fixture 未在本轮可见缓存/仓库找到原文件与 hash。沿用 docs/linux-audit-20261022.zh-CN.md 与 integration-master636-20261023.zh-CN.md 的**历史本地证据**；不把 receipt-loss demo（关闭心跳）或模拟 peer 充作真实 heartbeat 新实测。

## 费用条件

2026-10-24 只读 API 核仓库 public。GitHub 官方 [billing](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions) 与 [runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) 表示公开仓库标准 GitHub-hosted runner 分钟免费；larger runner 始终收费，artifact/cache 存储有独立额度。本配置用标准 ubuntu-24.04，不创建服务或增设账单；**未读取账户剩余存储额度，不保证任何未来运行总费用为零**。公开与首次 dispatch 前仍需用户许可并核其费用条件，不能据此自动开费。

## 本轮本地结果

两份YAML解析成功，dispatch-only/Ubuntu/10分钟约束静态校验通过；Python编译通过。既有profile守卫9/9、新白名单导出离线守卫3/3通过（均为合成数据单测，不是真实broker）。完整SHA512清单与本轮官方163字节响应逐字一致。已核本机Temurin17.0.20+8，但没有运行Classic或新增下载；CI固定该版本的可安装性仍须实际获准dispatch验证。

未运行项：真实TLS三版本、真实认证负控制、真实receipt-loss demo、真实port_closed/私钥清除回执、历史heartbeat原fixture/hash、五分钟负载、远端CI。这里的预期断言和配置不冒充以上实测。静态/单测通过不能证明broker集成CI已绿。

## Draft PR 费用约束

公开仓库使用标准 GitHub-hosted runner。本分支禁用 artifact 上传且不增加缓存写入，结果保留于普通日志/job summary；它们不计入 artifact 存储额度。未扩大账户权限或新增费用承诺。配置中的禁用上传步骤不是已上传证据。
