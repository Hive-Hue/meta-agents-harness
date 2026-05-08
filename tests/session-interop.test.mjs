/**
 * Session Interop Tests
 * @fileoverview Test suite for MAH sessions interoperability v0.6.0
 */

import { describe, it, mock, beforeEach } from "node:test"
import assert from "node:assert"

// Mock imports before use
const mockFs = {
  existsSync: mock.fn(() => true),
  mkdirSync: mock.fn(),
  readFileSync: mock.fn(() => '{"schema": "mah.session.v1"}'),
  readdirSync: mock.fn(() => [{ isDirectory: () => false, isSymbolicLink: () => false, name: "test.txt" }]),
  statSync: mock.fn(() => ({ size: 100 })),
  writeFileSync: mock.fn()
}

// Helper to create mock MahSession
function createMockMahSession(overrides = {}) {
  return {
    schema: "mah.session.v1",
    mah_session_id: "pi:dev:abc123",
    runtime: "pi",
    runtime_session_id: "abc123",
    crew: "dev",
    agent: "planning-lead",
    created_at: "2026-04-14T00:00:00.000Z",
    last_active_at: "2026-04-14T01:00:00.000Z",
    summary: "Test session summary",
    artifacts: [
      { name: "test.txt", type: "file", path: "test.txt", size_bytes: 100 }
    ],
    provenance: [
      { event: "created", timestamp: "2026-04-14T00:00:00.000Z" }
    ],
    context_blocks: [],
    raw_export_ref: null,
    ...overrides
  }
}

describe("Session Types", () => {
  it("should export MAH_SESSION_SCHEMA_VERSION constant", async () => {
    const { MAH_SESSION_SCHEMA_VERSION } = await import("../types/session-types.mjs")
    assert.strictEqual(MAH_SESSION_SCHEMA_VERSION, "mah.session.v1")
  })

  it("should export FIDELITY_LEVELS array", async () => {
    const { FIDELITY_LEVELS } = await import("../types/session-types.mjs")
    assert.ok(Array.isArray(FIDELITY_LEVELS))
    assert.ok(FIDELITY_LEVELS.includes("full"))
    assert.ok(FIDELITY_LEVELS.includes("contextual"))
    assert.ok(FIDELITY_LEVELS.includes("summary-only"))
  })

  it("should export DEFAULT_FIDELITY_LEVEL as contextual", async () => {
    const { DEFAULT_FIDELITY_LEVEL } = await import("../types/session-types.mjs")
    assert.strictEqual(DEFAULT_FIDELITY_LEVEL, "contextual")
  })
})

describe("Session Adapter Contract", () => {
  it("should export REQUIRED_SESSION_ADAPTER_FIELDS", async () => {
    const { REQUIRED_SESSION_ADAPTER_FIELDS } = await import("../scripts/session/session-adapter-contract.mjs")
    assert.ok(Array.isArray(REQUIRED_SESSION_ADAPTER_FIELDS))
    assert.ok(REQUIRED_SESSION_ADAPTER_FIELDS.includes("runtime"))
    assert.ok(REQUIRED_SESSION_ADAPTER_FIELDS.includes("listSessions"))
    assert.ok(REQUIRED_SESSION_ADAPTER_FIELDS.includes("exportSession"))
    assert.ok(REQUIRED_SESSION_ADAPTER_FIELDS.includes("buildInjectionPayload"))
  })

  it("should validate session adapters with all required fields", async () => {
    const { validateSessionAdapterContract } = await import("../scripts/session/session-adapter-contract.mjs")
    
    const validAdapter = {
      runtime: "pi",
      listSessions: async () => [],
      exportSession: async () => ({}),
      supportsRawExport: () => true,
      supportsContextInjection: () => true,
      buildInjectionPayload: async () => ({})
    }
    
    const result = validateSessionAdapterContract({ pi: validAdapter })
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.errors.length, 0)
  })

  it("should reject adapters missing required fields", async () => {
    const { validateSessionAdapterContract } = await import("../scripts/session/session-adapter-contract.mjs")
    
    const invalidAdapter = {
      runtime: "pi"
      // missing all required methods
    }
    
    const result = validateSessionAdapterContract({ pi: invalidAdapter })
    assert.strictEqual(result.ok, false)
    assert.ok(result.errors.length > 0)
  })

  it("should select fidelity level correctly", async () => {
    const { DEFAULT_FIDELITY_LEVEL } = await import("../types/session-types.mjs")
    const { selectFidelityLevel } = await import("../scripts/session/session-adapter-contract.mjs")
    
    // Default to contextual when no request
    assert.strictEqual(selectFidelityLevel(null, {}), DEFAULT_FIDELITY_LEVEL)
    
    // Use requested level if valid
    assert.strictEqual(selectFidelityLevel("summary-only", {}), "summary-only")
    
    // Use full if runtime supports it
    assert.strictEqual(selectFidelityLevel("full", { supportsFullReplay: true }), "full")
  })
})

