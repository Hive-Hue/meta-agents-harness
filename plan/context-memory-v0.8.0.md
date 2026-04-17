# Plano de Execução — `v0.8.0` Context Memory

## Status

- execução do plano: [planned]
- resultado esperado:
  - MAH passa a suportar uma camada canônica de **Operational Context Memory** para uso pós-roteamento
  - agentes conseguem recuperar contexto operacional altamente relevante por capability/tarefa sem degradar o roteamento por expertise
  - o produto ganha uma base viável de **persistência de memória operacional** entre sessões e runtimes
- observação:
  - esta feature não substitui `Expertise`, `Sessions`, `Provenance` ou `Evidence`
  - esta feature complementa essas camadas e aproxima o MAH de uma **assistant layer** de alto nível, runtime-agnostic, reutilizável sobre OpenCode, Hermes e outros runtimes

## Contexto

O MAH já possui camadas importantes, mas ainda fragmentadas:

- `Expertise` estruturada para routing, confiança, validação e policy
- `Sessions` para continuidade e injeção bounded de contexto entre runtimes
- `Provenance` para retenção auditável
- prompts, skills e MCPs como superfícies operacionais de execução

O gap atual é:

- o roteamento decide **quem** deve executar
- mas o sistema ainda não possui uma camada canônica e bounded que ajude o agente escolhido a lembrar **como** executar bem uma tarefa específica dentro de sua expertise

Exemplo:

- `planning-lead` pode ser roteado para `backlog-planning`
- mas o conhecimento operacional relevante para esta tarefa pode variar:
  - uso de ClickUp via MCP
  - critérios de decomposição de backlog
  - fluxo de milestones
  - uso de skills de gestão/PERT
  - fallback quando um sistema esperado não está disponível

Hoje isso tende a ficar espalhado em:

- prompt estático do agente
- memória curta de sessão
- notas ad hoc
- conhecimento implícito do operador

Isso limita:

- persistência útil entre sessões
- transferibilidade entre runtimes
- explainability do contexto usado na execução
- evolução do MAH como camada de assistência de alto nível

## Tese da Feature

Criar uma nova camada canônica chamada **Context Memory** ou **Operational Context Memory**, separada de `Expertise`, para:

1. recuperar contexto operacional após o roteamento
2. enriquecer bootstrap e execução do agente selecionado
3. persistir memória operacional curada entre sessões
4. permitir evolução futura do MAH como **assistant substrate** acima dos runtimes

Princípio central:

- `Expertise` decide **quem deve receber a tarefa**
- `Context Memory` decide **o que esse agente precisa lembrar para executar bem**

## Outcome de Produto (`v0.8.0`)

Ao final do release, MAH deve suportar:

1. corpus versionado de memória operacional por crew/agente/capability
2. schema e validação para arquivos de contexto (`.md`/`.qmd`)
3. indexação canônica e bounded desse corpus
4. retrieval explainable por tarefa, agent e capability
5. integração opcional com bootstrap de runtime para injeção bounded de contexto
6. proposal flow para transformar sinais de sessão/proveniência em memória persistente curada
7. base arquitetural para MAH atuar como **layer de assistência de alto nível**, e não apenas surface de dispatch

## Escopo do `v0.8.0` (In)

- nova camada `mah context`
- suporte a `.md` e `.qmd`
- frontmatter estruturado
- index local com rebuild determinístico
- retrieval lexical/metadata-aware, bounded e explainable
- integração inicial com bootstrap de runtime, priorizando Hermes
- proposal flow de memória derivada de sessões/proveniência
- testes de contrato, integração e regressão
- documentação e governança do corpus operacional

## Fora do Escopo (Out)

- vector DB obrigatório
- Obsidian como dependência do core
- knowledge graph completo
- auto-write não revisado a partir de transcript bruto
- substituição do `mah expertise recommend/explain`
- replay total de memória autobiográfica do agente
- autonomia irrestrita baseada em memória não validada

## Problema de Produto

## Problema 1 — Pós-roteamento sem memória operacional

O roteamento por expertise responde:

