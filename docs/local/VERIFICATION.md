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

## 0.2.2 本地独立模式

`pnpm check`：**1,195 passed / 30 skipped**，63 test files passed / 1 skipped，类型检查与构建成功。新增纯本地配置/环境/模式切换与本地任务集成测试，断言无 subprocess 探测、无 GitHub/飞书调用、无成员同步，本地 Worker 可完成并将报告回到 Router；远端原版回归继续通过。

当前实例实测：`/superagent-status` HTTP 200，指定 session-a534baa0-2a6f-4b10-8365-38a044d3de11 返回 active/configured:true/local:true/paused:false。`/orchestrator/api/state` 返回 setup.local=true、problem=null、accounts=null，runtime=ready、maxWorkers=1。无需补填任何远端信息。实际模型执行未由测试注入用户会话，防止伪造用户任务；Worker 执行链路由隔离集成测试验证。

本地默认在主会话原项目工作，独立任务严格一个槽位（包括人工跟进不会越过本地并发限制），保留用户 Git 配置。版本包为 `dsh-superagent-0.2.2.tgz`。

## 0.2.3 Router 工具隔离

最终 `pnpm check`：**1,202 passed / 30 skipped**，64 test files passed / 1 skipped，类型检查和构建通过。独立入口打包没有跨入口私有别名导入，CLI Error 品牌跨入口保持 304/410 等状态判定。

用户提供的 session-fab27bb7-d946-451b-bb8e-d155764af450 原先选中 dsh-superagent-worker，因此可写文件。已移除两个额外 Worker 预设，唯一可选预设名为 Superagent；真正 Worker 动态挂载工具。给指定会话迁移预设记录并转交空部署，运行态检查 /superagent-status?sessionId=... 返回16个明确的 orchestrator 工具，无 read/write/edit/bash/pwsh/job/subagent。Plugin Manager 运行态仅有一条 Superagent preset row。

新增真实工具服务边界测试，验证继承的write/bash不可见、同scope注入pwsh仍拒绝执行、伪orchestrator前缀不能过关，只有精确获准的route工具可调用。Worker composition测试证明只目标scope可见执行工具，并覆盖async失败回滚。当前Desktop的13个Worker工具模块已通过真实import和Config校验；模型驱动的真实Worker执行未触发，完整运行链路仍以隔离测试为验证依据。

## 0.3.0 每会话独立实例

最终 `pnpm check`：**1,210 passed / 30 skipped**，类型检查与构建通过。多实例controller测试覆盖同ID去重、不同ID并行、单实例释放和全局关闭；真实Cordis+Runtime测试验证两个实例的Sources均独立注册、状态目录不同、暂停A不影响B、释放A后B管理API仍HTTP 200。相同外部事件同一时刻在两个Router生成不同Ticket/Worker身份。UI测试验证选择前不请求业务API、切换后使用各自编码路径，拒绝通过实例面板修改共享Host默认模板。

实际运行检查发现6个已有Superagent主会话同时active/configured:true/local:true。用户指定session-f82e26e4-9541-46c0-8f45-be221f76629b与session-07314ffb-b629-4bd4-9e6a-91ed2c9748af分别使用不同sessions/<hash>目录、各自16个Router工具。实际暂停前者时后者paused=false，随后恢复前者至测试前paused=false。未向用户会话注入模拟任务，未执行真实远端写入。

旧单部署数据库原地保留，不复制其配置/任务到全部新实例，避免历史任务被重复恢复。0.3.0的新实例使用私有本地默认值。共享Host配置仅作为新实例模板，已运行实例读取其创建时的机器参数快照。若用户显式让多个实例操作同一个磁盘项目，项目文件仍是用户选定的同一路径；隔离的是Superagent实例、状态、权限与任务归属。

## 边界

模型和远端使用测试替身；真实远端授权/投递、飞书账号、安装后的渲染及图标尚未验证。Linux 专属脚本本次未在 Linux 主机重跑。没有将 mock 主会话集成测试称为真实模型端到端验证。
