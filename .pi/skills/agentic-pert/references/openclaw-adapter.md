# OpenClaw Adapter - Integration Guide

## Overview

The OpenClaw adapter allows `agentic-pert` to execute tasks via OpenClaw's `sessions_spawn` system. This enables parallel execution of PERT/CPM planned tasks.

## Usage

### Basic Execution

```python
from agentic_pert import Task, OpenClawExecutor

# Create executor
executor = OpenClawExecutor(
    model="zai/glm-5",  # or any OpenClaw-supported model
    runtime="subagent",
    run_timeout=1800,  # 30 minutes per task
)

# Create task
task = Task(
    id="T1",
    description="Create hello.py with print('Hello')",
    predecessors=[],
    optimistic=0.1,
    most_likely=0.2,
    pessimistic=0.5,
)

# Execute (calls sessions_spawn internally)
result = await executor.spawn_task(task)
print(f"Success: {result.success}")
print(f"Output: {result.output}")
```

### Full Plan Execution

```python
from agentic_pert import Task, analyze_plan, OpenClawPlanExecutor

# Define tasks
tasks = [
    Task(id="T1", description="Setup project", predecessors=[], ...),
    Task(id="T2", description="Add auth", predecessors=["T1"], ...),
    Task(id="T3", description="Add tests", predecessors=["T2"], ...),
]

# Analyze with PERT/CPM
plan, timings, batches = analyze_plan(tasks)

# Create executor
executor = OpenClawPlanExecutor(
    model="openai-codex/gpt-5.3-codex",
    max_concurrency=4,
)

# Progress callback
def on_complete(task_id, result):
    status = "✅" if result.success else "❌"
    print(f"[{task_id}] {status} {result.duration:.1f}s")

# Execute plan
results = await executor.execute_plan(
    tasks, 
    batches, 
    task_callback=on_complete
)
```

### Integration in SKILL.md

When used inside an OpenClaw skill:

```python
# In SKILL.md context, sessions_spawn is available

from agentic_pert import Task, analyze_plan, OpenClawPlanExecutor

async def execute_with_pert(user_task: str):
    # 1. Decompose via LLM
    tasks = await decompose_via_llm(user_task)
    
    # 2. Analyze with PERT/CPM
    plan, timings, batches = analyze_plan(tasks)
    
    # 3. Execute via sessions_spawn
    executor = OpenClawPlanExecutor()
    results = await executor.execute_plan(tasks, batches)
    
    return results
```

## Configuration

### Executor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | str | None | Model to use (e.g., "zai/glm-5") |
| `runtime` | str | "subagent" | OpenClaw runtime type |
| `run_timeout` | int | 1800 | Timeout per task (seconds) |
| `max_concurrency` | int | 4 | Max parallel tasks |
| `spawn_options` | dict | {} | Additional sessions_spawn options |

### sessions_spawn Config

The adapter generates this config for each task:

```python
{
    "task": "<task.description>",
    "runtime": "subagent",
    "model": "<model>",
    "runTimeoutSeconds": 1800,
    "mode": "run",
    ...spawn_options
}
```

## Error Handling

```python
results = await executor.execute_plan(tasks, batches)

# Check for failures
failed = [r for r in results.values() if not r.success]

if failed:
    for task_id, result in results.items():
        if not result.success:
            print(f"[{task_id}] FAILED: {result.error}")
```

## Mock Mode

When run outside OpenClaw context (e.g., during development), the executor returns mock results:

```python
result = await executor.spawn_task(task)
# Returns: ExecutionResult(success=True, output="[MOCK] Task '...' would be executed...")
```

This allows testing the flow without actual OpenClaw runtime.

## Examples

See `scripts/validate_openclaw.py` for a complete validation script.
