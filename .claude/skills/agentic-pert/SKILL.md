---
name: agentic-pert
description: Skill para planejamento PERT/CPM em fluxos agentic. Decompõe tarefas, calcula caminho crítico e gera plano estruturado com suporte de visualização.
version: 0.1.0
license: MIT
compatibility:
  - opencode
  - generic-python
tags:
  - project-management
  - workflow-orchestration
  - multi-agent
  - parallel-execution
  - subagents
  - pert-cpm
  - critical-path
  - visualization
allowed-tools:
  - bash
  - python
  - cli
metadata:
  audience: developers, agentic workflows, programmers
  category: orchestration
  triggers:
    - "use pert"
    - "use agentic-pert"
    - "planeje com PERT"
    - "execute com subagents paralelos"
    - "decompõe em tarefas com caminho crítico"
    - "orquestre com CPM"
---

# Agentic PERT + CPM

Skill especializada em aplicar PERT/CPM para planejar tarefas complexas com dependências explícitas e caminho crítico.

## O que esta skill faz

1. **Decompõe** tarefas complexas em subtarefas com dependências (via prompt para LLM)
2. **Calcula** estimativas PERT (otimista/mais provável/pessimista)
3. **Identifica** caminho crítico (CPM)
4. **Gera** plano em JSON e Mermaid pela CLI
5. **Disponibiliza** formatos extras de visualização pela API Python (D3, Cytoscape, React Flow, DOT, ASCII)

## Quando usar

- Tarefas complexas (mais de 3-4 passos)
- Oportunidades de paralelismo
- Necessidade de previsibilidade de tempo
- Projetos de programação, automação, análise de dados, refatoração

### Frases que ativam

- "Use agentic-pert para planejar..."
- "Decompõe essa feature usando PERT/CPM"
- "Planeje com caminho crítico e execute em paralelo"

## Uso

Pré-requisito:

```bash
uv --version
```

### CLI da skill (scripts) para o agente

Use a CLI em `scripts/pert_cli.py` para o fluxo completo de plano/tarefas/análise.

```bash
uv run --project .claude/skills/agentic-pert/package \
  python .claude/skills/agentic-pert/scripts/pert_cli.py --help
```

### 1) Gerar prompt de decomposição

```bash
uv run --project .claude/skills/agentic-pert/package \
  python .claude/skills/agentic-pert/scripts/pert_cli.py prompt \
  --objective "Implementar autenticação JWT + dashboard Streamlit + testes"
```

### 2) Criar plano inicial a partir da decomposição

```bash
uv run --project .claude/skills/agentic-pert/package \
  python .claude/skills/agentic-pert/scripts/pert_cli.py from-decomposition \
  --objective "Implementar autenticação JWT + dashboard Streamlit + testes" \
  --decomposition-file planner-output.json \
  --output plan.json
```

### 3) Adicionar/ajustar tarefas manualmente (opcional)

```bash
uv run --project .claude/skills/agentic-pert/package \
  python .claude/skills/agentic-pert/scripts/pert_cli.py add-task \
  --plan plan.json \
  --id T9 \
  --description "Validar integração final" \
  --predecessors T4,T6 \
  --optimistic 1 \
  --most-likely 2 \
  --pessimistic 3
```

### 4) Rodar análise PERT/CPM e gerar Mermaid

```bash
uv run --project .claude/skills/agentic-pert/package \
  python .claude/skills/agentic-pert/scripts/pert_cli.py analyze \
  --plan plan.json \
  --output plan-analyzed.json \
  --mermaid-output plan.mmd \
  --mermaid-style classic-pert
```

Estilos Mermaid disponíveis:
- `flowchart`: DAG padrão com tarefas como nós
- `classic-pert`: notação PERT clássica com eventos como nós e tarefas nas setas
- `pert-gantt`: visão temporal em gráfico Gantt usando os tempos PERT

No estilo `pert-gantt`, você pode customizar o marco final:

```bash
uv run --project .claude/skills/agentic-pert/package \
  python .claude/skills/agentic-pert/scripts/pert_cli.py analyze \
  --plan plan.json \
  --output plan-analyzed.json \
  --mermaid-output plan-gantt.mmd \
  --mermaid-style pert-gantt \
  --mermaid-milestone-label "Resumo operacional pronto"
```

### CLI do pacote (modo complementar)

`pert-agent` continua disponível, mas para o fluxo operacional do agente use prioritariamente `scripts/pert_cli.py`.

## Execução via OpenCode

A integração de execução usa adapter OpenCode:

```python
from agentic_pert import Task, analyze_plan, OpenCodePlanExecutor

tasks = [
    Task(id="T1", description="Setup JWT", predecessors=[], optimistic=1, most_likely=2, pessimistic=3),
    Task(id="T2", description="Auth endpoints", predecessors=["T1"], optimistic=2, most_likely=3, pessimistic=5),
]
plan, timings, batches = analyze_plan(tasks)
executor = OpenCodePlanExecutor(model="openai/gpt-5.2")
results = await executor.execute_plan(tasks, batches, task_callback=on_task_complete)
```

Fluxo recomendado no OpenCode:

1. Gerar ou ajustar a decomposição
2. Rodar `from-decomposition`
3. Rodar `analyze`
4. Executar os batches em ordem, em paralelo dentro de cada batch
5. Propagar o output das predecessoras para o próximo batch

Para detalhes de integração OpenCode, ver:
- `references/opencode-integration.md`

## Instalação

```bash
uv sync --project .claude/skills/agentic-pert/package \
  --extra dev \
  --extra visualization
```

## Validação com uv

```bash
cd .claude/skills/agentic-pert/package
uv run pytest -q
```

```bash
uv run --project .claude/skills/agentic-pert/package \
  python .claude/skills/agentic-pert/scripts/validate_opencode.py
```

## Dependências

- Python >= 3.10
- networkx >= 3.0
- typer >= 0.9
- pydantic >= 2.0
- rich >= 13.0

## Referências

- `package/README.md` (uso da biblioteca)
- `references/pert-cpm-theory.md` (teoria PERT/CPM)
- `references/opencode-integration.md` (integração OpenCode)
