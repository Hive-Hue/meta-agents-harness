---
name: agentic-pert
description: Skill para planejamento PERT/CPM em fluxos agentic. Decompõe tarefas, calcula caminho crítico e gera plano estruturado com suporte de visualização.
version: 0.1.0
license: MIT
compatibility:
  - openclaw
  - pi-agent
  - codex
  - opencode
  - claude-code
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

### CLI da skill (scripts) para o agente

Use a CLI em `scripts/pert_cli.py` para o fluxo completo de plano/tarefas/análise.

```bash
python /home/alyssonpi/.pi/skills/agentic-pert/scripts/pert_cli.py --help
```

### 1) Gerar prompt de decomposição

```bash
python /home/alyssonpi/.pi/skills/agentic-pert/scripts/pert_cli.py prompt \
  --objective "Implementar autenticação JWT + dashboard Streamlit + testes"
```

### 2) Criar plano inicial a partir da decomposição

```bash
python /home/alyssonpi/.pi/skills/agentic-pert/scripts/pert_cli.py from-decomposition \
  --objective "Implementar autenticação JWT + dashboard Streamlit + testes" \
  --decomposition-file planner-output.json \
  --output plan.json
```

### 3) Adicionar/ajustar tarefas manualmente (opcional)

```bash
python /home/alyssonpi/.pi/skills/agentic-pert/scripts/pert_cli.py add-task \
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
python /home/alyssonpi/.pi/skills/agentic-pert/scripts/pert_cli.py analyze \
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
python /home/alyssonpi/.pi/skills/agentic-pert/scripts/pert_cli.py analyze \
  --plan plan.json \
  --output plan-analyzed.json \
  --mermaid-output plan-gantt.mmd \
  --mermaid-style pert-gantt \
  --mermaid-milestone-label "Resumo operacional pronto"
```

### CLI do pacote (modo complementar)

`pert-agent` continua disponível, mas para o fluxo operacional do agente use prioritariamente `scripts/pert_cli.py`.

## Execução via OpenClaw

A integração de execução usa adapter específico:

```python
from agentic_pert import Task, analyze_plan, OpenClawPlanExecutor

tasks = [
    Task(id="T1", description="Setup JWT", predecessors=[], optimistic=1, most_likely=2, pessimistic=3),
    Task(id="T2", description="Auth endpoints", predecessors=["T1"], optimistic=2, most_likely=3, pessimistic=5),
]
plan, timings, batches = analyze_plan(tasks)
executor = OpenClawPlanExecutor(model="openai-codex/gpt-5.3-codex")
results = await executor.execute_plan(tasks, batches, task_callback=on_task_complete)
```

Para detalhes de integração OpenClaw, ver:
- `references/openclaw-adapter.md`

## Execução via Pi Agent

Há adapter funcional para Pi Agent usando o CLI em modo JSON.

Também há um caminho agentic nativo dentro do Pi usando a extensão:

```bash
cd /home/alyssonpi/Github/pi-agents
/home/alyssonpi/.npm-global/bin/pi \
  -e extensions/subagent-widget.ts \
  -e extensions/pure-focus.ts \
  -e extensions/theme-cycler.ts
```

Com essa extensão carregada:
- o usuário pode usar `/sub`, `/subcont`, `/subrm`, `/subclear`
- o modelo da sessão pode usar as tools `subagent_create`, `subagent_wait`, `subagent_wait_many`, `subagent_get_result`, `subagent_continue`, `subagent_remove`, `subagent_list`

Tools disponíveis para o modelo na sessão Pi:
- `subagent_create(task, model?)`: cria um subagente em background e retorna o `id`
- `subagent_wait(id, timeoutMs?)`: bloqueia até um subagente terminar e retorna o resultado final
- `subagent_wait_many(ids, timeoutMs?)`: espera vários subagentes e retorna todos os resultados em conjunto
- `subagent_get_result(id)`: retorna o estado atual e o output parcial/final sem bloquear
- `subagent_continue(id, prompt, model?)`: continua a conversa de um subagente já existente
- `subagent_remove(id)`: remove um subagente e encerra o processo se ele ainda estiver rodando
- `subagent_list()`: lista os subagentes ativos/finalizados e seus estados

