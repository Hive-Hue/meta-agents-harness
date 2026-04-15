# Codex Native Execution

## Objetivo

Executar batches PERT/CPM com os subagents nativos do Codex, usando `spawn_agent` e `wait_agent`, sem depender de `codex exec` via subprocess.

## Premissas

- O plano já foi analisado por `agentic_pert.analyze_plan(...)` ou pela CLI `scripts/pert_cli.py analyze`
- Cada item de `parallel_batches` representa um nível seguro de paralelismo
- O agente principal continua responsável por integrar resultados entre batches

## Fluxo recomendado

1. Carregue as tarefas e o `parallel_batches`
2. Execute um batch por vez
3. Para cada task do batch, abra um subagent com `agent_type="worker"` e `fork_context=true`
4. Aguarde o término do batch com `wait_agent`
5. Colete os outputs úteis de cada task
6. Inclua contexto das predecessoras ao montar o prompt do próximo batch

## Template de prompt por subagent

Use um prompt com esta estrutura:

```text
Task ID: T3
Objective: Implement endpoint X
You are not alone in the codebase. Do not revert unrelated edits made by others.

Dependency context:
[T1] success
<resumo do output>

[T2] success
<resumo do output>
```

## Observações

- `spawn_agent`/`wait_agent` são a integração primária para Codex
- A biblioteca Python pode ajudar com análise e serialização do plano, mas não substitui a orquestração nativa do runtime
- O pacote Python não deve tentar chamar as tools nativas do Codex; isso deve acontecer no agente principal
