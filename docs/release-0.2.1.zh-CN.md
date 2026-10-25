# MoonSTOMP 0.2.1

0.2.1 是心跳接收宽限修复版本，保持公共 API 与 STOMP 1.0/1.1/1.2 范围。Client 使用接收周期 R 的 `R + max(100ms,R)` 超时阈值；公共 HeartbeatClock 默认 100ms 不变，无接收心跳方向与 1.0 不变。该容差是实现策略，不是规范规定倍数；故障检测延后是明确取舍。已发布的 0.2.0 保持旧策略，不可覆盖。

```sh
moon add sundaysebasidian-byte/moonstomp@0.2.1
```

单元覆盖 2000ms/2001ms 边界、收到数据重置及方向禁用。真实 Classic 6.3.2 TLS 三版本、认证/证书负控制、receipt-loss 未知结果不重发、新心跳超时与五分钟低速单连接场景使用分别记录的回执；五分钟不是长稳、吞吐上限、生产持久性或外部采用。入站 EOL 总数可能包含帧分隔，只有静默窗口用于证明 idle 心跳。

首次本地五分钟尝试约 61.8 秒失败，修复后的本地与远端结果分列，原始失败没有改写。历史缺失心跳 fixture/hash 没有恢复，新 fixture 有自己的源码摘要。固定 go-stomp 对照不冒充新 Classic/Go 互操作实跑。

版本 PR 为 [#8](https://github.com/sundaysebasidian-byte/moonstomp/pull/8)。准确 head、合并记录及 CI 以该 PR 和 Actions 实际回执为准；正式包版本与 checksum 以 [Mooncakes](https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp) 为准。源码 CI 不能替代发布后全新 registry 安装；生产 PKI、mTLS、故障转移、长期稳定性、外部采用仍未验证，不包含比赛提交。
