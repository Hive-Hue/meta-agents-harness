from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Task:
    id: str
    description: str
    predecessors: list[str] = field(default_factory=list)
    optimistic: float = 0.0
    most_likely: float = 0.0
    pessimistic: float = 0.0
    pert_duration: float = 0.0
    status: str = "pending"


@dataclass
class Plan:
    tasks: list[Task]
    dependencies: dict[str, list[str]] = field(default_factory=dict)
    critical_path: list[str] = field(default_factory=list)
    total_duration: float = 0.0
    parallelism_groups: list[dict] = field(default_factory=list)


@dataclass
class ExecutionResult:
    task_id: str
    success: bool
    output: str
    duration: float
    error: Optional[str] = None
