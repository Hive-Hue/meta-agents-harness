---
name: mah-mobile-mcp
description: MCP (Model Context Protocol) servers available for the MAH Mobile crew — react-native-mcp for mobile app navigation/debug/state inspection, and playwright-mcp for web QA and UI validation. Load this skill when agents need to interact with mobile app UI, verify screens, or debug React Native components.
compatibility: [hermes]
---

# MAH Mobile MCP — Tool Reference

Use this skill when agents need to interact with the mobile app UI, verify screen states, debug components, or validate web/mobile interfaces.

## Available MCP Servers

### 1. react-native-mcp

Custom MCP server for React Native / Expo development. Located at:
`/home/alysson/Github/mah-mobile/mcps/react-native-mcp-server/dist/index.js`

**20 tools:**

#### Navigation & Screen
| Tool | Description | Args |
|------|-------------|------|
| `rn_navigate` | Simulate navigation to a screen (runs/sessions/approvals/workspace/chat) | `{ screen: string }` |
| `rn_get_screen` | Get current screen name and navigation state | `{}` |
| `rn_nav_history` | Get navigation stack history for a tab | `{ tab: string }` |

#### Debug & Console
| Tool | Description | Args |
|------|-------------|------|
| `rn_debug_enabled` | Check JS dev mode, remote debugging, hot/live reload status | `{}` |
| `rn_get_bridge` | Check RN bridge availability and version info | `{}` |
| `rn_inspect_props` | Inspect component props for a screen/element | `{ screen, element? }` |
| `rn_inspect_state` | Inspect Zustand store state for a screen | `{ screen }` |
| `rn_list_components` | List mounted React components on a screen | `{ screen }` |

#### Device & Runtime
| Tool | Description | Args |
|------|-------------|------|
| `rn_device_info` | Get OS version, model, Expo SDK, available memory | `{}` |
| `rn_check_expo` | Detect if running under Expo (SDK version, channel) | `{}` |
| `rn_live_reload` | Trigger Live Reload / Fast Refresh | `{}` |
| `rn_error_boundary_status` | Check if any error boundaries caught errors | `{}` |
| `rn_hermes_status` | Check Hermes JS engine version and memory stats | `{}` |

#### UI & Media
| Tool | Description | Args |
|------|-------------|------|
| `rn_take_screenshot` | Take screenshot (returns path or base64) | `{}` |

#### Storage
| Tool | Description | Args |
|------|-------------|------|
| `rn_storage_keys` | List all AsyncStorage keys (dev mode) | `{}` |
| `rn_storage_get` | Get value from AsyncStorage | `{ key: string }` |
| `rn_storage_set` | Set value in AsyncStorage (for testing auth flows) | `{ key, value }` |

#### Notifications
| Tool | Description | Args |
|------|-------------|------|
| `rn_notification_perms` | Check notification permissions | `{}` |

#### API Integration
| Tool | Description | Args |
|------|-------------|------|
| `rn_api_proxy` | Make proxied HTTP request through RN app environment | `{ method, path, body? }` |

**Pre-build vs Runtime:**
- Before app is running on device/simulator: all tools return `status: 'pre-build'` with mocked/simulated responses
- After app is running with dev client or Expo Go: tools connect to actual Metro/Hermes bridge for real inspection
- Screenshot, storage, and device tools require connected device/simulator

**Start the server:**
```bash
cd /home/alysson/Github/mah-mobile/mcps/react-native-mcp-server
node dist/index.js
```

---

### 2. playwright-mcp

External MCP server (`@executeautomation/playwright-mcp-server`) for browser/web automation. Available at:
`/home/alysson/.npm/_npx/0b9ff77863cb6e9f/node_modules/@executeautomation/playwright-mcp-server/dist/index.js`

