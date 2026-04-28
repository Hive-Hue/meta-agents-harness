import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const defaultPackageRoot = path.resolve(__dirname, "..")
export const CANONICAL_MAH_SKILLS = [
  "active-listener",
  "bootstrap",
  "caveman",
  "caveman-commit",
  "caveman-crew",
  "caveman-help",
  "caveman-review",
  "caveman-compress",
  "delegate-bounded",
  "context-memory",
  "expertise-model",
  "expertise-governance"
]

function firstExisting(paths = []) {
  for (const candidate of paths) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return ""
}

function copyDirectoryTree(sourcePath, targetPath) {
  if (!sourcePath || !existsSync(sourcePath)) return false
  if (existsSync(targetPath)) {
    try {
      if (lstatSync(targetPath).isSymbolicLink()) {
        rmSync(targetPath, { recursive: true, force: true })
      }
    } catch {
      // ignore stat errors and continue with copy
    }
  }
  mkdirSync(targetPath, { recursive: true })
  for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
    const sourceEntry = path.join(sourcePath, entry.name)
    const targetEntry = path.join(targetPath, entry.name)
    if (existsSync(targetEntry)) {
      try {
        if (lstatSync(targetEntry).isSymbolicLink()) {
          rmSync(targetEntry, { recursive: true, force: true })
        }
      } catch {
        // ignore stat errors and let cpSync decide
      }
    }
    if (entry.isDirectory()) {
      copyDirectoryTree(sourceEntry, targetEntry)
      continue
    }
    cpSync(sourceEntry, targetEntry, { force: true, dereference: true })
  }
  return true
}

function readJsonFile(targetPath) {
  if (!existsSync(targetPath)) return null
  try {
    return JSON.parse(readFileSync(targetPath, "utf-8"))
  } catch {
    return null
  }
}

function writeJsonFile(targetPath, payload) {
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
}

export function resolveMahHome() {
  const override = `${process.env.MAH_HOME || ""}`.trim()
  if (override) return path.resolve(override)
  return path.join(os.homedir(), ".mah")
}

export function resolveMahHomePath(...segments) {
  return path.join(resolveMahHome(), ...segments)
}

export function ensureMahHomeLayout({ packageRoot = defaultPackageRoot } = {}) {
  const homeRoot = resolveMahHome()
  mkdirSync(homeRoot, { recursive: true })
  mkdirSync(path.join(homeRoot, "mah-plugins"), { recursive: true })
  const expertiseRoot = path.join(homeRoot, "expertise")
  mkdirSync(expertiseRoot, { recursive: true })
  rmSync(path.join(expertiseRoot, "catalog"), { recursive: true, force: true })
  rmSync(path.join(expertiseRoot, "registry.json"), { force: true })

  const skillRoot = path.join(homeRoot, "skills")
  rmSync(skillRoot, { recursive: true, force: true })
  mkdirSync(skillRoot, { recursive: true })
  for (const skillName of CANONICAL_MAH_SKILLS) {
    const sourceSkillPath = path.join(packageRoot, "skills", skillName)
    const targetSkillPath = path.join(skillRoot, skillName)
    copyDirectoryTree(sourceSkillPath, targetSkillPath)
  }

  copyDirectoryTree(path.join(packageRoot, "extensions"), path.join(homeRoot, "extensions"))
  copyDirectoryTree(path.join(packageRoot, "scripts"), path.join(homeRoot, "scripts"))
  ensurePiGlobalSettings(homeRoot)

  return homeRoot
}

export function ensurePiGlobalSettings(mahHomeRoot = resolveMahHome()) {
  const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json")
  const themeOverlayPath = path.join(mahHomeRoot, "extensions", "themes")
  const current = readJsonFile(settingsPath)
  const settings = current && typeof current === "object" && !Array.isArray(current) ? { ...current } : {}
  const existingThemes = Array.isArray(settings.themes) ? settings.themes.map((item) => `${item || ""}`.trim()).filter(Boolean) : []
  const nextThemes = [...new Set([...existingThemes, themeOverlayPath])]
  const changed = nextThemes.length !== existingThemes.length || nextThemes.some((item, index) => item !== existingThemes[index])

  if (changed) {
    settings.themes = nextThemes
    writeJsonFile(settingsPath, settings)
  }

  return {
    settingsPath,
    themeOverlayPath,
    changed
  }
}

export function resolveMahAssetPath(repoRoot, targetPath, { packageRoot = defaultPackageRoot } = {}) {
  if (!targetPath) return ""
  if (path.isAbsolute(targetPath)) return targetPath

  const homePath = path.resolve(resolveMahHome(), targetPath)
  if (existsSync(homePath)) return homePath

  const localPath = path.resolve(repoRoot, targetPath)
  if (existsSync(localPath)) return localPath

  const packagePath = path.resolve(packageRoot, targetPath)
  if (existsSync(packagePath)) return packagePath

  return localPath
}

export function getMahPluginSearchPaths({ packageRoot = defaultPackageRoot, homeRoot = resolveMahHome() } = {}) {
  return [
    path.join(homeRoot, "mah-plugins"),
    path.join(packageRoot, "mah-plugins")
  ]
}

export function findMahSkillFile(skillName, {
  repoRoot,
  packageRoot = defaultPackageRoot,
  runtimeDirs = [".opencode", ".claude", ".kilo", ".pi"]
} = {}) {
  const candidates = []
  candidates.push(path.join(resolveMahHome(), "skills", skillName, "SKILL.md"))
  candidates.push(path.join(resolveMahHome(), "skills", skillName.replaceAll("-", "_"), "SKILL.md"))
  if (repoRoot) {
    for (const runtimeDir of runtimeDirs) {
      candidates.push(path.join(repoRoot, runtimeDir, "skills", skillName, "SKILL.md"))
      candidates.push(path.join(repoRoot, runtimeDir, "skills", skillName.replaceAll("-", "_"), "SKILL.md"))
    }
    candidates.push(path.join(repoRoot, "skills", skillName, "SKILL.md"))
    candidates.push(path.join(repoRoot, "skills", skillName.replaceAll("-", "_"), "SKILL.md"))
  }
  candidates.push(path.join(packageRoot, "skills", skillName, "SKILL.md"))
  candidates.push(path.join(packageRoot, "skills", skillName.replaceAll("-", "_"), "SKILL.md"))
  return firstExisting(candidates)
}
