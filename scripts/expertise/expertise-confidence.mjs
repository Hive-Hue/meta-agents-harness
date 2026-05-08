/**
 * MAH Expertise Confidence Scoring Engine
 * @fileoverview Confidence computation for expertise based on evidence metrics
 * @version 0.7.0
 */

/**
 * @typedef {import('../../types/expertise-types.mjs').ExpertiseConfidence} ExpertiseConfidence
 * @typedef {Object} ComputeConfidenceOptions
 * @property {boolean} [skipRecencyPenalty] - Skip recency penalty (for testing)
 */

/**
 * Clamp a value between min and max.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

/**
 * Days between two dates.
 * @param {Date} date
 * @param {Date} now
 * @returns {number}
 */
function daysBetween(date, now) {
  const diffMs = now.getTime() - date.getTime()
  return diffMs / (1000 * 60 * 60 * 24)
}

/**
 * Determine confidence band from numeric score.
 * @param {number} score - Score between 0 and 1
 * @returns {import('../../types/expertise-types.mjs').ConfidenceBand}
 */
export function scoreToBand(score) {
  if (score < 0.3) return 'low'
  if (score < 0.6) return 'medium'
  if (score < 0.85) return 'high'
  return 'critical'
}

/**
 * Assess the provenance/trustworthiness of evidence metrics.
 * Detects suspicious patterns that may indicate fabricated or low-quality evidence.
 * // SECURITY: v0.7.0-patch
 * @param {object} metrics - ExpertiseMetrics object
 * @returns {{ source: 'verified' | 'unverified' | 'fabricated_risk', trust_score: number, flags: string[] }}
 */
export function assessProvenance(metrics) {
  const flags = []
  const {
    total_invocations = 0,
    successful_invocations = 0,
    evidence_count: rawEvidenceCount,
    last_invoked = null,
    review_pass_rate = 0,
  } = metrics
  const evidence_count = typeof rawEvidenceCount === 'number' ? rawEvidenceCount : total_invocations

  // Check: evidence_count > 0 but last_invoked is null → suspicious
  if (evidence_count > 0 && (last_invoked === null || last_invoked === undefined)) {
    flags.push('evidence_present_but_never_invoked')
  }

  // Check: success rate > 0.99 with evidence_count < 5 → fabricated_risk
  if (total_invocations > 0) {
    const successRate = successful_invocations / total_invocations
    if (successRate > 0.99 && evidence_count < 5) {
      flags.push('suspiciously_high_success_rate_with_low_evidence')
    }
  }

  // Check: very high review pass rate with very low evidence → flag
  if (review_pass_rate >= 1.0 && evidence_count > 0 && evidence_count < 3) {
    flags.push('perfect_review_with_minimal_evidence')
  }

  // Determine provenance level
  if (flags.length === 0) {
    return { source: 'verified', trust_score: 1.0, flags }
  }
  if (flags.some(f => f.includes('suspiciously_high') || f.includes('perfect_review'))) {
    return { source: 'fabricated_risk', trust_score: 0.3, flags }
  }
  return { source: 'unverified', trust_score: 0.7, flags }
}

/**
 * Compute confidence from evidence metrics.
 * @param {object} metrics - ExpertiseMetrics from computeMetrics()
 * @param {ComputeConfidenceOptions} [options]
 * @returns {ExpertiseConfidence}
 */
export function computeConfidence(metrics, options = {}) {
  const {
    total_invocations = 0,
    successful_invocations = 0,
    review_pass_rate = 0,
    rejection_rate = 0,
    last_invoked = null,
  } = metrics

  // 1. Base score from success rate (max 0.5)
  let successRate = 0
  if (total_invocations > 0) {
    successRate = successful_invocations / total_invocations
  }
  const baseScore = successRate * 0.5

  // 2. Quality adjustment (max 0.3)
  const qualityScore = review_pass_rate * 0.3

  // 3. Recency penalty
  let recencyPenalty = 0
  if (last_invoked === null || last_invoked === undefined) {
    recencyPenalty = -0.1
  } else {
    const lastDate = new Date(last_invoked)
    const now = new Date()
    const days = daysBetween(lastDate, now)
    if (days > 30) {
      recencyPenalty = -0.05
    }
  }

  // 4. Rejection penalty (max -0.2)
  const rejectionPenalty = Math.min(rejection_rate * 0.2, 0.2)

  // 5. Final score
  const score = clamp(baseScore + qualityScore + recencyPenalty - rejectionPenalty, 0, 1)

  // SECURITY: v0.7.0-patch — provenance-based trust cap
  const provenance = assessProvenance(metrics)
  let trustCappedScore = score
  if (provenance.source === 'unverified') {
    trustCappedScore = score * 0.7
  } else if (provenance.source === 'fabricated_risk') {
    trustCappedScore = Math.min(score, 0.2)
  }
  const finalScore = clamp(trustCappedScore, 0, 1)

  // 6. Band
  const band = scoreToBand(finalScore)

  // 7. Evidence count from total_invocations
  const evidenceCount = total_invocations

  return {
    score: finalScore,
    band,
    evidence_count: evidenceCount,
    provenance: { source: provenance.source, trust_score: provenance.trust_score, flags: provenance.flags },
  }
}

