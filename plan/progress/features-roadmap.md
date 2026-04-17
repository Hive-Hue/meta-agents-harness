# Roadmap de Features — Meta Agents Harness (Refinado)

## Status Atual

- M1A: [done]
- M1B: [done]
- M2: [done]
- M3: [done]
- M4: [planned]
- nota:
  - o arquivo permanece em `plan/progress/` como roadmap vivo
  - os milestones `M1A` a `M3` já têm cobertura material no repositório
  - o próximo ciclo proposto passa a incluir `Context Memory` como base para evolução do MAH em direção a uma assistant layer de alto nível

## Objetivo

Consolidar o `meta-agents-harness` como camada interoperável de orquestração multi-runtime, com fonte canônica para crews, artefatos e metadata estável, validação forte, observabilidade operacional e extensibilidade via adapters.

## Diagnóstico Consolidado

- Existe risco de divergência entre `meta-agents.yaml` e lógica hardcoded do dispatcher.
- `validate` ainda está acoplado à ideia de runtime health e pouco à consistência de artefatos.
- Testes e CI ainda não cobrem todos os cenários críticos de precedência, drift e contrato por runtime.
- A UX operacional ainda explica bem a arquitetura, mas oferece pouco suporte diagnóstico ao operador.

## Princípios de Evolução

- YAML canônico e conservador para crews, modelos, skills, perfis, artefatos e metadata estável não-executável.
- Compatibilidade com automação (`--json`) e rastreabilidade (`--trace`).
- Mudanças incrementais para evitar big-bang refactor.
- Contratos explícitos para extensão de runtimes.
- Separação clara entre config declarativa e comportamento operacional em código.

## Modelo Arquitetural Desejado

- O YAML descreve:
  - crews
  - topologia
  - modelos
  - skills
  - perfis
  - paths e artefatos derivados
  - metadata estável de runtime
  - capabilities de alto nível não-executáveis
- Os adapters implementam:
  - lógica operacional
  - integração com binários
  - semântica de execução
- O dispatcher continua responsável por:
  - seleção de runtime
  - despacho de comandos
  - normalização de flags
  - uso de capabilities modeladas em código

Esse modelo evita meta-config excessiva, mas também não deixa o YAML totalmente cego ao runtime.

## Milestones

### M1A — Segurança Mínima de Config

**Meta:** reduzir risco imediato de configuração inválida com entrega rápida.

**Escopo**

- Schema formal inicial (`JSON Schema` ou `Zod`) para `meta-agents.yaml`.
- Validação de versão do config:
  - `version: 1` obrigatório
  - erro explícito para versões não suportadas.
- Política inicial de compatibilidade:
  - suporte apenas à versão atual
  - erro claro com instrução de upgrade em incompatibilidade
  - migrador opcional futuro, fora do escopo inicial
- `mah validate:config`.
- `sync --check` obrigatório na CI.

**Issues sugeridas**

- `feat(config): schema inicial do meta-agents.yaml`
- `feat(config): versionamento e validação de compatibilidade`
- `feat(validation): comando validate:config`
- `ci: tornar check:meta-sync obrigatório`

### M1B — Arquitetura Canônica de Runtime

**Meta:** reduzir duplicação estrutural entre domínio canônico e dispatcher, sem deslocar comportamento operacional demais para config.

**Escopo**

- Separar explicitamente:
  - domínio canônico no YAML
  - comportamento operacional no dispatcher/adapters
- Introduzir runtime adapters como contrato operacional.
- Reduzir hardcodes ad hoc no dispatcher, movendo-os para adapters em vez de para YAML.
- Introduzir capabilities por runtime em código tipado/estruturado.
- Resolução e normalização de flags orientadas por capabilities implementadas em código.
- `mah validate:runtime`, `mah validate:sync`, `mah validate:all`, com fronteiras explícitas:
  - `validate:runtime`: presença de binários, wrappers e compatibilidade do ambiente
  - `validate:config`: schema, versão e referências cruzadas
  - `validate:sync`: drift entre source-of-truth e artefatos gerados
  - `validate:all`: composição ordenada dos níveis anteriores
