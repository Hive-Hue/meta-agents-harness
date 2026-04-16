/**
 * MAH Expertise Confidence Scoring Engine
 * @fileoverview Confidence computation for expertise based on evidence metrics
 * @version 0.7.0
 */

/**
 * @typedef {import('../types/expertise-types.mjs').ExpertiseConfidence} ExpertiseConfidence
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
 * @returns {import('../types/expertise-types.mjs').ConfidenceBand}
 */
export function scoreToBand(score) {
  if (score < 0.3) return 'low'
  if (score < 0.6) return 'medium'
  if (score < 0.85) return 'high'
  return 'critical'
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

  // 6. Band
  const band = scoreToBand(score)

  // 7. Evidence count from total_invocations
  const evidenceCount = total_invocations

  return {
    score,
    band,
    evidence_count: evidenceCount,
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
  const oldConf = computeConfidence(oldMetrics)
  console.log(`    60-day-old metrics score=${oldConf.score.toFixed(3)} (should have -0.05 penalty)`)
  console.assert(oldConf.score < 0.8, 'Old evidence should have penalty')
  console.log('    PASS')

  console.log('\n=== All Self-Tests Passed ===')
}
