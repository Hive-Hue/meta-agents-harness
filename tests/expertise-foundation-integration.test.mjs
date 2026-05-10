/**
 * Expertise Foundation Integration Tests
 * Full pipeline: score -> explain -> propose -> review -> promote -> re-score
 * Run: node --test tests/expertise-foundation-integration.test.mjs
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { scoreCandidates } from "../scripts/expertise/expertise-routing.mjs"
import {
  buildExpertiseProposal,
  generateGovernedProposal,
  reviewProposal,
  promoteProposal,
} from "../scripts/expertise/expertise-proposal.mjs"

const orchestratorActor = { agent: "orchestrator", role: "orchestrator", team: "dev" }
const leadActor = { agent: "dev-lead", role: "lead", team: "dev" }

describe("Expertise Foundation Integration", () => {

  describe("T8.1: Score candidates produces routing signals", () => {
    it("routing_signals included in result and explain", () => {
      const candidates = [
        { id: "orch", expertise: { id: "orch", capabilities: ["task-planning"], domains: ["engineering"], validation_status: "validated", confidence: { band: "high", evidence_count: 10 }, trust_tier: "internal" } },
        { id: "worker", expertise: { id: "worker", capabilities: ["coding"], domains: ["backend"], validation_status: "validated", confidence: { band: "medium", evidence_count: 3 }, trust_tier: "internal" } },
      ]
      const result = scoreCandidates({
        task: "plan the sprint for next quarter",
        sourceAgent: "orchestrator",
        candidates,
        options: {},
      })
      assert.ok(result.routing_signals, "result must have routing_signals")
      assert.ok("diversity_score" in result.routing_signals)
      assert.ok("margin" in result.routing_signals)
      assert.ok("consensus" in result.routing_signals)
      assert.ok("candidate_depth" in result.routing_signals)
      assert.strictEqual(result.routing_signals.candidate_depth, 2)
      // explain also has routing_signals
      assert.ok(result.explain.routing_signals)
    })
  })

  describe("T8.2: Explain output includes confidence_details per candidate", () => {
    it("each scored candidate has confidence_details", () => {
      const candidates = [
        { id: "agent-a", expertise: { id: "agent-a", capabilities: ["testing"], domains: ["qa"], validation_status: "validated", confidence: { band: "high", evidence_count: 8 }, trust_tier: "internal" } },
        { id: "agent-b", expertise: { id: "agent-b", capabilities: ["coding"], domains: ["backend"], validation_status: "validated", confidence: { band: "medium", evidence_count: 2 }, trust_tier: "internal" } },
      ]
      const result = scoreCandidates({
        task: "run the test suite",
        sourceAgent: "test",
        candidates,
        options: {},
      })
      assert.ok(result.scores["agent-a"]?.confidence_details)
      assert.ok(result.scores["agent-b"]?.confidence_details)
      // agent-b has 2 evidence -> sparse decay_tier
      assert.strictEqual(result.scores["agent-b"].confidence_details.decay_tier, "sparse")
      assert.strictEqual(result.scores["agent-b"].confidence_details.freshness_penalty, -0.05)
    })
  })

  describe("T8.3: Generate governed proposal with routing context", () => {
    it("proposal includes routing-derived confidence_change", async () => {
      const candidates = [
        { id: "orch", expertise: { id: "orch", capabilities: ["task-planning"], domains: ["engineering"], validation_status: "validated", confidence: { band: "high", evidence_count: 10 }, trust_tier: "internal" } },
        { id: "worker", expertise: { id: "worker", capabilities: ["coding"], domains: ["backend"], validation_status: "observed", confidence: { band: "medium", evidence_count: 2 }, trust_tier: "internal" } },
      ]
      const result = scoreCandidates({
        task: "coordinate the team for next sprint",
        sourceAgent: "orchestrator",
        candidates,
        options: {},
      })
      const top = result.scores["orch"]
      const confidenceChange = {
        current_band: top.confidence_band,
        proposed_band: "critical",
        current_score: top.confidence?.score || 0.85,
        proposed_score: 0.92,
      }
      const proposalResult = await generateGovernedProposal({
        targetExpertiseId: "backend-dev",
        actor: leadActor,
        summary: `Improve backend-dev confidence based on routing evidence`,
        rationale: `Routing shows high margin (${result.routing_signals.margin.toFixed(2)}), diversity_score=${result.routing_signals.diversity_score.toFixed(2)}. Candidate depth: ${result.routing_signals.candidate_depth}. backend-dev consistently selected for planning tasks.`,
        proposedChanges: { confidence: { score: 0.92, band: "critical", evidence_count: 12 } },
        confidenceChange,
      })
      assert.ok(proposalResult.ok, `proposal failed: ${JSON.stringify(proposalResult)}`)
      assert.strictEqual(proposalResult.proposal.confidence_change.direction, "improvement")
      assert.strictEqual(proposalResult.proposal.confidence_change.proposed_band, "critical")
    })
  })

  describe("T8.4: Review and approve proposal", () => {
    it("approved proposal transitions to approved status", async () => {
      const result = await generateGovernedProposal({
        targetExpertiseId: "backend-dev",
        actor: orchestratorActor,
        summary: "Add observability capability",
        proposedChanges: { capabilities: ["observability"] },
      })
      assert.ok(result.ok)
      const reviewed = reviewProposal(result.proposal, "validation-lead", "approved", "Good proposal")
      assert.ok(reviewed.ok)
      assert.strictEqual(reviewed.proposal.status, "approved")
      assert.strictEqual(reviewed.proposal.reviews[0].decision, "approved")
    })
  })

  describe("T8.5: Promote proposal updates expertise", () => {
    it("approved proposal merges into target expertise", async () => {
      const mockTarget = {
        id: "dev:backend-dev",
        schema_version: "0.7.0",
        validation_status: "validated",
        lifecycle: "active",
        trust_tier: "internal",
        confidence: { score: 0.75, band: "high", evidence_count: 6 },
        capabilities: ["coding", "testing"],
        domains: ["backend"],
      }
      const { ok, proposal } = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: orchestratorActor,
        summary: "Add debugging capability",
        proposedChanges: { capabilities: ["debugging"] },
      })
      assert.ok(ok)
      const reviewed = reviewProposal(proposal, "validation-lead", "approved")
      assert.ok(reviewed.ok)
      const promoted = promoteProposal(reviewed.proposal, mockTarget)
      assert.ok(promoted.ok)
      assert.ok(promoted.expertise.capabilities.includes("debugging"))
      assert.strictEqual(promoted.expertise.last_promoted_by, "orchestrator")
    })
  })

  describe("T8.6: Re-score with updated expertise", () => {
    it("updated expertise produces improved confidence score", () => {
      const originalCandidates = [
        { id: "agent-1", expertise: { id: "agent-1", capabilities: ["planning"], domains: ["engineering"], validation_status: "validated", confidence: { band: "low", evidence_count: 1 }, trust_tier: "internal" } },
      ]
      const before = scoreCandidates({ task: "plan the sprint", sourceAgent: "test", candidates: originalCandidates, options: {} })
      assert.strictEqual(before.scores["agent-1"].confidence_band, "low")

      // Simulate promotion that improves confidence
      const updatedCandidate = {
        id: "agent-1",
        expertise: {
          id: "agent-1",
          capabilities: ["planning"],
          domains: ["engineering"],
          validation_status: "validated",
          confidence: { band: "high", evidence_count: 10 },
          trust_tier: "internal",
        },
      }
      const after = scoreCandidates({ task: "plan the sprint", sourceAgent: "test", candidates: [updatedCandidate], options: {} })
      assert.strictEqual(after.scores["agent-1"].confidence_band, "high")
      assert.strictEqual(after.scores["agent-1"].confidence_details.decay_tier, "robust")
      assert.strictEqual(after.scores["agent-1"].confidence_details.freshness_penalty, 0)
    })
  })

  describe("T8.7: Full pipeline end-to-end", () => {
    it("score -> propose -> review -> promote -> re-score", async () => {
      // Step 1: Score
      const initialCandidates = [
        { id: "planner", expertise: { id: "planner", capabilities: ["planning"], domains: ["engineering"], validation_status: "validated", confidence: { band: "medium", evidence_count: 2 }, trust_tier: "internal" } },
        { id: "builder", expertise: { id: "builder", capabilities: ["coding"], domains: ["backend"], validation_status: "validated", confidence: { band: "high", evidence_count: 8 }, trust_tier: "internal" } },
      ]
      const scoreResult = scoreCandidates({
        task: "coordinate the team planning session",
        sourceAgent: "orchestrator",
        candidates: initialCandidates,
        options: {},
      })
      assert.ok(scoreResult.routing_signals)

      // Step 2: Propose governance improvement for backend-dev
      const plannerScore = scoreResult.scores["planner"]
      const proposalResult = await generateGovernedProposal({
        targetExpertiseId: "backend-dev",
        actor: orchestratorActor,
        summary: "Upgrade backend-dev confidence based on routing evidence",
        rationale: `Planner selected with margin=${scoreResult.routing_signals.margin.toFixed(3)}, consensus=${scoreResult.routing_signals.consensus}. Consistent use in planning tasks.`,
        proposedChanges: { confidence: { score: 0.85, band: "high", evidence_count: 5 } },
        confidenceChange: {
          current_band: plannerScore.confidence_band,
          proposed_band: "high",
          current_score: 0.5,
          proposed_score: 0.85,
        },
      })
      assert.ok(proposalResult.ok)

      // Step 3: Review and approve
      const reviewed = reviewProposal(proposalResult.proposal, "validation-lead", "approved", "Routing evidence supports upgrade")
      assert.ok(reviewed.ok)
      assert.strictEqual(reviewed.proposal.status, "approved")

      // Step 4: Promote
      const plannerExpertise = initialCandidates[0].expertise
      const promoted = promoteProposal(reviewed.proposal, plannerExpertise)
      assert.ok(promoted.ok)
      assert.strictEqual(promoted.expertise.confidence.band, "high")
      assert.strictEqual(promoted.expertise.confidence.evidence_count, 5)

      // Step 5: Re-score with promoted expertise
      const promotedCandidates = [
        { id: "planner", expertise: promoted.expertise },
        { id: "builder", expertise: initialCandidates[1].expertise },
      ]
      const reScored = scoreCandidates({
        task: "coordinate the team planning session",
        sourceAgent: "orchestrator",
        candidates: promotedCandidates,
        options: {},
      })
      assert.strictEqual(reScored.scores["planner"].confidence_band, "high")
      assert.strictEqual(reScored.scores["planner"].confidence_details.decay_tier, "robust")
      // re-scored should still have routing_signals
      assert.ok(reScored.routing_signals)
    })
  })

  describe("T8.8: Rejected proposal cannot affect expertise", () => {
    it("rejected proposal blocked from promotion", async () => {
      const result = await generateGovernedProposal({
        targetExpertiseId: "backend-dev",
        actor: leadActor,
        summary: "This should be rejected",
      })
      assert.ok(result.ok)
      const reviewed = reviewProposal(result.proposal, "security-reviewer", "rejected", "Insufficient evidence")
      assert.ok(reviewed.ok)
      const mockTarget = {
        id: "dev:backend-dev",
        schema_version: "0.7.0",
        validation_status: "validated",
        lifecycle: "active",
        trust_tier: "internal",
        confidence: { score: 0.8, band: "high", evidence_count: 5 },
        capabilities: ["coding"],
        domains: ["backend"],
      }
      const promoted = promoteProposal(reviewed.proposal, mockTarget)
      assert.ok(!promoted.ok)
      // original expertise unchanged
      assert.deepStrictEqual(mockTarget.capabilities, ["coding"])
    })
  })

  describe("T8.9: Governance signals surface in explain", () => {
    it("explain.routing_signals includes all four fields", () => {
      const result = scoreCandidates({
        task: "run tests for backend",
        sourceAgent: "test",
        candidates: [
          { id: "qa-agent", expertise: { id: "qa-agent", capabilities: ["testing"], domains: ["qa"], validation_status: "validated", confidence: { band: "high", evidence_count: 10 }, trust_tier: "internal" } },
          { id: "dev-agent", expertise: { id: "dev-agent", capabilities: ["coding"], domains: ["backend"], validation_status: "validated", confidence: { band: "medium", evidence_count: 4 }, trust_tier: "internal" } },
        ],
        options: {},
      })
      const sig = result.explain.routing_signals
      assert.ok(typeof sig.diversity_score === "number")
      assert.ok(typeof sig.margin === "number")
      assert.ok(typeof sig.consensus === "boolean")
      assert.ok(typeof sig.candidate_depth === "number")
    })
  })

  describe("T8.10: Governance rejects unauthorized promotion", () => {
    it("worker role cannot generate proposals, so cannot promote", async () => {
      const workerActor = { agent: "backend-dev", role: "worker", team: "dev" }
      const result = await generateGovernedProposal({
        targetExpertiseId: "backend-dev",
        actor: workerActor,
        summary: "Unauthorized attempt",
      })
      assert.ok(!result.ok)
      assert.ok(result.error.includes("cannot generate proposals"))
    })
  })
})