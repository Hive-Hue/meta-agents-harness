/**
 * MAH Expertise Lifecycle State Machine
 * @fileoverview Lifecycle state machine for expertise management in MAH v0.7.0
 * @version 0.7.0
 */

import {
  LIFECYCLE_STATES,
  VALIDATION_STATUSES,
} from '../types/expertise-types.mjs';

/**
 * @typedef {import('../types/expertise-types.mjs').Expertise} Expertise
 * @typedef {LIFECYCLE_STATES[number]} LifecycleState
 * @typedef {VALIDATION_STATUSES[number]} ValidationStatus
 */

// All possible lifecycle states (re-export from types)
export { LIFECYCLE_STATES };

/**
 * Valid transitions map: from -> [allowed to states]
 * @type {Record<LifecycleState, LifecycleState[]>}
 */
export const LIFECYCLE_TRANSITIONS = {
  draft: ['active', 'experimental', 'deprecated'],
  active: ['experimental', 'restricted', 'deprecated'],
  experimental: ['active', 'restricted', 'deprecated'],
  restricted: ['active', 'deprecated'],
  deprecated: [], // terminal state - no transitions allowed
};

/**
 * Check if a transition is valid (without checking requirements)
 * @param {LifecycleState} from
 * @param {LifecycleState} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
  const allowed = LIFECYCLE_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Get transition requirements as human-readable strings
 * @param {LifecycleState} from
 * @param {LifecycleState} to
 * @returns {string[]}
 */
export function getTransitionRequirements(from, to) {
  const reqs = {
    'draft:active': [
      'validation_status must be "validated" or "declared"',
      'evidence_count must be >= 3',
    ],
    'draft:experimental': [],
    'draft:deprecated': [],
    'active:experimental': [],
    'active:restricted': ['reason must be provided (policy/trust concern)'],
    'active:deprecated': ['reason must be provided'],
    'experimental:active': [
      'validation_status must be "validated"',
      'evidence_count must be >= 5',
      'review_pass_rate must be >= 0.8',
    ],
    'experimental:restricted': ['reason must be provided'],
    'experimental:deprecated': ['reason must be provided'],
    'restricted:active': [
      'validation_status must be "validated"',
      'evidence_count must be >= 3',
      'reason must be "restriction_lifted"',
    ],
    'restricted:deprecated': ['reason must be provided'],
    'deprecated:active': ['deprecated is a terminal state in v0.7.0'],
    'deprecated:draft': ['deprecated is a terminal state in v0.7.0'],
  };

  return reqs[`${from}:${to}`] ?? [];
}

/**
 * Check if transition requirements are met
 * @param {Expertise} expertise
 * @param {LifecycleState} from
 * @param {LifecycleState} to
 * @param {{ review_pass_rate?: number } | null} [metrics]
 * @returns {{ ok: boolean, errors: string[] }}
 */
