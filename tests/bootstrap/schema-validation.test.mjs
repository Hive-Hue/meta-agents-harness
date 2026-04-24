import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..", "..")
const bootstrapPath = path.join(repoRoot, "scripts", "bootstrap-meta-agents.mjs")

function bootstrap(args, cwd) {
  return spawnSync(process.execPath, [bootstrapPath, ...args], {
    cwd,
    env: process.env,
    encoding: "utf-8"
  })
}

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), "mah-bsv-"))
}

function readConfig(dir) {
  return YAML.parse(readFileSync(path.join(dir, "meta-agents.yaml"), "utf-8"))
}

test.describe("Schema Validation - Generated Structure", () => {
  test("SV-001: Minimal valid config generated with --non-interactive", () => {
    const tempDir = tmpDir()
    try {
      const result = bootstrap(["--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(existsSync(path.join(tempDir, "meta-agents.yaml")), true)
      const config = readConfig(tempDir)
      assert.equal(config.version, 1)
      assert.equal(typeof config.name, "string")
      assert.ok(config.name.length > 0)
      assert.equal(config.runtime_detection, undefined)
      assert.ok(config.runtimes)
      assert.ok(config.catalog)
      assert.ok(Array.isArray(config.crews) && config.crews.length >= 1)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("SV-002: Config with custom name via --name flag", () => {
    const tempDir = tmpDir()
    try {
      const result = bootstrap(["--non-interactive", "--name", "MyProject"], tempDir)
      assert.equal(result.status, 0, result.stderr)
      const config = readConfig(tempDir)
      assert.equal(config.name, "MyProject")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("SV-003: Config with custom description via --description flag", () => {
    const tempDir = tmpDir()
    try {
      const result = bootstrap(["--non-interactive", "--description", "Test project"], tempDir)
      assert.equal(result.status, 0, result.stderr)
      const config = readConfig(tempDir)
      assert.equal(config.description, "Test project")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("SV-004: Config with custom crew via --crew flag", () => {
    const tempDir = tmpDir()
    try {
      const result = bootstrap(["--non-interactive", "--crew", "custom"], tempDir)
      assert.equal(result.status, 0, result.stderr)
      const config = readConfig(tempDir)
      assert.equal(config.crews[0].id, "custom")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("SV-005: Runtime detection is omitted from generated config", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.equal(config.runtime_detection, undefined)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("SV-006: All runtime entries present (pi, claude, opencode, hermes)", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.ok(config.runtimes.pi)
      assert.ok(config.runtimes.claude)
      assert.ok(config.runtimes.opencode)
      assert.ok(config.runtimes.hermes)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("SV-007: Catalog models present with defaults", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.ok(config.catalog.models)
      assert.ok(config.catalog.models.orchestrator_default)
      assert.ok(config.catalog.models.lead_default)
      assert.ok(config.catalog.models.worker_default)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("SV-008: Catalog skills are resolved by convention", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.equal(config.catalog.skills, undefined)
      assert.equal(config.catalog.shared_skills, undefined)
      assert.ok(existsSync(path.join(repoRoot, "skills", "delegate-bounded", "SKILL.md")))
      assert.ok(existsSync(path.join(repoRoot, "skills", "zero-micromanagement", "SKILL.md")))
      assert.ok(existsSync(path.join(repoRoot, "skills", "expertise-model", "SKILL.md")))
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("SV-009: Domain profiles present", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.ok(config.domain_profiles)
      assert.ok(config.domain_profiles.read_only_repo)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("SV-010: Crew topology valid", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      const crew = config.crews[0]
      assert.ok(crew.topology)
      assert.ok(crew.topology.orchestrator)
      assert.equal(typeof crew.topology.orchestrator, "string")
      assert.ok(crew.topology.leads)
      assert.ok(crew.topology.workers)
      assert.ok(crew.agents)
      assert.ok(Array.isArray(crew.agents) && crew.agents.length >= 1)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("Required Fields Presence and Format", () => {
  test("RF-001: Version field is literal 1 (number, not string)", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.equal(config.version, 1)
      assert.equal(typeof config.version, "number")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RF-002: Name is non-empty string", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.equal(typeof config.name, "string")
      assert.ok(config.name.length > 0)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RF-003: Runtime detection is internal and omitted from generated config", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.equal(config.runtime_detection, undefined)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RF-004: Crews is non-empty array", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.ok(Array.isArray(config.crews))
      assert.ok(config.crews.length > 0)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RF-005: Each crew has required fields (id, topology, agents)", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      for (const crew of config.crews) {
        assert.ok(crew.id)
        assert.ok(crew.topology)
        assert.ok(crew.agents)
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RF-006: Each agent has required fields (id, role, team)", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      for (const crew of config.crews) {
        for (const agent of crew.agents) {
          assert.ok(agent.id)
          assert.ok(agent.role)
          assert.ok(agent.team)
        }
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RF-007: Topology has orchestrator", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.ok(config.crews[0].topology.orchestrator)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RF-008: Agents include orchestrator", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      const agents = config.crews[0].agents
      const orchestrator = agents.find(a => a.role === "orchestrator")
      assert.ok(orchestrator, "At least one orchestrator agent must exist")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("Optional Fields Default Values", () => {
  test("OF-001: Description defaults correctly", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.ok(config.description)
      assert.ok(config.description.length > 0)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("OF-002: Display name derived from crew ID", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive", "--crew", "dev"], tempDir)
      const config = readConfig(tempDir)
      assert.equal(config.crews[0].display_name, "Development Crew")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("OF-003: Mission defaults correctly", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.ok(config.crews[0].mission)
      assert.ok(config.crews[0].mission.length > 0)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("OF-004: Model refs use catalog", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      for (const crew of config.crews) {
        for (const agent of crew.agents) {
          if (agent.model_ref) {
            assert.ok(config.catalog.models[agent.model_ref], `Model ref ${agent.model_ref} must exist in catalog.models`)
          }
        }
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("OF-005: Skills refs use canonical skill paths", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      for (const crew of config.crews) {
        for (const agent of crew.agents) {
          if (agent.skills) {
            for (const skill of agent.skills) {
              const skillSlug = skill.replaceAll("_", "-")
              assert.ok(
                existsSync(path.join(repoRoot, "skills", skillSlug, "SKILL.md")),
                `Skill ${skill} must exist at skills/${skillSlug}/SKILL.md`
              )
            }
          }
        }
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("OF-006: Domain profile refs valid", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      for (const crew of config.crews) {
        for (const agent of crew.agents) {
          if (agent.domain_profile) {
            assert.ok(config.domain_profiles[agent.domain_profile], `Domain profile ${agent.domain_profile} must exist in domain_profiles`)
          }
        }
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("Data Type Validation", () => {
  test("DT-001: Strings are strings", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.equal(typeof config.name, "string")
      assert.equal(typeof config.description, "string")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("DT-002: Arrays are arrays", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.ok(Array.isArray(config.crews))
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("DT-003: Objects are objects", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.equal(config.runtime_detection, undefined)
      assert.equal(typeof config.runtimes, "object")
      assert.equal(typeof config.catalog, "object")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("DT-004: Booleans are booleans", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      // Check boolean fields in domain profiles
      const profile = config.domain_profiles.read_only_repo[0]
      if (profile.read !== undefined) assert.equal(typeof profile.read, "boolean")
      if (profile.edit !== undefined) assert.equal(typeof profile.edit, "boolean")
      if (profile.bash !== undefined) assert.equal(typeof profile.bash, "boolean")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("DT-005: Numbers are numbers", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.equal(typeof config.version, "number")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("DT-006: Nested structures valid", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.equal(config.runtime_detection, undefined)
      assert.ok(config.catalog.models)
      assert.ok(config.crews[0].topology)
      assert.ok(config.crews[0].agents)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("Reference Integrity", () => {
  test("RI-001: Model refs resolve to catalog.models", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      for (const crew of config.crews) {
        for (const agent of crew.agents) {
          if (agent.model_ref) {
            assert.ok(config.catalog.models[agent.model_ref], `Model ref ${agent.model_ref} not found in catalog.models`)
          }
        }
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RI-002: Skill refs resolve to canonical skill paths", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      for (const crew of config.crews) {
        for (const agent of crew.agents) {
          if (agent.skills) {
            for (const skill of agent.skills) {
              const skillSlug = skill.replaceAll("_", "-")
              assert.ok(
                existsSync(path.join(repoRoot, "skills", skillSlug, "SKILL.md")),
                `Skill ${skill} not found at skills/${skillSlug}/SKILL.md`
              )
            }
          }
        }
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RI-003: Domain profile refs resolve to domain_profiles", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      for (const crew of config.crews) {
        for (const agent of crew.agents) {
          if (agent.domain_profile) {
            assert.ok(config.domain_profiles[agent.domain_profile], `Domain profile ${agent.domain_profile} not found`)
          }
        }
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RI-004: Topology orchestrator exists in agents", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      const crew = config.crews[0]
      const orchestratorId = crew.topology.orchestrator
      const orchestrator = crew.agents.find(a => a.id === orchestratorId)
      assert.ok(orchestrator, `Orchestrator ${orchestratorId} not found in agents`)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RI-005: Topology leads exist in agents", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      const crew = config.crews[0]
      for (const [team, leadId] of Object.entries(crew.topology.leads)) {
        const lead = crew.agents.find(a => a.id === leadId)
        assert.ok(lead, `Lead ${leadId} not found in agents`)
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RI-006: Topology workers exist in agents", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      const crew = config.crews[0]
      for (const [team, workers] of Object.entries(crew.topology.workers)) {
        for (const workerId of workers) {
          const worker = crew.agents.find(a => a.id === workerId)
          assert.ok(worker, `Worker ${workerId} not found in agents`)
        }
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RI-007: Topology roles match agent roles", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      const crew = config.crews[0]
      const orchestrator = crew.agents.find(a => a.id === crew.topology.orchestrator)
      assert.equal(orchestrator.role, "orchestrator")
      for (const [team, leadId] of Object.entries(crew.topology.leads)) {
        const lead = crew.agents.find(a => a.id === leadId)
        assert.equal(lead.role, "lead")
      }
      for (const [team, workers] of Object.entries(crew.topology.workers)) {
        for (const workerId of workers) {
          const worker = crew.agents.find(a => a.id === workerId)
          assert.equal(worker.role, "worker")
        }
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RI-008: No duplicate agent IDs within crew", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      for (const crew of config.crews) {
        const ids = crew.agents.map(a => a.id)
        const uniqueIds = new Set(ids)
        assert.equal(ids.length, uniqueIds.size, "Agent IDs must be unique within crew")
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RI-009: Runtime marker refs valid", () => {
    const tempDir = tmpDir()
    try {
      bootstrap(["--non-interactive"], tempDir)
      const config = readConfig(tempDir)
      assert.equal(config.runtime_detection, undefined)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
