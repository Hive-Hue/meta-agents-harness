from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field, ValidationError, model_validator

from .models import Task


class PlannerTaskModel(BaseModel):
    id: str = Field(min_length=1)
    description: str = Field(min_length=1)
    predecessors: list[str] = Field(default_factory=list)
    optimistic: float = Field(gt=0)
    most_likely: float = Field(gt=0)
    pessimistic: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_estimates(self) -> "PlannerTaskModel":
        if self.optimistic > self.most_likely or self.most_likely > self.pessimistic:
            raise ValueError("Expected optimistic <= most_likely <= pessimistic")
        return self


class PlannerResponseModel(BaseModel):
    tasks: list[PlannerTaskModel] = Field(min_length=1)


def build_decomposition_prompt(user_task: str) -> str:
    """Prompt base para pedir decomposição de tarefa ao LLM."""
    return f"""
Você é um planejador técnico especializado em PERT/CPM.
Decomponha a tarefa do usuário em subtarefas atômicas com dependências DAG.

Regras:
1) Responda APENAS JSON válido
2) Estrutura: {{"tasks": [ ... ]}}
3) Cada task deve ter: id, description, predecessors, optimistic, most_likely, pessimistic
4) IDs devem ser únicos e curtos (ex: T1, T2, T3)
5) predecessores devem referenciar apenas IDs existentes
6) Estimativas em horas e obedecer: optimistic <= most_likely <= pessimistic

Tarefa do usuário:
{user_task}
""".strip()


def _strip_json_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        return "\n".join(lines).strip()
    return text


def parse_plan_json(llm_output: str) -> list[Task]:
    """Parseia saída JSON estruturada do planner e converte em Task dataclass."""
    raw = _strip_json_fence(llm_output)

    try:
        data: Any = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON from planner: {exc}") from exc

    try:
        parsed = PlannerResponseModel.model_validate(data)
    except ValidationError as exc:
        raise ValueError(f"Planner schema validation failed: {exc}") from exc

    ids = {task.id for task in parsed.tasks}
    for task in parsed.tasks:
        missing = [p for p in task.predecessors if p not in ids]
        if missing:
            raise ValueError(f"Task '{task.id}' has unknown predecessors: {missing}")

    return [
        Task(
            id=t.id,
            description=t.description,
            predecessors=t.predecessors,
            optimistic=t.optimistic,
            most_likely=t.most_likely,
            pessimistic=t.pessimistic,
        )
        for t in parsed.tasks
    ]
