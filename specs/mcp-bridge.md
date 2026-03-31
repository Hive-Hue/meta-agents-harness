# Specification: MCP Bridge Extension

## Goal

Provide MCP access to Pi through an extension because Pi does not support MCP natively.

The bridge should:

- connect to stdio-based MCP servers
- connect to remote HTTP MCP servers
- support OAuth2/PKCE for remote MCP servers such as Figma
- initialize clients lazily on first use
- expose stable Pi tools for MCP operations
- work with multiple configured servers such as Figma, Context7, ClickUp, and others

## Files

- `extensions/mcp-bridge.ts`
- `mcp-servers.example.json`

## Configuration

The extension looks for config in this order:

1. `PI_MCP_CONFIG`
2. `.pi/mcp-servers.json`
3. `multi-agents/mcp-servers.example.json`

Config shape:

```json
{
  "servers": {
    "server-name": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "env": {
        "TOKEN": "value"
      },
      "cwd": ".",
      "timeout_ms": 20000
    },
    "figma": {
      "transport": "http",
      "url": "https://mcp.figma.com/mcp",
      "timeout_ms": 30000,
      "oauth": {
        "enabled": true,
        "clientId": "${FIGMA_OAUTH_CLIENT_ID}",
        "authorizationEndpoint": "https://www.figma.com/oauth/mcp",
        "tokenEndpoint": "https://api.figma.com/v1/oauth/token",
        "redirectUri": "http://127.0.0.1:45351/callback",
        "scope": "file_content:read"
      }
    }
  }
}
```

## OAuth state

- OAuth tokens are persisted under `.pi/mcp-oauth/`
- if `oauth.tokenFile` is set, that path is used instead
- the bridge prints the authorization URL to the terminal when a server needs consent
- the default flow expects a loopback callback URL such as `http://127.0.0.1:45351/callback`

## Exposed Pi Tools

- `mcp_servers`
- `mcp_tools`
- `mcp_call`
- `mcp_resources`
- `mcp_read_resource`
- `mcp_prompts`
- `mcp_get_prompt`

## Commands

- `/mcp`
- `/mcp-stop`

## Notes

- `transport` defaults to `http` when `url` is present, otherwise `stdio`
- direct HTTP MCP is now supported for services like Figma
- ClickUp may still be more reliable via `mcp-remote` under stdio, depending on its auth flow
- tool registration remains static because Pi extensions register tools synchronously
- dynamic per-server MCP tool registration can be added later, but the generic `mcp_call` tool is enough to make MCP useful immediately
