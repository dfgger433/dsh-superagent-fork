# Changelog

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

Existing linked installations need a DSH restart to load the new Host module. Retain the selected Router Session and configure repository/account Sources after restart.

## 0.2.0 — Router preset fork

### Changed

- Selecting **Superagent Router** binds the user's root conversation as the deployment Router. Bundle installation and eager preset loading stay idle.
- Deployment ownership is durable and unique per state directory. A second Router is refused with the owner Session ID; reopening the owner resumes its queues.
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

Back up the state directory and stop the prototype before loading this bundle. Select the Router preset in the intended user conversation. Existing records and pending effects remain; the old automatic main-session ID is retained as legacy metadata. Windows prepare commands must use PowerShell syntax. See [the Router guide](ROUTER.zh.md).