/**
 * Merge evidence-based confidence with declared confidence.
 * If declared is higher, prefer it but cap at evidence-supported level.
 * @param {ExpertiseConfidence | undefined} declared
 * @param {ExpertiseConfidence} computed
 * @returns {ExpertiseConfidence}
 */
export function mergeConfidence(declared, computed) {
  if (!declared) return computed

  // Cap declared at computed + 0.2 (operator trust but limited by evidence)
  const cappedDeclaredScore = Math.min(computed.score + 0.2, declared.score)

  // If declared is still higher than computed, use it with cap
  if (declared.score > computed.score) {
    return {
      score: cappedDeclaredScore,
      band: scoreToBand(cappedDeclaredScore),
      evidence_count: computed.evidence_count, // always use computed's evidence_count
    }
  }

  return computed
}

/**
 * Cap confidence based on minimum evidence threshold.
 * @param {ExpertiseConfidence} confidence
 * @param {number} evidenceCount
 * @returns {ExpertiseConfidence}
 */
export function applyEvidenceFloor(confidence, evidenceCount) {
  if (evidenceCount < 1) {
    // No evidence yet
    return {
      score: 0.1,
      band: 'low',
      evidence_count: evidenceCount,
    }
  }

  if (evidenceCount < 3) {
    // Fresh expertise penalty
    return {
      score: Math.min(confidence.score, 0.4),
      band: 'low',
      evidence_count: evidenceCount,
    }
  }

  return confidence
}

