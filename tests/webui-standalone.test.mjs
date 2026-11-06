import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createWebServer } from '../webui/server/start.mjs'

test('standalone server serves SPA/assets and routes API without Vite', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mah-http-static-'))
  writeFileSync(path.join(root, 'index.html'), '<main>MAH</main>')
  writeFileSync(path.join(root, 'app.js'), 'export default 1')
  const server = createWebServer({ staticRoot: root, api(req, res, next) {
    if (req.url === '/api/mah/test') { res.writeHead(401); res.end('auth required'); return }
    next()
  } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal(await (await fetch(`${base}/tasks`)).text(), '<main>MAH</main>')
    const js = await fetch(`${base}/app.js`)
    assert.match(js.headers.get('content-type'), /javascript/)
    assert.equal(js.headers.get('x-content-type-options'), 'nosniff')
    assert.equal((await fetch(`${base}/api/mah/test`)).status, 401)
    assert.equal((await fetch(`${base}/api/missing`)).status, 404)
    assert.equal((await fetch(`${base}/missing.js`)).status, 404)
    assert.equal((await fetch(`${base}/%2e%2e%2fsecret`)).status, 400)
  } finally {
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})
