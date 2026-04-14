"""
OpenCode adapter for parallel task execution.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional, Any

from ..models import Task, ExecutionResult
from ..executor import BaseExecutor

TaskRunner = Callable[[Task, Optional[str]], Awaitable[Any] | Any]


@dataclass
class OpenCodeExecutor(BaseExecutor):
    """
    Executor that delegates work to OpenCode task runtime.

    For library-only usage, you can provide a `task_runner` callback.
    Without callback, it returns deterministic mock output to allow
    planning-flow validation in local environments.
    """

    max_concurrency: int = 4
    timeout: float = 3600.0
    model: Optional[str] = None
    task_runner: Optional[TaskRunner] = None

    def __post_init__(self):
        BaseExecutor.__init__(self, max_concurrency=self.max_concurrency, timeout=self.timeout)

    async def spawn_task(self, task: Task) -> ExecutionResult:
        start_time = time.time()

        # Mock mode when no runtime callback is supplied
        if self.task_runner is None:
            duration = time.time() - start_time
            return ExecutionResult(
                task_id=task.id,
                success=True,
                output=f"[MOCK] Task '{task.description}' would be delegated via OpenCode task runtime",
                duration=duration,
                error=None,
            )

        try:
            result = self.task_runner(task, self.model)
            if asyncio.iscoroutine(result):
                result = await result

            duration = time.time() - start_time
            return ExecutionResult(
                task_id=task.id,
                success=True,
                output=str(result),
                duration=duration,
                error=None,
            )
        except Exception as exc:  # noqa: BLE001
            duration = time.time() - start_time
            return ExecutionResult(
                task_id=task.id,
                success=False,
                output="",
                duration=duration,
                error=str(exc),
            )

    def to_opencode_task_payload(self, task: Task) -> dict:
        """
        Build canonical payload for OpenCode task delegation.
        """
        payload: dict[str, Any] = {
            "task": task.description,
            "runtime": "subagent",
        }
        if self.model:
            payload["model"] = self.model
        return payload


class OpenCodePlanExecutor:
    """
    High-level executor that runs an entire PERT/CPM plan via OpenCode.
    """

    def __init__(
        self,
        executor: Optional[OpenCodeExecutor] = None,
        model: Optional[str] = None,
        max_concurrency: int = 4,
    ):
        self.executor = executor or OpenCodeExecutor(model=model, max_concurrency=max_concurrency)
        self.model = model

    async def execute_plan(
        self,
        tasks: list[Task],
        batches: list[list[str]],
        task_callback: Optional[Callable[[str, ExecutionResult], None]] = None,
    ) -> dict[str, ExecutionResult]:
        task_map = {t.id: t for t in tasks}
        results: dict[str, ExecutionResult] = {}

        for batch in batches:
            batch_tasks = [task_map[tid] for tid in batch if tid in task_map]

            if len(batch_tasks) == 1:
                task = batch_tasks[0]
                result = await self.executor.spawn_task(task)
                results[task.id] = result
                if task_callback:
                    task_callback(task.id, result)
            elif len(batch_tasks) > 1:
                batch_results = await self.executor.spawn_parallel(batch_tasks)
                for task, result in zip(batch_tasks, batch_results):
                    results[task.id] = result
                    if task_callback:
                        task_callback(task.id, result)

        return results

    def generate_execution_guide(self, tasks: list[Task], batches: list[list[str]]) -> str:
        """
        Generate a concise OpenCode-native execution guide.
        """
        task_map = {t.id: t for t in tasks}
        lines = [
            "# OpenCode Execution Guide",
            "",
            "Execute each batch in order. Inside a batch, tasks can run in parallel.",
            "",
        ]
        for idx, batch in enumerate(batches, 1):
            lines.append(f"## Batch {idx}")
            for task_id in batch:
                task = task_map.get(task_id)
                if not task:
                    continue
                lines.append(f"- `{task.id}`: {task.description}")
            lines.append("")
        return "\n".join(lines).strip() + "\n"
