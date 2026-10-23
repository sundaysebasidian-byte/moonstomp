# 独立源码审查（运行验证受阻）

由本轮单独的只读审查agent检查原基线、各次整改diff及最终修正；未自行编辑或声称编译/测试通过。此为AI辅助工程审查。

| 发现 | 修正及负控制 | 最终源码审查 |
|---|---|---|
| 1.0 id-less/identified destination重叠检查只覆盖一个加入顺序 | 两种顺序均在mutation前拒绝；原订阅仍可收MESSAGE | 已确认 |
| 低版本command/separator可能接受1.2 CRLF；literal CR不能与EOL混淆 | CONNECTED保留raw headers到header结束选版；按版保留literal CR/剥1.2 EOL CR，精确复验version | 已确认 |
| 纯1.0/1.1 CONNECT在Client层仍先按V12编码 | Fresh CONNECT按offer选择wire version，在提交状态前编码；纯低版本literalCR测试 | 已确认 |

默认connect/encode/Decoder.new仍为V12；Connected事件JSON未改形状。新版握手暂存受原max_line/max_headers约束，fatal及关闭路径清理；下一帧读取前版本已切换。lsof通过PATH定位适配Linux。独立审查最后结论：已报告问题均已处理，可保留未编译草案。

16个针对用例未执行；公开API消费、旧1.2回归、真实broker/go-stomp互操作均未执行。仅Node glue/Python runner语法及git diff空白检查通过。SDK访问403及缺少moon/moonc阻塞无法解除，见environment.json和真实入口失败报告。源码审查不等于验证通过。
