import { listAgentsForContext, loadActiveContext, summarizeActiveContext } from "../lib/runtime-context.mjs"

export async function listAgentsHandler(args = {}, options = {}) {
  const state = loadActiveContext({
    repoRoot: options.repoRoot,
    env: options.env
  })

  if (!state.ok) {
    return {
      ok: false,
      error: "No active Codex crew context could be resolved.",
      context: summarizeActiveContext(state),
      topology: listAgentsForContext(state)
    }
  }

  return {
    ok: true,
    context: summarizeActiveContext(state),
    topology: listAgentsForContext(state)
  }
}
