# 实施计划：预设驱动 Superagent Router

基线：8c32a9d；分支：feature/preset-router；工作树：根目录下 superagent-router。

## 已确认
- 当前 Windows Desktop (DSH 0.2.2-rc.3) 为首要目标，保留 Linux。
- 每个 stateDir 一个 Router，用户实际选择预设才启用，绑定用户主会话。
- 保留原版授权、Tickets、Workers、来源、持久队列、面板与恢复。
- 所有代码及记录位于此工作树；最终提交推送 fork 新分支。

## 顺序
1. 轻量 Host 生命周期协调器和预设门控；绑定、竞争、恢复、停机。
2. 真实本地用户消息接入，幂等独立线程及任务关联。
3. Windows 执行和 scoped 环境，消除全局 process.env 修改。
4. 面板状态、安装文档、打包元数据与升级说明。
5. typecheck、Vitest、构建、隔离 smoke，审查 diff，提交推送核对远端 SHA。

## 验收
未使用预设无后台活动；用户主会话是唯一 Router；本地请求和远端消息统一路由；Worker 执行结果返回；普通预设不受影响；重启不重复投递；Windows 路径和执行通过；原版回归通过。

## 验证边界
不自动安装至当前 profile，不创建远端测试评论/PR。真实模型、飞书及外部写入未执行时明确记录。
