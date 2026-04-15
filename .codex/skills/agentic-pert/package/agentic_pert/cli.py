from __future__ import annotations

import json
from typing import Literal

import typer

from .pert_cpm import analyze_plan
from .planner import build_decomposition_prompt, parse_plan_json

app = typer.Typer(help="Agentic PERT planner CLI")


def _to_mermaid(plan) -> str:
    lines = ["flowchart TD"]
    critical = set(plan.critical_path)

    for task in plan.tasks:
        cls = "critical" if task.id in critical else "normal"
        label = task.description.replace('"', "'")
        lines.append(f"  {task.id}[\"{task.id}: {label}\\n{task.pert_duration:.2f}h\"]:::{cls}")

    for task in plan.tasks:
        for pred in task.predecessors:
            lines.append(f"  {pred} --> {task.id}")

    lines.extend(
        [
            "",
            "  classDef critical fill:#ff6b6b,stroke:#c92a2a,color:#111;",
            "  classDef normal fill:#74c0fc,stroke:#339af0,color:#111;",
        ]
    )
    return "\n".join(lines)


@app.command()
def plan(
    task: str = typer.Argument(..., help="Tarefa de alto nível para decomposição"),
    output: Literal["json", "mermaid"] = typer.Option("json", "--output", "-o"),
    input_file: str | None = typer.Option(
        None,
        "--input-file",
        help="Arquivo com JSON estruturado do planner (quando LLM externo já foi executado)",
    ),
) -> None:
    """Gera plano PERT/CPM a partir de tarefa (via JSON de planner)."""

    if not input_file:
        typer.echo("Forneça --input-file com JSON do planner. Prompt sugerido:\n")
        typer.echo(build_decomposition_prompt(task))
        raise typer.Exit(code=2)

    with open(input_file, "r", encoding="utf-8") as f:
        llm_output = f.read()

    tasks = parse_plan_json(llm_output)
    computed_plan, timings, batches = analyze_plan(tasks)

    if output == "json":
        payload = {
            "task": task,
            "critical_path": computed_plan.critical_path,
            "total_duration": computed_plan.total_duration,
            "dependencies": computed_plan.dependencies,
            "parallel_batches": batches,
            "tasks": [
                {
                    "id": t.id,
                    "description": t.description,
                    "predecessors": t.predecessors,
                    "optimistic": t.optimistic,
                    "most_likely": t.most_likely,
                    "pessimistic": t.pessimistic,
                    "pert_duration": t.pert_duration,
                    "status": t.status,
                    "timings": timings[t.id],
                }
                for t in computed_plan.tasks
            ],
        }
        typer.echo(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        typer.echo(_to_mermaid(computed_plan))


if __name__ == "__main__":
    app()
