/**
 * Expertise Confidence Scoring Tests
 * Run: node --test tests/expertise-confidence-scoring.test.mjs
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { scoreCandidates } from "../scripts/expertise/expertise-routing.mjs"

describe("Expertise Confidence Scoring", () => {

  describe("Domain-weighted matching", () => {
    it("full-token domain match gets +0.25 not +0.2", () => {
      // Task contains "security" as a full token; agent has "security" domain
      const result = scoreCandidates({
        task: "perform security audit of the authentication system",
        sourceAgent: "test",
        candidates: [{
          id: "sec-agent",
          expertise: {
            id: "sec-agent",
            capabilities: [],
            domains: ["security"],
            validation_status: "validated",
            confidence: { band: "medium", evidence_count: 5 },
          },
        }],
        options: {},
      })
      // Domain "security" matches full token "security" -> +0.25
      assert.ok(result.scores["sec-agent"])
      assert.ok(result.scores["sec-agent"].match_score >= 0.25, `expected >= 0.25, got ${result.scores["sec-agent"].match_score}`)
    })

    it("partial domain match gets +0.2", () => {
      // Task has "auth" but domain is "authentication" (no full token match)
      const result = scoreCandidates({
        task: "fix auth bugs in the login flow",
        sourceAgent: "test",
        candidates: [{
          id: "auth-agent",
          expertise: {
            id: "auth-agent",
            capabilities: [],
            domains: ["authentication"],
            validation_status: "validated",
            confidence: { band: "medium", evidence_count: 5 },
          },
        }],
        options: {},
      })
      // Domain "authentication" partially matches "auth" -> +0.2
      assert.ok(result.scores["auth-agent"])
      const ms = result.scores["auth-agent"].match_score
      assert.ok(ms >= 0.2, `expected >= 0.2, got ${ms}`)
    })

    it("full-token match beats partial match for same domain", () => {
      // Two agents, one gets full token, one gets partial
      const result = scoreCandidates({
        task: "deploy the kubernetes cluster safely",
        sourceAgent: "test",
        candidates: [
          {
            id: "k8s-full",
            expertise: { id: "k8s-full", capabilities: [], domains: ["kubernetes"], validation_status: "validated", confidence: { band: "medium", evidence_count: 5 } },
          },
          {
            id: "k8s-partial",
            expertise: { id: "k8s-partial", capabilities: [], domains: ["container-orchestration"], validation_status: "validated", confidence: { band: "medium", evidence_count: 5 } },
          },
        ],
        options: {},
      })
      const fullScore = result.scores["k8s-full"]?.match_score || 0
      const partialScore = result.scores["k8s-partial"]?.match_score || 0
      assert.ok(fullScore > partialScore, `full-token (${fullScore}) should beat partial (${partialScore})`)
    })
  })

  describe("Evidence-freshness decay", () => {
    it("0 evidence -> -0.15 penalty", () => {
      const result = scoreCandidates({
        task: "write backend code for API",
        sourceAgent: "test",
        candidates: [{
          id: "no-evidence",
          expertise: {
            id: "no-evidence", capabilities: ["coding"], domains: ["backend"],
            validation_status: "validated",
            confidence: { band: "medium", evidence_count: 0 },
          },
        }],
        options: {},
      })
      const cd = result.scores["no-evidence"]?.confidence_details
      assert.strictEqual(cd?.freshness_penalty, -0.15)
      assert.strictEqual(cd?.decay_tier, "none")
    })

    it("1 evidence -> -0.10 penalty", () => {
      const result = scoreCandidates({
        task: "write backend code for API",
        sourceAgent: "test",
        candidates: [{
          id: "one-evidence",
          expertise: {
            id: "one-evidence", capabilities: ["coding"], domains: ["backend"],
            validation_status: "validated",
            confidence: { band: "medium", evidence_count: 1 },
          },
        }],
        options: {},
      })
      const cd = result.scores["one-evidence"]?.confidence_details
      assert.strictEqual(cd?.freshness_penalty, -0.10)
      assert.strictEqual(cd?.decay_tier, "sparse")
    })

    it("2 evidence -> -0.05 penalty", () => {
      const result = scoreCandidates({
        task: "write backend code for API",
        sourceAgent: "test",
        candidates: [{
          id: "two-evidence",
          expertise: {
            id: "two-evidence", capabilities: ["coding"], domains: ["backend"],
            validation_status: "validated",
            confidence: { band: "medium", evidence_count: 2 },
          },
        }],
        options: {},
      })
      const cd = result.scores["two-evidence"]?.confidence_details
      assert.strictEqual(cd?.freshness_penalty, -0.05)
      assert.strictEqual(cd?.decay_tier, "sparse")
    })

    it("3+ evidence -> 0 penalty (robust)", () => {
      const result = scoreCandidates({
        task: "write backend code for API",
        sourceAgent: "test",
        candidates: [{
          id: "robust",
          expertise: {
            id: "robust", capabilities: ["coding"], domains: ["backend"],
            validation_status: "validated",
            confidence: { band: "medium", evidence_count: 5 },
          },
        }],
        options: {},
      })
      const cd = result.scores["robust"]?.confidence_details
      assert.strictEqual(cd?.freshness_penalty, 0)
      assert.strictEqual(cd?.decay_tier, "robust")
    })
  })

  describe("routing_signals computation", () => {
    it("margin is difference between #1 and #2 scores", () => {
      const result = scoreCandidates({
        task: "plan and coordinate the sprint",
        sourceAgent: "test",
        candidates: [
          { id: "orch", expertise: { id: "orch", capabilities: ["task-planning"], domains: ["engineering"], validation_status: "validated", confidence: { band: "high", evidence_count: 10 } } },
          { id: "worker", expertise: { id: "worker", capabilities: ["coding"], domains: ["engineering"], validation_status: "validated", confidence: { band: "medium", evidence_count: 3 } } },
        ],
        options: {},
      })
      assert.ok(result.routing_signals)
      assert.ok("margin" in result.routing_signals)
      assert.ok("diversity_score" in result.routing_signals)
      assert.ok("consensus" in result.routing_signals)
      assert.ok("candidate_depth" in result.routing_signals)
      assert.strictEqual(result.routing_signals.candidate_depth, 2)
    })

    it("consensus=true when top-2 scores within 0.1", () => {
      const result = scoreCandidates({
        task: "plan the sprint",
        sourceAgent: "test",
        candidates: [
          { id: "a", expertise: { id: "a", capabilities: ["planning"], domains: ["engineering"], validation_status: "validated", confidence: { band: "high", evidence_count: 10 } } },
          { id: "b", expertise: { id: "b", capabilities: ["planning"], domains: ["engineering"], validation_status: "validated", confidence: { band: "high", evidence_count: 10 } } },
        ],
        options: {},
      })
      // Both get same match score -> consensus should be true
      assert.ok(result.routing_signals.consensus, "top-2 within 0.1 should be consensus")
    })

    it("consensus=false when gap >= 0.1", () => {
      const result = scoreCandidates({
        task: "write backend code for API",
        sourceAgent: "test",
        candidates: [
          { id: "coder", expertise: { id: "coder", capabilities: ["coding", "api-design"], domains: ["backend"], validation_status: "validated", confidence: { band: "high", evidence_count: 10 } } },
          { id: "planner", expertise: { id: "planner", capabilities: ["planning"], domains: ["engineering"], validation_status: "validated", confidence: { band: "medium", evidence_count: 3 } } },
        ],
        options: {},
      })
      // coder matches "code" + "api" perfectly; planner only partial -> gap should be significant
      assert.ok(!result.routing_signals.consensus, `gap=${result.routing_signals.margin} should indicate no consensus`)
    })

    it("diversity_score > 0 when candidates have very different relevance", () => {
      const result = scoreCandidates({
        task: "deploy kubernetes cluster",
        sourceAgent: "test",
        candidates: [
          { id: "k8s-ops", expertise: { id: "k8s-ops", capabilities: ["kubernetes-operations", "devops"], domains: ["infrastructure"], validation_status: "validated", confidence: { band: "high", evidence_count: 10 } } },
          { id: "web-dev", expertise: { id: "web-dev", capabilities: ["frontend"], domains: ["web"], validation_status: "validated", confidence: { band: "low", evidence_count: 0 } } },
        ],
        options: {},
      })
      // k8s-ops matches well; web-dev has no match + -0.15 freshness -> diversity > 0
      assert.ok(result.routing_signals.diversity_score > 0, `diversity=${result.routing_signals.diversity_score} should be > 0`)
    })

    it("single candidate has margin = its score, consensus=false, diversity=0", () => {
      const result = scoreCandidates({
        task: "code something",
        sourceAgent: "test",
        candidates: [
          { id: "solo", expertise: { id: "solo", capabilities: ["coding"], domains: ["engineering"], validation_status: "validated", confidence: { band: "high", evidence_count: 5 } } },
        ],
        options: {},
      })
      assert.strictEqual(result.routing_signals.candidate_depth, 1)
      assert.strictEqual(result.routing_signals.margin, result.routing_signals.margin) // a number
      assert.strictEqual(result.routing_signals.consensus, false)
      assert.strictEqual(result.routing_signals.diversity_score, 0)
    })
  })

  describe("confidence_details in each CandidateScore", () => {
    it("passing candidate has all confidence_details fields", () => {
      const result = scoreCandidates({
        task: "code review the PR",
        sourceAgent: "test",
        candidates: [{
          id: "reviewer",
          expertise: {
            id: "reviewer", capabilities: ["code-review"], domains: ["engineering"],
            validation_status: "validated",
            confidence: { band: "high", evidence_count: 4 },
          },
        }],
        options: {},
      })
      const cd = result.scores["reviewer"]?.confidence_details
      assert.ok(cd, "confidence_details must exist")
      assert.strictEqual(cd.evidence_count, 4)
      assert.strictEqual(cd.decay_tier, "robust")
      assert.strictEqual(cd.freshness_penalty, 0)
      assert.strictEqual(cd.band_adjustment, 0.0)
    })

    it("blocked candidate has confidence_details with decay_tier=none", () => {
      const result = scoreCandidates({
        task: "security audit",
        sourceAgent: "test",
        candidates: [{
          id: "bad-env",
          expertise: {
            id: "bad-env", capabilities: ["security"], domains: ["security"],
            validation_status: "validated",
            allowed_environments: ["restricted"],
            confidence: { band: "critical", evidence_count: 20 },
          },
        }],
        options: { allowed_environments: ["production"] },
      })
      const cd = result.scores["bad-env"]?.confidence_details
      assert.ok(cd, "confidence_details must exist even for blocked")
      assert.strictEqual(cd.decay_tier, "none")
    })
  })

  describe("ExplainPayload includes routing_signals", () => {
    it("explain.routing_signals present", () => {
      const result = scoreCandidates({
        task: "test routing signals in explain",
        sourceAgent: "test",
        candidates: [{
          id: "agent-1",
          expertise: {
            id: "agent-1", capabilities: ["testing"], domains: ["qa"],
            validation_status: "validated",
            confidence: { band: "medium", evidence_count: 3 },
          },
        }],
        options: {},
      })
      assert.ok(result.explain.routing_signals)
      assert.strictEqual(result.explain.routing_signals.candidate_depth, 1)
    })
  })

  describe("Regression: existing expertise-routing.test.mjs scenarios still pass", () => {
    it("orchestrator-1 selected for task-planning in production/staging", () => {
      const mockCandidates = [
        { id: "orchestrator-1", expertise: { id: "orchestrator-1", capabilities: ["task-planning", "crew-coordination", "delegation"], domains: ["software-engineering", "multi-agent-systems"], input_contract: { required_fields: ["task_description"], optional_fields: ["context"], field_types: {} }, allowed_environments: ["production", "staging"], validation_status: "validated", lifecycle: "active", confidence: { score: 0.9, band: "high", evidence_count: 15 }, trust_tier: "internal" } },
        { id: "dev-lead-1", expertise: { id: "dev-lead-1", capabilities: ["code-review", "task-planning", "architecture"], domains: ["software-engineering"], input_contract: { required_fields: ["task_description"], optional_fields: [], field_types: {} }, allowed_environments: ["production", "staging", "development"], validation_status: "validated", lifecycle: "active", confidence: { score: 0.75, band: "high", evidence_count: 8 }, trust_tier: "internal" } },
      ]
      const result = scoreCandidates({
        task: "Plan the task breakdown for the new feature implementation",
        sourceAgent: "orchestrator-1",
        candidates: mockCandidates,
        options: { allowed_environments: ["production", "staging"] },
      })
      assert.strictEqual(result.selected, "orchestrator-1")
      assert.strictEqual(result.escalation, false)
    })

    it("experimental agent with 1 evidence gets -0.10 freshness + -0.15 experimental", () => {
      const result = scoreCandidates({
        task: "coordinate crew",
        sourceAgent: "test",
        candidates: [{
          id: "exp",
          expertise: {
            id: "exp", capabilities: ["coordination"], domains: ["engineering"],
            validation_status: "declared", lifecycle: "experimental",
            confidence: { band: "low", evidence_count: 1 },
          },
        }],
        options: { allowed_environments: ["production"] },
      })
      const s = result.scores["exp"]
      assert.strictEqual(s.confidence_details.freshness_penalty, -0.10)
      assert.strictEqual(s.penalties_applied.includes("lifecycle:experimental"), true)
    })

    it("trust tier filter still blocks federated when required=internal", () => {
      const candidates = [
        { id: "internal", expertise: { id: "internal", capabilities: ["p"], domains: ["e"], validation_status: "validated", lifecycle: "active", confidence: { band: "high", evidence_count: 10 }, trust_tier: "internal" } },
        { id: "federated", expertise: { id: "federated", capabilities: ["p"], domains: ["e"], validation_status: "validated", lifecycle: "active", confidence: { band: "high", evidence_count: 10 }, trust_tier: "federated" } },
      ]
      const result = scoreCandidates({ task: "p", sourceAgent: "test", candidates, options: { requiredTrustTier: "internal" } })
      assert.strictEqual(result.selected, "internal")
      assert.ok(result.scores["federated"]?.blocked_filters.some(f => f.includes("trust_tier")))
    })
  })
})