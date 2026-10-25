# 原评语—证据—缺口矩阵（2026-10-25 本地补强前）

| 原始顾虑 | 已有可核验证据 | 本轮只补缺口 | 仍不能宣称 |
|---|---|---|---|
| ABNF 不只是文法校验器 | 0.2.0 Program::parse_input/InputTree；输入树见证、字节span与extract；四后端registry消费通过 | 将已验证的独立registry协议消费者固化为可复现脚本 | 完整ABNF规范认证、所有文法/平台兼容 |
| ABNF 输入树与通用性 | Age记录、二进制、ETag、RFC URI/Cookie、同程序预算后复用 | 一键真实发布包的JS协议记录黄金/拒绝/预算/配置检查 | 接入真实生产采用者 |
| ABNF 真实协议场景 | RFC3986八URI、Cookie512对照、ETag256；JS源绑定CI已通过 | 修订旧“未发布”说明并区分源码/registry消费者 | 完整HTTP或浏览器Cookie策略 |
| ABNF 成本可解释 | JS release单次adaptive bench及work/states/nodes/edges，RSS单列 | 固定复现命令、解释单次统计边界，不虚构p95 | 五轮独立实验、跨语言性能领先 |
| STOMP 已做/拟做混淆 | 0.2.0实际发布；三版本与Classic6.3.2 TLS真实CI成功 | 统一当前申报入口，保留历史日期 | 计划即完成、3.9秒demo即三分钟负载 |
| STOMP 参考go-stomp与公平对照 | 固定c155a2d699bb5bc1b2547a4382b3cdd7f4403648、原peer/glue、历史Artemis双向三版本 | 对照证据级别与语义取舍，不重复旧互操作 | 当前Classic已重跑go-stomp、比成熟实现更快 |
| STOMP 完整1.0/1.1/1.2 | 离线黄金、各版本ACK边界、真实Classic TLS矩阵 | 不重写；增加当前可复现真实心跳fixture | 1.0支持规范不存在的心跳/NACK |
| 安全与失败语义 | 认证负控制、CA/hostname、receiptUnknown不重放、清理回执 | 新心跳fixture显式无重连和socket/timer清理 | 生产PKI/mTLS、exactly-once、长稳或故障转移 |
| 独立审阅/奖项竞争力 | 两Draft PR当前无review；来源/许可保留 | 准备逐项审阅清单和回执 | 独立人类审查通过、真实采用、获奖概率 |

基线 ABNF 33b8b3159dee0a40ff7a59c42e76eb9ba52f9453；STOMP f752183d9f7968f2dca75057fe22cd14f83e1622。既有CI不为本轮本地新改动背书。两个发布包保持0.2.0。

## 本轮进展（本地新补丁，尚未公开）

ABNF已将既有registry JS协议消费者整理成可复现脚本，明确先安装再frozen检查。STOMP新增当前源码下真实TLS心跳超时fixture，复用旧broker runner及frameStream，不宣称恢复旧fixture/hash。完整结果见本轮申报草稿；既有远端绿不为新增代码背书。原始评语要求的能力有相应实现/测试证据，但是否消除评委顾虑仍需评委重新审核。

## 独立AI复审与新增实测阶段

独立AI已实际审查，发现验证隔离/快照/计数/异常清理问题并推动修复，不再只是一份未执行清单。ABNF五个独立进程实跑通过，缓存状态和原始数据见FIVE_PROCESS_BENCHMARK.zh-CN.md（仅ABNF仓库）；不报告p95。STOMP首次五分钟尝试失败约61.8秒，短诊断定位接收宽限策略后做未发布Client修复；最终完整300秒结果另列，不抹去失败。本轮新的公共上传仍待许可。外部人类review、评委认可和真实采用不在AI审查结果内。

## 本轮完成状态

独立AI审查已执行并推动有效修复；ABNF五次独立进程及修复后registry案例通过。STOMP新本地候选完整300秒真实TLS场景通过1397条一致收发、五个静默窗口心跳、资源及清理；首次失败保留，不能归属已发布0.2.0。仍缺外部人类/评委认可、生产采用、长稳、跨实现公平性能胜负等，不用本轮结果替代。新增文件和源代码修复均未公开上传。
