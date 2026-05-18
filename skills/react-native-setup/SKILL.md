---
name: react-native-setup
description: Bootstrap a React Native / Expo project for MAH Mobile Control Plane with all required dependencies, navigation structure, SSE client, voice capture, and state management. Use after env-setup to scaffold the mobile app.
compatibility: [hermes]
---

# React Native Setup — MAH Mobile Control Plane

Use this skill to bootstrap the React Native / Expo mobile app from scratch or to add major dependencies to an existing project.

## When to Use

- First time setting up the mobile app directory
- Adding React Navigation, state management, or SSE support
- Running `npx create-expo-app` for a fresh MAH Mobile project
- After `git clone` of mah-mobile repo

## Prerequisites

Run `env-setup` skill first to ensure Node.js and npm are ready.

## Step 1 — Create Expo App

```bash
cd /home/alysson/Github/mah-mobile
npx create-expo-app@latest mobile-app --template blank-typescript --yes
cd mobile-app
```

This creates:
```
mobile-app/
├── App.tsx
├── app.json
├── package.json
├── tsconfig.json
└── assets/
```

## Step 2 — Install Core Dependencies

```bash
npx expo install \
  expo-av \
  expo-device \
  expo-notifications \
  expo-linking \
  @react-native-async-storage/async-storage \
  react-native-screens \
  react-native-safe-area-context \
  @react-native-community/netinfo
```

## Step 3 — Install Navigation

```bash
npx expo install \
  @react-navigation/native \
  @react-navigation/bottom-tabs \
  @react-navigation/stack \
  react-native-gesture-handler
```

## Step 4 — Install State Management and Utilities

```bash
npm install zustand
npm install --save-dev @types/react @types/react-native
```

## Step 5 — Install SSE Client

For streaming run/terminal output:

```bash
npm install eventsource
npm install --save-dev @types/eventsource
```

Or use native `EventSource` with a polyfill if not available.

## Step 6 — Configure app.json

Update `mobile-app/app.json`:

```json
{
  "expo": {
    "name": "MAH Mobile",
    "slug": "mah-mobile",
    "scheme": "mahmobile",
    "version": "0.1.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "splash": {
      "image": "./assets/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#1a1a2e"
    },
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.mah.mobile"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#1a1a2e"
      },
      "package": "com.mah.mobile"
    },
    "plugins": [
      "expo-av",
      [
        "expo-notifications",
        {
          "sounds": []
        }
      ]
    ],
    "extra": {
      "apiBaseUrl": "http://localhost:3000"
    }
  }
}
```

## Step 7 — Configure babel.config.js

```js
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-reanimated/plugin', // if using animations
    ],
  };
};
```

## Step 8 — Create Project Structure

```bash
mkdir -p mobile-app/src/{screens,components,navigation,hooks,store,services,types}
mkdir -p mobile-app/src/screens/{Runs,Sessions,Approvals,Workspace,Chat}
mkdir -p mobile-app/src/components/{runs,sessions,approvals,workspace,chat,common}
mkdir -p mobile-app/src/store
mkdir -p mobile-app/src/services
mkdir -p mobile-app/src/types
```

## Step 9 — Type Definitions

Create `mobile-app/src/types/index.ts`:

```typescript
// Mobile API types
export interface DeviceSession {
  deviceId: string;
  userId: string;
  hostId: string;
  token: string;
  role: 'viewer' | 'operator' | 'admin';
  pairedAt: string;
  expiresAt: string;
}

export interface MAHSession {
  sessionId: string;
  name: string;
  crew: string;
  runtime: string;
  owner: string;
  status: 'active' | 'paused' | 'completed';
  lastActivity: string;
}

export interface RunStreamEvent {
  category: 'session.meta' | 'session.state' | 'run.lifecycle' | 'run.log' | 'run.activity' | 'run.artifact' | 'approval.pending' | 'approval.resolved' | 'terminal.chunk' | 'file.diff' | 'host.warning' | 'error';
  sessionId?: string;
  runId?: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ApprovalRequest {
  approvalId: string;
  actor: string;
  role: string;
  commandSummary: string;
  scope: string;
  target: string;
  reason: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
}

export interface RemoteTarget {
  targetId: string;
  identity: string;
  transportType: 'ssh' | 'local';
  workspaceBinding: string;
  environmentClass: 'dev' | 'staging' | 'production';
  healthState: 'healthy' | 'degraded' | 'unreachable';
}

export interface FilePatchRequest {
  fileId: string;
  action: 'inspect' | 'propose' | 'review' | 'apply';
  patch?: string;
}

// Navigation types
export type RootTabParamList = {
  Runs: undefined;
  Sessions: undefined;
  Approvals: undefined;
  Workspace: undefined;
  Chat: undefined;
};

export type RunsStackParamList = {
  RunsList: undefined;
  RunDetail: { runId: string };
};

export type SessionsStackParamList = {
  SessionsList: undefined;
  SessionDetail: { sessionId: string };
};
```