- Saída estruturada:
  - `mah detect --json`
  - `mah doctor --json`
  - `mah validate --json`.

**Issues sugeridas**

- `refactor(dispatcher): extrair adapter layer por runtime`
- `refactor(runtime): mover comportamento operacional para adapters`
- `feat(runtime): capability matrix em código estruturado`
- `feat(validation): split validate em níveis`
- `feat(cli): --json para detect/doctor/validate`

### M2 — UX Operacional e Explainability

**Meta:** reduzir atrito de adoção e troubleshooting, com UX diagnóstica consistente.

**Escopo**

- `mah explain`:
  - `mah explain detect`
  - `mah explain use <crew>`
  - `mah explain run`
  - `mah explain sync`
  - `mah explain run --trace`.
- `mah explain` sem subcomando deve funcionar como resumo do estado atual.
- `mah init` com bootstrap mínimo:
  - criação de config canônica
  - templates de crews
  - setup inicial guiado.
- `mah plan` e `mah diff` para preview de sync.
- Tratamento explícito de múltiplos markers:
  - warning forte por padrão
  - modo estrito opcional.

**Issues sugeridas**

- `feat(explain): explain + trace mode`
- `feat(init): bootstrap wizard`
- `feat(sync): plan/diff UX`
- `feat(detect): strict mode para marker ambíguo`

### M3 — Plataforma e Diferenciação

**Meta:** elevar de wrapper CLI para plataforma de orquestração observável.

**Escopo**

- Registry unificado de sessões:
  - `mah sessions`
  - filtros por crew/runtime/agent
  - ponte para resume.
- Provenance/auditoria opcional:
  - delegação, prompts, runtime, artefatos, timestamps, MCP.
- Execution Graph:
  - `mah graph`
  - `mah graph --run <session_id>`.
- Plugin API formal para runtimes.
- Contract tests por runtime.
- `mah demo` para onboarding e demonstração.

**Issues sugeridas**

- `feat(sessions): índice unificado de sessões`
- `feat(audit): trilha de provenance`
- `feat(graph): execution graph por run`
- `feat(plugin-api): RuntimeAdapter contract`
- `test(runtime): contract tests por adapter`
- `feat(demo): modo demo guiado`

### M4 — Context Memory e Assistant Layer Base

**Meta:** adicionar uma camada canônica de memória operacional pós-roteamento, reutilizável entre sessões e runtimes, fortalecendo o MAH como layer de assistência de alto nível sem contaminar o roteamento por expertise.

**Escopo**

- Novo namespace `mah context` para corpus operacional curado.
- Suporte a `.md` e `.qmd` com frontmatter estruturado.
- Indexação local bounded do corpus operacional.
- Retrieval explainable por:
  - `crew`
  - `agent`
  - `capability`
  - `task`
  - `systems/tools` disponíveis
- Integração opcional com bootstrap de runtime, priorizando Hermes.
- Proposal flow para transformar sinais de `sessions`, `provenance` e `evidence` em memória persistente curada.
- Boundary explícito entre:
  - `Expertise`
  - `Context Memory`
  - `Sessions`
  - `Evidence`
  - `Provenance`

**Princípio central**

- `Expertise` decide quem deve receber a tarefa.
- `Context Memory` decide o que esse agente precisa lembrar para executar bem.

**Issues sugeridas**

- `feat(context): schema e validação para context memory`
- `feat(context): index local e retrieval bounded`
- `feat(context-cli): namespace mah context`
- `feat(runtime): injeção de context memory no bootstrap Hermes`
- `feat(context): proposal flow a partir de sessions/provenance`
- `docs(product): MAH como assistant layer runtime-agnostic`

## Contrato de Runtime (Proposta)

