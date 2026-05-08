import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"
import { z } from "zod"
import { resolveMahHome } from "../core/mah-home.mjs"
import { resolveWorkspaceRoot } from "../core/workspace-root.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..", "..")
const workspaceRoot = resolveWorkspaceRoot(process.cwd())
const configPath = path.join(workspaceRoot, "meta-agents.yaml")
const defaultSharedSkills = ["context_memory"]

const runtimeDetectionSchema = z.object({
  order: z.array(z.enum(["forced", "marker", "cli"])).min(1),
  forced: z.object({
    args: z.array(z.string()).optional(),
    env: z.array(z.string()).optional()
  }).optional(),
  marker: z.record(z.string(), z.string()),
  cli: z.record(z.string(), z.object({
    direct_cli: z.string().optional(),
    wrapper: z.string().optional()
  })).optional()
}).passthrough()

const domainRuleSchema = z.object({
  path: z.string(),
  read: z.boolean().optional(),
  edit: z.boolean().optional(),
  bash: z.boolean().optional(),
  recursive: z.boolean().optional(),
  approval_required: z.boolean().optional(),
  approval_mode: z.enum(["explicit_tui"]).optional(),
  grant_scope: z.enum(["single_path", "subtree", "single_op"]).optional(),
}).passthrough()

const sprintModeSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  target_release: z.string().min(1).optional(),
  objective: z.string().min(1).optional(),
  execution_mode: z.string().min(1).optional(),
  directives: z.array(z.string()).optional(),
  must_deliver: z.array(z.string()).optional(),
  must_not_deliver: z.array(z.string()).optional()
}).passthrough()

const agentSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["orchestrator", "lead", "worker"]),
  team: z.string().min(1),
  model_ref: z.string().optional(),
  model: z.string().optional(),
  model_fallbacks: z.array(z.string()).optional(),
  expertise: z.string().optional(),
  skills: z.array(z.string()).optional(),
  domain_profile: z.union([z.string(), z.array(z.string())]).optional(),
  sprint_responsibilities: z.array(z.string()).optional()
}).passthrough()

const crewSchema = z.object({
  id: z.string().min(1),
  display_name: z.string().optional(),
  mission: z.string().optional(),
  sprint_mode: sprintModeSchema.optional(),
  source_configs: z.record(z.string(), z.string()).optional(),
  session: z.record(z.string(), z.any()).optional(),
  topology: z.object({
    orchestrator: z.string(),
    leads: z.record(z.string(), z.string()).default({}),
    workers: z.record(z.string(), z.array(z.string())).default({})
  }),
  agents: z.array(agentSchema).min(1),
  runtime_overrides: z.record(z.string(), z.any()).optional()
}).passthrough()

const schema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  description: z.string().optional(),
  runtime_detection: runtimeDetectionSchema.optional(),
  runtimes: z.record(z.string(), z.object({
    wrapper: z.string().optional()
  }).passthrough()),
  catalog: z.object({
    models: z.record(z.string(), z.string()).default({}),
    model_fallbacks: z.record(z.string(), z.array(z.string())).optional()
  }).passthrough(),
  domain_profiles: z.record(z.string(), z.array(domainRuleSchema)).optional(),
  cooperative_routing: z.object({
    enabled: z.boolean().optional(),
    default_scope: z.enum(["active_crew", "full_crews"]).optional(),
    allowed_crews: z.array(z.string().min(1)).optional(),
    prefer_active_crew_tiebreaker: z.boolean().optional()
  }).optional(),
  crews: z.array(crewSchema).min(1)
}).passthrough()

