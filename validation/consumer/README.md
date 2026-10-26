# 从私有源码包验证独立消费

从最终私有附件解压后的 `source/moonstomp` 运行。要求已有本轮可用的 SDK，`moon` 在 PATH，标准库已准备；当前 workspace 格式以 `moon 0.1.20261020 (6691f18)` 实测。只使用本地候选和随 SDK 的 core，没有 registry 下载、账户或发布。

下面创建源码目录旁的独立模块。`../moonstomp-consumer` 必须不存在；请先用新的解压目录，避免覆盖先前文件。主库目录名须保持 `moonstomp`。这验证源码 ZIP 的公共 API，**不代表 `moon package` 或 registry 安装成功**。

```sh
mkdir ../moonstomp-consumer
cp validation/consumer/main.mbt.in ../moonstomp-consumer/main.mbt
cp validation/consumer/moon.pkg.in ../moonstomp-consumer/moon.pkg
cat > ../moonstomp-consumer/moon.mod <<'EOF'
name = "independent/moonstomp-consumer"
version = "0.1.0"
license = "MIT"
import {
  "sundaysebasidian-byte/moonstomp@0.2.0",
}
EOF
cat > ../moonstomp-consumer/moon.work <<'EOF'
members = [".", "../moonstomp"]
EOF
cd ../moonstomp-consumer
moon check . --target js --frozen --no-mbti --deny-warn -j 1
moon build . --target js --frozen --deny-warn -j 1
moon test --target js --package independent/moonstomp-consumer --frozen --deny-warn -j 1
moon run . --target js --frozen --deny-warn -j 1
```

预期各命令退出 0，测试为 `Total tests: 6, passed: 6, failed: 0.`，运行输出为：

```text
media-worker: bytes=12, ACK=1, NACK=1, pending=0
sensor-feed: readings=2, values=25/26, duplicate-first, heartbeat=LF
ledger-batch: staged=2, abort-restored=2, commit-pending=0, receipts=2
```

`--frozen`禁止同步依赖，`--no-mbti`避免check时用另一SDK重写候选的接口索引；所需core已随现有SDK准备。输入server帧由fixture明确提供，没有连接真实broker。真实TLS订单场景使用源码根目录的 `scripts/classic-run.py --tls --demo`，见 [提交准备](https://github.com/sundaysebasidian-byte/moonstomp/blob/32090a84c0d4fd31359f764b4c92ffa16db7671c/docs/submission-preparation.zh-CN.md)。消费者运行后可删除这个独立模块；不会改全局SDK、配置或服务。