- quem é o melhor candidato
- quem é permitido
- qual nível de confiança se aplica

Mas não responde:

- quais playbooks operacionais usar
- qual MCP é o melhor ponto de integração
- quais skills são mais relevantes para esta tarefa
- quais gotchas já conhecidos importam para esta capability

## Problema 2 — Memória persistente mal distribuída

Hoje a memória útil tende a se perder entre:

- sessão efêmera
- expertise compacta limitada por budget
- artefatos espalhados em docs/plan/specs

Isso gera:

- rederivação recorrente do mesmo contexto operacional
- dependência do runtime/sessão atual
- baixa transferibilidade entre operadores e runtimes

## Problema 3 — MAH ainda não é uma assistant layer completa

Para o MAH evoluir de orchestration layer para uma assistant layer de alto nível, ele precisa conseguir:

1. decidir quem deve agir
2. recuperar contexto operacional útil
3. lembrar aprendizados entre sessões
4. injetar isso bounded em diferentes runtimes

Sem isso, o runtime continua sendo o principal “dono” da memória prática.

## Proposta

Separar explicitamente cinco camadas:

1. `Expertise`
- inteligência de capability, trust, lifecycle, policy e routing

2. `Context Memory`
- memória operacional curada por agent/capability/task pattern

3. `Sessions`
- continuidade de trabalho recente e injection cross-runtime

4. `Provenance`
- trilha auditável do que ocorreu

5. `Evidence`
- sinais estruturados que alimentam expertise e propostas

## Princípio de boundary

`Context Memory`:

- não participa do ranking de roteamento
- não concede permissão
- não altera policy
- não substitui expertise
- não recebe logs brutos diretamente

Seu papel é exclusivamente **enriquecer execução pós-roteamento**.

## Arquitetura Alvo (`v0.8.0`)

## Camadas

1. `Context Corpus`
- arquivos canônicos `.md`/`.qmd`
- versionados no repositório
- escritos para reuso operacional

2. `Context Index`
- índice derivado com metadata, snippets e chaves de busca

3. `Retrieval Engine`
- seleciona top-N contextos relevantes por tarefa/capability/ferramentas

4. `Runtime Injection Layer`
- integra o contexto recuperado ao bootstrap do runtime

5. `Proposal Layer`
- transforma sinais de sessões/proveniência em rascunhos de memória persistente

## Estruturas de dados (proposta inicial)

- `types/context-memory-types.mjs`
  - `ContextMemoryDocument`
  - `ContextMemoryIndexEntry`
  - `ContextMemoryRetrievalRequest`
  - `ContextMemoryRetrievalResult`
  - `ContextMemoryProposal`

- Diretórios:
  - `.mah/context/operational/`
  - `.mah/context/index/`
  - `.mah/context/proposals/`
  - `.mah/context/cache/`

## Organização de conteúdo

```text
.mah/context/operational/
  dev/
    planning-lead/
      backlog-planning/
        clickup-backlog-triage.qmd
        milestone-splitting.qmd
        acceptance-criteria-checklist.qmd
      scope-triage/
        scope-cut-heuristics.md
    engineering-lead/
      implementation-coordination/
        splitting-guidelines.md
```

## Frontmatter proposto

```yaml
---
id: dev/planning-lead/backlog-planning/clickup-backlog-triage
kind: operational-memory
crew: dev
agent: planning-lead
capabilities:
  - backlog-planning
domains:
  - planning
systems:
  - clickup
skills:
  - agentic_pert
tools:
  - mcp_call
task_patterns:
  - "transform spec into backlog"
  - "create milestones and tasks"
  - "derive acceptance criteria"
priority: high
stability: curated
source_type: human-authored
last_reviewed_at: 2026-04-17
refs:
  - docs/expertise-catalog-governance.md
---
```

## Relação com `Expertise`

Exemplo:

- `planning-lead` continua tendo capability `backlog-planning` no catálogo de expertise
- o roteamento usa esse dado estruturado para selecioná-lo
- após a seleção, o retrieval busca documentos operacionais ligados a:
  - `agent=planning-lead`
  - `capability=backlog-planning`
  - `systems=clickup`
  - `task_patterns` compatíveis com a tarefa

