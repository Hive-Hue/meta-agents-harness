"""
Adapters package for different execution harnesses.

Each adapter implements the Executor protocol for a specific harness:
- OpenCode: Uses task runtime delegation
"""

from .opencode import OpenCodeExecutor, OpenCodePlanExecutor

__all__ = [
    "OpenCodeExecutor",
    "OpenCodePlanExecutor",
]
