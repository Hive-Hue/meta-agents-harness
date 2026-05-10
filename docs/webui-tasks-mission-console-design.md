# v0.10 T10 — Tasks/Mission Tracking Console Design

**Status:** proposed
**Date:** 2026-05-09
**Target:** v0.10.0

## 1. Name
tasks-mission-console-design

## 2. Scope

Mission list, task board with kanban columns, task inspector, filter bar, state transition actions.

### Covers
- Mission list with progress indicators
- Task board with kanban columns per state
- Task inspector with metadata, dependencies, rationale
- State transition actions (backlog -> ready -> in_progress -> done)
- Filter bar (by state, mission, owner, priority)

### Does NOT Cover
- Drag-and-drop state transitions (buttons only)
- Gantt chart or dependency graph visualization
- Task creation from WebUI
- WebSocket real-time updates

## 3. Component Architecture

### New Files
| File | Purpose |
|------|---------|
| `webui/src/features/tasks/TaskBoard.tsx` | Kanban board with state columns |
| `webui/src/features/tasks/TaskInspector.tsx` | Detail panel for selected task |
| `webui/src/features/tasks/MissionList.tsx` | Mission cards with progress |
| `webui/src/features/tasks/TaskFilters.tsx` | Filter bar component |
| `webui/src/features/tasks/useMissionData.ts` | Mission listing hook |
| `webui/src/features/tasks/useTaskActions.ts` | State transition hook |

### Modified Files
| File | Change |
|------|--------|
| `webui/src/features/tasks/TasksPage.tsx` | Add TaskBoard tab, wire new components |
| `webui/src/features/tasks/tasks.css` | Styles for board columns, inspector, filters |

## 4. API Surface

| Method | Path | Maps To |
|--------|------|---------|
| GET | `/api/mah/missions` | `mah mission list --json` |
| GET | `/api/mah/tasks` | `mah task list --json` with query filters |
| GET | `/api/mah/tasks/:id` | Task detail from task list |
| PATCH | `/api/mah/tasks/:id` | `mah task update <id> --payload '...'` |

### Valid State Transitions
- `backlog` → `ready`
- `ready` → `in_progress`
- `in_progress` → `done`
- `in_progress` → `blocked`
- `blocked` → `ready`
- `blocked` → `in_progress`

## 5. UI Layout

### Mission Cards
```
┌─────────────────────────────────────────────┐
│ v0.10-evolution                             │
│ v0.10.0 Evolution                          │
│ 12 tasks · 4 done · 2 in progress          │
│ ████████████░░░░░░░░░░░░░  33%            │
│ [medium risk]                               │
└─────────────────────────────────────────────┘
```
- Grid of cards showing: ID, name, task count (done/total), progress bar, risk badge
- Click card → filter tasks by that mission

### Task Board
```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│ BACKLOG     │ READY       │ IN PROGRESS │ DONE        │ BLOCKED     │
│ (3)         │ (5)         │ (2)          │ (4)          │ (1)          │
├──────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ ┌──────────┐│ ┌──────────┐│ ┌──────────┐│ ┌──────────┐│ ┌──────────┐│
│ │ T11      ││ │ T6       ││ │ T9       ││ │ T1       ││ │ T7       ││
│ │ WebUI    ││ │ Conf     ││ │ Session  ││ │ Setup    ││ │ Context  ││
│ │ session  ││ │ scoring  ││ │ console  ││ │ infra    ││ │ memory   ││
│ │ console  ││ │          ││ │          ││ │          ││ │          ││
│ │ 🔴 high ││ │ 🟡 med  ││ │ 🟡 med  ││ │ 🟢 low  ││ │ 🔴 high ││
│ └──────────┘│ └──────────┘│ └──────────┘│ └──────────┘│ └──────────┘│
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
```
- Kanban columns: Backlog(gray), Ready(blue), In Progress(amber), Done(green), Blocked(red)
- Each task card shows: ID, title (2 lines), owner badge, priority indicator, estimate
- Click card → opens TaskInspector

