import { loadActiveContext, summarizeActiveContext } from "../lib/runtime-context.mjs"

export async function getActiveContextHandler(args = {}, options = {}) {
  const state = loadActiveContext({
    repoRoot: options.repoRoot,
    env: options.env
  })

  if (!state.ok) {
    return {
      ok: false,
      error: "No active Codex crew context could be resolved. Expected MAH_ACTIVE_CREW, MAH_AGENT, and .codex/crew/<crew>/multi-team.yaml.",
      context: summarizeActiveContext(state)
    }
  }

  return {
    ok: true,
    context: summarizeActiveContext(state)
  }
}
