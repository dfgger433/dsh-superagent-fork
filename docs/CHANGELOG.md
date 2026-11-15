# Changelog

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
