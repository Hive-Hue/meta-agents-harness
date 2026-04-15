# Plan — Cross-Runtime Child Agents (v0.6.0)

## Objetivo

Permitir que agentes do MAH, especialmente `orchestrator` e `leads`, possam delegar subtarefas não só para filhos nativos do runtime atual, mas também para side agents de outros runtimes, começando por Codex, sem quebrar a topologia do crew e sem introduzir federation ou scheduler distribuído.

O resultado esperado é:
- a delegação continua obedecendo o grafo lógico do crew
- o runtime de execução do child agent pode ser diferente do runtime do agente pai
- o operador consegue distinguir claramente:
  - delegação lógica no crew
  - runtime efetivo do child agent
  - modo de execução (`native` ou `sidecar`)
- Codex entra como primeiro runtime sidecar suportado
- a arquitetura continua bounded para `v0.6.0`

---

## 1. Problema

Hoje o MAH já possui delegação hierárquica real, mas ela ainda está acoplada ao runtime que executa o agente pai.

### Estado atual

- PI possui child agents nativos dentro do runtime multi-team
- Codex já pode ser usado como runtime-alvo autônomo via `mah run --runtime codex --agent <target> ...`
- o plugin `mah` no Codex já consegue disparar delegação MAH real dentro da sessão Codex
- a topologia do crew já define quem pode delegar para quem

### Lacuna atual

Ainda não existe um contrato explícito para:

- um lead em um runtime A delegar para um child agent executado em runtime B
- separar target lógico do crew de target operacional do runtime
- modelar side agents cross-runtime como capability oficial do MAH

### Consequência

Hoje a delegação cross-runtime é possível apenas de forma indireta e ad hoc, não como feature formal do produto.

---

## 2. Proposta

Criar uma camada explícita de child-agent execution no MAH, separando:

1. **roteamento lógico do crew**
2. **estratégia operacional de spawn**
3. **runtime efetivo do child agent**

### Princípio central

O grafo do crew continua sendo a autoridade sobre “quem pode delegar para quem”.

O runtime escolhido só define “como a subtarefa será executada”.

### Exemplo conceitual

- `planning-lead` em PI delega para `repo-analyst`
- o target lógico continua sendo `repo-analyst`
- a estratégia operacional pode ser:
  - `native` no runtime PI
  - `sidecar` no runtime Codex

Logo:

- target lógico: `repo-analyst`
- target runtime: `codex`
- modo: `cross-runtime-sidecar`

---

## 3. Casos de uso v0.6.0

### 3.1 Mesmo runtime, spawn nativo

Exemplo:
- PI orchestrator -> PI lead
- PI lead -> PI worker

### 3.2 Cross-runtime sidecar para Codex

Exemplo:
- PI lead -> `backend-dev` via Codex side agent
- Claude lead -> `repo-analyst` via Codex side agent
- Codex orchestrator -> `engineering-lead` via Codex autônomo não interativo

### 3.3 Seleção explícita do runtime-alvo

O operador ou a policy deve poder escolher:

- runtime padrão do agente pai
- runtime override do child

---

## 4. O que NÃO entra em v0.6.0

- federation entre workspaces
- child agents remotos
- scheduler distribuído
- retry orchestration complexa
- pool de side agents persistentes
- balanceamento automático entre runtimes
- replay universal de sessão para child agent
- suporte completo a todos os runtimes como target sidecar

---

## 5. Contrato funcional

### 5.1 Conceitos

#### Target lógico

O agente do crew a quem a tarefa pertence.

Exemplos:
- `planning-lead`
- `backend-dev`
- `qa-reviewer`

#### Target runtime

O runtime usado para executar a subtarefa.

Exemplos:
- `pi`
- `codex`
- `claude`

#### Spawn mode

- `native-same-runtime`
- `cross-runtime-sidecar`

### 5.2 Regras obrigatórias

- o target lógico sempre precisa ser válido na topologia do crew
- o runtime alvo nunca pode furar a policy do crew
- `orchestrator` continua delegando só para leads
- leads continuam delegando só para workers do próprio time
- trocar o runtime não autoriza delegação fora do grafo

### 5.3 Resolução em duas etapas

#### Etapa 1 — resolução lógica

