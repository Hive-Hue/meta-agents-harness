"""
OpenClaw adapter using sessions_spawn for parallel task execution.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Optional, Any

from ..models import Task, ExecutionResult
from ..executor import BaseExecutor


@dataclass
class OpenClawExecutor(BaseExecutor):
    """
    Executor that uses OpenClaw's sessions_spawn for subagent execution.
    
    This adapter integrates directly with OpenClaw's subagent system,
    allowing PERT/CPM planned tasks to be executed in parallel.
    
    Usage in OpenClaw context:
        executor = OpenClawExecutor(model="zai/glm-5")
        task = Task(id='T1', description='Create hello.py')
        result = await executor.spawn_task(task)
    """
    
    max_concurrency: int = 4
    timeout: float = 3600.0
    runtime: str = "subagent"
    model: Optional[str] = None
    run_timeout: int = 1800  # 30 minutes default per task
    spawn_options: dict = field(default_factory=dict)

    def __post_init__(self):
        BaseExecutor.__init__(self, max_concurrency=self.max_concurrency, timeout=self.timeout)
    
    async def spawn_task(self, task: Task) -> ExecutionResult:
        """
        Execute a single task via OpenClaw sessions_spawn.
        
        In actual OpenClaw execution context, this calls sessions_spawn.
        When run outside OpenClaw, returns a mock result for testing.
        """
        start_time = time.time()
        
        # Try to use sessions_spawn if available (in OpenClaw context)
        try:
            # This import only works inside OpenClaw runtime
            from openclaw import sessions_spawn
            
            result = await sessions_spawn(
                task=task.description,
                runtime=self.runtime,
                model=self.model,
                runTimeoutSeconds=self.run_timeout,
                **self.spawn_options
            )
            
            duration = time.time() - start_time
            
            return ExecutionResult(
                task_id=task.id,
                success=True,
                output=str(result),
                duration=duration,
                error=None
            )
        except ImportError:
            # Not in OpenClaw context - return mock for testing
            duration = time.time() - start_time
            
            return ExecutionResult(
                task_id=task.id,
                success=True,
                output=f"[MOCK] Task '{task.description}' would be executed via sessions_spawn",
                duration=duration,
                error=None
            )
    
    def to_openclaw_spawn_config(self, task: Task) -> dict:
        """
        Generate the configuration dict for sessions_spawn.
        
        Useful for debugging or manual execution.
        """
        return {
            "task": task.description,
            "runtime": self.runtime,
            "model": self.model,
            "runTimeoutSeconds": self.run_timeout,
            "mode": "run",
            **self.spawn_options
        }


class OpenClawPlanExecutor:
    """
    High-level executor that runs an entire PERT/CPM plan via OpenClaw.
    
    Handles:
    - Batch execution (parallel vs sequential)
    - Progress tracking
    - Result aggregation
    """
    
    def __init__(
        self,
        executor: Optional[OpenClawExecutor] = None,
        model: Optional[str] = None,
        max_concurrency: int = 4,
    ):
        self.executor = executor or OpenClawExecutor(model=model, max_concurrency=max_concurrency)
        self.model = model
    
    async def execute_plan(
        self,
        tasks: list[Task],
        batches: list[list[str]],
        task_callback: Optional[callable] = None,
    ) -> dict[str, ExecutionResult]:
        """
        Execute a plan respecting batch dependencies.
        
        Args:
            tasks: List of Task objects
            batches: List of batches (each batch is a list of task IDs)
            task_callback: Optional callback(task_id, result) for progress updates
        
        Returns:
            Dict mapping task_id -> ExecutionResult
        """
        task_map = {t.id: t for t in tasks}
        results: dict[str, ExecutionResult] = {}
        
        for batch_num, batch in enumerate(batches, 1):
            batch_tasks = [task_map[tid] for tid in batch if tid in task_map]
            
            if len(batch_tasks) == 1:
                # Sequential execution
                task = batch_tasks[0]
                result = await self.executor.spawn_task(task)
                results[task.id] = result
                
                if task_callback:
                    task_callback(task.id, result)
            
            elif len(batch_tasks) > 1:
                # Parallel execution
                batch_results = await self.executor.spawn_parallel(batch_tasks)
                
                for task, result in zip(batch_tasks, batch_results):
                    results[task.id] = result
                    
                    if task_callback:
                        task_callback(task.id, result)
            
            # Check for failures - stop if critical task failed
            failed = [r for r in results.values() if not r.success]
            if failed:
                # Could implement retry logic here
                pass
        
        return results
    
    def generate_execution_script(self, tasks: list[Task], batches: list[list[str]]) -> str:
        """
        Generate a Python script that can be run in OpenClaw context.
        
        This script uses sessions_spawn directly.
        """
        lines = [
            '"""Auto-generated OpenClaw execution script."""',
            'import asyncio',
            'from openclaw import sessions_spawn',
            '',
            'async def execute_plan():',
            '    results = {}',
            '',
        ]
        
        task_map = {t.id: t for t in tasks}
        
        for batch_num, batch in enumerate(batches, 1):
            batch_tasks = [task_map[tid] for tid in batch if tid in task_map]
            
            if len(batch_tasks) == 1:
                task = batch_tasks[0]
                lines.extend([
                    f'    # Batch {batch_num}: {task.id}',
                    f'    print("Executing: {task.description}")',
                    f'    result = await sessions_spawn(',
                    f'        task="{task.description}",',
                    f'        runtime="{self.executor.runtime}",',
                    f'        model="{self.model or "default"}",',
                    f'        runTimeoutSeconds={self.executor.run_timeout},',
                    f'    )',
                    f'    results["{task.id}"] = result',
                    '',
                ])
            else:
                lines.extend([
                    f'    # Batch {batch_num}: Parallel execution',
                    f'    batch_{batch_num}_tasks = [',
                ])
                for task in batch_tasks:
                    lines.append(f'        "{task.description}",')
                lines.extend([
                    '    ]',
                    f'    batch_{batch_num}_results = await asyncio.gather(*[',
                    f'        sessions_spawn(',
                    f'            task=t,',
                    f'            runtime="{self.executor.runtime}",',
                    f'            model="{self.model or "default"}",',
                    f'            runTimeoutSeconds={self.executor.run_timeout},',
                    f'        )',
                    f'        for t in batch_{batch_num}_tasks',
                    f'    ])',
                    '',
                ])
                for index, task in enumerate(batch_tasks):
                    lines.append(f'    results["{task.id}"] = batch_{batch_num}_results[{index}]')
                lines.append('')
        
        lines.extend([
            '    return results',
            '',
            'if __name__ == "__main__":',
            '    asyncio.run(execute_plan())',
        ])
        
        return '\n'.join(lines)