Ou seja:

- `Expertise` continua pequena, estruturada e governada
- `Context Memory` absorve o detalhe operacional reutilizável

## Relação com persistência de memória

## Memória persistente viável

Esta feature resolve um problema importante de persistência:

- memória operacional relevante não deve depender apenas de sessão ativa ou do runtime

Em vez de persistir transcript bruto, o MAH passa a persistir:

1. `memória curada`
- playbooks, padrões, heurísticas, integrações, gotchas

2. `memória derivada`
- propostas geradas a partir de sessões, provenance e evidence

3. `memória efêmera`
- snippets recuperados apenas para a execução atual

## Modelo de persistência em 3 níveis

### N1 — Curated Operational Memory

- versionada
- auditável
- revisável
- estável

### N2 — Derived Memory Proposals

- gerada de sessões/proveniência/evidence
- não entra automaticamente no corpus
- requer revisão humana

### N3 — Runtime Injected Memory

- resultado do retrieval bounded
- não persiste como truth por si só

## Benefício

Isso dá ao MAH uma forma **segura e explicável** de persistência de memória útil:

- sem depender do runtime
- sem inflar prompt fixo
- sem transformar logs em conhecimento canônico
- sem misturar capability intelligence com operational detail

## Evolução do Propósito do MAH

## Posição atual

Hoje o MAH é:

- orchestration layer
- runtime-agnostic control plane
- expertise-aware routing layer
- session/provenance bridge

## Posição futura

Com `Context Memory`, o MAH passa a ser também:

- context orchestration layer
- operational memory layer
- assistant state layer

Isso o aproxima de um produto de alto nível no estilo:

- evolução do OpenClaw
- selective absorption de padrões úteis do Hermes
- coordinator/assistant substrate acima dos runtimes

Sem virar:

- fork de Hermes
- runtime opinionated shell
- produto acoplado a uma UX específica como Obsidian

## Milestones

## M1 — Context Memory Foundation

Entrega:

- schema e tipos do documento operacional
- parser de frontmatter para `.md` e `.qmd`
- regras de validação
- storage layout canônico
- docs de boundary e naming

Critérios de aceite:

- documentos inválidos falham em `mah context validate`
- formatos `.md` e `.qmd` suportados igualmente
- o schema é estável e documentado
- não há ambiguidade com `Expertise`

## M2 — Indexing + Retrieval MVP

Entrega:

- index local determinístico
- retrieval por `agent`, `capability`, `task`, `systems`, `tools`
- explainability do retrieval
- limites de tamanho, profundidade e file-count

Critérios de aceite:

- `mah context find --agent planning-lead --task "<...>"` retorna top-N úteis
- retrieval não lê corpus inteiro a cada execução
- explain informa por que cada item foi escolhido
- retrieval é bounded por limites explícitos

## M3 — Runtime Injection (bounded)

Entrega:

- integração com bootstrap Hermes
- bloco adicional de contexto operacional no bootstrap query
- flags de opt-in e limites de injeção
- fallback seguro quando o corpus não existir

Critérios de aceite:

- nenhum runtime quebra sem corpus
- contexto injetado é resumido e bounded
- `mah explain run` ou superfície equivalente mostra o contexto usado
- runtime continua com semântica honesta

## M4 — CLI + Operator UX

Entrega:

- namespace `mah context`
- comandos:
  - `list`
  - `show <id>`
  - `find --agent --task`
  - `explain --agent --task`
  - `validate`
  - `index`
- `--json` para automação

Critérios de aceite:

- operador consegue responder:
  - qual contexto operacional foi recuperado
  - por que ele foi recuperado
  - quais ferramentas/sistemas foram assumidos

## M5 — Persistent Learning Proposal Flow

Entrega:

- proposal layer a partir de:
  - `sessions`
  - `provenance`
  - `evidence`
