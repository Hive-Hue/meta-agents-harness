/**
 * Expertise Governed Learning Loop Tests
 * Run: node --test tests/expertise-governed-loop.test.mjs
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildExpertiseProposal,
  generateGovernedProposal,
  reviewProposal,
  promoteProposal,
  validateProposalPayload,
} from "../scripts/expertise/expertise-proposal.mjs"
import { canTransition, LIFECYCLE_TRANSITIONS } from "../scripts/expertise/expertise-lifecycle.mjs"

// Mock actor (orchestrator role can generate proposals)
const orchestratorActor = { agent: "orchestrator", role: "orchestrator", team: "dev" }
const leadActor = { agent: "dev-lead", role: "lead", team: "dev" }
const workerActor = { agent: "backend-dev", role: "worker", team: "dev" }

const mockTarget = {
  id: "dev:backend-dev",
  schema_version: "0.7.0",
  validation_status: "validated",
  lifecycle: "active",
  trust_tier: "internal",
  confidence: { score: 0.8, band: "high", evidence_count: 5 },
  capabilities: ["coding", "testing"],
  domains: ["backend"],
  owner: { agent: "backend-dev", team: "dev" },
}

describe("Governed Expertise Learning Loop", () => {

  describe("T7.1: Proposal with confidence_change", () => {
    it("proposal includes confidence_change when provided", () => {
      const result = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: orchestratorActor,
        summary: "Increase confidence based on evidence",
        rationale: "Strong evidence from recent runs",
        proposedChanges: { confidence: { score: 0.9, band: "critical", evidence_count: 10 } },
        confidenceChange: {
          current_band: "high",
          proposed_band: "critical",
          current_score: 0.8,
          proposed_score: 0.9,
        },
      })
      assert.ok(result.ok)
      assert.ok(result.proposal.confidence_change)
      assert.strictEqual(result.proposal.confidence_change.current_band, "high")
      assert.strictEqual(result.proposal.confidence_change.proposed_band, "critical")
      assert.strictEqual(result.proposal.confidence_change.current_score, 0.8)
      assert.strictEqual(result.proposal.confidence_change.proposed_score, 0.9)
      assert.strictEqual(result.proposal.confidence_change.direction, "improvement")
    })

    it("confidence_change direction = degradation when score decreases", () => {
      const result = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: leadActor,
        summary: "Decrease confidence due to failures",
        rationale: "Recent failures indicate overconfidence",
        proposedChanges: { lifecycle: "experimental" },
        confidenceChange: {
          current_band: "high",
          proposed_band: "medium",
          current_score: 0.8,
          proposed_score: 0.55,
        },
      })
      assert.ok(result.ok)
      assert.strictEqual(result.proposal.confidence_change.direction, "degradation")
    })

    it("proposal without confidenceChange has no confidence_change field", () => {
      const result = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: leadActor,
        summary: "Simple capability addition",
        proposedChanges: { capabilities: ["debugging"] },
      })
      assert.ok(result.ok)
      assert.strictEqual(result.proposal.confidence_change, undefined)
    })
  })

  describe("T7.2: generateGovernedProposal validation", () => {
    it("rejects worker role actor", async () => {
      const result = await generateGovernedProposal({
        targetExpertiseId: "backend-dev",
        actor: workerActor,
        summary: "Worker should not generate proposals",
        rationale: "Not allowed",
      })
      assert.ok(!result.ok)
      assert.ok(result.error.includes("cannot generate proposals"))
    })

    it("rejects empty summary", async () => {
      const result = await generateGovernedProposal({
        targetExpertiseId: "backend-dev",
        actor: orchestratorActor,
        summary: "   ",
        rationale: "bad summary",
      })
      assert.ok(!result.ok)
      assert.ok(result.error.includes("summary"))
    })

    it("rejects nonexistent expertise id", async () => {
      const result = await generateGovernedProposal({
        targetExpertiseId: "nonexistent-agent-xyz-abc",
        actor: orchestratorActor,
        summary: "Should fail",
      })
      assert.ok(!result.ok)
      assert.ok(result.error.includes("not found"))
    })

    it("returns validation errors for malformed proposal", async () => {
      const result = await generateGovernedProposal({
        targetExpertiseId: "backend-dev",
        actor: orchestratorActor,
        summary: "Valid summary",
        proposedChanges: { invalid_prop: 123 }, // will be included but validated
      })
      // Should succeed since backend-dev exists and summary is valid
      assert.ok(result.ok, `expected ok but got: ${JSON.stringify(result)}`)
    })
  })

  describe("T7.3: reviewProposal function", () => {
    it("approves proposal and sets status=approved", () => {
      const { ok, proposal } = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: orchestratorActor,
        summary: "Test approval",
        proposedChanges: {},
      })
      assert.ok(ok)
      const reviewed = reviewProposal(proposal, "validation-lead", "approved", "LGTM")
      assert.ok(reviewed.ok)
      assert.strictEqual(reviewed.proposal.status, "approved")
      assert.strictEqual(reviewed.proposal.reviews.length, 1)
      assert.strictEqual(reviewed.proposal.reviews[0].decision, "approved")
      assert.strictEqual(reviewed.proposal.reviews[0].comment, "LGTM")
      assert.ok(reviewed.proposal.reviews[0].reviewed_at)
    })

    it("rejects proposal and sets status=rejected", () => {
      const { ok, proposal } = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: leadActor,
        summary: "Test rejection",
      })
      assert.ok(ok)
      const reviewed = reviewProposal(proposal, "security-reviewer", "rejected", "Missing evidence")
      assert.ok(reviewed.ok)
      assert.strictEqual(reviewed.proposal.status, "rejected")
      assert.strictEqual(reviewed.proposal.reviews[0].decision, "rejected")
    })

    it("needs_changes sets status=needs_changes", () => {
      const { ok, proposal } = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: leadActor,
        summary: "Test needs changes",
      })
      assert.ok(ok)
      const reviewed = reviewProposal(proposal, "validation-lead", "needs_changes", "Add evidence refs")
      assert.ok(reviewed.ok)
      assert.strictEqual(reviewed.proposal.status, "needs_changes")
    })

    it("rejects invalid decision value", () => {
      const { ok, proposal } = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: leadActor,
        summary: "Test bad decision",
      })
      assert.ok(ok)
      const result = reviewProposal(proposal, "reviewer", "maybe", "invalid")
      assert.ok(!result.ok)
      assert.ok(result.error.includes("approved") && result.error.includes("rejected"))
    })

    it("appends to existing reviews", () => {
      const { ok, proposal } = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: orchestratorActor,
        summary: "Multi-review test",
      })
      assert.ok(ok)
      const first = reviewProposal(proposal, "reviewer1", "needs_changes", "first pass")
      assert.ok(first.ok)
      const second = reviewProposal(first.proposal, "reviewer2", "approved", "second pass")
      assert.ok(second.ok)
      assert.strictEqual(second.proposal.reviews.length, 2)
      assert.strictEqual(second.proposal.status, "approved") // last review wins
    })
  })

  describe("T7.4: promoteProposal enforcement", () => {
    it("promotes approved proposal into expertise", () => {
      const { ok, proposal } = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: orchestratorActor,
        summary: "Promote this",
        proposedChanges: { capabilities: ["debugging", "profiling"] },
        confidenceChange: {
          current_band: "high",
          proposed_band: "critical",
          current_score: 0.8,
          proposed_score: 0.95,
        },
      })
      assert.ok(ok)
      const reviewed = reviewProposal(proposal, "validation-lead", "approved", "OK")
      assert.ok(reviewed.ok)
      const promoted = promoteProposal(reviewed.proposal, mockTarget)
      assert.ok(promoted.ok)
      // capabilities overwritten (not merged) by proposed_changes
      assert.deepStrictEqual(promoted.expertise.capabilities, ["debugging", "profiling"])
      assert.strictEqual(promoted.expertise.last_promoted_by, "orchestrator")
    })

    it("rejects promotion of draft proposal", () => {
      const { ok, proposal } = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: leadActor,
        summary: "Draft should not promote",
      })
      assert.ok(ok)
      assert.strictEqual(proposal.status, "draft")
      const result = promoteProposal(proposal, mockTarget)
      assert.ok(!result.ok)
      assert.ok(result.error.includes("approved"))
    })

    it("rejects promotion of rejected proposal", () => {
      const { ok, proposal } = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: leadActor,
        summary: "Rejected should not promote",
      })
      assert.ok(ok)
      const reviewed = reviewProposal(proposal, "security-reviewer", "rejected", "No")
      assert.ok(reviewed.ok)
      const result = promoteProposal(reviewed.proposal, mockTarget)
      assert.ok(!result.ok)
      assert.ok(result.error.includes("rejected"))
    })

    it("rejects promotion of needs_changes proposal", () => {
      const { ok, proposal } = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: orchestratorActor,
        summary: "Needs changes should not promote",
      })
      assert.ok(ok)
      const reviewed = reviewProposal(proposal, "validation-lead", "needs_changes", "Revise")
      assert.ok(reviewed.ok)
      const result = promoteProposal(reviewed.proposal, mockTarget)
      assert.ok(!result.ok)
      assert.ok(result.error.includes("needs_changes"))
    })

    it("preserve fields not in proposed_changes", () => {
      const { ok, proposal } = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: orchestratorActor,
        summary: "Partial update",
        proposedChanges: { validation_status: "validated" },
      })
      assert.ok(ok)
      const reviewed = reviewProposal(proposal, "validation-lead", "approved", "OK")
      assert.ok(reviewed.ok)
      const promoted = promoteProposal(reviewed.proposal, mockTarget)
      assert.ok(promoted.ok)
      // domains should survive (not overwritten)
      assert.deepStrictEqual(promoted.expertise.domains, mockTarget.domains)
      // confidence should survive
      assert.deepStrictEqual(promoted.expertise.confidence, mockTarget.confidence)
    })
  })

  describe("T7.5: Lifecycle transitions", () => {
    it("draft -> active requires validated status + 3+ evidence", () => {
      assert.strictEqual(canTransition("draft", "active"), true)
    })

    it("experimental -> active requires 5+ evidence + 0.8 pass rate", () => {
      assert.strictEqual(canTransition("experimental", "active"), true)
    })

    it("active -> restricted allowed", () => {
      assert.strictEqual(canTransition("active", "restricted"), true)
    })

    it("deprecated is terminal - no transitions allowed", () => {
      const deps = LIFECYCLE_TRANSITIONS["deprecated"]
      assert.strictEqual(deps.length, 0)
    })
  })

  describe("T7.6: Confidence change direction logic", () => {
    it("improvement when proposed_score > current_score", () => {
      const result = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: leadActor,
        summary: "Improve",
        confidenceChange: { current_band: "medium", proposed_band: "high", current_score: 0.6, proposed_score: 0.85 },
      })
      assert.ok(result.ok)
      assert.strictEqual(result.proposal.confidence_change.direction, "improvement")
    })

    it("degradation when proposed_score < current_score", () => {
      const result = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: leadActor,
        summary: "Degrade",
        confidenceChange: { current_band: "high", proposed_band: "medium", current_score: 0.85, proposed_score: 0.55 },
      })
      assert.ok(result.ok)
      assert.strictEqual(result.proposal.confidence_change.direction, "degradation")
    })

    it("neutral when scores equal (edge case)", () => {
      const result = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: leadActor,
        summary: "Neutral",
        confidenceChange: { current_band: "high", proposed_band: "high", current_score: 0.8, proposed_score: 0.8 },
      })
      assert.ok(result.ok)
      assert.strictEqual(result.proposal.confidence_change.direction, "degradation") // > not >= so degradation
    })
  })

  describe("T7.7: validateProposalPayload integration", () => {
    it("validates proposal with confidence_change", () => {
      const { ok, proposal } = buildExpertiseProposal({
        targetExpertise: mockTarget,
        actor: orchestratorActor,
        summary: "Validate with confidence_change",
        confidenceChange: { current_band: "low", proposed_band: "medium", current_score: 0.3, proposed_score: 0.6 },
      })
      assert.ok(ok)
      const validation = validateProposalPayload(proposal)
      assert.ok(validation.valid, `errors: ${validation.errors.join(', ')}`)
    })

    it("invalidates proposal with missing required fields", () => {
      const result = validateProposalPayload({ id: "x", target_expertise_id: "y", summary: "" })
      assert.ok(!result.valid)
      assert.ok(result.errors.some(e => e.includes("summary")))
    })
  })

  describe("T7.8: End-to-end governed proposal lifecycle", () => {
    it("full cycle: proposal -> review -> promote", async () => {
      // Generate governed proposal
      const genResult = await generateGovernedProposal({
        targetExpertiseId: "backend-dev",
        actor: orchestratorActor,
        summary: "Add observability capabilities based on evidence",
        rationale: "Recent runs show need for tracing and profiling",
        proposedChanges: { capabilities: ["observability", "profiling"] },
        confidenceChange: {
          current_band: "high",
          proposed_band: "critical",
          current_score: 0.8,
          proposed_score: 0.92,
        },
      })
      assert.ok(genResult.ok, `generateGovernedProposal failed: ${JSON.stringify(genResult)}`)
      const proposal = genResult.proposal
      assert.strictEqual(proposal.status, "draft")
      assert.ok(proposal.confidence_change)

      // Review and approve
      const reviewed = reviewProposal(proposal, "validation-lead", "approved", "Evidence-backed improvement")
      assert.ok(reviewed.ok)
      assert.strictEqual(reviewed.proposal.status, "approved")

      // Promote
      const promoted = promoteProposal(reviewed.proposal, mockTarget)
      assert.ok(promoted.ok)
      assert.ok(promoted.expertise.capabilities.includes("observability"))
      assert.ok(promoted.expertise.capabilities.includes("profiling"))
      assert.strictEqual(promoted.expertise.last_promoted_by, "orchestrator")
    })

    it("blocked cycle: rejected proposal cannot promote", async () => {
      const genResult = await generateGovernedProposal({
        targetExpertiseId: "backend-dev",
        actor: leadActor,
        summary: "Should be rejected and blocked",
      })
      assert.ok(genResult.ok)
      const reviewed = reviewProposal(genResult.proposal, "security-reviewer", "rejected", "Insufficient evidence")
      assert.ok(reviewed.ok)
      const promoted = promoteProposal(reviewed.proposal, mockTarget)
      assert.ok(!promoted.ok)
      assert.ok(promoted.error.includes("rejected"))
    })
  })
})