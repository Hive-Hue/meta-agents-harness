import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const opencodeRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(opencodeRoot, "..")
const configPath = path.join(opencodeRoot, "multi-team.yaml")

function titleFromId(id) {
  return id
    .split("-")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ")
}

function resolvePath(filePath) {
  if (path.isAbsolute(filePath)) return filePath
  return path.resolve(repoRoot, filePath)
}

function colorFor(agentId, teamName, role) {
  if (role === "ceo") return "accent"
  const team = (teamName || "").toLowerCase()
  if (role === "lead") {
    if (team === "planning") return "info"
    if (team === "engineering") return "warning"
    if (team === "validation") return "error"
    return "secondary"
  }
  if (agentId === "repo-analyst") return "secondary"
  if (agentId === "solution-architect") return "info"
  if (agentId === "frontend-dev" || agentId === "backend-dev") return "success"
  if (agentId === "qa-reviewer" || agentId === "security-reviewer") return "error"
  return "secondary"
}

function descriptionFor(agentId, role, teamName) {
  const team = teamName ? `${teamName} ` : ""
  if (role === "ceo") return "Top-level orchestrator that routes work to team leads and controls execution order."
  if (role === "lead") return `${team}lead responsible for delegation, synthesis, and team-level coordination.`
  if (agentId.endsWith("reviewer")) return `${team}worker focused on validation findings with evidence and risk rating.`
  return `${team}worker focused on scoped execution within assigned ownership boundaries.`
}

function permissionFromAgent(agent) {
  const tools = Array.isArray(agent.tools) ? agent.tools : []
  const routes = Array.isArray(agent.routes_to) ? agent.routes_to : []

  const permission = {
    edit: tools.includes("edit") ? "allow" : "deny",
    bash: tools.includes("bash") ? "ask" : "deny",
    task: {
      "*": "deny"
    }
  }

  for (const route of routes) {
    permission.task[route] = "allow"
  }
  return permission
}

function formatDomainLine(rule) {
  const flags = []
  if ("read" in rule) flags.push(`read: ${Boolean(rule.read)}`)
  if ("edit" in rule) flags.push(`edit: ${Boolean(rule.edit)}`)
  if ("bash" in rule) flags.push(`bash: ${Boolean(rule.bash)}`)
  return `- \`${rule.path}\` (${flags.join(", ")})`
}

