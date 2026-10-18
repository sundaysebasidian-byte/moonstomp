# STOMP 初审整改续接：事实与验收缺口

本轮接续 `1218cca20956a9ed11f247222945d649d48842a4`，保留 `review/multiversion-20261014` 和2026-10-14恢复包；正式版本仍为0.1.2。仅云端工作，无push、Actions、Mooncakes发布、申请提交、条款同意或凭据创建。本文是AI辅助工程底稿，不是人工最终申报书。

## 精确评审要求

主线程本轮重读邮件并提供的原文：

> 项目有一定的价值。申报书已实现功能和拟实现混在一起，不够清晰；请给出更清晰的拟实现功能说明。功能范围略窄，建议参考 go-stomp https://github.com/go-stomp/stomp 等成熟实现（并建议补充功能对比和互操作测试，以增强说服力），实现完整的 STOMP 协议支持（而不只是 STOMP 1.2）。

原申请可在10月31日前修改重申；未提供精确截止小时，不自行补造。

## 状态矩阵

| 范围 | 已有正式能力/证据 | 当前分支实际完成 | 未完成验收 |
|---|---|---|---|
| 1.2协议与生命周期 | 0.1.2 codec/client/heartbeat、旧Linux/Artemis及注册表记录 | 原接口和旧broker场景保留 | 当前diff的1.2全量回归 |
| 多版本协议 | 0.1.2未实现1.0/1.1 | 前轮三版源码草案；本轮修复STOMP混合offer误拒 | 17项MoonBit测试均未编译/执行，完整协议支持不能宣告完成 |
| go-stomp比较 | 前轮已按源码比较 | 明确Go writer版本不敏感转义边界；新真实peer测试glue | Go1.26.8官方包校验安装后，真实peer已编译；仅CLI guard检查，不能称互操作通过 |
| 真broker双向 | 历史仅Artemis1.2，不移用 | 新三版Go↔broker↔MoonBit入口，复用原broker启动/trace/清理 | MoonBit SDK及已核SHA512的Artemis包、原锁定Java17需可用；当前仅Java21，所有新broker结果未产生 |

本轮源码修复：`STOMP` 帧提供 `1.0,1.1` 等混合现代offer不再被误拒；纯1.0 STOMP仍拒绝。新增针对用例使总数从16增至17，**通过数未知**。1.0服务器不能识别STOMP命令；本用例面向支持现代协议的服务器，不据此承诺可向1.0服务器发送STOMP。

## 可审阅的互操作实现

- `tests/interop/go-peer/main.go` 使用真实go-stomp公共API，不实现替代codec。固定 `c155a2d699bb5bc1b2547a4382b3cdd7f4403648`；本项目只写控制/断言glue，未复制参考协议实现。
- `scripts/build-go-peer.py` 要求已有干净的固定上游checkout和真实Go编译器，禁自动下载工具链/模块；生成build报告、peer源码hash及binary hash。原 `/usr/bin/go` 仍是围棋程序，初次入口因此失败，原输出保留；随后通过官方go.dev发布目录下载Go1.26.8，按官方SHA256核验，仅解压任务目录，不改系统/配置。真实peer构建成功并通过CLI help/无效参数guard；这些不连接broker。临时目录VCS stamping首轮失败也保留，最终使用明确的-buildvcs=false并以pin/源码/二进制hash记录来源。
- `scripts/go-broker-interop.cjs` 核build记录、pin、实际binary及glue源码hash；两个客户端分别连接已有隔离broker，两个独立destination承载两个方向。订阅先等receipt，再传二进制 `[65,0,255,13,10]`。双方都核实际版本；Moon ACK按1.0 message-id、1.1 message-id+subscription、1.2 id选择；核退订和断开回执。
- 三版共同测试安全ASCII header，1.1增加colon/LF/backslash/Unicode/空格，1.2再加CR。Go参考writer对所有版本统一转义，不能用其1.0特殊header或1.1 CR编码替代规范；旧版literalCR由MoonBit字节测试覆盖，未放宽校验。
- `broker-run.py --go-peer ...` 复用旧真实broker生命周期与全部原1.2场景，再执行新入口，保存Node/Go两侧wire trace、实际版本和每方向断言。未提供peer时明确NOT RUN，失败时保留失败状态，不冒称成功。旧Artemis事务ACK无法回滚的限制不变。

完整链路尚未执行；其中Go peer构建及CLI检查已完成。后续重现命令（MoonBit构建和broker阶段仍待前置条件满足）：

```sh
python3 scripts/build-go-peer.py --go /absolute/path/to/go \
  --go-stomp-checkout /absolute/path/to/pinned-clean-go-stomp --output /new/go-peer-build
moon build --target js -j 1
python3 scripts/broker-run.py --archive /official/apache-artemis-2.57.0-bin.tar.gz \
  --sha512 /official/archive.sha512 --java-home /existing/java17 \
  --go-peer /new/go-peer-build/go-peer --output /new/broker-evidence
```

原 `scripts/verify.py --transport` 完整适用入口已再次尝试，在moon缺失检查处退出；未执行核心测试。Node/Python语法检查只是glue静态检查，不是协议或Go编译验证。

## 工具链和独立审查

`moon/moonc`依旧缺失。按新授权只对原官方安装脚本正常请求一次，返回HTTP403/curl退出22；响应头为server envoy，未给明确原因，不能断言是哪项网络/访问政策拒绝。未执行安装、重试或换来源。响应头、stderr、exit code和两个实际失败入口均保留在 `evidence/review-20261015`。

独立只读审查发现并确认混合offer修复；同时要求peer provenance核验及`close`后处理未排空stdout，均已处理。最终运行验收仍受阻，不能称初审整改已完成。

Go官方安装元数据、SHA256、首次失败、最终构建及CLI检查在evidence/review-20261015/go-*。最终peer路径：/workspace/moon-review/checks/go-peer-final-20261015/go-peer；Go编译器：/workspace/moon-review/go-attempt-20261015/sdk/go/bin/go。实际Go可用不解除MoonBit SDK阻塞，17项新增MoonBit测试及互操作仍未运行。
