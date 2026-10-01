# 支持边界与失败行为

本版源码为 0.1.1，以公开 HEAD `6b126587a1821795e909ea561c46dcf32b160a2a` 为修复基线。用户已明确批准公开/发布本轮修复；0.1.0 历史保持原样。准确新版本 commit、CI、发布和安装状态见 publication-0.1.1.zh-CN.md。

## 协议与后端

| 范围 | 支持与限制 |
| --- | --- |
| 帧协议 | 只支持 STOMP 1.2 列明的命令；UTF-8 command/header，正文 Bytes；LF/CRLF；重复 header 保存但按首值解释，大小写敏感；不支持未知命令及 1.0/1.1 协商。 |
| codec 与会话 | encode/Decoder 检查语法；必需 header、收发方向及连接时序由 Client 验证。单独 encode 没有 Limits 容量约束，不可将它当作有界 Client。输入 chunk 及输出事件的生命周期由调用者负责。 |
| 核心后端 | JS 和 Wasm-GC 的核心及独立应用已测试；JS bridge/TCP 只支持 JS/Node。整个工程包含 JS extern bridge，不支持直接把整个工程切为 Wasm-GC 构建；Wasm-GC 证据是根核心包测试和独立依赖消费。native/LLVM/旧 Wasm、浏览器及其他 Node/SDK 版本未验证。 |
| 运输 | Node TCP 便利层不提供 TLS、WebSocket、自动重连或 CONNECT 登录参数；core Frame 可以携带凭据 header，但认证 broker 未测。broker 测试和示例只连接数字回环地址；不向公网 broker 测试。 |
| 业务语义 | destination 是不透明字符串；不检查 MIME 正文语义、不创建 broker 队列、不保证持久化、重投递、死信、顺序恢复或 exactly-once。receipt 表示协议处理反馈，不能代替业务成功或持久化证明。 |
| 真实兼容 | 仅 Artemis 2.57.0 已记录的无认证、无持久化、默认 ANYCAST profile；其他 broker、支持事务 ACK 的真实互操作、认证/TLS/持久化/高负载未测。该 broker NACK 丢弃，事务 ACK 不随 ABORT 恢复。 |

## 容量与时钟

| 层 | 默认值与预算口径 |
| --- | --- |
| Decoder | 单行 8192 字节：CR 计入、LF 不计；128 headers；1 MiB 正文；每次 feed 1024 事件，心跳也计事件。Limits 可自定义，Client 内部 Decoder 固定用默认值。 |
| Client 出站 | 每对 header 名值 UTF-8 原始字节合计最多 2047；最多 128 个最终 wire headers（0.1.1 包括自动 content-length）；正文最多 1 MiB。显式长度占已有 header 槽；无长度的非空正文只能由调用者提供最多 127 headers。 |
| 会话记录 | 默认分别 256 个订阅、事务、receipt，1024 个待确认 delivery；capacity/max_pending 可配置。退订等待 receipt 的订阅仍占一个订阅槽，相关记录不超出既有容量；未结清旧 delivery 禁止复用该订阅 ID。 |
| Node 事件等待 | 最多 1024 个排队事件、JSON 估算最多 4 MiB、256 个等待者；写缓冲最多 2 MiB。已匹配等待者的事件直接交付；无人等待的心跳不入队。没有应用层暂停/恢复背压或自动消费。 |
| 估算与内存 | 4 MiB 是事件 JSON 字节预算，**不是正文字节预算**；高 octet 值的 1 MiB 正文及元数据可能排不进队列，应预先注册消费者。单帧/事件数上限不等于总 RSS 或整批输出字节上限，UTF-8、正文复制和 JSON 会产生临时分配。调用者必须控制 feed 分块和存活结果数；未提供性能、内存峰值或 CPU 时限保证。 |
| 时钟与期限 | 非负、单调毫秒 Int64；heartbeat 双方 MAX、0 禁用，默认接收容差 100 ms。core 没有握手/业务请求 deadline，tick 由调用者调度；Node CONNECT、receipt 默认等待 5 s，tick 默认 25 ms。应用阻塞、调度延迟和 broker 重载未压力测试。 |

## 退订与失败

需要排空在途消息时，core 发送 `Frame::new("UNSUBSCRIBE", [("id", id), ("receipt", receipt_id)])`，或 Node 调用 `receipt('UNSUBSCRIBE', [['id', id]])`。0.1.1 在对应 receipt 到来前保存订阅/ACK 模式，允许线上先到的 MESSAGE；禁止重复退订、提前复用 ID；receipt 后移除订阅，但已经交付的消息仍可确认。此顺序是本库的有限策略，不宣称所有 broker 实现具有同样行为。

便利构造 `unsubscribe(id)` 不设置 receipt，立即删除本地订阅；随后遇到该 ID 的 MESSAGE 会关闭连接。对应 receipt 之后仍收到未知订阅的 MESSAGE 同样关闭。使用无 receipt 退订时，上层必须已经协调停止投递；库不猜测一个未确认退订何时在服务器完成。

| 失败 | 调用者可观察的行为 |
| --- | --- |
| Decoder 非法、超限、截断或 EOF | ProtocolError；清理持有内容并进入不可复用状态。feed 整批失败，不返回该批先前成功帧；本批随后出现错误时不能把它当作部分成功。 |
| Client receive/tick 错误 | fail/Closed；清理订阅、待退订、事务、receipt、delivery、clock 与解析内容。Client.end 无论干净 EOF 还是截断都关闭；截断另报错。 |
| Client send 参数/容量错误 | 不登记订阅、退订、事务、确认或 receipt 意图，保持原协议状态；调用者时间仍须单调。成功 send/tick 是本地意图，运输失败必须 fail，不能继续复用原连接。 |
| broker ERROR | core 返回 ServerError 后 Closed；Node 终止运输，已有 ERROR 等待者可拿到帧；无人等待的排队事件在 stop 时丢弃，不能把错误内容缓存当成诊断持久化。 |
| TCP send/解析/队列/写缓冲失败 | 关闭连接，取消 timer，拒绝等待者并清空队列。bridge 将核心异常统一为 MoonSTOMP protocol error，不提供稳定细分错误码或保留原核心详细字符串。 |
| receipt 便利入口预检失败 | 参数、重复 header、等待者满或旧队列同 ID 回执拒绝且不发帧，保留健康连接；之后进入核心/运输的错误仍关闭。 |
| waitFor 超时 | 只删除该等待者，连接仍可存活；已发送命令可能已被服务端处理，core pending receipt 仍等待到来或 fail，不能据超时直接重复业务操作。DISCONNECT 便利入口在成功/失败后都 stop。 |
| 用户 predicate | 必须是同步、快速、无副作用的匹配函数；异步 predicate 不支持。匹配已有队列时抛错会同步传出，接收路径匹配时抛错会关闭连接；没有回调隔离、重入或线程安全保证。 |

本轮新增回归分别验证：自动长度预算拒绝且不登记 receipt，127+自动/128+显式边界成功；receipt 前 MESSAGE、容量占用、重复退订/ID 复用、旧消息确认；无 receipt/receipt 后未知订阅失败；运输失败清理待退订；Node 分段实际连接在 MESSAGE+receipt 连帧中保持健康。原实现两项失败证据和修复后证据分开保存，不降低断言。

协议来源：[STOMP 1.2 规范](https://stomp.github.io/stomp-specification-1.2.html)，沿用项目既有归因。这里声明实现范围和失败策略，不是完整 STOMP 一致性认证。申报书务必用户本人最终人工撰写，AI 技术参考不能替代申报；不代填表或接受承诺。
