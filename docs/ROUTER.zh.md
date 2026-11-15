# Superagent Router 插件

本 fork 基于 DeepSeek 的研究原型。0.2.0 将 Router 改为用户选择的 DSH 主会话，执行工作仍使用原版 Ticket / Worker 架构。

## 安装与启用

运行要求：DSH 0.2.2-rc.3 或兼容版本，Node 22.19+ / 24+，构建需要 pnpm 11.7；Windows 需要 PowerShell 7 (`pwsh`)，Linux 使用 `sh`。纯本地任务不需要 Git、GitHub CLI、飞书或远端账号。启用 GitHub 来源时才需要对应 CLI 和仓库权限；飞书需要 bot-only lark-cli。

在本分支项目目录运行：

```powershell
pnpm install --frozen-lockfile
pnpm build
```

在 DSH「插件 → 添加插件」选择项目目录，或已构建的包。`stateDir` 从 0.2.1 起默认使用当前 DSH profile 下的 `superagent` 子目录，不需要首次安装前手工填写。可在插件配置中改为专属状态目录，例如 `H:\SuperagentData\widgets`，不要与代码目录混用。已有配置继续优先使用。包保留 `dsh-superagent` 名称，升级前停用旧版本，不同时加载两份相同包或预设。

新建 DSH 会话并选择 **Superagent**。每个主会话都会自动创建属于自己的 Superagent 实例；只是安装、启用插件或加载预设定义不会启动来源监听或自动创建主会话。普通预设不获得这些功能。从 0.2.2 起，不配置远端即可进入本地模式并开始执行。只有需要远端来源时，才在面板填写 GitHub 仓库和智能体 CLI；远端配置部分填写时仍会显示具体配置错误。

原版的管理面板、策略、GitHub/飞书来源、模型和执行设置继续保留。GitHub 请求仍按来源名单与策略授权，本地主会话操作员单独授权；飞书默认关闭。外部事件不能冒充本地用户。

## 角色与工具权限

插件只提供一个用户可选预设 **Superagent**。主会话仅拥有已注册的路由、消息和任务状态工具，没有 read/write/edit、bash/pwsh、后台作业或任意子智能体工具；Host 的精确工具 guard 还会拒绝其他插件在当前 Agent 上新增的命令/写入工具。Worker 不作为额外预设公开，只有 Engine 确认归属的任务会话与其子智能体，才动态加载执行工具。

旧版本中误选“执行器”预设的已加载主会话会迁移为安全 Router。完成任务请通过 Router 创建 Ticket，不能直接在 Router 调用文件修改工具。

## 本地独立使用

选择 Superagent 后直接提出本地任务即可，不需要连接远端。GitHub 仓库与 CLI 全空，或显式关闭 GitHub 来源时，部署使用本地模式；GitHub/飞书轮询与成员同步均不启动，也不会探测账号或执行 Git 验证。

默认 Worker 使用 Router 主会话的原项目目录，即使它不是 Git 仓库也能工作；保持本机的 Git 身份配置，不强制提交、PR 或远端审查。独立任务以一个 Worker 槽位串行执行，避免共享项目目录被并发修改。Worker 自己的子智能体能力继续保留。需要自定义准备目录时仍可配置 Execution 的 directory/prepare。

本地任务使用本地角色提示词和本地交付标准；用户自定义团队提示词仍优先。完成后 Worker 记录 ready 报告，Router 在当前主会话汇总结果。

## 交互与执行

直接在 Router 主会话提出任务。Router 通过已记录的消息 ID 接入请求，生成 Ticket 并交给独立 Worker；闲聊直接回复。多个任务使用独立本地线程，补充指令显式关联对应 Ticket。Worker 问题、结果和远端候选返回此会话；GitHub/飞书回复仍发送至原渠道。

Router 负责交流、评估、路由与结果解释，Worker 负责调查、计划和实现。原版的并发、子智能体、任务订阅、暂停、停止、重试、持久队列及失败恢复保持有效。

从 0.3.0 起，`stateDir` 是所有实例的存储根目录；每个主会话使用其下 `sessions/<会话ID哈希>`，独立数据库、任务、队列、提示词、模型和远端来源配置。新的 Superagent 会话直接进入本地模式，不需要转交或手工更改状态目录。面板明确选择当前要管理的实例，切换后请求只发送到对应会话接口。暂停、重启或释放一个实例不改变其他实例。结束一轮对话或切换界面不停止后台处理；释放该 Agent 或停用插件时停止运行、保存队列并释放锁，重新加载原 Router 恢复。关闭浏览器不等同于释放 Agent。

## Windows 与工作目录

支持 Windows 盘符、UNC、空格和中文路径。GitHub CLI 可为原生程序或 `.cmd/.bat/.ps1` 包装脚本；推荐使用专属配置目录登录的 CLI。Worker 命令通过部署自己的 PATH、Git 配置及账号包装执行，普通会话与 DSH 主进程环境保持原值。

Execution 中的 `prepare` 在 Windows 用 PowerShell，Linux 用 `sh`。例如 Windows 从现有本地克隆创建任务工作树：

```powershell
git -C 'H:\GitHub\widgets' worktree add -b $env:DSH_SUPERAGENT_NAME $env:DSH_SUPERAGENT_DIR
```

具体可用变量以面板显示为准。已有 Linux prepare 命令不会自动翻译为 PowerShell，迁移机器时需更新该字段。Worker 及其子智能体的 shell 使用所属实例的专用执行作用域，Router 无 shell；不修改标准预设，也不改变整个进程的 `process.env`。账号包装是默认账号选择和命令限制，不是 OS 级隔离。

## 升级

先备份旧 stateDir，再停用旧插件，构建并加载本分支。数据库仍使用原版 schema 11，已有 schema 10 迁移继续保留，新增绑定及幂等索引使用 KV。0.3.0 为每个会话创建独立存储；升级前单部署数据库和历史文件原地保留，不自动复制到每个新会话，以免把同一队列重复执行。旧数据不会删除；新实例默认从独立的本地配置开始。

本地来源的授权由当前主会话接入边界提供。不要将不可信文本写成 DSH 原生用户事件。会话日志和本地数据库需沿用 DSH 的文件访问控制。

## 验证范围

本项目包含原版回归与新增 Router 集成、真实 Windows CLI 和环境测试。部署测试使用模拟模型和远端，不发送真实 GitHub 评论或创建 PR；真实飞书、模型服务和安装后图标/界面需要在目标部署中验证。旧 POSIX tmux 服务脚本保留为 Linux 运维入口，Windows 使用 Desktop 的进程生命周期。
