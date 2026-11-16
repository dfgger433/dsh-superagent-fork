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

新建 DSH 会话并选择 **Superagent**。每个主会话都会自动创建独立的 Superagent Runtime；本地任务与聊天始终留在该会话。主页 Superagent 面板只管理 profile 级共享设置（来源、策略、模型、执行默认值和团队提示词），不列出、不切换也不管理本地会话。安装、启用插件或加载预设定义不会启动来源监听或自动创建主会话。普通预设不获得这些功能。从 0.4.0 起，来源配置与策略等设置在各实例间共享；Ticket、聊天、来源游标、队列和执行状态仍按会话隔离。若多个实例监听同一个 GitHub 仓库，它们会分别收到事件并可能独立创建工单；需要避免重复远端处理时，只在一个实例开启该来源。

Superagent 主页面板集中管理共享策略、GitHub/飞书来源、模型、执行默认值和提示词。GitHub 请求仍按来源名单与策略授权，本地会话操作员单独授权；飞书默认关闭。外部事件不能冒充本地用户。

## 角色与工具权限

插件只提供一个用户可选预设 **Superagent**。Router 会话仅拥有已注册的路由、消息和任务状态工具，没有 read/write/edit、bash/pwsh、后台作业或任意子智能体工具；Host 的精确工具 guard 还会拒绝其他插件在当前 Agent 上新增的命令/写入工具。Local Ticket 执行器以 DSH 原生子代理形式挂在 Router 会话下，Agent 创建的异步装饰会在首条任务消息前完成；文件、Shell、作业和子代理工具只动态加载到已确认 Ticket 归属的子代理。远端部署继续使用独立 Worker Session。

旧版本中误选“执行器”预设的已加载主会话会迁移为安全 Router。任务通过会话中的 Router 创建 Ticket；本地执行器及其团队成员显示在该会话的子代理视图。

## 本地独立使用

选择 Superagent 后直接提出本地任务即可，不需要连接远端。GitHub 仓库与 CLI 全空，或显式关闭 GitHub 来源时，部署使用本地模式；GitHub/飞书轮询与成员同步均不启动，也不会探测账号或执行 Git 验证。

默认本地子代理使用 Router 会话的项目目录，即使它不是 Git 仓库也能工作；保持本机 Git 身份配置，不强制提交、PR 或远端审查。独立任务以一个槽位串行执行，避免共享项目目录被并发修改。需要自定义准备目录时仍可在主页 Execution 设置里配置 directory/prepare。

本地任务使用本地角色提示词和本地交付标准；团队提示词由主页统一维护。完成后子代理记录 Ticket 报告，Router 在当前会话汇总结果。

## 交互与执行

直接在 Superagent 会话窗口提出任务。Router 通过已记录的消息 ID 接入请求，生成 Ticket 并交给本会话的原生子代理；闲聊直接回复。多个任务使用独立本地线程，补充指令显式关联对应 Ticket。Worker 问题、结果和团队成员进度呈现在同一会话的子代理/智能体团队视图；GitHub/飞书回复仍发送至原渠道。

Router 负责交流、评估、路由与结果解释，Ticket 子代理负责调查、计划和实现。暂停、停止、重试、持久队列及失败恢复仍由 Ticket Engine 管理。子代理 Session 与 Ticket/Router 有同一存储生命周期，但每个 Router 的 Ticket、队列、提示词版本绑定、来源游标和执行状态相互隔离。

`stateDir` 是 profile 级数据根目录；全局设置库位于 `global-config/settings.sqlite`，每个 Superagent 会话的 Ticket 数据仍在 `sessions/<会话ID哈希>` 下独立保存。首次升级时，若全局库为空，将从首个启用的 Runtime 复制设置/提示词版本；其他旧会话的分歧设置不会合并。已有独立 Worker Session 不会被删除或自动重新挂到新 Router；后续本地 Ticket 尝试以新的 `-subagent` 子会话 ID 执行，保留旧会话历史。

主页 Superagent 面板提供共享配置与提示词管理，不提供本地聊天、Ticket 浏览、暂停或会话选择。需要交流、查看任务和跟进子代理时，打开对应 Superagent 会话。

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