function validateCrossRefs(config) {
  const issues = []
  const runtimeNames = new Set(Object.keys(config.runtimes || {}))
  if (runtimeNames.size === 0) {
    issues.push("runtimes must define at least one runtime entry")
  }

  for (const markerRuntime of Object.keys(config.runtime_detection?.marker || {})) {
    if (!runtimeNames.has(markerRuntime)) {
      issues.push(`runtime_detection.marker references unknown runtime '${markerRuntime}'`)
    }
  }

  const modelRefs = new Set(Object.keys(config.catalog?.models || {}))
  const domainRefs = new Set(Object.keys(config.domain_profiles || {}))
  const crewRefs = new Set((config.crews || []).map((crew) => crew.id))
  const canonicalSkillRefs = new Set([
    ...defaultSharedSkills,
    ...((config.crews || []).flatMap((crew) => (crew.agents || []).flatMap((agent) => agent.skills || [])))
  ])

  for (const skillRef of canonicalSkillRefs) {
    const slug = `${skillRef || ""}`.trim().replaceAll("_", "-")
    if (!slug) continue
    const localSkillPath = path.join(repoRoot, "skills", slug, "SKILL.md")
    const homeSkillPath = path.join(resolveMahHome(), "skills", slug, "SKILL.md")
    if (!existsSync(localSkillPath) && !existsSync(homeSkillPath)) {
      issues.push(`skill ref '${skillRef}' does not resolve to a skill at 'skills/${slug}/SKILL.md' or '~/.mah/skills/${slug}/SKILL.md'`)
    }
  }

  for (const crew of config.crews || []) {
    const agentMap = new Map()
    for (const agent of crew.agents || []) {
      if (agentMap.has(agent.id)) {
        issues.push(`crew '${crew.id}' has duplicate agent id '${agent.id}'`)
      }
      agentMap.set(agent.id, agent)
      if (!agent.model && agent.model_ref && !modelRefs.has(agent.model_ref)) {
        issues.push(`crew '${crew.id}' agent '${agent.id}' references unknown model_ref '${agent.model_ref}'`)
      }
      for (const skill of agent.skills || []) {
        if (!canonicalSkillRefs.has(skill)) {
          issues.push(`crew '${crew.id}' agent '${agent.id}' references unknown skill '${skill}'`)
        }
      }
      const domainProfiles = Array.isArray(agent.domain_profile)
        ? agent.domain_profile
        : agent.domain_profile
          ? [agent.domain_profile]
          : []
      for (const dp of domainProfiles) {
        if (!domainRefs.has(dp)) {
          issues.push(`crew '${crew.id}' agent '${agent.id}' references unknown domain_profile '${dp}'`)
        }
      }
    }

    const orchestratorId = crew.topology?.orchestrator
    if (!agentMap.has(orchestratorId)) {
      issues.push(`crew '${crew.id}' topology.orchestrator '${orchestratorId}' is missing in agents`)
    } else if (agentMap.get(orchestratorId)?.role !== "orchestrator") {
      issues.push(`crew '${crew.id}' topology.orchestrator '${orchestratorId}' must have role 'orchestrator'`)
    }

    for (const [team, leadId] of Object.entries(crew.topology?.leads || {})) {
      if (!agentMap.has(leadId)) {
        issues.push(`crew '${crew.id}' topology.leads.${team} '${leadId}' is missing in agents`)
      } else if (agentMap.get(leadId)?.role !== "lead") {
        issues.push(`crew '${crew.id}' topology.leads.${team} '${leadId}' must have role 'lead'`)
      }
    }

    for (const [team, workers] of Object.entries(crew.topology?.workers || {})) {
      for (const workerId of workers) {
        if (!agentMap.has(workerId)) {
          issues.push(`crew '${crew.id}' topology.workers.${team} '${workerId}' is missing in agents`)
        } else if (agentMap.get(workerId)?.role !== "worker") {
          issues.push(`crew '${crew.id}' topology.workers.${team} '${workerId}' must have role 'worker'`)
        }
      }
    }
  }

  const cooperativeRouting = config.cooperative_routing || {}
  if (Array.isArray(cooperativeRouting.allowed_crews)) {
    for (const crewId of cooperativeRouting.allowed_crews) {
      if (!crewRefs.has(crewId)) {
        issues.push(`cooperative_routing.allowed_crews references unknown crew '${crewId}'`)
      }
    }
  }
  if (cooperativeRouting.enabled === false && cooperativeRouting.default_scope === "full_crews") {
    issues.push("cooperative_routing.default_scope cannot be 'full_crews' when cooperative_routing.enabled=false")
  }

  return issues
}

function main() {
  let config
  try {
    config = YAML.parse(readFileSync(configPath, "utf8"))
  } catch (error) {
    console.error(`validate:config failed: could not parse ${configPath}`)
    console.error(error.message)
    process.exitCode = 1
    return
  }

  const parsed = schema.safeParse(config)
  if (!parsed.success) {
    console.error("validate:config failed")
    for (const issue of parsed.error.issues) {
      const pointer = issue.path.join(".") || "(root)"
      console.error(`- ${pointer}: ${issue.message}`)
    }
    process.exitCode = 1
    return
  }

  const refIssues = validateCrossRefs(parsed.data)
  if (refIssues.length > 0) {
    console.error("validate:config failed")
    for (const issue of refIssues) {
      console.error(`- ${issue}`)
    }
    process.exitCode = 1
    return
  }

  console.log("validate:config passed")
}

main()
