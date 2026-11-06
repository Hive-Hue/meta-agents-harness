import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createWebServer } from './start.mjs'

// This process uses a one-run test credential and never launches a runtime.
process.env.MAH_WEBUI_PASSWORD = randomUUID()
delete process.env.MAH_WEBUI_ALLOW_EXEC
const { apiMiddleware } = await import('../dist-server/api.mjs')
const server = createWebServer({ api: apiMiddleware })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
try {
  assert.equal((await fetch(base)).status, 200)
  assert.equal((await fetch(`${base}/api/mah/config`)).status, 401)
  const loggedIn = await fetch(`${base}/api/mah/auth/login`, { method: 'POST', body: JSON.stringify({ username: process.env.MAH_WEBUI_USER || 'admin', password: process.env.MAH_WEBUI_PASSWORD }) })
  assert.equal(loggedIn.status, 200)
  const cookie = loggedIn.headers.get('set-cookie').split(';')[0]
  assert.equal((await (await fetch(`${base}/api/mah/auth/status`, { headers: { cookie } })).json()).authenticated, true)
  assert.equal((await fetch(`${base}/api/mah/run-start`, { method: 'POST', headers: { cookie }, body: '{}' })).status, 403)
  assert.equal((await fetch(`${base}/api/mah/config`, { method: 'POST', headers: { cookie, origin: 'https://other.example' }, body: '{}' })).status, 403)
  console.log('Standalone production HTTP smoke: 6 assertions passed; no runtime launched.')
} finally { await new Promise(resolve => server.close(resolve)) }