// ---------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== Expertise Confidence Scoring Engine Self-Test ===\n')

  // Test 1: Zero evidence -> score=0.1, band="low"
  console.log('[1] Zero evidence...')
  const zeroMetrics = {
    total_invocations: 0,
    successful_invocations: 0,
    review_pass_rate: 0,
    rejection_rate: 0,
    last_invoked: null,
  }
  const zeroConf = computeConfidence(zeroMetrics)
  console.log(`    score=${zeroConf.score} (expected ~0.1), band=${zeroConf.band} (expected low)`)
  console.assert(zeroConf.band === 'low', 'Zero evidence should be low band')
  const flooredZero = applyEvidenceFloor(zeroConf, 0)
  console.assert(flooredZero.score === 0.1, 'Zero evidence should score 0.1 after floor')
  console.log('    PASS')

  // Test 2: All successful + perfect review_pass -> high band
  console.log('\n[2] All successful + perfect review...')
  const perfectMetrics = {
    total_invocations: 10,
    successful_invocations: 10,
    review_pass_rate: 1.0,
    rejection_rate: 0,
    last_invoked: new Date().toISOString(), // recent
  }
  const perfectConf = computeConfidence(perfectMetrics)
  console.log(`    score=${perfectConf.score.toFixed(3)}, band=${perfectConf.band}`)
  console.assert(perfectConf.band === 'high' || perfectConf.band === 'critical', 'Perfect should be high/critical')
  console.log('    PASS')

  // Test 3: High rejection rate -> lower score
  console.log('\n[3] High rejection rate...')
  const rejectMetrics = {
    total_invocations: 10,
    successful_invocations: 8,
    review_pass_rate: 0.8,
    rejection_rate: 0.8, // 80% rejection rate
    last_invoked: new Date().toISOString(),
  }
  const rejectConf = computeConfidence(rejectMetrics)
  console.log(`    score=${rejectConf.score.toFixed(3)} (should be lower than without rejections)`)
  // rejection_penalty = min(0.8 * 0.2, 0.2) = 0.16
  // base = (8/10) * 0.5 = 0.4, quality = 0.8 * 0.3 = 0.24
  // score = 0.4 + 0.24 - 0.16 = 0.48
  console.assert(rejectConf.score < 0.6, 'High rejection should lower score')
  console.log('    PASS')

  // Test 4: scoreToBand boundaries
  console.log('\n[4] scoreToBand boundaries...')
  console.assert(scoreToBand(0.0) === 'low', '0.0 should be low')
  console.assert(scoreToBand(0.29) === 'low', '0.29 should be low')
  console.assert(scoreToBand(0.3) === 'medium', '0.3 should be medium')
  console.assert(scoreToBand(0.59) === 'medium', '0.59 should be medium')
  console.assert(scoreToBand(0.6) === 'high', '0.6 should be high')
  console.assert(scoreToBand(0.84) === 'high', '0.84 should be high')
  console.assert(scoreToBand(0.85) === 'critical', '0.85 should be critical')
  console.assert(scoreToBand(1.0) === 'critical', '1.0 should be critical')
  console.log('    PASS')

  // Test 5: applyEvidenceFloor caps score at 0.4 when evidence_count < 3
  console.log('\n[5] applyEvidenceFloor with low evidence...')
  const midConf = { score: 0.7, band: 'high', evidence_count: 2 }
  const floored = applyEvidenceFloor(midConf, 2)
  console.log(`    original score=0.7, floored score=${floored.score} (expected 0.4), band=${floored.band} (expected low)`)
  console.assert(floored.score === 0.4, 'Should cap at 0.4')
  console.assert(floored.band === 'low', 'Should be low band')
  console.log('    PASS')

  // Test 6: mergeConfidence respects declared but caps at evidence
  console.log('\n[6] mergeConfidence...')
  const declaredHigh = { score: 0.8, band: 'high', evidence_count: 2 }
  const computedLow = { score: 0.3, band: 'low', evidence_count: 10 }
  const merged = mergeConfidence(declaredHigh, computedLow)
  console.log(`    declared=0.8, computed=0.3, merged=${merged.score.toFixed(3)} (expected 0.5 = 0.3+0.2)`)
  console.assert(merged.score === 0.5, 'Should cap at computed + 0.2')
  console.assert(merged.evidence_count === 10, 'Should use computed evidence_count')
  console.log('    PASS')

  // Test 7: mergeConfidence when computed is higher
  console.log('\n[7] mergeConfidence when computed > declared...')
  const declaredLow = { score: 0.2, band: 'low', evidence_count: 1 }
  const computedHigh = { score: 0.6, band: 'high', evidence_count: 20 }
  const merged2 = mergeConfidence(declaredLow, computedHigh)
  console.log(`    declared=0.2, computed=0.6, merged=${merged2.score.toFixed(3)} (expected 0.6, use computed)`)
  console.assert(merged2.score === 0.6, 'Should use computed when computed > declared')
  console.log('    PASS')

  // Test 8: Recency penalty
  console.log('\n[8] Recency penalty...')
  const oldMetrics = {
    total_invocations: 10,
    successful_invocations: 10,
    review_pass_rate: 1.0,
    rejection_rate: 0,
    last_invoked: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days ago
  }
  const oldConf = computeConfidence({ ...oldMetrics, evidence_count: oldMetrics.total_invocations })
  console.log(`    60-day-old metrics score=${oldConf.score.toFixed(3)} (should have -0.05 penalty)`)
  console.assert(oldConf.score < 0.8, 'Old evidence should have penalty')
  console.log('    PASS')

  // Test 9: Provenance assessment — verified metrics
  console.log('\n[9] assessProvenance — verified metrics...')
  const verifiedMetrics = { total_invocations: 10, successful_invocations: 8, evidence_count: 10, last_invoked: new Date().toISOString(), review_pass_rate: 0.8 }
  const provVerified = assessProvenance(verifiedMetrics)
  console.log(`    source=${provVerified.source} (expected verified), flags=${JSON.stringify(provVerified.flags)}`)
  console.assert(provVerified.source === 'verified', 'Normal metrics should be verified')
  console.log('    PASS')

  // Test 10: Provenance — suspiciously high success rate
  console.log('\n[10] assessProvenance — fabricated_risk...')
  const fabMetrics = { total_invocations: 4, successful_invocations: 4, evidence_count: 4, last_invoked: new Date().toISOString(), review_pass_rate: 0.5 }
  const provFab = assessProvenance(fabMetrics)
  console.log(`    source=${provFab.source} (expected fabricated_risk), flags=${JSON.stringify(provFab.flags)}`)
  console.assert(provFab.source === 'fabricated_risk', '4/4 success with < 5 evidence should be fabricated_risk')
  console.log('    PASS')

  // Test 11: Provenance — evidence but never invoked
  console.log('\n[11] assessProvenance — unverified (evidence but no last_invoked)...')
  const unprovMetrics = { total_invocations: 5, successful_invocations: 3, evidence_count: 5, last_invoked: null, review_pass_rate: 0.6 }
  const provUnprov = assessProvenance(unprovMetrics)
  console.log(`    source=${provUnprov.source} (expected unverified), flags=${JSON.stringify(provUnprov.flags)}`)
  console.assert(provUnprov.source === 'unverified', 'Evidence but null last_invoked should be unverified')
  console.log('    PASS')

  // Test 12: computeConfidence caps provenance
  console.log('\n[12] computeConfidence provenance cap...')
  const fabConf = computeConfidence(fabMetrics)
  console.log(`    score=${fabConf.score.toFixed(3)} (should be capped at 0.2), provenance=${fabConf.provenance?.source}`)
  console.assert(fabConf.score <= 0.2, 'Fabricated risk should cap at 0.2')
  console.assert(fabConf.provenance?.source === 'fabricated_risk', 'Provenance should be in result')
  console.log('    PASS')

  console.log('\n=== All Self-Tests Passed ===')
}
