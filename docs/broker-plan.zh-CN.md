# 本地 broker 执行与复现记录

2026-10-01，用户明确授权“可以，测试吧”。仅使用本任务临时目录，没有借用其他任务 Docker/Lima，没有改全局配置。

- 官方页：https://artemis.apache.org/components/artemis/download/
- 官方发行包：https://downloads.apache.org/artemis/artemis/2.57.0/apache-artemis-2.57.0-bin.tar.gz
- 官方 SHA512：https://downloads.apache.org/artemis/artemis/2.57.0/apache-artemis-2.57.0-bin.tar.gz.sha512
- 实测大小 48,869,723 字节；官方校验和固定摘要一致，见 scripts/broker-run.py 的 PINNED_SHA512 和运行 JSON。
- 复用本机 Temurin 17.0.20，没有新装 Java。当前 runner 只核 Java 17、macOS arm64 实跑；其他平台工具路径未验证。

scripts/broker-run.py 不下载软件。它以传入的官方 archive、checksum、java-home 创建新临时 runtime，仅 127.0.0.1:61613 STOMP acceptor，删除默认多协议 acceptor；禁用持久化、认证、Web、JMX，无集群。ANYCAST 默认路由，自动创建自造测试地址。JAVA_ARGS 为 Xms64m/Xmx256m、ActiveProcessorCount=2；线程池 4、定时池 2、消息内存预算 32 MiB。lsof 对本进程核只有一个回环监听。

三个例和五检查/一限制探针保存原始 stdout/stderr、命令退出码、socket 入站字节与出站 write intent、配置 SHA256、Java 版本及 RSS 采样。字节日志是应用层观察，不宣称 pcap 抓包。自造任务/ID/正文没有个人业务数据；测试占位账号没有用于客户端登录。

客户端 finally 关闭；broker finally SIGTERM，等待退出，必要时只 kill 自己创建的子进程。确认端口释放，删除临时 runtime，保留配置、日志、官方 LICENSE/NOTICE 和 JSON。预先端口占用时拒绝运行，不停止其他进程。源码 ZIP 不包含 broker 二进制或 SDK。

完整复验命令见 README；也可直接运行：

```sh
python3 scripts/broker-run.py --output ../broker-evidence \
  --archive /absolute/path/apache-artemis-2.57.0-bin.tar.gz \
  --sha512 /absolute/path/apache-artemis-2.57.0-bin.tar.gz.sha512 \
  --java-home /absolute/path/java17/Contents/Home
```

没有公网 broker 测试。实际 profile 与限制见 broker-interop.zh-CN.md；公开仓库、远端 CI、Mooncakes 发布及人工申报仍未完成。