```ts
interface RuntimeAdapter {
  name: string
  detect(context: DetectContext): DetectResult
  validate(level: "runtime" | "config" | "sync"): ValidationResult
  run(args: RunArgs): RunResult
  useCrew(crew: string): CommandResult
  clearCrew(): CommandResult
  capabilities(): CapabilityMatrix
}
```

Notas:

- Este é o contrato mínimo inicial.
- É esperado que ele evolua após M2 para acomodar `doctor`, `explain`, `listCrews`, `resumeSession` e normalização padronizada de args/capabilities.
- `listCrews` é o candidato natural mais provável para a primeira expansão do contrato.

## Estratégia de Testes

### Unit

- parsing/normalização de runtime args
- precedência `forced > env > marker > cli`
- normalização por capabilities
- validação de version/schema do YAML

### Integração

- geração de artefatos por runtime
- `sync --check` e detecção de drift
- fluxo `use/clear/run` por runtime
- `validate:*` em cenários reais de erro e sucesso

### Contract

- todos os runtimes cumprindo `RuntimeAdapter`
- casos mínimos obrigatórios por comando
- evolução do contrato acompanhada de testes versionados de adapter

### CI

- `check:meta-sync` obrigatório
- matriz por runtime (`pi`, `claude`, `opencode`)
- smoke + integração + contract tests
- validação de schema em PR

## Critérios de Prontidão (DoD)

### DoD M1A

- schema + versionamento ativos
- `validate:config` funcional
- CI bloqueando drift de sync

### DoD M1B

- dispatcher sem fonte paralela de runtime profiles
- `validate:*` consolidado
- `--json` estável em comandos de diagnóstico

### DoD M2

- `explain --trace` com execução resolvida
- `init` com bootstrap funcional
- plan/diff usados antes de sync em fluxo padrão

### DoD M3

- sessions/provenance/graph operacionais
- plugin API com adapter de referência
- contract tests cobrindo todos os adapters
- `mah demo` pronto para onboarding

### DoD M4

- `mah context` existe como namespace separado de `mah expertise`
- corpus operacional suporta `.md` e `.qmd` com schema validável
- retrieval bounded e explainable funcionando por agent/tarefa/capability
- bootstrap do runtime pode consumir contexto operacional resumido sem inflar prompt fixo
- existe proposal flow para persistência de memória derivada
- a feature preserva o roteamento por expertise como source of truth para seleção de agente

## Priorização Recomendada

1. M1A — segurança imediata
2. M1B — arquitetura canônica
3. M2 — UX e troubleshooting
4. M3 — diferenciação de plataforma
5. M4 — context memory e base da assistant layer

## Decisões de Arquitetura em Aberto

Antes de implementar M1B, três decisões precisam ser fechadas:

1. Até onde vai a responsabilidade declarativa do YAML
   - decisão atual: YAML mínimo, focado em conteúdo canônico
2. Quais campos entram no contrato mínimo de `RuntimeAdapter`
   - escopo inicial obrigatório
   - pontos previstos de extensão futura
3. Definição operacional exata dos níveis `validate:*`
   - fronteiras sem sobreposição ambígua
   - ordenação e composição em `validate:all`
   - cada erro pertencendo a um único nível principal

## Notas de Execução

- Entregar em PRs pequenos por feature.
- Preservar retrocompatibilidade da CLI durante transição.
- Migrar runtime internals por adapter, evitando refactor monolítico.

## Checklist de Conformidade do Roadmap

### M1A — Segurança Mínima de Config

- [done] schema inicial implementado para `meta-agents.yaml` — `scripts/validate-meta-config.mjs` com Zod
- [done] validação de versão ativa (`version: 1`) — `z.literal(1)` no schema Zod; rejeita configs sem `version: 1`
- [done] `mah validate:config` implementado — `npm run validate:config` / `mah validate:config`; valida schema + cross-refs (skills, domain_profiles, topology)
- [done] `check:meta-sync` obrigatório na CI — `npm run check:meta-sync` existe em package.json; Zod valida referências cruzadas em validate:config

### M1B — Arquitetura Canônica de Runtime

