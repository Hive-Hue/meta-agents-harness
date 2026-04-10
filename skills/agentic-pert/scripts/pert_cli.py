#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PACKAGE_ROOT = ROOT / "package"
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))


def _read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _split_predecessors(raw: str) -> list[str]:
    if not raw.strip():
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pert-cli", description="CLI de apoio para criar plano e análise PERT/CPM")
    sub = parser.add_subparsers(dest="command", required=True)

    prompt = sub.add_parser("prompt", help="gera prompt de decomposição para LLM")
    prompt.add_argument("--objective", required=True, help="objetivo macro do problema")

    init_plan = sub.add_parser("init-plan", help="inicializa arquivo de plano")
    init_plan.add_argument("--objective", required=True, help="objetivo macro do plano")
    init_plan.add_argument("--output", required=True, help="arquivo de saída .json")

    add_task = sub.add_parser("add-task", help="adiciona tarefa manualmente ao plano")
    add_task.add_argument("--plan", required=True, help="arquivo de plano .json")
    add_task.add_argument("--id", required=True, help="id da tarefa, ex: T1")
    add_task.add_argument("--description", required=True, help="descrição da tarefa")
    add_task.add_argument("--predecessors", default="", help="ids predecessoras separadas por vírgula")
    add_task.add_argument("--optimistic", type=float, required=True, help="estimativa otimista (horas)")
    add_task.add_argument("--most-likely", type=float, required=True, help="estimativa mais provável (horas)")
    add_task.add_argument("--pessimistic", type=float, required=True, help="estimativa pessimista (horas)")

    from_dec = sub.add_parser("from-decomposition", help="carrega tasks de JSON de decomposição e monta plano")
    from_dec.add_argument("--objective", required=True, help="objetivo macro do plano")
    from_dec.add_argument("--decomposition-file", required=True, help="arquivo JSON do planner com campo tasks")
    from_dec.add_argument("--output", required=True, help="arquivo de saída do plano .json")

    analyze = sub.add_parser("analyze", help="calcula PERT/CPM a partir do plano")
    analyze.add_argument("--plan", required=True, help="arquivo de plano .json")
    analyze.add_argument("--output", required=True, help="arquivo de saída com análise .json")
    analyze.add_argument("--mermaid-output", help="arquivo opcional para saída mermaid")
    analyze.add_argument(
        "--mermaid-style",
        choices=["flowchart", "classic-pert", "pert-gantt"],
        default="flowchart",
        help="estilo da saída mermaid",
    )
    analyze.add_argument(
        "--mermaid-milestone-label",
        help="rótulo do milestone final no estilo pert-gantt",
    )
    return parser


def _cmd_prompt(args: argparse.Namespace) -> int:
    from agentic_pert.planner import build_decomposition_prompt

    print(build_decomposition_prompt(args.objective))
    return 0


def _cmd_init_plan(args: argparse.Namespace) -> int:
    payload = {"objective": args.objective, "tasks": []}
    _write_json(Path(args.output), payload)
    print(f"Plano inicial criado em {args.output}")
    return 0


def _validate_estimates(o: float, m: float, p: float) -> None:
    if not (o > 0 and m > 0 and p > 0):
        raise ValueError("Estimativas devem ser maiores que zero")
    if not (o <= m <= p):
        raise ValueError("Estimativas devem obedecer optimistic <= most_likely <= pessimistic")


def _cmd_add_task(args: argparse.Namespace) -> int:
    _validate_estimates(args.optimistic, args.most_likely, args.pessimistic)
    plan_path = Path(args.plan)
    payload = _read_json(plan_path)
    tasks = payload.setdefault("tasks", [])

    if any(task.get("id") == args.id for task in tasks):
        raise ValueError(f"Task id duplicado: {args.id}")

    predecessors = _split_predecessors(args.predecessors)
    known = {task.get("id") for task in tasks}
    missing = [pred for pred in predecessors if pred not in known]
    if missing:
        raise ValueError(f"Predecessoras não encontradas no plano: {missing}")

    tasks.append(
        {
            "id": args.id,
            "description": args.description,
            "predecessors": predecessors,
            "optimistic": args.optimistic,
            "most_likely": args.most_likely,
            "pessimistic": args.pessimistic,
        }
    )
    _write_json(plan_path, payload)
    print(f"Tarefa {args.id} adicionada em {args.plan}")
    return 0


def _cmd_from_decomposition(args: argparse.Namespace) -> int:
    from agentic_pert.planner import PlannerResponseModel

    decomposition = _read_json(Path(args.decomposition_file))
    parsed = PlannerResponseModel.model_validate(decomposition)
    payload = {
        "objective": args.objective,
        "tasks": [
            {
                "id": task.id,
                "description": task.description,
                "predecessors": task.predecessors,
                "optimistic": task.optimistic,
                "most_likely": task.most_likely,
                "pessimistic": task.pessimistic,
            }
            for task in parsed.tasks
        ],
    }
    _write_json(Path(args.output), payload)
    print(f"Plano criado a partir da decomposição em {args.output}")
    return 0


def _cmd_analyze(args: argparse.Namespace) -> int:
    try:
        from agentic_pert.models import Task
        from agentic_pert.pert_cpm import analyze_plan
        from agentic_pert.visualization import to_mermaid
    except ModuleNotFoundError as exc:
        raise ValueError(
            "Dependências ausentes. Execute: "
            "uv sync --project .claude/skills/agentic-pert/package --extra dev --extra visualization"
        ) from exc

    payload = _read_json(Path(args.plan))
    tasks_raw = payload.get("tasks", [])
    if not tasks_raw:
        raise ValueError("Plano sem tarefas")

    tasks = []
    for task in tasks_raw:
        tasks.append(
            Task(
                id=task["id"],
                description=task["description"],
                predecessors=task.get("predecessors", []),
                optimistic=float(task["optimistic"]),
                most_likely=float(task["most_likely"]),
                pessimistic=float(task["pessimistic"]),
            )
        )

    plan, timings, batches = analyze_plan(tasks)
    output = {
        "objective": payload.get("objective", ""),
        "critical_path": plan.critical_path,
        "total_duration": plan.total_duration,
        "dependencies": plan.dependencies,
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
            for t in plan.tasks
        ],
    }
    _write_json(Path(args.output), output)
    print(f"Análise PERT/CPM salva em {args.output}")

    if args.mermaid_output:
        mermaid = to_mermaid(
            plan,
            timings,
            style=args.mermaid_style,
            milestone_label=args.mermaid_milestone_label,
        )
        path = Path(args.mermaid_output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(mermaid, encoding="utf-8")
        print(f"Mermaid ({args.mermaid_style}) salvo em {args.mermaid_output}")
    return 0


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    handlers = {
        "prompt": _cmd_prompt,
        "init-plan": _cmd_init_plan,
        "add-task": _cmd_add_task,
        "from-decomposition": _cmd_from_decomposition,
        "analyze": _cmd_analyze,
    }
    try:
        return handlers[args.command](args)
    except Exception as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
