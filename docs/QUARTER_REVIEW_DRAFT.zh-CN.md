# MoonSTOMP：复审材料草稿（2026-10-25）

供用户审阅改写，未发送、未提交。原评语关心实现/计划混淆、范围偏窄、成熟实现对照、互操作与完整版本。本稿按当前发布事实、历史证据、本地新增和待做四种身份说明，不以季度奖目标替代证据。

## 已完成并可安装

0.2.0已在Mooncakes发布，含STOMP1.0/1.1/1.2。核心按字节增量处理帧、二进制正文、状态、ACK、事务、receipt与心跳；Node适配器负责TCP/TLS。不存在“支持1.0也支持心跳/NACK”的承诺：规范不允许的版本组合明确拒绝。迁移时三个状态类型由方法暴露行为，不能继续访问旧公开字段。

公开Draft #8基线f752183d9f7968f2dca75057fe22cd14f83e1622的真实Classic6.3.2 TLS CI已通过，包括认证负控制、三版本收发、receipt未知不重发和清理。这是隔离真实broker，不是demo peer。其receipt-loss案例约3.9秒，是三分钟内可讲解的功能演示，**不是三分钟负载**，更不是长稳或性能结果。

## 本轮补强

新scripts/classic-heartbeat-test.cjs复用Classic runner与frameStream，通过TLS中继观察真实双向心跳后选择丢弃broker心跳，验证timeout、fail-closed、无重连、socket/timer/waiter与私钥/端口清理。心跳观察基于协议帧边界，不依赖TLS chunk边界，避免把header换行误计为心跳。没有业务SEND，不主张投递结果。新fixture的SHA256随本轮回执保存，不能说已恢复缺失历史文件。使用--tls --heartbeat复现，不能与--demo组合。

成熟实现的固定源码公平对照见FAIR_GO_STOMP_COMPARISON.zh-CN.md。Go接受调用者自备tls.Conn，不能用“没有内建TLS选项”暗示不支持TLS。既有Go/Artemis双向三版本互操作有原日期记录，本轮不重写为Classic+Go新实测。

## 尚未完成

已完成本地修复候选的五分钟限定低速场景；未跑长时间稳定性、生产PKI/mTLS、故障转移、长稳、事务ACK回滚/NACK重投递完整语义；未取得独立第三方代码review、真实采用或评委复审结论。本轮新增代码未推送，无新远端CI，不借旧绿徽章背书。原始评语对应能力已有证据，但是否完全消除顾虑须由评委重新判断；不承诺初审或季度奖。

### 上一轮本地回执（1634eeb修复前fixture，保留历史身份）

新fixture SHA256 `ec1e3e5c0495a2d6de70549a36d538330ccec1bb858241d80d1983dde3cc2a18`。本次观察客户端心跳3次、broker心跳4次，丢弃broker心跳2字节后超时关闭；连接1、无重连、中继socket0、业务SEND0，port_closed和private_key_removed均true。该场景约1958ms，绝非负载时长。既有receipt-loss demo回归亦通过。旧历史fixture仍未恢复，新fixture有自己的源码与回执身份。

## 后续独立AI复审与测量

独立AI复审已开展，不能称外部人类审查通过。五分钟首跑暴露固定100ms心跳容差误判，已做本地Client策略修复并回归；完整300秒重跑已通过，限定数据和首轮失败见FIVE_MINUTE_VALIDATION.zh-CN.md。修复未包含于已发布0.2.0或公开PR旧head，不能扩大registry发布包的能力证明。
