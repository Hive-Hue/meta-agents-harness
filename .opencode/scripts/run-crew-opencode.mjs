import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { ensureCrewSelected, listCrews, repoRoot, resolveRuntimeSelection } from "./lib/crew-runtime.mjs"

function parseArgs(argv) {
  const args = {
    crew: "",
    config: "",
    hierarchy: false,
    passthrough: []
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === "--crew" && argv[i + 1]) {
      args.crew = argv[i + 1]
      i += 1
      continue
    }
    if (token === "--config" && argv[i + 1]) {
      args.config = argv[i + 1]
      i += 1
      continue
    }
    if (token === "--hierarchy") {
      args.hierarchy = true
      continue
    }
    if (token === "--no-hierarchy") {
      args.hierarchy = false
      continue
    }
    args.passthrough.push(token)
  }
  return args
}

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exitCode = 1
}

const args = parseArgs(process.argv.slice(2))
let selection = null

if (args.config) {
  const configPath = path.isAbsolute(args.config) ? args.config : path.resolve(repoRoot, args.config)
  if (!existsSync(configPath)) {
    fail(`config not found: ${args.config}`)
  } else {
    selection = { crew: "", configPath }
  }
} else {
  selection = resolveRuntimeSelection(args.crew)
}

if (!selection) {
  const crews = listCrews()
  fail("no OpenCode crew selected. Use --crew <name> or run `ocmh use <crew>`")
  if (crews.length > 0) {
    console.log("Available crews:")
    for (const crew of crews) console.log(`- ${crew}`)
  }
} else {
  if (selection.crew) {
    ensureCrewSelected(selection.crew, { hierarchy: args.hierarchy })
  } else if (args.config) {
    fail("custom --config is not supported in crew mode. Use `ocmh use <crew>` first.")
    process.exit()
  }

  console.log("Running OpenCode with selected crew config")
  console.log(`- config=${path.relative(repoRoot, selection.configPath)}`)
  if (selection.crew) console.log(`- crew=${selection.crew}`)
  if (args.hierarchy) console.log("- hierarchy=enabled")
  if (args.passthrough.length > 0) console.log(`- args=${args.passthrough.join(" ")}`)
  console.log("")

  const child = spawnSync("opencode", args.passthrough, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit"
  })
  process.exitCode = typeof child.status === "number" ? child.status : 1
}