**33 tools** including:
- `playwright_navigate` — Navigate to URL in browser
- `playwright_click` — Click element by selector
- `playwright_type` — Type text into element
- `playwright_evaluate` — Run JavaScript in browser context
- `playwright_screenshot` — Take screenshot
- `playwright_get_text` — Get element text content
- `playwright_get_attribute` — Get element attribute
- `playwright_hover` — Hover over element
- `playwright_press` — Press keyboard key
- `playwright_select_option` — Select dropdown option
- `playwright_evaluate` — Execute JS in page context
- `playwright_wait_for_selector` — Wait for element
- `playwright_scroll` — Scroll page or element
- `playwright_upload_file` — Upload file to input
- `playwright_open_page` — Open new page
- `playwright_close_page` — Close page
- `playwright_get_cookies` — Get browser cookies
- `playwright_get_session_storage` — Get session storage
- `playwright_console_messages` — Get console log/error messages
- And more...

**Use cases for MAH Mobile:**
- QA validation of WebUI components in Hermes Gateway
- Testing MAH API responses in browser context
- Validating web-based Hermes Gateway chat interface
- E2E testing of any web surfaces that the mobile app interacts with

**Prerequisites:**
- Playwright browsers installed: `npx playwright install`
- If no browsers available, install with:
  ```bash
  npx playwright install chromium
  npx playwright install webkit
  ```

**Start the server:**
```bash
npx -y @executeautomation/playwright-mcp-server
```

---

## MCP Configuration

The crew's MCP config is at:
`/home/alysson/Github/mah-mobile/.mcp.json`

```json
{
  "mcpServers": {
    "react-native-mcp": {
      "transport": "stdio",
      "command": "node",
      "args": ["/home/alysson/Github/mah-mobile/mcps/react-native-mcp-server/dist/index.js"],
      "timeout_ms": 30000
    },
    "playwright-mcp": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@executeautomation/playwright-mcp-server"],
      "timeout_ms": 60000
    }
  }
}
```

---

## Usage Patterns

### Pattern 1 — Pre-build screen verification
```python
# Agent verifying navigation structure before app runs
rn_navigate(screen="runs")  # Returns simulated navigation result
rn_get_screen()  # Returns status: 'pre-build'
```

### Pattern 2 — Verify Zustand store structure
```python
rn_inspect_state(screen="approvals")  # Returns store structure mock
rn_storage_keys()  # Returns [] (pre-build)
```

### Pattern 3 — QA web components with playwright
```python
playwright_open_page(url="http://localhost:3001")
playwright_navigate(url="/api/mah/hermes-gateway/health")
playwright_get_text(selector=".status")
playwright_screenshot()
```

### Pattern 4 — API proxy through mobile context
```python
rn_api_proxy(method="GET", path="/api/mah/mobile/sessions")
rn_api_proxy(method="POST", path="/api/mah/mobile/auth/pair", body={"deviceName": "test"})
```

### Pattern 5 — Device info check
```python
rn_device_info()  # Returns mock pre-build device info
rn_check_expo()  # Returns Expo SDK detection
rn_hermes_status()  # Returns Hermes availability status
```

---

## Skill Loading

To use MCP tools, the skill must be loaded and the MCP servers must be running. Agents can call `mcp_list` (if available) to see which tools are currently active.

For `mah run --crew mah-mobile`, the MCP servers are auto-enabled if `.mcp.json` exists in the crew root.

If tools are not responding, verify:
1. `node dist/index.js` is running for react-native-mcp
2. `npx -y @executeautomation/playwright-mcp-server` is running for playwright-mcp

---

## Tool Categories Summary

| Category | react-native-mcp | playwright-mcp |
|----------|-----------------|----------------|
| Navigation | ✓ (RN screens) | ✓ (browser URLs) |
| Debug/Inspect | ✓ (RN props/state) | ✓ (browser console) |
| Device Info | ✓ (OS, Expo, Hermes) | ✗ |
| Storage | ✓ (AsyncStorage) | ✓ (cookies, storage) |
| UI/Visual | ✓ (screenshot) | ✓ (full screenshot) |
| API | ✓ (proxy) | ✗ |
| Network | ✗ | ✓ (HTTP requests) |

---

## Error States

- `status: 'pre-build'` — App not running, tools return mocked data
- `status: 'no-device'` — Device/simulator not connected (screenshot, storage write)
- `status: 'metro-disconnected'` — Metro bundler not reachable
- `Error: Server does not support tools` — MCP server not registered or started