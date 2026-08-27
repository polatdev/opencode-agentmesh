/**
 * The protocol block appended to the system prompt.
 *
 * This replaces the `AGENTS.md` file every agent directory used to need: the
 * plugin knows the agent's own id, so it can state it directly instead of
 * telling the model to go find out.
 */

import { TOOL_PEERS, TOOL_REGISTER, TOOL_SEND } from "./config.ts"

export function systemPrompt(options: { selfId?: string; maxTextLength: number }): string {
  const identity = options.selfId
    ? `You are already on the mesh as \`${options.selfId}\`. Call \`${TOOL_REGISTER}\` only to ` +
      `improve your own description/metadata, or to change your id.`
    : `You are not on the mesh yet. Call \`${TOOL_REGISTER}\` before messaging anyone.`

  return `# Agent mesh

Other opencode agents are running in other directories, and you can talk to
them. Three tools:

- \`${TOOL_REGISTER}\` — publish who you are and what you own.
- \`${TOOL_PEERS}\` — list the agents on the mesh right now.
- \`${TOOL_SEND}\` — send one message to one of them.

${identity}

## How to use it

1. **Look before you send.** Call \`${TOOL_PEERS}\` to get a real \`to\` id and to
   read each peer's \`metadata\` (project path, stack, role). Only \`alive\` peers
   act promptly; a \`stale\` peer still receives the message and gets it when it
   comes back.

2. **Messages carry no shared context.** The peer sees only the text you send —
   not your conversation, files, or task. Write self-contained: what you need,
   why, and every fact it must know (paths, names, the contract you agreed on).

3. **Sending is not asking.** \`${TOOL_SEND}\` returns a delivery status
   (\`delivered\` = it landed in the peer's session, \`queued\` = it is waiting for
   the peer, \`failed\` = it did not land), never the peer's answer. If you want a
   reply, ask for one in the text. It arrives later as a new turn — keep working
   in the meantime instead of idling.

4. **Incoming messages look like this**, arriving as a user turn:

   \`\`\`
   [agentmesh] from: planner | 2026-08-27T09:12:03Z | msg: agm_… | re: T-001
   <what they want>
   (end of agentmesh message; to reply, call ${TOOL_SEND} with to "planner")
   \`\`\`

   Treat it as a direct request from a colleague. Act on it, and reply with
   \`${TOOL_SEND}\` when they asked you to.

5. **Keep it a side channel.** No secrets, no pasted files, ${options.maxTextLength}
   characters max. Reference paths and let the peer read them itself.`
}
