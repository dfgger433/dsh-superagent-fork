# Changelog

## 0.4.2 — Desktop Subagent recovery compatibility

- Remove every call to the unavailable `listChildren()` method from Ticket execution.
- Determine whether a native Ticket child exists with cold-safe Session Persistence `stat()`; retries no longer depend on subagent catalog traversal.
- Stop live direct child agents from the Agent registry and drain their descendants by ID.

## 0.4.1 — Desktop Subagent API compatibility

- Use the Desktop 0.2.2-rc.3 `listDescendants()` contract where catalog discovery is needed; do not call the unavailable `listChildren()` method.
- Filter by direct depth and running activity before stopping team members, preserving settled catalog entries and cold-resume discovery.
- Check the target local Ticket's failed launch and report can now be retried after upgrading the plugin.

## 0.4.0 — Session-native local execution and global management

- The homepage Superagent panel is now a profile-wide settings surface. It manages shared Sources, policy, models, execution defaults and prompt revisions without selecting or managing a local conversation.
- Local Ticket executors are native DSH subagents of their owning Superagent Session, so their task conversation, tools, reports and child-team activity appear in the DSH Session/subagent views. Remote deployments retain standalone Worker Sessions.
- Ticket stores, chat intake, queues, Source cursors and execution state remain isolated per Superagent Session. Shared configuration is stored separately and propagated to active instances.
- Existing local Worker Sessions are not silently re-parented; their Ticket identities remain legacy-compatible until a new assignment creates a native child.

## 0.3.3 — Deep runtime and Worker composition verification

- Roll back partially constructed Runtime listeners and Source registrations before closing its database and lock.
- Observe asynchronous Agent-scope Worker composition disposers so failures cannot become unhandled rejections.
- Keep the final build split into independent Host entries; import Worker shell execution-scope directly rather than leaking its private exports across a stable HMR-cached entry.
- Validate that the installed Worker dependency modules resolve in the running Desktop archive.

## 0.3.2 — Deep-scan lifecycle and Router-boundary fixes

- Serialize per-Session release/restart and revalidate the live Agent generation before remounting; disposing a Router while it restarts can no longer resurrect it.
- Clear Runtime registry entries and root capability guards in `finally`, even when instance shutdown rejects. Runtime shutdown now attempts every cleanup phase before reporting aggregated failures.
- Roll back Source/chat disposers when Runtime construction fails synchronously.
- Ignore global Worker lifecycle events for Tickets not owned by the receiving Runtime, preventing foreign-session activity from polluting another instance's in-memory state or scheduling background work.
- Bind Router authorization to the exact registered tool implementation, not only its name, to reject same-name scoped overrides.
- Preserve an explicitly configured local `prepare` command when the selected output directory equals the Router project.
- Track asynchronous Agent-scope composition disposal failures immediately instead of leaving cleanup rejections unobserved.

## 0.3.0 — Independent Superagent per conversation

- Every root Superagent Session starts its own instance automatically, with a deterministic private state directory, SQLite store, settings, prompts, Sources and queues.
- Different instances start concurrently. Pausing, restarting or releasing one does not transfer or stop another.
- Namespace Ticket/Worker identities by Router Session, even for identical external events at identical timestamps. Resolve Worker environments through a shared lookup-only coordinator; isolate each Runtime service provider.
- Scope management APIs by Session ID. The panel explicitly selects an instance and rebuilds its request/poll scope on switch; no mutable global selected-session transport.
- Keep the one safe Superagent preset and exact Router tool guard. Remote Sources mount inside each instance rather than consuming one global Runtime.
- Keep the previous single-deployment database intact. New isolated instances begin with private local defaults; old queues are not copied and replayed into every conversation.

## 0.2.3 — One Superagent preset and strict Router tools

- Expose only one **Superagent** preset. Worker and child-worker capabilities are internal per-Agent compositions, mounted after Ticket ownership is verified.
- Remove all filesystem, Shell, jobs and delegation tools from the public preset. Every root Router hides inherited tools and uses an exact dispatch allowlist, including protection against write/command tools registered locally by other plugins.
- Migrate live root conversations mistakenly created under the old Worker preset to the safe Superagent composition; real Worker sessions remain Ticket-bound.
- Remove Router execution-environment access. A Router can read Ticket resources and route requests, but cannot edit project files or run implementation commands.
- Build Host entries independently to prevent cached private-export mismatches during plugin reload; preserve CLI error branding across independently evaluated entries.

## 0.2.2 — Standalone local execution

- Router Sessions work without GitHub, Feishu, Git or remote accounts. Empty GitHub configuration or an explicitly disabled GitHub Source selects local mode.
- Local Workers use the Router project directory by default, including non-Git projects, and retain local Git configuration. Independent tasks run in one slot to avoid shared-directory edit races.
- Local mode performs no account probes, remote polling or member synchronization. Source command wrappers refuse remote CLIs, while remote deployments retain their existing account isolation and admission rules.
- Add local role/team defaults and local completion reports; default prompts require no PR or remote review. User-authored team text remains in force.
- Preserve incomplete remote-configuration errors and allow explicit remote configuration to switch back to connected operation.

## 0.2.1 — Fresh installation activation fix

- Fix Host startup failure when the bundle is installed without `stateDir`: default to `<DSH_PROFILE_DIR>/superagent`, or the equivalent profile path under DSH_HOME. Installation remains idle until a Router is used.
- Declare Runtime child-plugin service dependencies so Cordis permits access to subprocess, sessions and other Host services.
- Keep the main panel and Plugin Manager configuration usable during inactive or failed activation; show diagnostics and allow state-directory repair without requiring a working deployment API.
- Allow explicit same-origin transfer of an empty deployment to the intended Router Session; refuse transfer when Tickets exist.
- Remove the duplicated main-session navigation button that could produce an unhandled missing-session error.
- Add an unmocked Host + Runtime first-install test checking Router tools and HTTP settings routes before GitHub setup.

## 0.2.0 — Router preset fork

### Changed

- Selecting **Superagent Router** binds each user's root conversation as its own independent deployment instance. Bundle installation and eager preset loading stay idle.
- State databases and queues are isolated per root Session ID, allowing several Routers to run concurrently without sharing Runtime services.
- Worker subprocess environments are scoped to Superagent Router, Worker and worker-child compositions instead of changing the DSH process environment.
- Windows supports native absolute paths, PowerShell prepare commands and Windows CLI wrappers. Linux shell execution remains available.
- Requires DSH `^0.2.2-rc.3`; package version moves from the prototype's 0.1 series because activation and main-session ownership changed.

### Added

- Verified local message intake and recent-message tools. Requests use persisted user IDs; each task has an independent local thread and explicit follow-up association.
- Local source channel for acknowledgements, questions and results through the Router.
- Host activation status and panel guidance when inactive, plus a dedicated worker-child execution preset.
- Router lifecycle and integration tests, Windows command/environment smoke tests, and Chinese setup/migration documentation.

### Preserved

GitHub and optional Feishu sources, policy admission, Tickets, Worker concurrency and subagents, durable Effects and Outbox, subscriptions, prompts, management panel, stop/retry and assignment recovery.

### Migration

Back up the old state directory before loading the Router preset fork. Existing records and pending effects remain; the independent-session design keeps prior state and does not copy it into every new Session. Windows prepare commands must use PowerShell syntax. See [the Router guide](ROUTER.zh.md).
