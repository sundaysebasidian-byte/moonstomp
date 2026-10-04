# 0.1.1 修复历史

0.1.1 基于 0.1.0 修复两项边界：自动 content-length 计入最终 header 预算；带 receipt 的退订保留订阅槽、原 ACK 模式和在途 MESSAGE，直到相应回执确认。先新增回归观察原实现两项失败，修复后核心两个后端各 37 项、TCP 10 项、独立差分和候选消费通过。

准确 0.1.1 tag、CI、正式发布和独立 registry 安装见 publication-0.1.1.zh-CN.md。0.1.0 历史保留，不用旧结果代替新版。0.1.2 修复与生成回归另见 quality-0.1.2.zh-CN.md、overnight-review-20261003.zh-CN.md，当前源码/CI 状态见 source-sync-0.1.2.zh-CN.md。
