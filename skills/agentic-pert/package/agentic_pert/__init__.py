"""
Agentic PERT + CPM

Orchestrator with PERT + CPM that decomposes complex tasks,
calculates critical path (CPM), probabilistic estimates (PERT),
and prepares parallelizable batches for agentic execution.
"""

__version__ = "0.1.0"

# Core models
from .models import Task, Plan, ExecutionResult

# PERT/CPM analysis
from .pert_cpm import (
    calculate_pert_duration,
    build_dag,
    validate_dag,
    forward_pass,
    backward_pass,
    identify_critical_path,
    compute_parallel_batches,
    analyze_plan,
)

# LLM-based planner
from .planner import (
    build_decomposition_prompt,
    parse_plan_json,
    PlannerTaskModel,
    PlannerResponseModel,
)

# Visualization formats
from .visualization import (
    Visualizer,
    to_mermaid,
    to_d3,
    to_cytoscape,
    to_react_flow,
    to_dot,
    to_ascii,
)

# Executor interface
from .executor import Executor, BaseExecutor

# Adapters
from .adapters import (
    OpenCodeExecutor,
    OpenCodePlanExecutor,
)

__all__ = [
    # Models
    "Task",
    "Plan",
    "ExecutionResult",
    # PERT/CPM
    "calculate_pert_duration",
    "build_dag",
    "validate_dag",
    "forward_pass",
    "backward_pass",
    "identify_critical_path",
    "compute_parallel_batches",
    "analyze_plan",
    # Planner
    "build_decomposition_prompt",
    "parse_plan_json",
    "PlannerTaskModel",
    "PlannerResponseModel",
    # Visualization
    "Visualizer",
    "to_mermaid",
    "to_d3",
    "to_cytoscape",
    "to_react_flow",
    "to_dot",
    "to_ascii",
    # Executor
    "Executor",
    "BaseExecutor",
    # Adapters
    "OpenCodeExecutor",
    "OpenCodePlanExecutor",
]
