# 有界复核与 0.1.1 发布流程

基线为已公开 master `6b126587a1821795e909ea561c46dcf32b160a2a`，正式包 0.1.0 对应 v0.1.0/16343c8。先前本地复核阶段只实现/验证并交付 diff，没有提交或发布；现已收到用户明确补充授权，按 0.1.1 推进真实修复提交、准确 CI、正式包与全新 registry 安装。0.1.0 历史保持，时间按实际保存，不填写报名或接受新协议。

## 实际缺陷与局部修复

1. Client 原本仅统计调用者的 headers，非空正文编码器自动追加 content-length 后可能从 128 变 129，超出本库默认 Decoder 可接受范围。新预算在编码前包括自动长度；拒绝时保持 Active 且不登记 receipt。测试覆盖 128+自动拒绝、127+自动成功及 128+显式成功，并把成功 wire 交给默认 Decoder 验证。
2. UNSUBSCRIBE 带 receipt 时原本立即删除本地订阅，导致合法在途 MESSAGE 被视为未知订阅，或过早允许重用 ID。新状态保存 id/receipt 并保留原订阅槽与 ACK 模式至对应回执，阻止重复退订/提前复用；回执后退订但已交付消息仍可确认，旧消息清空后可再用 ID。fail 清理所有待退订记录。新记录数量受已有订阅 capacity 和 pending receipts 限制，没有独立无限队列。

先加入行为回归，原实现测试 36 项中 2 项失败；修复后另外加入失败清理与 Node bridge/TCP 连帧回归。测试原始 red/green、完整核验和意图绑定候选源码摘要保留于交付 evidence，不以旧正式版本测试替代。无 receipt 退订仍立即移除、未知订阅消息 fatal，作为清楚的严格边界，没有实现自动 drain、重连或通用 broker 特例。

边界补充还明确：encode 本身无 Limits；Client 内部默认 Decoder；JSON 排队预算与 raw body 不等同；feed 返回批次不是 RSS 保证；receipt 超时不撤销服务端可能已处理的意图；同步 predicate 异常可能关闭运输；generic bridge error 无稳定细分码；JS bridge 不支持整工程 Wasm-GC。整体 Wasm-GC 的编译错误是已确认不支持，不把失败隐藏成“未测”。

## 经明确授权的发布流程

版本为 **0.1.1 patch**：只修已有预算和退订时序，没有扩公共 API或新运行依赖。下面记录流程要求，实际完成状态与准确链接以 publication-0.1.1.zh-CN.md 为准：

1. 用户已明确批准本项目 diff 公开和发布；以一个真实修复阶段提交，不为空提交或提交数拆分。
2. 将 moon.mod version 统一到 0.1.1；downstream.py 现在从 moon.mod 读取模块/version 推导 ZIP 文件名和候选版本、README 安装例、候选/已发布措辞与验收证据版本。保留 0.1.0 历史证据；不要只改 manifest 后让复验仍读旧 ZIP。
3. 在最终候选串行执行固定 SDK check/build/test、独立参考、10 项 TCP、独立本地 package 消费及现有已下载 Artemis 的真实三例/五检查；无新软件安装、无公网 broker 测试。
4. 复核准确 package 清单、许可证、全历史隐私和所有源码摘要后，再经授权推送；等待该 **准确提交** 的远端 CI success，绑定 v0.1.1。现成认证仅正常官方工具使用，不读/提取 token，缺认证或新协议则停报。
5. 正式 moon publish 0.1.1 后，在独立新缓存 moon add 安装，JS/Wasm-GC check/build/test/run 各三个场景，并核正式 archive checksum 和实际安装文件一致。将准确 package/version/commit/CI/安装记录交回父任务统一汇总。

0.1.1 已获明确推进授权，最终远端 CI/registry 状态以版本证据为准，不用旧版本结果替代新版本。其他 broker/认证/持久化等明确未测，不扩成全面标准库。发布完成仍不等于比赛申报或验收；申报书必须用户本人最终人工撰写，私人表单和承诺由用户处理。
