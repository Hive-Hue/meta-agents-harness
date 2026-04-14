#!/usr/bin/env python3
"""
Example: Using Agentic PERT visualization.

This example demonstrates how to:
1. Create a plan with tasks
2. Export to multiple visualization formats
3. Use the outputs in different contexts
"""

from pathlib import Path

from agentic_pert import Task, Plan, Visualizer


SKILL_ROOT = Path(__file__).resolve().parent.parent


def create_sample_plan() -> Plan:
    """Create a sample project plan."""
    tasks = [
        Task(
            id="T1",
            description="Setup JWT library",
            predecessors=[],
            pert_duration=1.5,
            optimistic=1.0,
            most_likely=1.5,
            pessimistic=2.5,
            critical=True,
            status="pending",
            early_start=0.0,
            early_finish=1.5,
            late_start=0.0,
            late_finish=1.5,
            float_=0.0,
        ),
        Task(
            id="T2",
            description="Implement auth endpoints",
            predecessors=["T1"],
            pert_duration=3.0,
            optimistic=2.0,
            most_likely=3.0,
            pessimistic=5.0,
            critical=True,
            status="pending",
            early_start=1.5,
            early_finish=4.5,
            late_start=1.5,
            late_finish=4.5,
            float_=0.0,
        ),
        Task(
            id="T3",
            description="Build dashboard base",
            predecessors=["T1"],
            pert_duration=2.0,
            optimistic=1.5,
            most_likely=2.0,
            pessimistic=3.0,
            critical=False,
            status="pending",
            early_start=1.5,
            early_finish=3.5,
            late_start=2.5,
            late_finish=4.5,
            float_=1.0,
        ),
        Task(
            id="T4",
            description="Integrate auth with dashboard",
            predecessors=["T2", "T3"],
            pert_duration=1.5,
            optimistic=1.0,
            most_likely=1.5,
            pessimistic=2.5,
            critical=True,
            status="pending",
            early_start=4.5,
            early_finish=6.0,
            late_start=4.5,
            late_finish=6.0,
            float_=0.0,
        ),
        Task(
            id="T5",
            description="Write integration tests",
            predecessors=["T4"],
            pert_duration=2.5,
            optimistic=2.0,
            most_likely=2.5,
            pessimistic=4.0,
            critical=True,
            status="pending",
            early_start=6.0,
            early_finish=8.5,
            late_start=6.0,
            late_finish=8.5,
            float_=0.0,
        ),
    ]
    
    return Plan(
        tasks=tasks,
        critical_path=["T1", "T2", "T4", "T5"],
        total_duration=8.5,
        parallelism_groups=[
            {"batch": 1, "tasks": ["T1"], "can_run_parallel": False},
            {"batch": 2, "tasks": ["T2", "T3"], "can_run_parallel": True},
            {"batch": 3, "tasks": ["T4"], "can_run_parallel": False},
            {"batch": 4, "tasks": ["T5"], "can_run_parallel": False},
        ],
    )


def main():
    """Run the example."""
    print("=== Agentic PERT + CPM Example ===\n")
    
    # Create plan
    plan = create_sample_plan()
    print(f"Total tasks: {len(plan.tasks)}")
    print(f"Critical path: {' → '.join(plan.critical_path)}")
    print(f"Total duration: {plan.total_duration}h\n")
    
    # Create visualizer
    viz = Visualizer(plan)
    
    # 1. Mermaid (for docs)
    print("--- Mermaid Flowchart ---")
    mermaid = viz.to_mermaid()
    print(mermaid)
    print()
    
    # 2. ASCII (for terminal)
    print("--- ASCII Art ---")
    ascii_art = viz.to_ascii()
    print(ascii_art)
    print()
    
    # 3. D3.js (for web)
    print("--- D3.js Format ---")
    d3_data = viz.to_d3_format()
    print(f"Nodes: {len(d3_data['nodes'])}")
    print(f"Links: {len(d3_data['links'])}")
    print(f"Critical path in metadata: {d3_data['metadata']['criticalPath']}")
    print()
    
    # 4. React Flow (for React UI)
    print("--- React Flow Format ---")
    react_flow = viz.to_react_flow_format()
    print(f"Nodes: {len(react_flow['nodes'])}")
    print(f"Edges: {len(react_flow['edges'])}")
    print(f"First node position: {react_flow['nodes'][0]['position']}")
    print()
    
    # 5. Graphviz DOT (for SVG/PDF)
    print("--- Graphviz DOT ---")
    dot = viz.to_dot_format()
    print(dot[:200] + "...")
    print()
    
    # 6. Save to files
    import json
    import os
    
    output_dir = SKILL_ROOT / "examples" / "output"
    os.makedirs(output_dir, exist_ok=True)
    
    # Save all formats
    with open(output_dir / "plan.mmd", "w") as f:
        f.write(mermaid)
    
    with open(output_dir / "plan-d3.json", "w") as f:
        json.dump(d3_data, f, indent=2)
    
    with open(output_dir / "plan-flow.json", "w") as f:
        json.dump(react_flow, f, indent=2)
    
    with open(output_dir / "plan.dot", "w") as f:
        f.write(dot)
    
    with open(output_dir / "plan.txt", "w") as f:
        f.write(ascii_art)
    
    print(f"✅ Saved all formats to {output_dir}/")
    print("   - plan.mmd (Mermaid)")
    print("   - plan-d3.json (D3.js)")
    print("   - plan-flow.json (React Flow)")
    print("   - plan.dot (Graphviz)")
    print("   - plan.txt (ASCII)")


if __name__ == "__main__":
    main()
