import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { recordDelegationEvidence } from "../../scripts/expertise/evidence/evidence-pipeline.mjs"
import { computeMetrics, loadEvidenceFor, recordEvidence } from "../../scripts/expertise/evidence/expertise-evidence-store.mjs"

function makeEvidenceRoot() {
  return mkdtempSync(join(tmpdir(), "mah-evidence-pipeline-"))
}

test("exit success is recorded as execution success while review remains unknown", async () => {
  const evidenceRoot = makeEvidenceRoot()
  try {
    await recordDelegationEvidence({
      crew: "dev",
      expertiseId: "backend-dev",
      taskDescription: "implement a verified feature",
      outcome: "success",
      durationMs: 25,
      sourceAgent: "engineering-lead",
      sessionId: "session-exit-zero",
      runtime: "test",
      output: "process completed",
      isExecuted: true,
      evidenceRoot,
    })

    const evidence = await loadEvidenceFor("dev:backend-dev", { evidenceRoot })
    assert.equal(evidence.length, 1)
    assert.equal(evidence[0].quality_signals.execution_succeeded, true)
    assert.equal(evidence[0].quality_signals.verification_passed, null)
    assert.equal(evidence[0].quality_signals.human_accepted, null)
    assert.equal(evidence[0].quality_signals.review_pass, null)
    assert.equal((await computeMetrics("dev:backend-dev", { evidenceRoot })).review_pass_rate, 0)
  } finally {
    rmSync(evidenceRoot, { recursive: true, force: true })
  }
})

test("review and human acceptance require named actors and evidence references", async () => {
  const evidenceRoot = makeEvidenceRoot()
  try {
    await recordDelegationEvidence({
      crew: "dev",
      expertiseId: "backend-dev",
      taskDescription: "implement an assessed feature",
      outcome: "success",
      durationMs: 25,
      sourceAgent: "engineering-lead",
      sessionId: "session-reviewed",
      runtime: "test",
      isExecuted: true,
      verification: {
        passed: true,
        verifier: "independent-test-suite",
        evidence: "artifact:build-42/test-report.xml",
        artifactRef: "sha256:abc123",
      },
      humanAcceptance: {
        accepted: true,
        actor: "release-owner",
        evidence: "approval:ticket-123",
        artifactRef: "sha256:abc123",
      },
      evidenceRoot,
    })

    await recordDelegationEvidence({
      crew: "dev",
      expertiseId: "backend-dev",
      taskDescription: "implement an unsubstantiated feature",
      outcome: "success",
      durationMs: 25,
      sourceAgent: "engineering-lead",
      sessionId: "session-invalid-review",
      runtime: "test",
      isExecuted: true,
      verification: { passed: true, verifier: " " },
      humanAcceptance: { accepted: true, evidence: " " },
      evidenceRoot,
    })

    await recordDelegationEvidence({
      crew: "dev",
      expertiseId: "backend-dev",
      taskDescription: "implement a rejected feature",
      outcome: "success",
      durationMs: 25,
      sourceAgent: "engineering-lead",
      sessionId: "session-rejected-review",
      runtime: "test",
      isExecuted: true,
      verification: {
        passed: false,
        verifier: "independent-test-suite",
        evidence: "artifact:build-43/test-report.xml",
        artifactRef: "sha256:def456",
      },
      evidenceRoot,
    })

    const evidence = await loadEvidenceFor("dev:backend-dev", { evidenceRoot })
    const verified = evidence.find((entry) => entry.source_session === "session-reviewed")
    const unverified = evidence.find((entry) => entry.source_session === "session-invalid-review")
    const rejected = evidence.find((entry) => entry.source_session === "session-rejected-review")

    assert.equal(verified.quality_signals.review_pass, true)
    assert.equal(verified.quality_signals.verification_passed, true)
    assert.equal(verified.quality_signals.human_accepted, true)
    assert.equal(verified.verification.verifier, "independent-test-suite")
    assert.equal(verified.verification.evidence, "artifact:build-42/test-report.xml")
    assert.equal(verified.verification.artifact_ref, "sha256:abc123")
    assert.equal(verified.human_acceptance.actor, "release-owner")

    assert.equal(unverified.quality_signals.review_pass, null)
    assert.equal(unverified.quality_signals.verification_passed, null)
    assert.equal(unverified.quality_signals.human_accepted, null)

    assert.equal(rejected.quality_signals.review_pass, false)
    assert.equal(rejected.verification.artifact_ref, "sha256:def456")
    assert.equal((await computeMetrics("dev:backend-dev", { evidenceRoot })).review_pass_rate, 0.5)
  } finally {
    rmSync(evidenceRoot, { recursive: true, force: true })
  }
})

test("evidence store preserves the supplied rejection count", async () => {
  const evidenceRoot = makeEvidenceRoot()
  try {
    const result = await recordEvidence({
      expertise_id: "dev:backend-dev",
      outcome: "failure",
      task_type: "testing",
      task_description: "three rejected checks",
      duration_ms: 10,
      quality_signals: { rejection_count: 3 },
      source_agent: "engineering-lead",
      source_session: "session-rejections",
    }, { evidenceRoot })
    assert.equal(result.ok, true)

    const evidence = await loadEvidenceFor("dev:backend-dev", { evidenceRoot })
    assert.equal(evidence.length, 1)
    assert.equal(evidence[0].quality_signals.rejection_count, 3)
  } finally {
    rmSync(evidenceRoot, { recursive: true, force: true })
  }
})
