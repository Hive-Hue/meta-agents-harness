import http from 'node:http'
import https from 'node:https'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webuiRoot = fileURLToPath(new URL('../', import.meta.url))
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

export function createWebServer({ api, staticRoot = path.join(webuiRoot, 'dist'), tls } = {}) {
  if (typeof api !== 'function') throw new Error('API middleware is required')
  const root = realpathSync(staticRoot)
  const handler = (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Frame-Options', 'DENY')
    try {
      api(req, res, () => {
        const url = new URL(req.url, 'http://localhost')
        if (url.pathname.startsWith('/api/')) { res.writeHead(404); res.end(); return }
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return }
        let name
        try { name = decodeURIComponent(url.pathname) } catch { res.writeHead(400); res.end(); return }
        if (name.includes('\0') || name.includes('\\') || name.split('/').includes('..')) { res.writeHead(400); res.end(); return }
        let candidate = path.resolve(root, `.${name}`)
        try { if (!statSync(candidate).isFile()) candidate = path.join(root, 'index.html') }
        catch { if (path.extname(name)) { res.writeHead(404); res.end(); return }; candidate = path.join(root, 'index.html') }
        candidate = realpathSync(candidate)
        const relative = path.relative(root, candidate)
        if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403); res.end(); return }
        const body = readFileSync(candidate)
        res.setHeader('Content-Type', mime[path.extname(candidate)] || 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.writeHead(200)
        res.end(req.method === 'HEAD' ? undefined : body)
      })
    } catch { if (!res.headersSent) res.writeHead(500); res.end('Request failed') }
  }
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler)
  server.requestTimeout = 30000
  server.headersTimeout = 15000
  return server
}

export async function main(argv = process.argv.slice(2)) {
  const arg = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1] }
  const host = arg('--host', '127.0.0.1')
  const port = Number(arg('--port', '4173'))
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid host/port')
  if (!process.env.MAH_WEBUI_PASSWORD) throw new Error('Set MAH_WEBUI_PASSWORD before starting the WebUI')
  const key = process.env.MAH_WEBUI_TLS_KEY
  const cert = process.env.MAH_WEBUI_TLS_CERT
  if (Boolean(key) !== Boolean(cert)) throw new Error('TLS key and certificate are both required')
  const tls = key && cert ? { key: readFileSync(key), cert: readFileSync(cert) } : undefined
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && (!tls || process.env.MAH_WEBUI_ALLOW_REMOTE !== '1')) throw new Error('Remote bind requires TLS and MAH_WEBUI_ALLOW_REMOTE=1')
  const { apiMiddleware } = await import('../dist-server/api.mjs')
  const server = createWebServer({ api: apiMiddleware, tls })
  server.listen(port, host, () => console.log(`MAH WebUI: ${tls ? 'https' : 'http'}://${host}:${port}`))
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
  return server
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