Responder:
- quem é o target lógico?
- esse target é permitido a partir do agente atual?
- existe reroute lógico necessário?

#### Etapa 2 — resolução operacional

Responder:
- em qual runtime o child vai rodar?
- existe suporte nativo?
- existe suporte sidecar?
- qual comando/adapter será usado?

---

## 6. Arquitetura proposta

### 6.1 Novo contrato: `ChildAgentAdapter`

Separar child-agent execution do `RuntimeAdapter` e do `SessionAdapter`.

```ts
interface ChildAgentAdapter {
  name: string
  sourceRuntime: string | "*"
  targetRuntime: string

  supportsSpawn(ctx: SpawnSupportContext): boolean
  listSpawnModes(ctx: SpawnSupportContext): SpawnMode[]

  prepareSpawn(ctx: SpawnContext): SpawnPlanResult
  spawn?(ctx: SpawnContext): SpawnExecutionResult
}
```

### 6.2 Estruturas principais

```ts
type SpawnMode =
  | "native-same-runtime"
  | "cross-runtime-sidecar"

interface SpawnSupportContext {
  crew: string
  sourceRuntime: string
  sourceAgent: string
  logicalTarget: string
}

interface SpawnContext {
  crew: string
  sourceRuntime: string
  targetRuntime: string
  sourceAgent: string
  logicalTarget: string
  effectiveLogicalTarget: string
  task: string
  mode: SpawnMode
}

interface SpawnPlanResult {
  ok: boolean
  mode: SpawnMode
  exec: string
  args: string[]
  envOverrides: Record<string, string>
  warnings: string[]
  error?: string
}
```

### 6.3 Reuso do core existente

Deve reutilizar:

- topologia de crew já existente
- resolução de target/reroute
- `mah run --runtime <x> --agent <y>`
- suporte headless quando o runtime alvo exigir execução não interativa

---

## 7. Estratégia de implementação

### 7.1 Fase 1 — normalizar a delegação lógica

Antes de qualquer spawn cross-runtime, o MAH precisa ter uma API única para:

- validar target lógico
- resolver reroute
- produzir um `DelegationResolution`

Essa parte deve sair de paths runtime-specific e virar serviço compartilhado.

### 7.2 Fase 2 — introduzir strategy layer de spawn

A resolução de “como executar” sai do handler runtime-specific e passa para uma strategy layer.

### 7.3 Fase 3 — Codex sidecar

Codex vira o primeiro runtime sidecar oficial.

Estratégia inicial:

- `mah run --runtime codex --agent <target> <task>`
- `MAH_CODEX_AUTONOMOUS=1`
- `codex exec --full-auto`

Sem sessão compartilhada obrigatória.

### 7.4 Fase 4 — surface operacional

Expor isso no MAH de forma clara:

- CLI
- explainability
- plugin/tooling

---

## 8. Surface proposta

### 8.1 CLI

Possibilidades:

```bash
mah delegate --target backend-dev --task "Implement the parser"
mah delegate --target backend-dev --runtime codex --task "Implement the parser"
mah delegate --target repo-analyst --runtime codex --mode sidecar --task "Map the affected files"
```

ou, se o surface atual for mantido:

```bash
mah run --delegate backend-dev --delegate-runtime codex "Implement the parser"
```

### 8.2 Ferramentas de runtime/plugin

No Codex plugin e em futuros runtimes:

- `mah_delegate_agent`
- parâmetro novo opcional:
  - `target_runtime`
  - `spawn_mode`

### 8.3 Explainability

`mah explain` precisa mostrar:

- target lógico solicitado
- target lógico efetivo
- runtime do agente pai
- runtime do child
- spawn mode
- comando efetivo
- warnings

---

## 9. Regras de policy

### 9.1 Policy mínima

- `orchestrator -> leads`
- `leads -> workers do próprio time`
- `workers -> sem child agents`, salvo futura capability explícita

### 9.2 Policy cross-runtime

- o runtime-alvo nunca altera o target lógico permitido
- o runtime-alvo é um detalhe operacional, não de autorização

### 9.3 Runtime allowlist

Para `v0.6.0`, sidecars suportados:

- `codex`

Futuros:

- `claude`
- `hermes`
- outros

---

## 10. Critérios por runtime

### PI

