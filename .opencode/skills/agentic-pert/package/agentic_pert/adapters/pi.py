from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from ..executor import BaseExecutor
from ..models import ExecutionResult, Task


@dataclass
class PiAgentExecutor(BaseExecutor):
    max_concurrency: int = 4
    timeout: float = 3600.0
    pi_binary: str = "pi"
    model: Optional[str] = None
    run_timeout: int = 1800
    tools: list[str] = field(default_factory=lambda: ["read", "bash", "grep", "find", "ls"])
    thinking: str = "off"
    no_extensions: bool = True
    session_dir: Optional[str] = None
    extra_args: list[str] = field(default_factory=list)

    def __post_init__(self):
        BaseExecutor.__init__(self, max_concurrency=self.max_concurrency, timeout=self.timeout)

    def _session_dir(self) -> Path:
        if self.session_dir:
            path = Path(self.session_dir)
        else:
            path = Path(tempfile.gettempdir()) / "agentic-pert-pi-sessions"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _session_file(self, task: Task) -> Path:
        safe_task_id = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in task.id)
        filename = f"{safe_task_id}-{int(time.time() * 1000)}.jsonl"
        return self._session_dir() / filename

    def _build_command(self, task: Task, session_file: Path) -> list[str]:
        command = [
            self.pi_binary,
            "--mode",
            "json",
            "-p",
            "--session",
            str(session_file),
        ]
        if self.no_extensions:
            command.append("--no-extensions")
        if self.model:
            command.extend(["--model", self.model])
        if self.tools:
            command.extend(["--tools", ",".join(self.tools)])
        if self.thinking:
            command.extend(["--thinking", self.thinking])
        command.extend(self.extra_args)
        command.append(task.description)
        return command

    @staticmethod
    def _parse_json_stream(stdout: str, stderr: str = "") -> tuple[str, int]:
        text_chunks: list[str] = []
        tool_count = 0

        for line in stdout.splitlines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                text_chunks.append(line)
                continue

            event_type = event.get("type")
            if event_type == "message_update":
                message = event.get("assistantMessageEvent", {})
                if message.get("type") == "text_delta":
                    delta = message.get("delta") or ""
                    if delta:
                        text_chunks.append(delta)
            elif event_type == "tool_execution_start":
                tool_count += 1

        if stderr.strip():
            text_chunks.append(stderr.strip())

        return "".join(text_chunks).strip(), tool_count

    async def spawn_task(self, task: Task) -> ExecutionResult:
        start = time.time()
        if shutil.which(self.pi_binary) is None:
            return ExecutionResult(
                task_id=task.id,
                success=False,
                output="",
                duration=time.time() - start,
                error=f"Pi CLI not found: {self.pi_binary}",
            )

        session_file = self._session_file(task)
        command = self._build_command(task, session_file)

        def _run():
            return subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=self.run_timeout,
                env={**os.environ},
            )

        try:
            completed = await asyncio.to_thread(_run)
            output, tool_count = self._parse_json_stream(completed.stdout, completed.stderr)
            if tool_count and output:
                output = f"[tools={tool_count}]\n{output}"
            elif tool_count:
                output = f"[tools={tool_count}]"
            return ExecutionResult(
                task_id=task.id,
                success=completed.returncode == 0,
                output=output,
                duration=time.time() - start,
                error=None if completed.returncode == 0 else f"exit code {completed.returncode}",
            )
        except subprocess.TimeoutExpired:
            return ExecutionResult(
                task_id=task.id,
                success=False,
                output="",
                duration=time.time() - start,
                error=f"timeout after {self.run_timeout}s",
            )
        except Exception as exc:
            return ExecutionResult(
                task_id=task.id,
                success=False,
                output="",
                duration=time.time() - start,
                error=str(exc),
            )


class PiAgentPlanExecutor:
    def __init__(
        self,
        executor: Optional[PiAgentExecutor] = None,
        model: Optional[str] = None,
        max_concurrency: int = 4,
    ):
        self.executor = executor or PiAgentExecutor(model=model, max_concurrency=max_concurrency)

    async def execute_plan(
        self,
        tasks: list[Task],
        batches: list[list[str]],
        task_callback: Optional[callable] = None,
    ) -> dict[str, ExecutionResult]:
        task_map = {task.id: task for task in tasks}
        results: dict[str, ExecutionResult] = {}

        for batch in batches:
            batch_tasks = [task_map[task_id] for task_id in batch if task_id in task_map]
            if not batch_tasks:
                continue

            if len(batch_tasks) == 1:
                task = batch_tasks[0]
                result = await self.executor.spawn_task(task)
                results[task.id] = result
                if task_callback:
                    task_callback(task.id, result)
                continue

            parallel_results = await self.executor.spawn_parallel(batch_tasks)
            for task, result in zip(batch_tasks, parallel_results):
                results[task.id] = result
                if task_callback:
                    task_callback(task.id, result)

        return results
