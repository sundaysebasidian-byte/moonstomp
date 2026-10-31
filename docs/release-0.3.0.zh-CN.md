# MoonSTOMP 0.3.0 版本说明

> 历史版本说明（2026-10-26 更新）：0.3.0 已经由 [PR #9](https://github.com/sundaysebasidian-byte/moonstomp/pull/9) 合并并发布，但其 Mac 实际 registry 心跳消费曾失败；修复后的当前版本为 [0.3.1](release-0.3.1.zh-CN.md)，两档真实 TLS 心跳及 drop 控制已通过。旧包和旧失败保持不变。请以[当前证据索引](https://github.com/sundaysebasidian-byte/moonstomp/blob/32090a84c0d4fd31359f764b4c92ffa16db7671c/docs/REVIEW_EVIDENCE_INDEX.zh-CN.md)区分源码 CI、registry 消费与未验项。

相对0.2.1新增Node源码适配器`sendAsync`：有界FIFO、等待write callback/drain、复制输入、单调期限、逐项取消/超时和未知结果，无自动重连/重发。保留同步接口与MoonBit sans-I/O核心；新增调用入口采用minor版本0.3.0。详见[异步SEND](async-send.zh-CN.md)。Mooncakes安装MoonBit包，Node适配器仍按源码使用，不冒充npm包或MoonBit根包异步API。

写前取消/到期不尝试发送；写后失败可能未知并关闭；本机完成不是broker回执。控制操作需等队列清空；心跳背压可能先关闭。示例只展示三条合成记录与demo peer，不是持久化、真实broker或生产采用证明。上轮真实五分钟测试保留0.2.1的原提交身份，不改称异步发送负载测试。

历史验证未覆盖 native/普通 Wasm 消费者、Windows、生产 PKI、mTLS、故障转移及长期稳定性。