- [done] adapter layer extraída para `runtime-adapters.mjs` — 4 runtimes (pi, claude, opencode, hermes)
- [done] capacidade canônica de comportamento formalizada em `runtime-adapters.mjs` (YAML permanece canônico para conteúdo)
- [done] capability matrix estruturada em código — `capabilities.sessionModeNew/Continue`, `supportsSessions`, `sessionListCommand`, etc. por adapter
- [done] `validate:runtime`, `validate:sync`, `validate:all` disponíveis — `mah validate:runtime/sync/all` + `npm run validate:*`
- [done] `RuntimeAdapter` com interface operacional mínima por métodos — `detect`, `supports`, `resolveCommandPlan`, `validateRuntime` validados por `runtime-adapter-contract.mjs`
- [done] `validate:runtime` com precheck semântico próprio via adapter + execução de runtime check
- [done] `--json` uniforme em `detect`, `doctor` e `validate:*` — `jsonMode` propagates through all diagnostic commands
- [done] `contract:runtime` / `test:contract` — `scripts/runtime-adapter-contract.mjs` + `tests/runtime-contract.test.mjs` com validação de campos, métodos e comandos obrigatórios por runtime

### M2 — UX Operacional e Explainability

- [done] `mah explain` com targets `detect/use/run/sync`
- [done] `mah explain --trace` com saída estruturada
- [done] `mah init` com bootstrap mínimo — output é `"mah init completed"`; bootstrap completo via `npm run bootstrap:meta`
- [done] tratamento de múltiplos markers com modo estrito (`--strict-markers` / `MAH_STRICT_MARKERS=1`)
- [done] `mah plan` e `mah diff` com modos dedicados (`--plan` e `--diff`) e relatórios próprios

### M3 — Plataforma e Diferenciação

- [done] `mah sessions` com filtros e `--json` — list/resume/new/export/delete com `--runtime`, `--crew`, `--json`, `--dry-run`, `--yes`
- [done] provenance opcional (`MAH_AUDIT=1` / `MAH_PROVENANCE=1`) em `.mah/provenance.jsonl`
- [done] `mah graph` para topologia e run graph — `mah graph [--crew <name>] [--run <id>] [--json] [--mermaid]`
- [done] contrato mínimo de adapter formalizado + `contract:runtime` — `runtime-adapter-contract.mjs` valida campos, métodos e comandos por runtime
- [done] `mah demo` implementado — `mah demo` é alias de `mah run --demo`
- [done] `mah resume <id>` implementado como `mah sessions resume <id>` — ID format: `runtime:crew:sessionId`
- [done] plugin API — loader, registry, install/uninstall, validação e integração no CLI entregues em `v0.5.0`

### Ações Recomendadas para Fechar Gaps

- [done] evoluir `RuntimeAdapter` de shape estrutural para interface operacional mínima por métodos
- [done] desacoplar `validate:runtime` com precheck semântico próprio e relatório estruturado
- [done] uniformização de `--json` em comandos de diagnóstico
- [done] semântica diferenciada de `plan` e `diff` com relatórios dedicados
- [done] mecanismo de carregamento externo de plugins (`scripts/plugin-loader.mjs`, `mah plugins ...`, testes e docs)

### M4 — Context Memory e Assistant Layer Base

- [planned] documento de execução salvo em [`plan/context-memory-v0.8.0.md`](../context-memory-v0.8.0.md)
- [todo] definir naming final da feature (`Context Memory` vs `Operational Context Memory`)
- [todo] modelar schema e contratos em `types/` e `scripts/`
- [todo] criar storage canônico em `.mah/context/operational/`
- [todo] implementar `mah context validate` e `mah context index`
- [todo] implementar retrieval bounded e explainable
- [todo] integrar contexto recuperado ao bootstrap Hermes
- [todo] definir proposal flow para persistência derivada de `sessions`/`provenance`
- [todo] documentar boundary com `Expertise` para evitar sobreposição semântica
