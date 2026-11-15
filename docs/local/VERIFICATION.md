# 验证记录

环境：Windows，Node 24.20.0，pnpm 11.7.0；当前目标 DSH Desktop 0.2.2-rc.3。基线 commit 8c32a9d。

## 基线

原版在 Windows 存在 POSIX 命令 (`sh`/`sleep`/`env`/tmux)、chmod 权限位、跨盘临时文件及路径分隔相关失败。本分支保留 Linux 专属测试，并在 Windows 明确跳过这些测试；新增原生 Windows 命令验证补足执行路径。

## 已执行

- Router controller/index：安装静默、实际选择后采用用户会话、唯一所有者、失败恢复与启动中卸载。
- Router Runtime：真实 Store/Engine/Effects/Worker adapter 集成，本地消息去重、独立任务 follow-up、拒绝 relay、结果回 Router。
- Windows execution：真实 `.cmd`/`.ps1` CLI、账号 probe、Git credential helper、PowerShell prepare、中文及空格路径、literal 参数、blocked commands、执行作用域与主进程环境不变。
- 原版 Runtime / concurrency、Engine、Policy、Outbox、Effects、面板、迁移与模型提示词回归。

0.2.0 的 `pnpm check`：类型检查通过，**1,184 tests passed / 30 skipped**，62 test files passed / 1 skipped，Host ESM 与 DSH Client CJS 构建成功。跳过项为 POSIX/tmux、POSIX fake CLI 和 Unix 权限位专属验证；这些测试在 Linux 仍保留。

真实 Cordis Fiber 挂载/卸载测试同时通过，确认插件启动使用 `.await()` 等待异步初始化。独立代码审查确认本地主会话授权不扩展到远端来源，部署归属不因主会话暂时释放而自动转交。

依赖安装使用锁定清单；没有安装到当前用户 profile，没有发送真实 GitHub/飞书消息，没有创建 PR。构建产物打包为 `dsh-superagent-0.2.0.tgz`，不将 lib/ 或压缩包提交到源码分支。压缩包包含 52 个文件；校验了 Host/Client 入口、patch、双语 locale、SVG、提示词、技能与 Router 使用说明均存在，SVG XML 可解析。四个编译后的 Host 模块均可由 Node 成功导入。

## 0.2.1 实际安装修复

现场发现首次安装缺少 stateDir 导致 Host 失败，以及动态 Runtime 子插件缺失 inject。已修复并补未 mock Runtime 的真实 Cordis 组合测试。最终 `pnpm check`：**1,188 passed / 30 skipped**，类型检查与构建通过。

实际运行实例 `/superagent-status` 与 `/orchestrator/api/state` 均 HTTP 200，已按用户指定绑定 session-a534baa0-2a6f-4b10-8365-38a044d3de11。当前 configured=false、repositoryUnset，需在来源中配置真实仓库/CLI；没有执行真实远端任务。详细诊断和应用记录见 [BUGFIX](BUGFIX-2026-11-15.md)。

## 边界

模型和远端使用测试替身；真实远端授权/投递、飞书账号、安装后的渲染及图标尚未验证。Linux 专属脚本本次未在 Linux 主机重跑。没有将 mock 主会话集成测试称为真实模型端到端验证。
