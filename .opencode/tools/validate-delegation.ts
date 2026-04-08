import { readFileSync } from "node:fs"
import path from "node:path"
import YAML from "yaml"
import { tool, type ToolContext } from "@opencode-ai/plugin"

interface ValidationResult {
  allowed: boolean
  allowed_targets: string[]
  message: string
}

interface ActiveCrew {
  crew: string
  source_config: string
}

interface CrewConfig {
  id: string
  runtime_overrides?: {
    opencode?: {
      permission?: {
        task?: {
          allow_delegate?: Record<string, string[]>
        }
      }
    }
  }
}

interface MetaAgentsConfig {
  crews?: CrewConfig[]
}

export default tool({
  description: "Validates whether a delegation target is allowed under the current crew hierarchy. Must be called before any Task call.",
  args: {
    delegator: tool.schema.string().default("orchestrator"),
    target: tool.schema.string()
  },
  async execute(args, _context: ToolContext): Promise<string> {
    const { delegator = "orchestrator", target } = args

    if (!target) {
      return JSON.stringify({
        allowed: false,
        allowed_targets: [],
        message: "No delegation target specified."
      } satisfies ValidationResult)
    }

    try {
      // Read active crew to determine which crew is running
      const activeCrewPath = path.join(process.cwd(), ".opencode", ".active-crew.json")
      const activeCrewRaw = readFileSync(activeCrewPath, "utf-8")
      const activeCrew: ActiveCrew = JSON.parse(activeCrewRaw)
      const activeCrewName = activeCrew.crew

      // Read meta-agents.yaml to get delegation rules
      const metaAgentsPath = path.join(process.cwd(), "meta-agents.yaml")
      const metaAgentsRaw = readFileSync(metaAgentsPath, "utf-8")
      const metaAgentsConfig: MetaAgentsConfig = YAML.parse(metaAgentsRaw)

      // Find the crew config for the active crew
      const crewConfig = metaAgentsConfig.crews?.find((c) => c.id === activeCrewName)
      const allowDelegate = crewConfig?.runtime_overrides?.opencode?.permission?.task?.allow_delegate

      if (!allowDelegate) {
        return JSON.stringify({
          allowed: false,
          allowed_targets: [],
          message: `No delegation rules found for crew "${activeCrewName}".`
        } satisfies ValidationResult)
      }

      // Get allowed targets for the delegator
      const allowedTargets = allowDelegate[delegator] ?? []

      // Special case: orchestrator can only delegate to leads in dev crew
      if (delegator === "orchestrator" && activeCrewName === "dev") {
        const leads = ["planning-lead", "engineering-lead", "validation-lead"]
        const isLead = leads.includes(target)

        if (!isLead) {
          return JSON.stringify({
            allowed: false,
            allowed_targets: leads,
            message: `Direct delegation from orchestrator to worker "${target}" is not allowed. Workers must be accessed through their respective leads.`
          } satisfies ValidationResult)
        }
      }

      // Check if target is in allowed list
      const isAllowed = allowedTargets.includes(target)

      if (isAllowed) {
        return JSON.stringify({
          allowed: true,
          allowed_targets: allowedTargets,
          message: `Delegation to "${target}" is allowed.`
        } satisfies ValidationResult)
      }

      return JSON.stringify({
        allowed: false,
        allowed_targets: allowedTargets,
        message: `Target "${target}" is not in the allowed delegation targets for "${delegator}". Allowed targets: ${allowedTargets.join(", ")}`
      } satisfies ValidationResult)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      return JSON.stringify({
        allowed: false,
        allowed_targets: [],
        message: `Validation failed: ${errorMessage}`
      } satisfies ValidationResult)
    }
  }
})
