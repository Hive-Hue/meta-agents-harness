import test from "node:test"
import assert from "node:assert/strict"
import { rankCooperativeCandidates } from "../scripts/routing/cooperative-ranking.mjs"

test("strong cross-crew expert can outrank weaker local candidate", () => {
  const candidates = [
    { crew: "dev", agent: "local-dev", role: "worker", team: "engineering", skills: [], domainProfiles: ["runtime_impl"], runtimeCompatible: true },
    { crew: "ops", agent: "db-specialist", role: "worker", team: "platform", skills: [], domainProfiles: ["runtime_impl"], runtimeCompatible: true }
  ]
  const expertiseById = {
    "dev:local-dev": {
      capabilities: ["frontend", "css"],
      domains: ["ui"],
      confidence: { score: 0.45 },
      validation_status: "validated"
    },
    "ops:db-specialist": {
      capabilities: ["database", "migration", "sql"],
      domains: ["data-platform"],
      confidence: { score: 0.95 },
      validation_status: "validated"
    }
  }

  const result = rankCooperativeCandidates({
    task: "plan database migration and SQL rollback strategy",
    candidates,
    sourceCrew: "dev",
    expertiseById
  })

  assert.equal(result.selected?.agent, "db-specialist")
  assert.equal(result.selected?.crew, "ops")
})

test("active crew wins when expertise is materially equivalent", () => {
  const candidates = [
    { crew: "dev", agent: "local-a", role: "worker", team: "engineering", skills: [], domainProfiles: ["runtime_impl"], runtimeCompatible: true },
    { crew: "ops", agent: "remote-a", role: "worker", team: "platform", skills: [], domainProfiles: ["runtime_impl"], runtimeCompatible: true }
  ]
  const expertise = {
    capabilities: ["refactor", "testing"],
    domains: ["software-engineering"],
    confidence: { score: 0.8 },
    validation_status: "validated"
  }
  const result = rankCooperativeCandidates({
    task: "refactor and add testing coverage",
    candidates,
    sourceCrew: "dev",
    expertiseById: {
      "dev:local-a": expertise,
      "ops:remote-a": expertise
    }
  })

  assert.equal(result.selected?.agent, "local-a")
  assert.equal(result.selected?.crew, "dev")
})

test("hard filters exclude invalid candidates before ranking", () => {
  const candidates = [
    { crew: "dev", agent: "restricted-agent", role: "worker", team: "engineering", skills: [], domainProfiles: ["runtime_impl"], runtimeCompatible: true },
    { crew: "dev", agent: "ok-agent", role: "worker", team: "engineering", skills: [], domainProfiles: ["runtime_impl"], runtimeCompatible: true }
  ]
  const result = rankCooperativeCandidates({
    task: "implement runtime adapter changes",
    candidates,
    sourceCrew: "dev",
    expertiseById: {
      "dev:restricted-agent": {
        capabilities: ["runtime", "adapter"],
        domains: ["runtime"],
        confidence: { score: 0.9 },
        validation_status: "restricted"
      },
      "dev:ok-agent": {
        capabilities: ["runtime", "adapter"],
        domains: ["runtime"],
        confidence: { score: 0.7 },
        validation_status: "validated"
      }
    }
  })

  assert.equal(result.selected?.agent, "ok-agent")
  assert.equal(result.excluded.some((item) => item.agent === "restricted-agent"), true)
})
