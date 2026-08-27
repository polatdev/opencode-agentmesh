# opencode-agentmesh

[![npm version](https://img.shields.io/npm/v/opencode-agentmesh.svg)](https://www.npmjs.com/package/opencode-agentmesh)
[![license](https://img.shields.io/npm/l/opencode-agentmesh.svg)](https://github.com/polatdev/opencode-agentmesh/blob/main/LICENSE)

Peer-to-peer messaging between [opencode](https://opencode.ai) agents running in
different sessions, directories, or even different servers.

It's a plugin, not an MCP server, not an app. There is **no daemon, no port, and
no config server** to run — coordination happens entirely through a shared
directory on disk. Install it, and any two opencode sessions that load it can
discover each other and exchange messages, whether they're two terminals on
your laptop or two sessions on different machines pointed at the same shared
folder.

## Why

If you run multiple opencode sessions side by side — one per repo, one per
service, one for planning and others for implementation — they have no way to
coordinate. `opencode-agentmesh` gives each session three tools so they can
find each other and talk, without you copy-pasting between terminals.

## Install

Add it to your `opencode.json` (global `~/.config/opencode/opencode.json` or
per-project):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-agentmesh"
  ]
}
```

opencode installs npm plugins automatically at startup — there is nothing to
`npm install` yourself. To pin a fixed agent id or tune the defaults, use the
tuple form:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-agentmesh",
      {
        "id": "api-gateway"
      }
    ]
  ]
}
```

## How it works

Every session that loads the plugin registers itself on the mesh the moment
you send your first message, and gets three tools:

| Tool                 | Purpose                                                                                                                                                    |
|----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `agentmesh_register` | Publish this agent's id, description, and metadata so peers can find it. Called automatically; call it again to update your description or change your id. |
| `agentmesh_peers`    | List every agent on the mesh right now: id, description, metadata, `alive`/`stale` status, last seen, directory.                                           |
| `agentmesh_send`     | Send one message to a peer by id. It's injected into that peer's own opencode session as a new user turn.                                                  |

A message sent to a peer that's offline just waits — the recipient's own
plugin instance watches its inbox and delivers the message the moment it
comes back online. Sending never blocks on the recipient being reachable.

```
[agentmesh] from: planner | 2026-08-27T09:12:03Z | msg: agm_01… | re: T-001
review src/auth.ts please
(end of agentmesh message; to reply, call agentmesh_send with to "planner")
```

That's what shows up as a new turn in the recipient's session — no polling,
no manual relay.

### No daemon, just files

Every agent's plugin instance coordinates through one shared home directory
(default `~/.local/share/opencode-agentmesh`, or `$XDG_DATA_HOME/opencode-agentmesh`):

```
<home>/agents/<id>.json         one record per agent, written only by its owner
<home>/inbox/<id>/<msgid>.json  queued messages for <id>, written by senders
<home>/acks/<msgid>.json        delivery confirmation, written by the recipient
```

Each agent only ever writes its own record and its own acks, and a sender only
ever writes into the recipient's inbox — so there is nothing to lock. Liveness
is a heartbeat (file mtime) plus a process check, so a killed opencode shows
up as stale immediately rather than lingering.

If your agents run on different machines, point `AGENTMESH_HOME` (see below)
at a directory synced or shared between them (e.g. a network mount).

## Configuration

Options can be passed via the plugin tuple, and every one has an environment
variable that overrides it (env > plugin options > defaults):

| Plugin option         | Env var                           | Default                                                                    | Description                                                                          |
|-----------------------|-----------------------------------|----------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| `id`                  | `AGENTMESH_ID`                    | derived from the worktree directory name                                   | Fixed agent id for this project.                                                     |
| `home`                | `AGENTMESH_HOME`                  | `$XDG_DATA_HOME/opencode-agentmesh` or `~/.local/share/opencode-agentmesh` | Mesh home directory.                                                                 |
| `autoRegister`        | `AGENTMESH_AUTO_REGISTER`         | `true`                                                                     | Register automatically on the first user message.                                    |
| `injectSystemPrompt`  | `AGENTMESH_INJECT_SYSTEM_PROMPT`  | `true`                                                                     | Append the mesh protocol explanation to the system prompt.                           |
| `heartbeatIntervalMs` | `AGENTMESH_HEARTBEAT_INTERVAL_MS` | `15000`                                                                    | How often a registered agent refreshes its liveness.                                 |
| `staleAfterMs`        | `AGENTMESH_STALE_AFTER_MS`        | `60000`                                                                    | No heartbeat for this long → agent shows as `stale`.                                 |
| `expireAfterMs`       | `AGENTMESH_EXPIRE_AFTER_MS`       | `300000`                                                                   | No heartbeat for this long → agent's record is dropped entirely.                     |
| `ackWaitMs`           | `AGENTMESH_ACK_WAIT_MS`           | `3000`                                                                     | How long `agentmesh_send` waits for delivery confirmation before returning `queued`. |
| `pollIntervalMs`      | `AGENTMESH_POLL_INTERVAL_MS`      | `2000`                                                                     | Inbox poll interval, as a fallback for missed filesystem events.                     |
| `maxTextLength`       | `AGENTMESH_MAX_TEXT_LENGTH`       | `8000`                                                                     | Maximum message body length, in characters.                                          |

`AGENTMESH_DEBUG=1` enables info-level logging to stderr.

## Requirements

- opencode
- Node.js >= 22 (only matters if you're developing the plugin itself; end
  users just add it to `opencode.json`)

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test on test/*.test.ts
npm run build        # emits dist/
```

See [AGENTS.md](./AGENTS.md) for architecture notes and conventions if you're
contributing.

## License

MIT © [Abdulkadir Polat](https://github.com/polatdev)
