# Agentic PERT + CPM

Agentic PERT/CPM toolkit para planejamento de tarefas com caminho crítico e batches paralelos.

## Instalação

```bash
uv sync --project .claude/skills/agentic-pert/package \
  --extra dev \
  --extra visualization
```

## CLI

Comando disponível:

```bash
uv run --project .claude/skills/agentic-pert/package pert-agent plan "<tarefa>"
```

Fluxo atual da CLI:

1. Sem `--input-file`, ela imprime um prompt sugerido para você executar em um LLM externo.
2. Com `--input-file`, ela processa o JSON retornado pelo planner e calcula o plano PERT/CPM.

Exemplo:

```bash
# 1) Prompt sugerido
uv run --project .claude/skills/agentic-pert/package pert-agent \
  plan "Implementar JWT + dashboard + testes"

# 2) Salve a resposta do LLM em planner-output.json

# 3) Gerar plano em JSON
uv run --project .claude/skills/agentic-pert/package pert-agent \
  plan "Implementar JWT + dashboard + testes" \
  --input-file planner-output.json \
  --output json

# 4) Gerar plano em Mermaid
uv run --project .claude/skills/agentic-pert/package pert-agent \
  plan "Implementar JWT + dashboard + testes" \
  --input-file planner-output.json \
  --output mermaid
```

## API Python

### Análise PERT/CPM

```python
from agentic_pert import Task, analyze_plan

tasks = [
    Task(id="T1", description="Setup JWT", predecessors=[], optimistic=1, most_likely=2, pessimistic=3),
    Task(id="T2", description="Auth endpoints", predecessors=["T1"], optimistic=2, most_likely=3, pessimistic=5),
]

plan, timings, batches = analyze_plan(tasks)
```

### Visualização

```python
from agentic_pert import to_mermaid, to_d3, to_cytoscape, to_react_flow, to_dot, to_ascii

mermaid = to_mermaid(plan, timings)
d3_data = to_d3(plan, timings)
cyto_data = to_cytoscape(plan, timings)
flow_data = to_react_flow(plan, timings)
dot_text = to_dot(plan, timings)
ascii_text = to_ascii(plan, timings)
```

### Execução por adapters

```python
from agentic_pert import OpenCodePlanExecutor

opencode_executor = OpenCodePlanExecutor(model="openai/gpt-5.2")
```

## Observações

- Adapter OpenCode pode rodar em modo mock (sem callback) ou com callback customizado para runtime real.
- O pacote Python produz plano e batches; a orquestração de execução fica no runtime integrador.
- O pacote principal não executa LLM automaticamente; a decomposição é alimentada por JSON do planner.

## License

MIT