- drafts em `.mah/context/proposals/`
- merge/dedupe básico
- governança de promoção para corpus curado

Critérios de aceite:

- memória derivada não entra automaticamente no corpus
- proposals têm explain e fonte rastreável
- o operador/reviewer consegue promover ou descartar aprendizado

## M6 — Assistant Layer Base

Entrega:

- definição de `assistant-state` canônico do MAH
- mapeamento explícito entre:
  - expertise selecionada
  - contexto recuperado
  - sessão ativa
  - provenance relevante
- base para MCP/CLI futura

Critérios de aceite:

- o MAH consegue descrever o “estado de assistência” atual de forma estruturada
- o design continua runtime-agnostic

## Backlog Técnico (Workstreams)

## W1 — Naming, Boundary e Product Spec

- documento de boundary entre `Expertise`, `Context Memory`, `Sessions`, `Evidence` e `Provenance`
- definir naming oficial da feature
- documentar `Obsidian optional, core-independent`

## W2 — Modelagem e Validação

- `types/context-memory-types.mjs`
- `scripts/context-memory-schema.mjs`
- `scripts/context-memory-validate.mjs`
- fixtures válidas/inválidas

## W3 — Parsing e Indexação

- parser de frontmatter
- extração de headings/snippets
- índice canônico em `.mah/context/index/operational-context.index.json`
- cache por hash/mtime

## W4 — Retrieval Engine

- lexical scoring
- metadata-aware ranking
- capability-aware filtering
- compatibilidade com tools/MCP disponíveis
- explain payload

## W5 — Runtime Integration

- integração em `scripts/runtime-core-integrations.mjs`
- enrichment de `agentCtx`
- bootstrap query com bloco `Operational context for this task`
- flags:
  - `MAH_CONTEXT_MEMORY=1`
  - `--with-context-memory`
  - `--context-limit`
  - `--context-mode=summary|snippets`

## W6 — CLI e Operabilidade

- `mah context list`
- `mah context show`
- `mah context find`
- `mah context explain`
- `mah context index`
- `mah context validate`

## W7 — Proposal Flow de Persistência

- `scripts/context-memory-proposal.mjs`
- geração de drafts por sessão/proveniência
- dedupe e merge básico
- promote/reject workflow

## W8 — Testes e Segurança

- contract tests
- integration tests
- non-regression com `mah run`, `mah sessions`, `mah expertise`
- limites de traversal, file-count e snippet-size
- bloqueios contra uso de corpus não curado como truth de policy

## Contrato funcional mínimo

## CLI

```bash
mah context index
mah context validate
mah context list --agent planning-lead
mah context show dev/planning-lead/backlog-planning/clickup-backlog-triage
mah context find --agent planning-lead --task "transform spec into backlog with clickup"
mah context explain --agent planning-lead --task "transform spec into backlog with clickup"
mah context propose --from-session hermes:dev:abc123
```

## Retrieval Request

```json
{
  "crew": "dev",
  "agent": "planning-lead",
  "task": "transform spec into backlog with clickup",
  "capability_hint": "backlog-planning",
  "available_tools": ["mcp_call", "read", "grep"],
  "available_mcp": ["clickup", "github", "context7"],
  "runtime": "hermes"
}
```

## Retrieval Result

```json
{
  "matched_docs": [
    {
      "id": "dev/planning-lead/backlog-planning/clickup-backlog-triage",
      "score": 0.91,
      "reasons": [
        "agent match",
        "capability match",
        "system clickup available",
        "task pattern overlap"
      ]
    }
  ],
  "summary_blocks": [
    "Use ClickUp MCP when the task explicitly mentions backlog grooming or milestone/task creation.",
    "Prefer milestone-first decomposition before creating individual tasks."
  ],
  "tool_hints": ["mcp_call"],
  "skill_hints": ["agentic_pert"],
  "blocked_refs": [],
  "confidence": "high"
}
```

## Algoritmo de Retrieval (MVP)