function sectionLines(agent, context) {
  const team = context.teamName || "Global"
  const routes = Array.isArray(agent.routes_to) ? agent.routes_to : []
  const skills = Array.isArray(agent.skills) ? agent.skills : []
  const tools = Array.isArray(agent.tools) ? agent.tools : []
  const mcp = Array.isArray(agent.mcp_access) ? agent.mcp_access : []
  const domains = Array.isArray(agent.domain) ? agent.domain : []

  const lines = []
  lines.push(`# ${titleFromId(agent.id)}`)
  lines.push("")
  lines.push(`Role: \`${agent.role}\``)
  lines.push(`Team: \`${team}\``)
  lines.push(`Model: \`${agent.model}\``)
  lines.push("")
  lines.push("## Mission")
  lines.push(descriptionFor(agent.id, agent.role, context.teamName))
  lines.push("")
  lines.push("## Expertise")
  lines.push(`- path: \`${agent.expertise?.path || ""}\``)
  lines.push(`- use-when: ${agent.expertise?.use_when || "At task boundaries and after meaningful new learnings."}`)
  lines.push("")
  lines.push("## Skills")
  if (skills.length === 0) {
    lines.push("- none")
  } else {
    for (const skill of skills) {
      lines.push(`- path: \`${skill.path}\` | use-when: ${skill.use_when || "When relevant to current task."}`)
    }
  }
  lines.push("")
  lines.push("## Tools")
  if (tools.length === 0) {
    lines.push("- none")
  } else {
    for (const toolName of tools) lines.push(`- ${toolName}`)
  }
  lines.push("")
  lines.push("## MCP Access")
  if (mcp.length === 0) {
    lines.push("- none")
  } else {
    for (const item of mcp) lines.push(`- ${item}`)
  }
  lines.push("")
  lines.push("## Domain")
  if (domains.length === 0) {
    lines.push("- not defined")
  } else {
    for (const rule of domains) lines.push(formatDomainLine(rule))
  }
  lines.push("")
  lines.push("## Delegation")
  if (routes.length === 0) {
    lines.push("- Do not delegate further.")
  } else {
    lines.push(`- Allowed routes: ${routes.map((r) => `\`${r}\``).join(", ")}`)
    lines.push("- Delegate one bounded objective per task call.")
  }
  lines.push("")
  lines.push("## Operating Rules")
  lines.push("- Stay within ownership boundaries declared in `Domain`.")
  lines.push("- Return evidence with explicit file paths and concrete outcomes.")
  lines.push("- Avoid speculative claims; state assumptions clearly when needed.")
  if (tools.includes("update-expertise-model")) {
    lines.push("- Persist durable learnings using `update-expertise-model` after meaningful work.")
  }
  lines.push("")
  lines.push("## Response Contract")
  if (agent.role === "ceo") {
    lines.push("1. teams engaged")
    lines.push("2. concrete outputs by team")
    lines.push("3. residual risks and blockers")
    lines.push("4. recommended next routing step")
  } else if (agent.role === "lead") {
    lines.push("1. delegation summary")
    lines.push("2. worker outputs with artifacts")
    lines.push("3. unresolved risks or blockers")
    lines.push("4. handoff recommendation")
  } else {
    lines.push("1. execution summary")
    lines.push("2. changed files or evidence paths")
    lines.push("3. verification performed")
    lines.push("4. residual risks")
  }

  return lines.join("\n") + "\n"
}

function buildAgentMarkdown(agent, context) {
  const frontmatter = {
    description: descriptionFor(agent.id, agent.role, context.teamName),
    mode: agent.role === "ceo" ? "primary" : "subagent",
    temperature: 0.1,
    color: colorFor(agent.id, context.teamName, agent.role),
    permission: permissionFromAgent(agent)
  }

  const fm = YAML.stringify(frontmatter, { indent: 2 }).trimEnd()
  const body = sectionLines(agent, context)
  return `---\n${fm}\n---\n\n${body}`
}

function collectAgents(doc) {
  const results = []
  results.push({
    agent: doc.orchestrator,
    context: { teamName: null }
  })

  for (const team of doc.teams || []) {
    results.push({
      agent: team.lead,
      context: { teamName: team.name }
    })
    for (const member of team.members || []) {
      results.push({
        agent: member,
        context: { teamName: team.name }
      })
    }
  }
  return results
}

function main() {
  const checkOnly = process.argv.includes("--check")
  const raw = readFileSync(configPath, "utf-8")
  const doc = YAML.parse(raw)
  if (!doc?.orchestrator || !Array.isArray(doc?.teams)) {
    throw new Error("Invalid `.opencode/multi-team.yaml`: missing orchestrator or teams.")
  }

  const agents = collectAgents(doc)
  let drift = false
  for (const { agent, context } of agents) {
    if (!agent?.id || !agent?.agent_file) {
      throw new Error("Invalid agent entry: missing `id` or `agent_file`.")
    }

    const outputPath = resolvePath(agent.agent_file)
    const markdown = buildAgentMarkdown(agent, context)

    if (checkOnly) {
      if (!existsSync(outputPath)) {
        drift = true
        console.log(`drift: missing file ${path.relative(repoRoot, outputPath)}`)
        continue
      }

      const current = readFileSync(outputPath, "utf-8")
      if (current !== markdown) {
        drift = true
        console.log(`drift: out-of-sync ${path.relative(repoRoot, outputPath)}`)
      } else {
        console.log(`ok: ${path.relative(repoRoot, outputPath)}`)
      }
      continue
    }

    mkdirSync(path.dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, markdown, "utf-8")
    console.log(`synced: ${path.relative(repoRoot, outputPath)}`)
  }

  if (checkOnly) {
    if (drift) {
      console.log("multi-team sync check failed: run `npm --prefix .opencode run sync:multi-team`")
      process.exitCode = 1
      return
    }
    console.log(`sync check passed for ${agents.length} agent files`)
    return
  }

  console.log(`synced ${agents.length} agent files from .opencode/multi-team.yaml`)
}

main()
