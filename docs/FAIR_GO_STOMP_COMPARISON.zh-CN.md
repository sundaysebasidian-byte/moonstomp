# 固定源码下的公平功能对照（2026-10-25）

本轮只读取得上游github.com/go-stomp/stomp固定commit c155a2d699bb5bc1b2547a4382b3cdd7f4403648，核README、conn.go、conn_options.go与Apache-2.0 LICENSE.txt。依赖源码留于私有证据，不拷进MoonBit实现。不是与Go客户端的性能比赛或全面安全审计。

| 维度 | go-stomp固定源码 | MoonSTOMP 0.2.0与证据身份 |
|---|---|---|
| 协议版本 | README声明1.0/1.1/1.2 | 三版本离线黄金、真实Classic TLS三版本；当前公开Draft真实CI已通过 |
| I/O | Dial/Connect；Connect接受io.ReadWriteCloser | sans-I/O MoonBit核心，Node TCP/TLS适配器；不声称功能等价 |
| TLS | 调用者可提供tls.Conn给Connect；不能说“不能TLS” | 适配器提供tlsOptions，校验证书与hostname；生产PKI/mTLS未验 |
| 凭据/ACK/NACK/事务/receipt | ConnOpt.Login、Ack/Nack、事务和receipt接口 | 核心和Node接口；事务ACK回滚/NACK重投递完整语义仍未验 |
| 心跳 | 独立读写超时与grace选项（conn.go/conn_options.go） | 核心单调时钟/预算；本轮新增真实TLS心跳timeout本地fixture；1.0没有心跳协商 |
| 重连/重放 | 不以缺少自动重连贬低上游 | MoonSTOMP不自动重放，receipt失败outcomeUnknown要求业务幂等/对账 |
| 资源范围 | Go读写缓冲选项，不与MoonBit算法预算直接等价 | 核心帧/缓存/事件界限+适配器等待期限；节点或work不是RSS |
| 互操作证据 | 作为真实对端的既有Go↔Artemis↔MoonBit三版本双向记录 | 保留2026-10-18原环境/日期，不冒充本轮Classic+Go新测试 |

上游固定来源：https://github.com/go-stomp/stomp/tree/c155a2d699bb5bc1b2547a4382b3cdd7f4403648 。既有本项目glue见tests/interop/go-peer/main.go；构建器要求干净固定checkout，不用自造peer替代成熟客户端。当前没有重新跑该Go互操作矩阵，也没有跨实现吞吐/延迟比较。采用者、长稳、Windows、故障转移和生产安全均无此证明。