## Step 10 — Zustand Store

Create `mobile-app/src/store/index.ts`:

```typescript
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthState {
  deviceSession: DeviceSession | null;
  isAuthenticated: boolean;
  setDeviceSession: (session: DeviceSession) => void;
  clearDeviceSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  deviceSession: null,
  isAuthenticated: false,
  setDeviceSession: async (session) => {
    await AsyncStorage.setItem('deviceSession', JSON.stringify(session));
    set({ deviceSession: session, isAuthenticated: true });
  },
  clearDeviceSession: async () => {
    await AsyncStorage.removeItem('deviceSession');
    set({ deviceSession: null, isAuthenticated: false });
  },
}));

interface RunsState {
  activeRuns: Map<string, RunStreamEvent[]>;
  addRunEvent: (runId: string, event: RunStreamEvent) => void;
  clearRun: (runId: string) => void;
}

export const useRunsStore = create<RunsState>((set) => ({
  activeRuns: new Map(),
  addRunEvent: (runId, event) => set((state) => {
    const runs = new Map(state.activeRuns);
    const existing = runs.get(runId) || [];
    runs.set(runId, [...existing, event]);
    return { activeRuns: runs };
  }),
  clearRun: (runId) => set((state) => {
    const runs = new Map(state.activeRuns);
    runs.delete(runId);
    return { activeRuns: runs };
  }),
}));

interface ApprovalsState {
  pending: ApprovalRequest[];
  setPending: (approvals: ApprovalRequest[]) => void;
  resolveApproval: (approvalId: string) => void;
}

export const useApprovalsStore = create<ApprovalsState>((set) => ({
  pending: [],
  setPending: (approvals) => set({ pending: approvals }),
  resolveApproval: (approvalId) => set((state) => ({
    pending: state.pending.filter(a => a.approvalId !== approvalId),
  })),
}));
```

## Step 11 — API Service

Create `mobile-app/src/services/api.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL = 'http://localhost:3000';

async function getToken(): Promise<string> {
  const session = await AsyncStorage.getItem('deviceSession');
  if (!session) throw new Error('Not authenticated');
  return JSON.parse(session).token;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  auth: {
    pair: (deviceName: string) => request('/api/mah/mobile/auth/pair', { method: 'POST', body: JSON.stringify({ deviceName }) }),
    refresh: (token: string) => request('/api/mah/mobile/auth/refresh', { method: 'POST', body: JSON.stringify({ token }) }),
    revoke: () => request('/api/mah/mobile/auth/revoke', { method: 'DELETE' }),
  },
  devices: {
    list: () => request('/api/mah/mobile/devices'),
    revoke: (deviceId: string) => request(`/api/mah/mobile/devices/${deviceId}`, { method: 'DELETE' }),
  },
  sessions: {
    list: (filters?: Record<string, string>) => {
      const qs = filters ? '?' + new URLSearchParams(filters).toString() : '';
      return request(`/api/mah/mobile/sessions${qs}`);
    },
    resume: (sessionId: string) => request(`/api/mah/mobile/sessions/${sessionId}/resume`, { method: 'POST' }),
    new: (crew: string, runtime: string, targetId?: string) =>
      request('/api/mah/mobile/sessions', { method: 'POST', body: JSON.stringify({ crew, runtime, targetId }) }),
  },
  runs: {
    list: () => request('/api/mah/mobile/runs'),
    get: (runId: string) => request(`/api/mah/mobile/runs/${runId}`),
  },
  approvals: {
    list: () => request('/api/mah/mobile/approvals'),
    get: (approvalId: string) => request(`/api/mah/mobile/approvals/${approvalId}`),
    approve: (approvalId: string) => request(`/api/mah/mobile/approvals/${approvalId}/approve`, { method: 'POST' }),
    deny: (approvalId: string, reason?: string) => request(`/api/mah/mobile/approvals/${approvalId}/deny`, { method: 'POST', body: JSON.stringify({ reason }) }),
  },
  files: {
    browse: (path?: string) => request(`/api/mah/mobile/files/browse${path ? '?path=' + path : ''}`),
    diff: (fileId: string) => request(`/api/mah/mobile/files/${fileId}/diff`),
    patch: (req: FilePatchRequest) => request('/api/mah/mobile/files/patch', { method: 'POST', body: JSON.stringify(req) }),
  },
  targets: {
    list: () => request('/api/mah/mobile/targets'),
    get: (targetId: string) => request(`/api/mah/mobile/targets/${targetId}`),
    execute: (targetId: string, command: string) => request(`/api/mah/mobile/targets/${targetId}/execute`, { method: 'POST', body: JSON.stringify({ command }) }),
  },
  voice: {
    input: (transcript: string) => request('/api/mah/mobile/voice/input', { method: 'POST', body: JSON.stringify({ transcript }) }),
  },
};
```

