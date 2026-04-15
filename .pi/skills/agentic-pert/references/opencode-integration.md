# OpenCode Integration

## Objetivo

Executar batches PERT/CPM no OpenCode de forma previsível:
- batch em sequência
- tarefas do mesmo batch em paralelo
- propagação de contexto entre predecessoras e sucessoras

## Premissas

- O plano já foi analisado por `agentic_pert.analyze_plan(...)` ou pela CLI `scripts/pert_cli.py analyze`.
- Cada item de `parallel_batches` é um nível seguro de paralelismo.
- O runtime principal continua responsável por integrar resultados entre batches.

## Fluxo recomendado

1. Carregue tarefas e `parallel_batches`.
2. Execute um batch por vez.
3. Para cada task no batch, delegue para o runtime/subagent do OpenCode.
4. Aguarde finalizar todas do batch atual.
5. Consolide outputs úteis das tasks concluídas.
6. Passe esse contexto para as tasks do próximo batch.

## Uso do adapter Python

```python
from agentic_pert import Task, analyze_plan, OpenCodePlanExecutor

tasks = [
    Task(id="T1", description="Setup project", predecessors=[], optimistic=1, most_likely=2, pessimistic=3),
    Task(id="T2", description="Implement auth", predecessors=["T1"], optimistic=2, most_likely=3, pessimistic=5),
]

plan, timings, batches = analyze_plan(tasks)
executor = OpenCodePlanExecutor(model="openai/gpt-5.2")
results = await executor.execute_plan(tasks, batches)
```

## Modo mock vs runtime real

- Sem `task_runner`: `OpenCodeExecutor` retorna output mock (útil para validar pipeline local).
- Com `task_runner`: o callback executa task real no runtime e retorna o output para o executor.

Exemplo de callback:

```python
async def task_runner(task, model):
    # Integrar aqui com sua estratégia de delegação no OpenCode
    # Ex.: chamada para agente, comando externo, API, etc.
    return f"Executed {task.id} with model={model}"
```