function checkRequirements(expertise, from, to, metrics = null) {
  const errors = [];

  if (from === 'draft' && to === 'active') {
    if (!['validated', 'declared'].includes(expertise.validation_status)) {
      errors.push(`validation_status must be "validated" or "declared", got "${expertise.validation_status}"`);
    }
    if ((expertise.confidence?.evidence_count ?? 0) < 3) {
      errors.push(`evidence_count must be >= 3, got ${expertise.confidence?.evidence_count ?? 0}`);
    }
  }

  if (from === 'experimental' && to === 'active') {
    if (expertise.validation_status !== 'validated') {
      errors.push(`validation_status must be "validated", got "${expertise.validation_status}"`);
    }
    if ((expertise.confidence?.evidence_count ?? 0) < 5) {
      errors.push(`evidence_count must be >= 5, got ${expertise.confidence?.evidence_count ?? 0}`);
    }
    const reviewPassRate = metrics?.review_pass_rate ?? expertise.metrics?.review_pass_rate
    if (typeof reviewPassRate !== 'number') {
      errors.push('review_pass_rate must be provided for experimental -> active transition');
    } else if (reviewPassRate < 0.8) {
      errors.push(`review_pass_rate must be >= 0.8, got ${reviewPassRate}`);
    }
  }

  if (from === 'restricted' && to === 'active') {
    if (expertise.validation_status !== 'validated') {
      errors.push(`validation_status must be "validated", got "${expertise.validation_status}"`);
    }
    if ((expertise.confidence?.evidence_count ?? 0) < 3) {
      errors.push(`evidence_count must be >= 3, got ${expertise.confidence?.evidence_count ?? 0}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Check if an actor is authorized to perform a given lifecycle transition.
 * Sensitive transitions require actor with role 'admin' or 'governance'.
 * Non-sensitive transitions are always authorized (with optional warning).
 * // SECURITY: v0.7.0-patch
 * @param {{ id?: string, role?: string } | null} actor
 * @param {LifecycleState} fromState
 * @param {LifecycleState} toState
 * @returns {{ authorized: boolean, reason?: string }}
 */
export function isAuthorizedTransition(actor, fromState, toState) {
  const SENSITIVE_TRANSITIONS = new Set([
    'restricted:active',
    'active:restricted',
  ])
  const key = `${fromState}:${toState}`

  if (!SENSITIVE_TRANSITIONS.has(key)) {
    return { authorized: true }
  }

  // Sensitive transition — require authorized actor
  if (!actor) {
    return { authorized: false, reason: `sensitive transition '${key}' requires an actor with role 'admin' or 'governance' — no actor provided` }
  }

  if (!actor.role && !actor.id) {
    return { authorized: false, reason: `sensitive transition '${key}' requires actor with .role or .id field` }
  }

  if (actor.role !== 'admin' && actor.role !== 'governance') {
    return { authorized: false, reason: `sensitive transition '${key}' requires actor with role 'admin' or 'governance', got '${actor.role || 'none'}'` }
  }

  return { authorized: true }
}

/**
 * Execute a lifecycle transition (validate + update)
 * @param {Expertise} expertise
 * @param {LifecycleState} targetState
 * @param {string} [reason]
 * @param {{ review_pass_rate?: number } | null} [metrics]
 * @returns {{ ok: boolean, expertise?: Expertise, errors?: string[], warnings?: string[] }}
 */
export function transitionExpertise(expertise, targetState, reason, metrics = null, actor = null) {
  const currentState = expertise.lifecycle;
  const errors = [];
  const warnings = [];

  // SECURITY: v0.7.0-patch — hard authorization enforcement for sensitive transitions
  const authCheck = isAuthorizedTransition(actor, currentState, targetState)
  if (!authCheck.authorized) {
    errors.push(authCheck.reason)
  } else {
    // Non-blocking warning for non-sensitive transitions without actor
    const SENSITIVE_TRANSITIONS = new Set(['restricted:active', 'active:restricted'])
    const transitionKey = `${currentState}:${targetState}`
    if (!SENSITIVE_TRANSITIONS.has(transitionKey) && !actor) {
      warnings.push(`transition '${transitionKey}' performed without actor context — consider providing an actor for audit trail`)
    }
  }

  // Validate target state is valid
  if (!LIFECYCLE_STATES.includes(targetState)) {
    return { ok: false, errors: [`Invalid target state: ${targetState}`] };
  }

  // Check if transition is structurally valid
  if (!canTransition(currentState, targetState)) {
    return {
      ok: false,
      errors: [
        `Invalid transition: ${currentState} -> ${targetState} is not allowed`,
        ...getTransitionRequirements(currentState, targetState).map(r => `Requirement: ${r}`),
      ],
    };
  }

  // Check specific requirements
  const reqCheck = checkRequirements(expertise, currentState, targetState, metrics);
  if (!reqCheck.ok) {
    errors.push(...reqCheck.errors);
  }

  // Require reason for restricted/deprecated targets
  if ((targetState === 'restricted' || targetState === 'deprecated') && !reason) {
    errors.push(`reason is required when transitioning to "${targetState}"`);
  }

  // Special check for restricted -> active with reason="restriction_lifted"
  if (currentState === 'restricted' && targetState === 'active') {
    if (reason !== 'restriction_lifted') {
      errors.push('reason must be "restriction_lifted" when returning from restricted to active');
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Execute transition - create updated expertise
  const updatedExpertise = {
    ...expertise,
    lifecycle: targetState,
    metadata: {
      ...expertise.metadata,
      updated: new Date().toISOString(),
      // SECURITY: v0.7.0-patch — transition audit trail
      ...(actor ? { _transition_actor: actor.id || actor.role, _transition_at: new Date().toISOString() } : {}),
    },
  };

  return { ok: true, expertise: updatedExpertise, warnings };
}

/**
 * Get human-readable description of a lifecycle state
 * @param {LifecycleState} state
 * @returns {string}
 */
export function describeLifecycle(state) {
  const descriptions = {
    draft: 'Expertise is being defined and is not yet active',
    active: 'Expertise is operational and being used for routing',
    experimental: 'Expertise is being validated through real task execution',
    restricted: 'Expertise use is temporarily limited pending review',
    deprecated: 'Expertise has been retired and should not be used',
  };
  return descriptions[state] ?? `Unknown lifecycle state: ${state}`;
}

/**
 * Get recommended next states from current state
 * @param {LifecycleState} current
 * @returns {LifecycleState[]}
 */
export function getSuggestedNextStates(current) {
  return LIFECYCLE_TRANSITIONS[current] ?? [];
}

// Self-test
function runTests() {
  console.log('Running expertise-lifecycle self-tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.log(`  ✗ ${message}`);
      failed++;
    }
  }

  // Test canTransition
  assert(canTransition('draft', 'active') === true, 'canTransition(draft, active) = true (structural transition, requirements checked separately)');
  assert(canTransition('draft', 'experimental') === true, 'canTransition(draft, experimental) = true');
  assert(canTransition('deprecated', 'active') === false, 'canTransition(deprecated, active) = false (terminal)');
  assert(canTransition('active', 'restricted') === true, 'canTransition(active, restricted) = true');
  assert(canTransition('restricted', 'active') === true, 'canTransition(restricted, active) = true');
  assert(canTransition('experimental', 'deprecated') === true, 'canTransition(experimental, deprecated) = true');

  // Test transitionExpertise with invalid transition
  const draftExpertise = {
    id: 'test:draft',
    lifecycle: 'draft',
    validation_status: 'declared',
    confidence: { score: 0.5, band: 'medium', evidence_count: 2 },
    metadata: { created: '2024-01-01', updated: '2024-01-01', owner_id: 'test', tags: [] },
    owner: {},
    schema_version: 'mah.expertise.v1',
    capabilities: [],
    domains: [],
    input_contract: { required_fields: [], optional_fields: [], field_types: {} },
    allowed_environments: [],
    trust_tier: 'internal',
    policy: { federated_allowed: false, allowed_domains: [], approval_required: false },
    evidence_refs: [],
  };

  // draft -> active should fail (needs evidence_count >= 3)
  const result1 = transitionExpertise(draftExpertise, 'active');
  assert(result1.ok === false, 'transitionExpertise(draft, active) fails without enough evidence');

  // draft -> experimental should succeed
  const result2 = transitionExpertise(draftExpertise, 'experimental');
  assert(result2.ok === true, 'transitionExpertise(draft, experimental) succeeds');
  assert(result2.expertise.lifecycle === 'experimental', 'expertise.lifecycle updated to experimental');

  // Test deprecated is terminal
  const deprecatedExpertise = { ...draftExpertise, lifecycle: 'deprecated' };
  const result3 = transitionExpertise(deprecatedExpertise, 'active');
  assert(result3.ok === false, 'transitionExpertise(deprecated, active) fails (terminal)');

  // Test reason required for deprecated
  const activeExpertise = { ...draftExpertise, lifecycle: 'active', validation_status: 'validated', confidence: { score: 0.8, band: 'high', evidence_count: 10 } };
  const result4 = transitionExpertise(activeExpertise, 'deprecated');
  assert(result4.ok === false, 'transitionExpertise(active, deprecated) fails without reason');
  const result5 = transitionExpertise(activeExpertise, 'deprecated', 'no longer needed');
  assert(result5.ok === true, 'transitionExpertise(active, deprecated, reason) succeeds with reason');

  // Test restricted -> active requires restriction_lifted
  const restrictedExpertise = {
    ...draftExpertise,
    lifecycle: 'restricted',
    validation_status: 'validated',
    confidence: { score: 0.8, band: 'high', evidence_count: 5 },
  };
  const result6 = transitionExpertise(restrictedExpertise, 'active', 'wrong_reason');
  assert(result6.ok === false, 'transitionExpertise(restricted, active) fails with wrong reason');
  // SECURITY: v0.7.0-patch — restricted→active now requires authorized actor
  const result7 = transitionExpertise(restrictedExpertise, 'active', 'restriction_lifted', null, { id: 'admin-1', role: 'admin' });
  assert(result7.ok === true, 'transitionExpertise(restricted, active, restriction_lifted) succeeds with authorized actor');

  // SECURITY: v0.7.0-patch — hard enforcement tests
  const sensitiveNoActor = transitionExpertise(activeExpertise, 'restricted', 'policy_violation');
  assert(sensitiveNoActor.ok === false, 'sensitive transition without actor is BLOCKED (hard enforcement)');
  assert((sensitiveNoActor.errors || []).some(e => e.includes('no actor provided')), 'error message mentions missing actor');

  const sensitiveWrongActor = transitionExpertise(activeExpertise, 'restricted', 'policy_violation', null, { id: 'user-1', role: 'worker' });
  assert(sensitiveWrongActor.ok === false, 'sensitive transition with non-admin actor is BLOCKED');
  assert((sensitiveWrongActor.errors || []).some(e => e.includes("'admin' or 'governance'")), 'error message mentions required roles');

  const restrictedAgain = { ...activeExpertise, lifecycle: 'restricted' };
  const sensitiveAdmin = transitionExpertise(restrictedAgain, 'active', 'restriction_lifted', null, { id: 'gov-1', role: 'governance' });
  assert(sensitiveAdmin.ok === true, 'sensitive transition with governance actor succeeds');
  assert(!!sensitiveAdmin.expertise.metadata._transition_actor, 'transition actor is stored in metadata');
  assert(!!sensitiveAdmin.expertise.metadata._transition_at, 'transition timestamp is stored in metadata');

  // Non-sensitive transition should still work without actor (backward compat)
  const nonSensitiveNoActor = transitionExpertise(draftExpertise, 'experimental');
  assert(nonSensitiveNoActor.ok === true, 'non-sensitive transition without actor still succeeds');

  // Test getSuggestedNextStates
  const suggestions = getSuggestedNextStates('draft');
  assert(suggestions.includes('experimental'), 'draft suggests experimental');
  assert(suggestions.includes('active'), 'draft suggests active');
  assert(suggestions.includes('deprecated'), 'draft suggests deprecated');
  assert(getSuggestedNextStates('deprecated').length === 0, 'deprecated has no suggestions');

  // Test describeLifecycle
  assert(describeLifecycle('active').includes('operational'), 'describeLifecycle(active) works');
  assert(describeLifecycle('deprecated').includes('retired'), 'describeLifecycle(deprecated) works');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  console.log('All tests passed!');
}
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}
