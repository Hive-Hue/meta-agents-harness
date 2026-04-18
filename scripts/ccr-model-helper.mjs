export function mapModelToCcrRef(m) {
  const v = String(m || "").trim()
  if (!v) return ""
  const i = v.indexOf("/")
  if (i <= 0 || i >= v.length - 1) return ""
  const p = v.slice(0, i).trim()
  const n = v.slice(i + 1).trim()
  const map = {
    "zai": "Zai Coding Plan",
    "zai-coding-plan": "Zai Coding Plan",
    "minimax": "Minimax",
    "minimax-coding-plan": "Minimax",
    "openrouter": "openrouter",
    "lmstudio": "lmstudio",
    "openai-codex": "openrouter"
  }
  return (map[p] || p) + "," + n
}
