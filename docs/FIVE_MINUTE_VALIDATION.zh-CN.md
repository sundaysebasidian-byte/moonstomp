# 实际五分钟有界验证（未发布本地修复候选）

2026-10-25，现有Mac arm64、16GiB/10逻辑核、既有官方SDK/moonc v0.10.14+7d59c7ec9、Node24.18.0、Temurin17.0.20+8、完整官方SHA512已核Classic6.3.2。标准单连接STOMP1.2、真实TLS、合成payload；活动阶段目标5条/秒，每分钟末4秒停止业务发送观察心跳，共固定300秒。broker单活跃处理器、无持久化/JMX/Web，仅127.0.0.1，不是新增常驻服务。

## 实际结果

- 负载窗口300014.899ms，父监督器301.833s（含启动/清理）。
- attempted_sends/sent/received/本地ACK调用/receipt确认均为1397，unique_payloads=1397。
- errors=0、非预期timeouts=0、重复=0、outcome_unknown=0。另有明确标记的1次预期200ms负观察超时，不隐藏为普通错误。
- 五个静默窗口均有出入活动：outgoing_delta=[4, 4, 4, 4, 4]；incoming_delta=[3, 3, 3, 4, 3]。
- incoming_heartbeats总数是核心EOL事件，可能包含消息帧间LF，不能称为同样数量的broker独立idle脉冲；仅静默窗口增量用于证明idle心跳活动。
- 每条延迟均值1.112ms、最大11.622ms；从SEND前至receipt、delivery和本地ACK调用结束，不是broker持久化、ACK确认或生产SLO。无p95宣传。
- 每0.2秒采样自身进程树RSS，峰值233504768字节；512MiB/380秒上限均未触发。RSS为采样和，不是精确OS峰值、算法节点或单独库内存。
- port_closed=true、private_key_removed=true；client socket/timer/waiter关闭断言通过。
- fixture SHA256：`83cbebe54da7faa2a0c4cd110793d4525ad9e21cdbee77968852dafe13a34da6`。

## 失败没有抹去：有效的产品修复

首跑约61.8秒、280条确认后失败；短诊断明确收到1000,1000协商，固定100ms接收宽限导致idle过渡heartbeat timeout。独立AI评审支持最小Client策略改为R+max(100ms,R)，是实现政策而非规范规定倍数，代价为死亡检测延后；公共HeartbeatClock默认100ms不变，无心跳方向/1.0不变。1000ms边界2000允许/2001关闭、收到任意数据重置、方向禁用及既有版本测试均回归。

已发布registry0.2.0仍是旧策略，**本五分钟通过只属于未发布修复候选**。原始首次失败、两个短诊断、修复后完整重跑和监督器记录分别保存在本任务quarter-followup目录；不覆盖旧回执。短诊断模式即使6.5秒通过，也由runner拒绝冒充完整五分钟。

## 复现

已有可信依赖及构建后的bridge：

```sh
python3 scripts/classic-run.py --home /verified/apache-activemq-6.3.2 --java-home /existing/jdk --output /new/soak --port 62618 --processors 1 --tls --soak
```

必须用外层380秒/RSS512MiB监督器，日志仅私有保留；本轮未接入公开CI。可参考scripts/bounded_run.py（ABNF工具），不要把默认120秒上限用于五分钟任务。

这是低速、单连接、五分钟稳定性观察，不是吞吐上限、长稳、跨broker对照、生产PKI/mTLS、故障转移、持久性或exactly-once证明。没有外部采用者或奖项承诺。
