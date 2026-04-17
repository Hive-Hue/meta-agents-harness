import { appendFileSync } from "node:fs"
import process from "node:process"
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { getActiveContextHandler } from "./handlers/get-active-context.mjs"
import { listAgentsHandler } from "./handlers/list-agents.mjs"
import { delegateAgentHandler } from "./handlers/delegate-agent.mjs"

const DEBUG_LOG = "/tmp/mah-mcp-debug.log"

function debug(direction, payload) {
  try {
    appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${direction} ${JSON.stringify(payload)}\n`)
  } catch {
    // Ignore debug logging failures.
  }
}

function asTextResult(result) {
  debug("result", result)
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ]
  }
}

const server = new McpServer({
  name: "mah-codex-plugin",
  version: "0.7.0"
})

server.registerTool(
  "mah_get_active_context",
  {
    description: "Return the active MAH Codex crew context, including crew, agent, role, team, sprint metadata, and resolution sources.",
    inputSchema: {}
  },
  async () => {
    const result = await getActiveContextHandler({}, {})
    return asTextResult(result)
  }
)

server.registerTool(
  "mah_list_agents",
  {
    description: "List the active crew topology and the valid delegation targets from the current agent.",
    inputSchema: {}
  },
  async () => {
    const result = await listAgentsHandler({}, {})
    return asTextResult(result)
  }
)

server.registerTool(
  "mah_delegate_agent",
  {
    description: "Delegate a bounded task through the MAH delegation pipeline using the active crew graph.",
    inputSchema: {
      target: z.string().min(1).describe("Target lead or worker name."),
      task: z.string().min(1).describe("Focused delegation task."),
      target_runtime: z.string().min(1).optional().describe("Optional runtime hint for where the delegated subagent should execute (for example: codex, hermes, pi)."),
      include_full_output: z.boolean().optional().describe("Include the full command output in the result.")
    }
  },
  async ({ target, task, target_runtime, include_full_output }) => {
    const result = await delegateAgentHandler(
      {
        target,
        task,
        target_runtime,
        include_full_output
      },
      {}
    )
    return asTextResult(result)
  }
)

const transport = new StdioServerTransport()

debug("startup", {
  cwd: process.cwd(),
  pid: process.pid,
  argv: process.argv
})

process.stdin.resume()
await server.connect(transport)
