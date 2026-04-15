#!/usr/bin/env python3
"""
Validation script for Agentic PERT + CPM with OpenCode adapter.

This script tests the full workflow:
1. Create tasks with PERT estimates
2. Run PERT/CPM analysis
3. Export to visualization formats
4. Execute via OpenCode executor (mock runner)

Run this with uv to validate the integration.
"""

import asyncio
import sys
from pathlib import Path

# Add package to path
sys.path.insert(0, str(Path(__file__).parent.parent / "package"))

from agentic_pert import (
    Task,
    analyze_plan,
    Visualizer,
    OpenCodeExecutor,
    OpenCodePlanExecutor,
)


def create_test_tasks() -> list[Task]:
    """Create a simple test plan."""
    return [
        Task(
            id="T1",
            description="Create hello.py with a simple print statement",
            predecessors=[],
            optimistic=0.1,
            most_likely=0.2,
            pessimistic=0.5,
        ),
        Task(
            id="T2",
            description="Add a greeting function to hello.py",
            predecessors=["T1"],
            optimistic=0.2,
            most_likely=0.3,
            pessimistic=0.5,
        ),
        Task(
            id="T3",
            description="Create README.md with usage instructions",
            predecessors=["T1"],
            optimistic=0.1,
            most_likely=0.2,
            pessimistic=0.3,
        ),
        Task(
            id="T4",
            description="Add test for greeting function",
            predecessors=["T2"],
            optimistic=0.2,
            most_likely=0.4,
            pessimistic=0.8,
        ),
    ]


def test_pert_cpm_analysis():
    """Test PERT/CPM analysis."""
    print("=" * 60)
    print("TEST: PERT/CPM Analysis")
    print("=" * 60)
    
    tasks = create_test_tasks()
    plan, timings, batches = analyze_plan(tasks)
    
    print(f"\nTasks: {len(plan.tasks)}")
    print(f"Critical path: {' → '.join(plan.critical_path)}")
    print(f"Total duration: {plan.total_duration:.2f}h")
    print(f"Parallel batches: {batches}")
    
    print("\nTask timings:")
    for task_id, t in timings.items():
        print(f"  {task_id}: ES={t['ES']:.2f} EF={t['EF']:.2f} "
              f"LS={t['LS']:.2f} LF={t['LF']:.2f} float={t['float']:.2f}")
    
    return plan, timings, batches


def test_visualization(plan, timings):
    """Test visualization formats."""
    print("\n" + "=" * 60)
    print("TEST: Visualization Formats")
    print("=" * 60)
    
    viz = Visualizer(plan, timings)
    
    # Mermaid
    mermaid = viz.to_mermaid()
    print(f"\nMermaid ({len(mermaid)} chars):")
    print(mermaid[:300] + "..." if len(mermaid) > 300 else mermaid)
    
    # React Flow
    flow = viz.to_react_flow_format()
    print(f"\nReact Flow: {len(flow['nodes'])} nodes, {len(flow['edges'])} edges")
    
    # ASCII
    ascii_art = viz.to_ascii()
    print(f"\nASCII Art:")
    print(ascii_art[:500])


async def test_opencode_executor_mock():
    """Test OpenCode executor (mock mode)."""
    print("\n" + "=" * 60)
    print("TEST: OpenCode Executor (Mock Mode)")
    print("=" * 60)
    
    executor = OpenCodeExecutor(model="openai/gpt-5.2")
    task = Task(
        id="TEST",
        description="Test task",
        predecessors=[],
        optimistic=0.1,
        most_likely=0.2,
        pessimistic=0.3,
    )
    
    # This returns a mock result since no task_runner callback is configured
    result = await executor.spawn_task(task)
    print(f"\nResult: {result}")
    print(f"Payload: {executor.to_opencode_task_payload(task)}")


async def test_opencode_plan_executor():
    """Test full plan execution."""
    print("\n" + "=" * 60)
    print("TEST: OpenCode Plan Executor")
    print("=" * 60)
    
    tasks = create_test_tasks()
    plan, timings, batches = analyze_plan(tasks)
    
    executor = OpenCodePlanExecutor(model="openai/gpt-5.2")
    
    # Generate execution guide
    script = executor.generate_execution_guide(tasks, batches)
    print(f"\nGenerated execution guide ({len(script)} chars)")
    print("First 500 chars:")
    print(script[:500])
    print("...")


def test_integration():
    """Run all tests."""
    print("\n" + "=" * 60)
    print("AGENTIC PERT + CPM - OpenCode Validation")
    print("=" * 60)
    
    # Test 1: PERT/CPM Analysis
    plan, timings, batches = test_pert_cpm_analysis()
    
    # Test 2: Visualization
    test_visualization(plan, timings)
    
    # Test 3: OpenCode Executor (async)
    asyncio.run(test_opencode_executor_mock())
    
    # Test 4: Plan Executor
    asyncio.run(test_opencode_plan_executor())
    
    print("\n" + "=" * 60)
    print("✅ All validation tests passed!")
    print("=" * 60)


if __name__ == "__main__":
    test_integration()
