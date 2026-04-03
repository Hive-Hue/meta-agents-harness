"""
Adapters package for different execution harnesses.

Each adapter implements the Executor protocol for a specific harness:
- OpenClaw: Uses sessions_spawn
- Pi Agent: Uses `pi --mode json` subprocess execution
"""

from .openclaw import OpenClawExecutor, OpenClawPlanExecutor
from .pi import PiAgentExecutor, PiAgentPlanExecutor

__all__ = [
    "OpenClawExecutor",
    "OpenClawPlanExecutor",
    "PiAgentExecutor",
    "PiAgentPlanExecutor",
]