- continua sendo referência de spawn nativo
- deve conseguir chamar strategy layer comum

### Codex

- entra como target sidecar
- execução não interativa via `codex exec`
- seleção explícita de `--agent`

### Claude

- fora do escopo inicial como target sidecar
- pode ser preparado apenas no contrato

### OpenCode

- fora do escopo inicial como target sidecar

### Hermes

- fora do escopo inicial como target sidecar

---

## 11. Mudanças de código previstas

### Core

- `scripts/meta-agents-harness.mjs`
- `scripts/runtime-core-integrations.mjs`
- `scripts/runtime-adapter-contract.mjs`

### Novos módulos prováveis

- `scripts/delegation-resolution.mjs`
- `scripts/child-agent-adapter-contract.mjs`
- `scripts/child-agent-spawn.mjs`

### Runtime-specific

- `plugins/runtime-pi/index.mjs`
- `plugins/codex/index.mjs`
- `plugins/mah/mcp/handlers/delegate-agent.mjs`

### Testes

- `tests/child-agent-spawn.test.mjs`
- `tests/runtime-core-integration.test.mjs`
- `tests/codex-mah-plugin.test.mjs`

### Documentação

- `docs/cross-runtime-child-agents.md`
- update de `README.md`

---

## 12. Test plan

### 12.1 Unit

- resolução lógica de target
- policy enforcement
- seleção de `spawn_mode`
- seleção de runtime sidecar

### 12.2 Integração

- PI lead -> PI worker via `native-same-runtime`
- PI lead -> worker via `cross-runtime-sidecar` em Codex
- Codex `mah_delegate_agent` aceitando `target_runtime=codex`
- explainability mostrando resolução completa

### 12.3 Não-regressão

- delegação atual no PI continua funcionando
- `mah_delegate_agent` atual continua funcionando sem `target_runtime`
- `mah run --runtime codex --agent ...` não regressa

---

## 13. Execução por slice

### Slice 0 — Modelo e boundary

**Entrega**
- definir target lógico vs target runtime
- definir `ChildAgentAdapter`
- definir spawn modes

**Gate**
- sem contrato explícito não existe implementação segura

### Slice 1 — DelegationResolution compartilhado

**Entrega**
- serviço canônico de resolução de target
- política única para todos os runtimes

**Gate**
- semântica única de autorização

### Slice 2 — Strategy layer de spawn

**Entrega**
- seleção entre `native-same-runtime` e `cross-runtime-sidecar`
- explainability básica

**Gate**
- escolha operacional separada da policy

### Slice 3 — Codex sidecar MVP

**Entrega**
- `target_runtime=codex`
- spawn real via `codex exec`
- integração com `mah run`

**Gate**
- execução reproduzível e auditável

### Slice 4 — CLI/plugin surface

**Entrega**
- parâmetros de runtime-alvo
- plugin/tool updates
- `explain` completo

**Gate**
- operador entende o que aconteceu

### Slice 5 — Testes e docs

**Entrega**
- suíte dedicada
- documentação de policy e limites

**Gate**
- sem regressão na delegação atual

---

## 14. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Runtime-alvo virar bypass de policy | alto | resolução lógica obrigatória antes do spawn |
| Acoplamento excessivo entre runtimes | alto | `ChildAgentAdapter` separado |
| Misturar com session interop cedo demais | alto | sidecar sem sessão compartilhada por default |
| Operador não entender quem executou a subtarefa | médio | explainability obrigatória |
| Sidecar Codex parecer “nativo” sem ser | médio | expor `spawn_mode` e `target_runtime` explicitamente |

---

## 15. Dependências

### Dependência forte

- `headless-cross-runtime-v0.6.0`

Porque o sidecar Codex depende de execução não interativa estável.

### Dependência fraca

- `sessions-interop-v0.6.0`

Útil para evolução futura, mas não obrigatória para o MVP de sidecar.

---

## 16. Critério de sucesso

Ao final:

- MAH possui conceito formal de child agent cross-runtime
- a policy do crew continua sendo a mesma
- Codex funciona como primeiro runtime sidecar suportado
- o operador consegue delegar subtarefa para um agent lógico do crew executado em Codex
- tudo isso é explicável, testável e bounded para `v0.6.0`
