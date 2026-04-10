# PERT/CPM Theory Reference

## Overview

PERT (Program Evaluation and Review Technique) and CPM (Critical Path Method) are project management techniques for planning and scheduling complex projects.

## PERT: Probabilistic Time Estimation

### Three-Point Estimation

For each task, estimate three durations:
- **Optimistic (O):** Best-case scenario (everything goes right)
- **Most Likely (M):** Normal conditions (realistic estimate)
- **Pessimistic (P):** Worst-case scenario (everything goes wrong)

### PERT Formula

Expected duration is calculated as a weighted average:

```
PERT Duration = (O + 4M + P) / 6
```

This follows a Beta distribution, giving more weight to the most likely estimate.

### Variance

```
Variance = ((P - O) / 6)²
```

### Example

| Task | O | M | P | PERT | Variance |
|------|---|---|---|------|----------|
| Setup | 1 | 2 | 5 | 2.33 | 0.44 |
| Auth | 2 | 4 | 8 | 4.33 | 1.00 |
| Tests | 1 | 2 | 3 | 2.00 | 0.11 |

**Total Project Variance:** Sum of variances on critical path

**Standard Deviation:** √Total Variance

**Confidence Intervals:**
- 68% chance: Duration ± 1σ
- 95% chance: Duration ± 2σ
- 99.7% chance: Duration ± 3σ

## CPM: Critical Path Method

### Definitions

- **Activity:** A task that takes time
- **Event:** A milestone (start/end of activities)
- **Predecessor:** Activity that must complete before this one starts
- **Successor:** Activity that can start after this one completes
- **Path:** Sequence of connected activities from start to end

### Forward Pass (Early Times)

Calculate earliest possible start/finish times:

```
ES (Early Start) = max(EF of all predecessors)
EF (Early Finish) = ES + Duration
```

Start with ES = 0 for tasks with no predecessors.

### Backward Pass (Late Times)

Calculate latest allowable start/finish times:

```
LF (Late Finish) = min(LS of all successors)
LS (Late Start) = LF - Duration
```

End with LF = Project Duration for tasks with no successors.

### Float (Slack)

```
Float = LS - ES = LF - EF
```

- **Float = 0:** Critical task (any delay delays the project)
- **Float > 0:** Non-critical (can be delayed up to float days)

### Critical Path

The longest path through the network (in terms of duration). All tasks on this path have zero float.

## Example Calculation

### Network

```
     ┌──> T2 (3d) ──┐
T1 (2d)             ├──> T4 (4d) ──> T5 (2d)
     └──> T3 (2d) ──┘
```

### Forward Pass

| Task | Duration | Predecessors | ES | EF |
|------|----------|--------------|----|----|
| T1 | 2 | - | 0 | 2 |
| T2 | 3 | T1 | 2 | 5 |
| T3 | 2 | T1 | 2 | 4 |
| T4 | 4 | T2, T3 | 5 | 9 |
| T5 | 2 | T4 | 9 | 11 |

**Project Duration:** 11 days

### Backward Pass

| Task | LF | LS | Float |
|------|----|----|-------|
| T5 | 11 | 9 | 0 |
| T4 | 9 | 5 | 0 |
| T3 | 5 | 3 | 1 |
| T2 | 5 | 2 | 0 |
| T1 | 2 | 0 | 0 |

### Critical Path

**T1 → T2 → T4 → T5** (11 days)

T3 has 1 day of float (can be delayed up to 1 day without affecting project completion).

## Parallelism Analysis

### Batches

Group tasks by their "level" in the DAG:

```
Batch 1: Tasks with no predecessors (can start immediately)
Batch 2: Tasks whose predecessors are all in Batch 1
Batch 3: Tasks whose predecessors are all in Batch 1 or 2
...
```

### Parallelizable Groups

Within each batch, tasks can run in parallel if they have no dependencies on each other.

```
Batch 1: [T1] → 1 task (sequential)
Batch 2: [T2, T3] → 2 tasks (parallel)
Batch 3: [T4] → 1 task (sequential)
Batch 4: [T5] → 1 task (sequential)
```

## DAG Validation

Before execution, validate the network:

1. **No cycles:** A task cannot depend (directly or indirectly) on itself
2. **No orphans:** All predecessors must exist
3. **Single source:** At least one task with no predecessors
4. **Single sink:** At least one task with no successors

### Cycle Detection (networkx)

```python
import networkx as nx

G = nx.DiGraph()
for task in tasks:
    G.add_node(task.id)
    for pred in task.predecessors:
        G.add_edge(pred, task.id)

if not nx.is_directed_acyclic_graph(G):
    cycles = list(nx.simple_cycles(G))
    raise ValueError(f"Cycles detected: {cycles}")
```

## Integration with Agentic Systems

### Task Decomposition via LLM

Prompt template for LLM-based decomposition:

```
Decompose the following task into subtasks with PERT estimates.

Task: {user_task}

For each subtask, provide:
- id: Unique identifier (T1, T2, ...)
- description: What the subtask does
- predecessors: List of task IDs that must complete first
- optimistic: Best-case duration in hours
- most_likely: Realistic duration in hours
- pessimistic: Worst-case duration in hours

Output as JSON array.
```

### Execution via Subagents

1. Generate plan with PERT/CPM
2. Identify parallelizable batches
3. For each batch:
   - If parallelizable: spawn all tasks simultaneously
   - If sequential: execute one at a time
4. Track actual vs estimated duration
5. Report results

## References

- [PERT Wikipedia](https://en.wikipedia.org/wiki/Program_evaluation_and_review_technique)
- [CPM Wikipedia](https://en.wikipedia.org/wiki/Critical_path_method)
- [networkx Documentation](https://networkx.org/documentation/stable/reference/algorithms/dag.html)
