# MoonSTOMP 0.2.1

0.2.1 是心跳接收宽限修复版本，保持公共 API 与 STOMP 1.0/1.1/1.2 范围。Client 使用接收周期 R 的 `R + max(100ms,R)` 超时阈值；公共 HeartbeatClock 默认 100ms 不变，无接收心跳方向与 1.0 不变。该容差是实现策略，不是规范规定倍数；故障检测延后是明确取舍。已发布的 0.2.0 保持旧策略，不可覆盖。

```sh
moon add sundaysebasidian-byte/moonstomp@0.2.1
```

单元覆盖 2000ms/2001ms 边界、收到数据重置及方向禁用。真实 Classic 6.3.2 TLS 三版本、认证/证书负控制、receipt-loss 未知结果不重发、新心跳超时与五分钟低速单连接场景使用分别记录的回执；五分钟不是长稳、吞吐上限、生产持久性或外部采用。入站 EOL 总数可能包含帧分隔，只有静默窗口用于证明 idle 心跳。

首次本地五分钟尝试约 61.8 秒失败，修复后的本地与远端结果分列，原始失败没有改写。历史缺失心跳 fixture/hash 没有恢复，新 fixture 有自己的源码摘要。固定 go-stomp 对照不冒充新 Classic/Go 互操作实跑。

## 已完成的发布核验（2026-10-25）

[版本 PR #8](https://github.com/sundaysebasidian-byte/moonstomp/pull/8) 已合并，发布提交为 `29453aa85734589cb1afe7623116456075ed99c7`。该提交的[核心/传输验收](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40166736746)及[Fresh clone](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40166736744)成功。官方CLI发布退出0并返回HTTP 200，registry metadata为0.2.1、build_status为success；[精确版本页面](https://mooncakes.io/docs/sundaysebasidian-byte/moonstomp@0.2.1/)。

官方ZIP SHA256：`a40663578a25e662addccc778db2c3896a5f5aa9b7df6b79b329bf58ac1cd1e1`。全新registry消费者无workspace/path覆盖，安装的145个包文件与ZIP一致；JS/Wasm GC核心各8/8、多版本黄金、已安装适配器TCP/TLS，以及实际安装包的Classic6.3.2 TLS三版本和心跳场景通过。native/普通Wasm消费者与Windows未验。

[五分钟远端回执](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/40166180099)对应合并前精确head `43f06e44bc894c232d44de121e840cd1ecdb5e5e`，与发布提交源码树一致：300秒、1399条一致收发，未出现非预期错误、超时或重复。它是源码场景，不是registry五分钟消费测试；旧本地1397条保留自己的身份。后续开发的`sendAsync`及单调期限修复**不在0.2.1**，见[未发布异步SEND](async-send.zh-CN.md)。这些发布轮证据不为本地新特性背书；生产PKI、mTLS、故障转移、长期稳定性、外部采用仍未验证，不包含比赛提交。
