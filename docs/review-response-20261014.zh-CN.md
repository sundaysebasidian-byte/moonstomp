# 初审整改技术记录（未验证草案）

基线 master `d2e84f8b678c7bab9062df776b3a834b45d2736d`，正式版本仍为 0.1.2。本轮在 `review/multiversion-20261014` 接续原仓库，未 push、运行 Actions、发布或重申。本文为 AI 辅助技术底稿；不是申请人最终申报书。

## 差距与证据对应

| 初审问题 | 原有事实 | 当前整改 | 状态/门槛 |
|---|---|---|---|
| 已实现和拟实现混杂 | 0.1.2 为 1.2 客户端；已有 Artemis/Linux、差分和注册表证据 | 明确“正式发行 / 当前未验证草案 / 后续待办” | 本文与环境报告，不移用旧成功证明新源码 |
| 范围仅 1.2 | 已有 ACK、事务、心跳、receipt fence、资源限制 | Version V10/V11/V12；Client 协商、版本化 codec/ACK/订阅 | 源码与 16 项针对测试已写，SDK 缺失未编译/执行 |
| 参考 go-stomp | 原先差分参考 stompjs，不能声称已与 go-stomp 互操作 | 读取真实 go-stomp public API 与版本策略，列对比 | go-stomp→broker→MoonSTOMP 及反向真实通信尚未执行 |
| 互操作依据 | 历史 Artemis 2.57.0 1.2 成功，但事务 ACK 不能回滚 | 复用 broker-run.py、原 examples/extended tests；lsof 改为 PATH 查询适配 Linux | 新版本、旧 1.2 全量回归、Artemis/go-stomp 新结果均未产生 |

## 规范及实现位置

- [1.0 官方规范](https://stomp.github.io/stomp-specification-1.0.html)：CONNECT 无现代协商必需头；无 heartbeat/NACK/client-individual；ACK `message-id`；SUBSCRIBE id 可选；UNSUBSCRIBE destination 或 id。
- [1.1 官方规范](https://stomp.github.io/stomp-specification-1.1.html)：ACK/NACK `message-id+subscription`；转义 `\\`、`\n`、`\c`，`\r` 为 undefined；LF 帧换行，literal CR 是 header 数据而不是 EOL；现代订阅 id 与心跳。
- [1.2 官方规范](https://stomp.github.io/stomp-specification-1.2.html)：ACK/NACK `id` 取自 MESSAGE ack；加入 CRLF EOL 与 `\r` 转义。

`version.mbt` 存版本类型/解析；`headers.mbt` 增 `encode_versioned`；`Decoder::new(version=...)` 可显式解析独立帧。Client 的 decoder 只在 handshake 中启用自动协商，在 CONNECTED header结束处选定版本，发生在读同一 chunk 的下一字节之前；不会先整块按旧版本解析再改变 Client 状态。缺省 CONNECTED version 仅当提供 1.0 时可接受。保留原 connect/encode/acknowledge 的 1.2 语义及 Connected 事件 JSON。

新增 `connect_versions`、`subscribe_versioned`、`unsubscribe_destination`、`acknowledge_message`、`Client::version`。Node TCP connect 新增 versions 选项，原缺省仍为 1.2；bridge 另加版本查询，保留旧事件形状。

1.0 内部订阅键分别用 id/destination 前缀；包含 id-less 的同 destination 重叠两种加入顺序均拒绝，避免无 subscription 的合法 MESSAGE 无法归属。多个显式 id 的重叠若 broker 不给 subscription 也会明确拒绝歧义。此为有界客户端策略，须与实际 broker 观察对应，不宣称所有 broker profile 均支持。

## go-stomp 对比（不是互操作结果）

| 能力 | go-stomp 当前只读源码 | MoonSTOMP |
|---|---|---|
| 1.0/1.1/1.2 | `ConnOpt.AcceptVersion` 与 `Conn.Version`；默认提供三版 | 正式0.1.2仅1.2；本草案增加三版，未运行验证 |
| ACK/NACK、事务、receipt、heartbeat | 已有成熟客户端接口 | 原1.2已有；草案版本化，不承诺 broker 的事务ACK语义 |
| TCP 接入 | Go io.ReadWriteCloser/Dial/Connect | MoonBit sans-I/O + Node TCP glue |
| TLS、WebSocket、重连 | 取决于连接/调用者能力，勿笼统挪用 | 不扩张本轮范围，不宣称新增支持 |
| 严格有界解析 | 参考实现具有不同宽容行为 | 原有 fatal decoder 与资源限额；新版本需针对回归 |

参考提交、文件 SHA256 和环境阻塞见 `evidence/review-20261014/environment.json`；go-stomp 为测试设计参考，不引入或复制其实现代码。

## 验证与剩余工作

16 项测试覆盖缺省兼容、旧版literal header、转义、CRLF、CONNECTED与MESSAGE同块的所有两段分界、旧版header中部/尾部literal CR保真、poisoning、协商拒绝、1.0 ACK/id-less/id退订、receipt fence、1.1 ACK匹配/事务及两项独立审查负控制。测试数量表示已写用例数，**通过数为未知**。

当前没有 moon/moonc；官方 SDK 安装脚本 HTTPS GET 返回 403，未取得脚本，未执行安装，未用其他来源绕过。Node/Python 与历史锁定版本也不同。全量适用测试、`moon info/fmt`、公开 API 下游消费及真正 broker 互操作须在已有可信 SDK 可用后执行。不能手改 generated mbti 冒充 `moon info` 生成。

现有 broker runner 继续要求原官方固定 archive SHA512及 Java17。需在隔离回环 broker 启动后分别强制1.0/1.1/1.2，并让 Go 真实客户端与 MoonBit 客户端双向生产消费；核二进制 body、用户 header、实际协商版、正确 ACK、receipt 和 unsubscribe。保留原3例+5扩展及事务ACK限制。直接连接两个客户端、只跑Go或只解析Go输出均不满足互操作验收。
