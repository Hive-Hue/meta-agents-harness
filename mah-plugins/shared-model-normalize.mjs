/**
 * Shared model ID normalization for MAH runtime plugins.
 *
 * Catalog IDs like "zai-coding-plan/glm-5" and legacy "z-ai/glm-5" are
 * normalized to their runtime-compatible form "zai/glm-5".
 * Prefix-based matching ensures future model versions are covered automatically.
 */

export function normalizeModelId(model = "") {
  const value = `${model || ""}`.trim()
  if (!value) return value

  const exact = {
    "minimax-coding-plan/MiniMax-M2.7": "minimax/minimax-m2.7"
  }
  if (exact[value]) return exact[value]

  const prefixes = [
    ["minimax-coding-plan/", "minimax/"],
    ["zai-coding-plan/", "zai/"],
    ["z-ai/", "zai/"]
  ]
  for (const [from, to] of prefixes) {
    if (value.startsWith(from)) return to + value.slice(from.length)
  }

  return value
}
