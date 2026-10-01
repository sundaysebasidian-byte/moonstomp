# 真实 broker 互操作缺口（待批准）

当前没有运行真实 broker；不安装新软件，不借用其他任务的 Docker/Lima 授权。源码中的 Node 回环 peer 只是运输生命周期 fixture，stompjs 是独立 codec 参考，两者均不能替代 broker 验证。

可审阅的候选方案：Apache Artemis 2.57.0（官方页标 2026-09-09，Java 17+）。

- 官方页：https://artemis.apache.org/components/artemis/download/
- 官方发行包：https://downloads.apache.org/artemis/artemis/2.57.0/apache-artemis-2.57.0-bin.tar.gz
- 官方 SHA512：https://downloads.apache.org/artemis/artemis/2.57.0/apache-artemis-2.57.0-bin.tar.gz.sha512
- 2026-09-30 HEAD 实测大小 48,869,723 字节（约 46.6 MiB）；这只是下载信息，当时没有下载或安装 broker。

获明确批准后才执行：验证官方校验值，解压到本任务临时目录；创建无持久化、无用户凭据的测试实例；关闭 Web/Jolokia/集群及不需要的 acceptor，仅 STOMP 绑定数值地址 `127.0.0.1:61613`。Java `-Xms64m -Xmx256m`，预计 RSS 预算约 512 MiB（不是实测保证）。先审查配置中的所有监听地址，再启动。三例按顺序运行，记录 broker 版本、配置 SHA256、原始帧/退出码和每个断言结果。

退出与清理：SIGTERM 对应实例 PID，等待结束，确认监听端口关闭；只删除本任务创建的实例与临时文件。失败时保留日志，不向公网 broker 发测试，不修改全局环境。

当前尚未验证 Artemis 具体 CLI 创建参数、配置与 broker 语义。执行时要以该发行版官方文档核对；不能将本方案文字当作已完成或已验证安装。
