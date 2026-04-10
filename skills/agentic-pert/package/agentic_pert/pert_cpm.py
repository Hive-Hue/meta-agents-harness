from __future__ import annotations

from collections import deque
from dataclasses import asdict

import networkx as nx

from .models import Plan, Task


def calculate_pert_duration(optimistic: float, most_likely: float, pessimistic: float) -> float:
    """Calcula duração esperada PERT: (o + 4m + p) / 6."""
    return (optimistic + (4 * most_likely) + pessimistic) / 6.0


def build_dag(tasks: list[Task]) -> nx.DiGraph:
    """Cria grafo DAG orientado de dependências de tarefas."""
    graph = nx.DiGraph()

    task_ids = {t.id for t in tasks}
    if len(task_ids) != len(tasks):
        raise ValueError("Task IDs must be unique")

    for task in tasks:
        if task.pert_duration <= 0:
            task.pert_duration = calculate_pert_duration(task.optimistic, task.most_likely, task.pessimistic)
        graph.add_node(task.id, task=task)

    for task in tasks:
        for predecessor in task.predecessors:
            if predecessor not in task_ids:
                raise ValueError(f"Task '{task.id}' references unknown predecessor '{predecessor}'")
            graph.add_edge(predecessor, task.id)

    validate_dag(graph)
    return graph


def validate_dag(graph: nx.DiGraph) -> None:
    """Valida se grafo é DAG (sem ciclos)."""
    if not nx.is_directed_acyclic_graph(graph):
        cycle = nx.find_cycle(graph, orientation="original")
        cycle_repr = " -> ".join([str(edge[0]) for edge in cycle] + [str(cycle[0][0])])
        raise ValueError(f"Dependency graph has cycle: {cycle_repr}")


def forward_pass(graph: nx.DiGraph) -> tuple[dict[str, float], dict[str, float]]:
    """Calcula ES/EF (Early Start/Finish)."""
    es: dict[str, float] = {}
    ef: dict[str, float] = {}

    for node in nx.topological_sort(graph):
        preds = list(graph.predecessors(node))
        es[node] = max((ef[p] for p in preds), default=0.0)
        duration = graph.nodes[node]["task"].pert_duration
        ef[node] = es[node] + duration

    return es, ef


def backward_pass(graph: nx.DiGraph, project_duration: float) -> tuple[dict[str, float], dict[str, float]]:
    """Calcula LS/LF (Late Start/Finish)."""
    ls: dict[str, float] = {}
    lf: dict[str, float] = {}

    for node in reversed(list(nx.topological_sort(graph))):
        succs = list(graph.successors(node))
        lf[node] = min((ls[s] for s in succs), default=project_duration)
        duration = graph.nodes[node]["task"].pert_duration
        ls[node] = lf[node] - duration

    return ls, lf


def identify_critical_path(
    graph: nx.DiGraph,
    es: dict[str, float],
    ls: dict[str, float],
    tolerance: float = 1e-9,
) -> list[str]:
    """Retorna nós críticos (float ~ 0) em ordem topológica."""
    critical = []
    for node in nx.topological_sort(graph):
        total_float = ls[node] - es[node]
        if abs(total_float) <= tolerance:
            critical.append(node)
    return critical


def compute_parallel_batches(graph: nx.DiGraph) -> list[list[str]]:
    """Agrupa tarefas por níveis de paralelização (Kahn levelized)."""
    indegree = {n: graph.in_degree(n) for n in graph.nodes}
    ready = deque(sorted([n for n, d in indegree.items() if d == 0]))
    batches: list[list[str]] = []

    while ready:
        current_batch = list(ready)
        batches.append(current_batch)
        next_ready = []

        for node in current_batch:
            ready.popleft()
            for succ in graph.successors(node):
                indegree[succ] -= 1
                if indegree[succ] == 0:
                    next_ready.append(succ)

        ready.extend(sorted(next_ready))

    if sum(len(batch) for batch in batches) != len(graph.nodes):
        raise ValueError("Failed to compute parallel batches; graph may have unresolved cycle")

    return batches


def analyze_plan(tasks: list[Task]) -> tuple[Plan, dict[str, dict[str, float]], list[list[str]]]:
    """Executa análise completa PERT/CPM e retorna Plan + tempos + batches."""
    graph = build_dag(tasks)

    es, ef = forward_pass(graph)
    total_duration = max(ef.values(), default=0.0)
    ls, lf = backward_pass(graph, total_duration)
    critical_path = identify_critical_path(graph, es, ls)
    batches = compute_parallel_batches(graph)

    dependencies = {node: list(graph.predecessors(node)) for node in graph.nodes}
    
    # Convert batches to parallelism_groups format
    parallelism_groups = [
        {
            "batch": i + 1,
            "tasks": batch,
            "can_run_parallel": len(batch) > 1
        }
        for i, batch in enumerate(batches)
    ]
    
    plan = Plan(
        tasks=tasks,
        dependencies=dependencies,
        critical_path=critical_path,
        total_duration=total_duration,
        parallelism_groups=parallelism_groups,
    )

    timings = {
        node: {
            "ES": es[node],
            "EF": ef[node],
            "LS": ls[node],
            "LF": lf[node],
            "float": ls[node] - es[node],
        }
        for node in graph.nodes
    }

    return plan, timings, batches
