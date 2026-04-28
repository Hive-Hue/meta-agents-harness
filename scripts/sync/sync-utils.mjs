export function determineAction(status) {
  if (status === "missing") return "create"
  if (status === "out_of_sync") return "update"
  if (status === "ok") return "no_change"
  if (status === "synced") return "applied"
  return "unknown"
}
