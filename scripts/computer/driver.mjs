import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export async function connectDesktop(config) {
  const client = new Client({ name: 'mah-computer-driver', version: '0.1.0' })
  const env = {}
  for (const key of ['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'AT_SPI_BUS_ADDRESS', 'AGENT_DESKTOP_HOME']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  const transport = new StdioClientTransport({ command: config.command, args: [...(config.args || []), 'mcp'], env, stderr: 'pipe' })
  // Do not echo desktop data or arbitrary child diagnostics into public logs.
  transport.stderr?.resume()
  try { await client.connect(transport, { timeout: config.timeout_ms || 15000 }) }
  catch (error) { await transport.close(); throw error }
  return {
    version: client.getServerVersion()?.version,
    listTools: () => client.listTools({}, { timeout: config.timeout_ms || 15000 }),
    callTool: (name, args, options) => client.callTool({ name, arguments: args }, undefined, options),
    close: () => client.close(),
  }
}