## Step 12 — SSE Streaming Service

Create `mobile-app/src/services/sse.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RunStreamEvent } from '../types';

type SSEHandler = (event: RunStreamEvent) => void;

class SSEService {
  private connections: Map<string, EventSource> = new Map();
  private handlers: Map<string, SSEHandler[]> = new Map();

  private async getHeaders(): Promise<Record<string, string>> {
    const session = await AsyncStorage.getItem('deviceSession');
    const token = session ? JSON.parse(session).token : '';
    return {
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/event-stream',
    };
  }

  async subscribe(runId: string, onEvent: SSEHandler): Promise<void> {
    const token = (await AsyncStorage.getItem('deviceSession')) ? JSON.parse(await AsyncStorage.getItem('deviceSession')).token : '';
    const url = `http://localhost:3000/api/mah/mobile/runs/${runId}/stream`;

    // Use native EventSource
    const es = new EventSource(url, {
      withCredentials: true,
    });

    es.onmessage = (e) => {
      try {
        const event: RunStreamEvent = JSON.parse(e.data);
        onEvent(event);
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // Reconnect logic
      setTimeout(() => this.reconnect(runId, onEvent), 3000);
    };

    this.connections.set(runId, es);
    const handlers = this.handlers.get(runId) || [];
    handlers.push(onEvent);
    this.handlers.set(runId, handlers);
  }

  private reconnect(runId: string, onEvent: SSEHandler) {
    this.unsubscribe(runId);
    this.subscribe(runId, onEvent);
  }

  unsubscribe(runId: string) {
    const es = this.connections.get(runId);
    if (es) {
      es.close();
      this.connections.delete(runId);
      this.handlers.delete(runId);
    }
  }

  unsubscribeAll() {
    this.connections.forEach((es) => es.close());
    this.connections.clear();
    this.handlers.clear();
  }
}

export const sseService = new SSEService();
```

## Step 13 — Navigation Setup

Create `mobile-app/src/navigation/AppNavigator.tsx`:

```typescript
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';

import RunsScreen from '../screens/Runs/RunsScreen';
import SessionsScreen from '../screens/Sessions/SessionsScreen';
import ApprovalsScreen from '../screens/Approvals/ApprovalsScreen';
import WorkspaceScreen from '../screens/Workspace/WorkspaceScreen';
import ChatScreen from '../screens/Chat/ChatScreen';

const Tab = createBottomTabNavigator();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          tabBarActiveTintColor: '#6366f1',
          tabBarInactiveTintColor: '#64748b',
          tabBarStyle: { backgroundColor: '#1a1a2e', borderTopColor: '#2d2d4a' },
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#e2e8f0',
        }}
      >
        <Tab.Screen name="Runs" component={RunsScreen} options={{ title: 'Runs' }} />
        <Tab.Screen name="Sessions" component={SessionsScreen} />
        <Tab.Screen name="Approvals" component={ApprovalsScreen} />
        <Tab.Screen name="Workspace" component={WorkspaceScreen} />
        <Tab.Screen name="Chat" component={ChatScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
```

## Step 14 — Screen Placeholders

Create stub screens for each tab:

**`mobile-app/src/screens/Runs/RunsScreen.tsx`**:
```typescript
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function RunsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Runs</Text>
      <Text style={styles.subtitle}>Active runs will appear here</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a', padding: 16 },
  title: { color: '#e2e8f0', fontSize: 24, fontWeight: 'bold' },
  subtitle: { color: '#64748b', fontSize: 14, marginTop: 8 },
});
```

(Repeat pattern for Sessions, Approvals, Workspace, Chat screens)

## Step 15 — Update App.tsx

```typescript
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <>
      <StatusBar style="light" />
      <AppNavigator />
    </>
  );
}
```

## Verification

- [ ] `npx expo --version` returns 52+
- [ ] `mobile-app/package.json` has all dependencies
- [ ] `mobile-app/src/navigation/AppNavigator.tsx` exists
- [ ] `mobile-app/src/types/index.ts` exists with all types
- [ ] `mobile-app/src/services/api.ts` and `sse.ts` exist
- [ ] `mobile-app/App.tsx` renders AppNavigator
- [ ] `npx expo export` or `npx expo run:android` builds without errors

## Troubleshooting

### Navigation not working
```bash
cd mobile-app
npx expo install react-native-screens react-native-safe-area-context
npx expo start --clear
```

### AsyncStorage errors
```bash
npx expo install @react-native-async-storage/async-storage
```

### SSE connection fails on Android
Add to `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
```