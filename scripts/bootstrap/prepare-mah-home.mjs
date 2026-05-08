import path from "node:path"
import { fileURLToPath } from "node:url"
import { ensureMahHomeLayout } from "../core/mah-home.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.resolve(__dirname, "..", "..")

const homeRoot = ensureMahHomeLayout({ packageRoot })
console.log(`mah-home prepared at ${homeRoot}`)
