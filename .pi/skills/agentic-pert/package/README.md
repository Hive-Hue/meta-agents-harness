# Agentic PERT + CPM

Agentic PERT/CPM toolkit para planejamento de tarefas com caminho crítico e batches paralelos.

## Instalação

```bash
cd /home/alyssonpi/.codex/skills/agentic-pert/package
python -m venv .venv
. .venv/bin/activate
pip install -e .
```

## CLI

Comando disponível:

```bash
pert-agent plan "<tarefa>"
```

Fluxo atual da CLI:

1. Sem `--input-file`, ela imprime um prompt sugerido para você executar em um LLM externo.
2. Com `--input-file`, ela processa o JSON retornado pelo planner e calcula o plano PERT/CPM.

Exemplo:

```bash
# 1) Prompt sugerido
/home/alyssonpi/.codex/skills/agentic-pert/package/.venv/bin/pert-agent \
  plan "Implementar JWT + dashboard + testes"

# 2) Salve a resposta do LLM em planner-output.json

# 3) Gerar plano em JSON
/home/alyssonpi/.codex/skills/agentic-pert/package/.venv/bin/pert-agent \
  plan "Implementar JWT + dashboard + testes" \
  --input-file planner-output.json \
  --output json

# 4) Gerar plano em Mermaid
/home/alyssonpi/.codex/skills/agentic-pert/package/.venv/bin/pert-agent \
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
from agentic_pert import OpenClawPlanExecutor, PiAgentPlanExecutor

openclaw_executor = OpenClawPlanExecutor(model="openai-codex/gpt-5.3-codex")
pi_executor = PiAgentPlanExecutor(model="openrouter/google/gemini-3-flash-preview")
```

## Observações

- Adapter OpenClaw usa `sessions_spawn` quando disponível.
- Adapter Pi Agent usa `pi --mode json` com sessão persistente por task.
- No runtime do Codex, a integração principal usa `spawn_agent` e `wait_agent`.
- O pacote Python não executa subagents nativos do Codex; ele só produz o plano e os batches para o agente principal orquestrar.
- O pacote principal não executa LLM automaticamente; a decomposição é alimentada por JSON do planner.

## License

MIT
