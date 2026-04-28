# Roadmap de Features — Meta Agents Harness (Refinado)

## Status Atual

- M1A: [done]
- M1B: [done]
- M2: [done]
- M3: [done]
- M4: [in-progress]
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

- [done] documento de execução salvo em [`plan/context-memory-v0.8.0.md`](../context-memory-v0.8.0.md)
- [done] naming final definido como `Context Memory`
- [done] Context Memory slice planning consolidated in [`plan/slices/context-memory-finalization-slices.md`](../slices/context-memory-finalization-slices.md)
- [done] schema e contratos em `types/context-memory-types.mjs`, `scripts/context/context-memory-validate.mjs`, `scripts/context/context-memory-schema.mjs`
- [done] storage canônico em `.mah/context/` com subdiretórios operational/, index/, proposals/, cache/
- [done] `mah context validate`, `mah context list`, `mah context show` implementados
- [done] `mah context index [--rebuild]` — deterministic index builder (operational + fixtures)
- [done] `mah context find --agent <name> --task "<desc>"` — lexical + metadata retrieval
- [done] `mah context explain --agent <name> --task "<desc>"` — explainable retrieval reasoning
- [done] fixtures de teste em `tests/fixtures/context-memory/` (5 documentos: 4 válidos, 1 inválido)
- [done] `scripts/context/context-memory-integration.mjs` — runtime injection logic
- [done] Hermes bootstrap injection via `MAH_CONTEXT_MEMORY=1` ou `--with-context-memory`
- [done] Suporte a `--context-limit <n>` e `--context-mode=summary|snippets`
- [done] proposal flow com `sessions`/`provenance` (PR4) — mah context propose --from-session <ref>
- [done] boundary com `Expertise` documentado em `plan/context-memory-v0.8.0.md`
- [done] nenhuma dependência de vector DB ou Obsidian