```text
Input: task, crew, agent, capability_hint, available_tools, available_mcp, runtime

1) Filtrar por crew
2) Filtrar por agent
3) Boost por capability_hint
4) Boost por systems/tools disponíveis no runtime
5) Match lexical por task_patterns/tags/headings
6) Penalizar docs longos/baixamente revisados/instáveis
7) Ordenar e retornar top-N
8) Gerar explain payload e summary blocks bounded
```

## Integração com Runtime

## Hermes (primeiro alvo)

Ponto de integração:

- enriquecer `agentCtx` antes de `buildHermesBootstrapQuery()`
- adicionar bloco extra no bootstrap:
  - `Operational context for this task`
  - `Relevant tools/systems`
  - `Relevant docs`
  - `Bounded summary`

## Outros runtimes

- Claude/OpenCode/PI podem absorver isso em seus próprios pontos de `prepareRunContext`
- o contrato deve ser comum, com a projeção final respeitando a semântica do runtime

## Governança

## Regras de escrita do corpus

- não armazenar transcript bruto
- não armazenar logs/copied output como corpus operacional
- manter documentos curtos, específicos e reusáveis
- separar contexto curado de propostas derivadas
- toda promoção de memória derivada exige revisão

## Obsidian

- uso opcional como editor local
- sem dependência do core
- `.obsidian/` não faz parte do contrato funcional do MAH

## Métricas de Sucesso do Release

1. Eficiência operacional
- redução de rederivação manual de contexto em tarefas repetidas
- menor tempo até ação útil após roteamento

2. Qualidade de execução
- aumento de consistência no uso correto de tools/MCPs por capability
- menor divergência entre agentes para tarefas parecidas

3. Persistência útil
- memória operacional reaproveitada entre sessões e runtimes
- proposals derivadas de sessões com taxa útil de promoção

4. Produto
- avanço do MAH em direção a uma assistant layer de alto nível, sem perder runtime agnosticism

## Riscos e Mitigações

1. Corpus virar dumping ground
- Mitigação: schema rígido, proposal flow e revisão obrigatória

2. Prompt inflation
- Mitigação: top-N, snippet caps, summary-only por default

3. Retrieval opaco
- Mitigação: explain payload obrigatório

4. Acoplamento a Obsidian
- Mitigação: parser só depende de arquivos + frontmatter

5. Mistura indevida com `Expertise`
- Mitigação: boundaries explícitos e superfícies CLI separadas

6. Risco de custo/performance por indexação ampla
- Mitigação: limits, cache, incremental rebuild e guardrails de traversal

## Dependências e Decisões Abertas

1. Naming final:
- `Context Memory`
- `Operational Context Memory`
- `Assistant Memory`

2. Forma de indexação inicial:
- lexical + metadata only
- ou híbrido com embeddings opcionais em release futuro

3. Onde expor explainability:
- `mah context explain`
- `mah explain run`
- ambos

4. Política de proposal flow:
- somente leads/orchestrator
- ou worker também pode propor com reviewer obrigatório

## PR Slices sugeridos

### PR1 — Schema + validate + storage layout

- tipos
- schema
- fixtures
- docs de boundary

### PR2 — Index + retrieval MVP

- index builder
- retrieval engine
- CLI `index/find/explain`

### PR3 — Hermes/runtime bootstrap integration

- enrichment de `agentCtx`
- injection bounded
- tests de bootstrap

### PR4 — Proposal flow de persistência

- drafts a partir de sessions/provenance
- governança
- docs e testes

### PR5 — Product docs + assistant-layer framing

- documentação do release
- relação com expertise/sessions/provenance
- roadmap futuro

## Definition of Done

1. `mah expertise` permanece semanticamente intacto no roteamento.
2. `mah context` existe como namespace separado e operável.
3. O sistema suporta `.md` e `.qmd` como corpus operacional.
4. O retrieval é bounded, explainable e respeita ferramentas disponíveis.
5. O bootstrap do runtime pode consumir contexto operacional sem depender de prompt fixo.
6. Existe proposal flow para persistência de memória derivada.
7. O design fortalece o MAH como camada de assistência de alto nível sem capturar a identidade do produto por um runtime específico.