describe("Session Export", () => {
  it("should export buildMahSessionEnvelope function", async () => {
    const { buildMahSessionEnvelope } = await import("../scripts/session/session-export.mjs")
    assert.strictEqual(typeof buildMahSessionEnvelope, "function")
  })

  it("should export all format functions", async () => {
    const mod = await import("../scripts/session/session-export.mjs")
    assert.strictEqual(typeof mod.exportSession, "function")
    assert.strictEqual(typeof mod.exportSessionMahJson, "function")
    assert.strictEqual(typeof mod.exportSessionSummaryMd, "function")
    assert.strictEqual(typeof mod.exportSessionRaw, "function")
  })
})

describe("Session Injection", () => {
  it("should export injection functions", async () => {
    const mod = await import("../scripts/session/session-injection.mjs")
    assert.strictEqual(typeof mod.determineInjectionStrategy, "function")
    assert.strictEqual(typeof mod.buildContextBlocks, "function")
    assert.strictEqual(typeof mod.buildInjectionPayload, "function")
    assert.strictEqual(typeof mod.injectSessionContext, "function")
  })

  it("should determine strategy based on fidelity level", async () => {
    const { determineInjectionStrategy } = await import("../scripts/session/session-injection.mjs")
    
    // Contextual defaults to context-injection
    const result1 = determineInjectionStrategy("contextual", "pi", {})
    assert.strictEqual(result1.strategy, "context-injection")
    
    // Summary-only uses summary-only strategy
    const result2 = determineInjectionStrategy("summary-only", "pi", {})
    assert.strictEqual(result2.strategy, "summary-only")
  })

  it("should build context blocks for different fidelity levels", async () => {
    const { buildContextBlocks } = await import("../scripts/session/session-injection.mjs")
    
    const session = createMockMahSession()
    
    // Summary-only creates fewer blocks
    const summaryBlocks = buildContextBlocks(session, "summary-only")
    assert.ok(summaryBlocks.length >= 1)
    
    // Contextual creates more blocks
    const contextualBlocks = buildContextBlocks(session, "contextual")
    assert.ok(contextualBlocks.length >= 2)
  })
})

describe("Session Bridge", () => {
  it("should export bridgeSession function", async () => {
    const { bridgeSession } = await import("../scripts/session/session-bridge.mjs")
    assert.strictEqual(typeof bridgeSession, "function")
  })
})

describe("Non-regression: Existing m3-ops", () => {
  it("should still export parseSessionId", async () => {
    const { parseSessionId } = await import("../scripts/session/m3-ops.mjs")
    assert.strictEqual(typeof parseSessionId, "function")
  })

  it("should parse valid session IDs correctly", async () => {
    const { parseSessionId } = await import("../scripts/session/m3-ops.mjs")
    
    const result = parseSessionId("pi:dev:abc123")
    assert.deepStrictEqual(result, {
      runtime: "pi",
      crew: "dev",
      sessionId: "abc123"
    })
  })

  it("should reject invalid session ID formats", async () => {
    const { parseSessionId } = await import("../scripts/session/m3-ops.mjs")
    
    assert.strictEqual(parseSessionId("invalid"), null)
    assert.strictEqual(parseSessionId("only:two"), null)
    assert.strictEqual(parseSessionId(""), null)
    assert.strictEqual(parseSessionId(null), null)
  })
})