Fluxo recomendado para PERT dentro do Pi:

1. Planejar tarefas e batches com a skill
2. Para um batch paralelo, chamar `subagent_create` para cada task
3. Guardar os IDs retornados
4. Chamar `subagent_wait_many` para sincronizar o batch
5. Usar os resultados para montar o próximo batch
6. Repetir até o término do plano

Padrão recomendado de uso das tools:

1. Batch paralelo:
   usar `subagent_create` uma vez por task, com `model` quando quiser forçar um modelo específico
2. Sincronização:
   usar `subagent_wait_many` para fechar o batch
3. Inspeção incremental:
   usar `subagent_get_result` se precisar verificar progresso antes do término
4. Continuação de contexto:
   usar `subagent_continue` quando quiser reaproveitar a sessão de um subagente, opcionalmente trocando o `model`
5. Limpeza:
   usar `subagent_remove` para encerrar e remover subagentes que não serão mais usados

Exemplo conceitual de orquestração no Pi:

```text
1. ids = [subagent_create(T1, model=A), subagent_create(T2, model=A), subagent_create(T3, model=B)]
2. results = subagent_wait_many(ids)
3. sintetizar dependências do próximo batch
4. id4 = subagent_create(T4 com contexto de T1/T2/T3, model=C)
5. final = subagent_wait(id4)
```

Exemplo direto neste ambiente:

```python
from agentic_pert import Task, analyze_plan, PiAgentPlanExecutor

tasks = [
    Task(id="T1", description="Inspecionar estrutura do projeto", predecessors=[], optimistic=0.5, most_likely=1, pessimistic=2),
    Task(id="T2", description="Resumir achados", predecessors=["T1"], optimistic=0.5, most_likely=1, pessimistic=1.5),
]
plan, timings, batches = analyze_plan(tasks)

executor = PiAgentPlanExecutor(
    model="openrouter/google/gemini-3-flash-preview",
    max_concurrency=2,
)
executor.executor.pi_binary = "/home/alyssonpi/.npm-global/bin/pi"

results = await executor.execute_plan(tasks, batches)
```

Notas:
- O adapter usa `pi --mode json -p --session ...`
- Cada task recebe um arquivo de sessão JSONL próprio
- O parser agrega texto do stream e contabiliza tool calls
- Se o `pi` não estiver no `PATH`, configure `executor.executor.pi_binary` com o caminho absoluto
- Para orquestração dentro da própria sessão do Pi, prefira a extensão `subagent-widget.ts` com `subagent_wait`/`subagent_wait_many`
- Na extensão Pi, `subagent_create` e `subagent_continue` aceitam `model` opcional por subagente

## Execução via Codex

No runtime do Codex, a execução do plano deve usar os subagents nativos `spawn_agent` + `wait_agent`.
Use a biblioteca para decomposição/análise e execute cada batch com as ferramentas nativas do runtime.

Fluxo recomendado no Codex:

1. Gerar ou ajustar a decomposição
2. Rodar `from-decomposition`
3. Rodar `analyze`
4. Para cada batch em `parallel_batches`, abrir subagents com `spawn_agent`
5. Aguardar o batch terminar com `wait_agent`
6. Propagar o output das predecessoras para o próximo batch

O pacote Python não deve tentar chamar tools nativas do Codex. A orquestração agentica pertence ao runtime do agente principal.

Para uso direto neste runtime, ver:
- `references/codex-native-execution.md`

## Instalação

```bash
cd /home/alyssonpi/.pi/skills/agentic-pert/package
python -m venv .venv
. .venv/bin/activate
pip install -e .
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
- `references/openclaw-adapter.md` (integração OpenClaw)
- `references/codex-native-execution.md` (integração Codex nativa)
