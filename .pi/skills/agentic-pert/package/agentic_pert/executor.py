"""
Executor adapters for different harnesses.

Provides a common interface for executing tasks via subagents,
with implementations for OpenCode and other runtimes.
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Protocol, runtime_checkable

from .models import Task, ExecutionResult


@runtime_checkable
class Executor(Protocol):
    """Protocol that each harness adapter must implement."""
    
    async def spawn_task(self, task: Task) -> ExecutionResult:
        """Execute a single task as an isolated subagent."""
        ...
    
    async def spawn_parallel(
        self, 
        tasks: list[Task], 
        max_concurrency: int = 4
    ) -> list[ExecutionResult]:
        """Execute multiple tasks in parallel with concurrency limit."""
        ...


class BaseExecutor(ABC):
    """Base class for executor implementations."""
    
    def __init__(self, max_concurrency: int = 4, timeout: float = 3600.0):
        self.max_concurrency = max_concurrency
        self.timeout = timeout
    
    @abstractmethod
    async def spawn_task(self, task: Task) -> ExecutionResult:
        """Execute a single task. Must be implemented by subclass."""
        ...
    
    async def spawn_parallel(
        self, 
        tasks: list[Task], 
        max_concurrency: Optional[int] = None
    ) -> list[ExecutionResult]:
        """
        Execute multiple tasks in parallel with semaphore-based concurrency.
        
        Uses asyncio.Semaphore to limit concurrent executions.
        """
        concurrency = max_concurrency or self.max_concurrency
        semaphore = asyncio.Semaphore(concurrency)
        
        async def run_with_semaphore(task: Task) -> ExecutionResult:
            async with semaphore:
                return await self.spawn_task(task)
        
        results = await asyncio.gather(
            *[run_with_semaphore(t) for t in tasks],
            return_exceptions=True
        )
        
        # Convert exceptions to failed ExecutionResults
        processed = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                processed.append(ExecutionResult(
                    task_id=tasks[i].id,
                    success=False,
                    output="",
                    duration=0.0,
                    error=str(result)
                ))
            else:
                processed.append(result)
        
        return processed