### Task Inspector
```
┌────────────────────────────────────────┐
│ T9  ·  Design WebUI session console   [×]│
├────────────────────────────────────────┤
│ State    [✓ Done            ▼]          │
│ Priority [Medium            ▼]          │
│ Owner    @frontend-dev                 │
│ Runtime  pi                            │
│ Mission  v0.10-evolution               │
│ Estimate —                             │
├────────────────────────────────────────┤
│ Dependencies                           │
│ ← T1 (Setup infra) — done              │
│ ← T3 (Design system) — done            │
├────────────────────────────────────────┤
│ Rationale                              │
│ Session console needed for run         │
│ management and inspection in WebUI.     │
├────────────────────────────────────────┤
│ Command                                │
│ node scripts/... --task "design..."   │
├────────────────────────────────────────┤
│ Last updated: 2026-05-09 15:30 UTC    │
├────────────────────────────────────────┤
│ [← Backlog]  [→ In Progress]  [⊘ Block]│
└────────────────────────────────────────┘
```
- Slide-in panel from right
- Sections: Header (ID, title, state badge, priority), Metadata (owner, runtime, mission, estimate), State Machine (action buttons for valid transitions), Dependencies (linked task IDs), Rationale, Command preview, Last update timestamp

### Filter Bar
```
[State ▼]  [Mission ▼]  [Owner ▼]  [Priority ▼]  [🔍 Search...]
Active: [× v0.10-evolution] [× in_progress]
```
- Horizontal bar above board: state multi-select, mission dropdown, owner dropdown, priority dropdown, search text input
- Active filters shown as removable chips

## 6. State Management

### Polling Strategy
- **Task list**: poll every **10 seconds**
- **Inspector**: poll every **5 seconds** while open
- **Pause polling** when browser tab is hidden (`visibilitychange` event)
- **Stop polling** on page unmount

### Optimistic Transitions
1. Immediately update task state in local state
2. Show loading indicator on task card
3. On API success: confirm state, refresh full list on next poll
4. On API failure: revert to previous state, show error toast

### State Shape
```typescript
type TaskRecord = {
  id: string
  missionId: string
  title: string
  state: 'backlog' | 'ready' | 'in_progress' | 'done' | 'blocked'
  owner: string
  priority: 'high' | 'medium' | 'low'
  runtime: string
  estimate?: string
  confidence?: number
  dependencies: string[]
  rationale: string
  command: string
  blockedReason?: string
  createdAt: string
  lastUpdate: string
}

type MissionRecord = {
  id: string
  name: string
  description: string
  task_count: number
  done_count: number
  in_progress_count: number
  blocked_count: number
  ready_count: number
  risk?: 'low' | 'medium' | 'high'
}
```

## 7. Constraints

- **Enhance existing TasksPage** — do not replace; add new tab alongside existing views
- **Preserve board/missions/pert/timeline tabs** — existing tabs remain functional
- **CLI remains primary surface** — WebUI is read-only + state-transition, not task creation
- **No drag-and-drop in v0.10** — state transitions via buttons only; drag-drop deferred to v0.11
- **Polling only (no WebSocket)** — WebSocket/SSE deferred to post-v0.10
- **No task creation** — task creation remains via CLI or backlog grooming
- **Optimistic revert on error** — no partial state; always revert or confirm

## 8. Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC1 | Mission list shows cards with ID, name, task count, progress bar |
| AC2 | Click mission card filters task board to that mission |
| AC3 | Task board shows kanban columns per state with task cards |
| AC4 | Task cards show ID, title, owner, priority |
| AC5 | Click task card opens inspector with metadata, dependencies, rationale |
| AC6 | State transition buttons in inspector update task state |
| AC7 | Filter bar supports filtering by state, mission, owner |
| AC8 | Optimistic state transitions with error revert |
| AC9 | Task list auto-refreshes every 10 seconds |
| AC10 | Existing TasksPage tabs (board/missions/pert/timeline) preserved |

## 9. Dependencies

### Required CLI Commands (existing)
- `mah mission list --json` — mission listing
- `mah task list --json [--mission <id>] [--state <state>] [--owner <owner>]` — task listing with filters
- `mah task update <id> --payload '{"state":"<new_state>"}'` — state transitions

### Required WebUI Server Endpoints (existing or new)
- `GET /api/mah/missions` — wraps `mah mission list --json`
- `GET /api/mah/tasks` — wraps `mah task list --json` with query params
- `GET /api/mah/tasks/:id` — returns single task from task list
- `PATCH /api/mah/tasks/:id` — wraps `mah task update` for state transitions

### No New Dependencies
- Does not require new npm packages beyond existing WebUI dependencies
- Does not require new backend scripts
- Does not require new MAH CLI commands

## 10. Non-Goals (Deferred)

- Drag-and-drop task reordering
- Task creation from WebUI
- Real-time WebSocket updates
- Dependency graph visualization
- Time tracking / estimation features
- Comment threads on tasks
