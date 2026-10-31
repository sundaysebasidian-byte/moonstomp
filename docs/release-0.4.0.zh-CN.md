# MoonSTOMP 0.4.0 发行候选

状态：源码版本准备完成；未取得 Mooncakes 0.4.0 发布及精确安装回执，不标为已发布。

## 范围

运行时代码基于默认分支 `34860e244eb2fbf7093e2c01fd91ca704bc7fc3c`；本版本准备仅修改模块版本、README 与本说明，不改变协议实现。相对 0.3.1，纳入同事务累计确认、订阅生命周期/路由、退订前写入拒绝的安全重试、事务本地结果、Node 字节与 CLI 输入边界修复，以及对应回归。STOMP 1.0/1.1/1.2 支持与限制见 [逐项回应](review-response-20261030.zh-CN.md)。

0.4.0 使用 minor 版本表达这些公开行为与边界变化。关闭订阅句柄不再允许确认，应在退订前结算；结果未知不能自动重放，不代表 broker 已提交或业务持久化。Node 适配器仍按源码构建，不是 npm 包。

## 验证证据

原运行时代码的默认分支 [检查](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/41214099934)、[fresh clone](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/41214099906)、[RabbitMQ](https://github.com/sundaysebasidian-byte/moonstomp/actions/runs/41214099917) 已通过。此处不冒充本发行候选或注册表包的独立验收。

RabbitMQ 测试覆盖 SEND 事务提交/中止及 NACK 重投递，不是事务 ACK 验证。Classic 14 场景、Artemis/Go 证据绑定各自历史版本，未在本次重新执行。SDK 仅锁定 0.10.18。STOMP ZIP Windows-path guard 未完成，不计作本次修复。

## 发布门槛

候选提交的 CI、实际包文件清单、官方发布回执和干净消费者精确安装 `sundaysebasidian-byte/moonstomp@0.4.0` 分别核验；源码 CI 不能替代注册表包测试。MIT 与来源披露保持不变。
