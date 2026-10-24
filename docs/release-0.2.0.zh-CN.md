# 0.2.0 发布准备（尚未发布）

候选基于已合入master的 `19ed395482377798759b04a9d569b044faa51afe`。三个有状态类型从公开字段改为抽象类型，对外部字段调用方属于破坏性变更，因此从0.1.x升至0.2.0；不覆写历史0.1.2。多版本STOMP、认证/TLS、句柄等实现与master一致，此发布准备不改变产品运行逻辑。

**本轮尚不能确认registry最新版本，也没有发布成功回执。** 原云环境对官方manifest查询和完整SDK校验文件请求均被代理403拒绝；已停止这些目标，没有换镜像、机器或新凭据。现有官方CLI的`moon whoami`返回`Not logged in`，隔离Wasm工具链缺少`mooncake`发布器。没有发起`moon publish`，没有读取秘密值或创建账户/凭据。0.2.0是否已被其他发布占用仍需恢复官方访问后核实；本候选暂不合并为正式发布版本。

README保留候选与已发布旧包的区别。`.moonignore`按官方规则排除历史`evidence/`、构建/依赖目录、归档、临时私钥和环境/认证文件；`scripts/downstream.py`在官方`moon package --frozen`产生的真实ZIP上再次拒绝这些条目。SDK/broker二进制、原工程ZIP和私有交付证据不属于发布内容。stompjs测试参考及其LICENSE、核心/bridge/transport和示例仍保留。

解除前提后，正式步骤依次为：

1. 通过官方manifest/index核实既有命名空间与最新版本，确保实际version、metadata.version和checksum对应目标，而非回退旧版；若0.2.0已存在则比较来源，不能覆盖或盲目重复发布。
2. 在原环境使用已有Mooncakes登录认证和官方完整CLI，不打印token；若需要新协议、权限或凭据则停止并报告。
3. 对最终发布PR的精确head运行检查、官方package及下游验证，审阅包文件列表和校验和；通过后合并，再绑定准确发布commit。
4. 仅调用一次官方`moon publish --frozen`；若结果不明先查registry目标版本和checksum，不盲重试。记录真实HTTP/CLI结果与registry实际版本，不能把GitHub合并当作发包。
5. 在全新索引/缓存的消费者中仅用版本依赖安装`@0.2.0`，无path/workspace覆盖；核实际安装来源和文件摘要，验证核心、多协议版本、生成bridge与TLS/适配示例。脚本peer和真实broker的证据分别报告，必要真实broker仅用已有隔离profile。

本轮的本地源码消费或CI package通过都不代替第4/5步。历史0.10.16的Wasm/Wasm GC控制失败、本地native runtime缺件以及生产PKI/mTLS/代理、持久性/故障转移、长时soak和性能等未验边界保持可见。不发版、不代交比赛，不承诺无bug或获奖。
