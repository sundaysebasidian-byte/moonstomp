# MoonSTOMP 0.3.0 发布候选

> 历史候选记录（2026-10-26 状态指针更新）：下文保留发布前条件，不是当前状态。0.3.0 已经由 [PR #9](https://github.com/sundaysebasidian-byte/moonstomp/pull/9) 合并并发布，但其 Mac 实际 registry 心跳消费曾失败；修复后的当前版本为 [0.3.1](release-0.3.1.zh-CN.md)，两档真实 TLS 心跳及 drop 控制已通过。旧包和旧失败保持不变。请以[当前证据索引](https://github.com/sundaysebasidian-byte/moonstomp/blob/32090a84c0d4fd31359f764b4c92ffa16db7671c/docs/REVIEW_EVIDENCE_INDEX.zh-CN.md)区分源码 CI、registry 消费与未验项。

状态：本地候选，尚未push、建立版本PR、合并或发布。当前Mooncakes最新包仍是0.2.1；不覆盖既有版本。

相对0.2.1新增Node源码适配器`sendAsync`：有界FIFO、等待write callback/drain、复制输入、单调期限、逐项取消/超时和未知结果，无自动重连/重发。保留同步接口与MoonBit sans-I/O核心；新增调用入口采用minor版本0.3.0。详见[异步SEND](async-send.zh-CN.md)。Mooncakes安装MoonBit包，Node适配器仍按源码使用，不冒充npm包或MoonBit根包异步API。

写前取消/到期不尝试发送；写后失败可能未知并关闭；本机完成不是broker回执。控制操作需等队列清空；心跳背压可能先关闭。示例只展示三条合成记录与demo peer，不是持久化、真实broker或生产采用证明。上轮真实五分钟测试保留0.2.1的原提交身份，不改称异步发送负载测试。

发布条件：

1. 父线程确认两个公开仓库、候选SHA与版本范围后，正常push当前开发分支并建立独立版本PR；旧#8已合并，不复用它。
2. 精确PR head的核心JS/Wasm GC、三版本黄金、完整本地传输验收、异步期限/背压/取消/关闭及pinned/latest fresh-clone通过；固定Classic手动CI在同一head串行执行真实TLS三版本、receipt-loss、心跳与短异步场景。远端未跑不能用本地回执代替。
3. 正常合并后核对合并提交CI、完整官方broker归档SHA512、包清单与源码一致。临发布再次只读确认0.3.0未占用，以既有CLI登录发布一次；未知结果先核实。
4. 真正发布回执后，全新registry消费者精确安装0.3.0，检查核心、多版本、实际包内Node适配器异步发送及TLS清理。不得用workspace/path依赖冒充registry。

本候选未运行远端CI、未产生registry回执；native/普通Wasm消费者、Windows、长稳/生产PKI/mTLS/故障转移仍不能推断已通过。不包含比赛提交或获奖概率承诺。
