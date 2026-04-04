# Roadmap de Features — Meta Agents Harness (Refinado)

## Objetivo

Consolidar o `meta-agents-harness` como camada interoperável de orquestração multi-runtime, com fonte canônica única, validação forte, observabilidade operacional e extensibilidade via adapters.

## Diagnóstico Consolidado

- Existe risco de divergência entre `meta-agents.yaml` e lógica hardcoded do dispatcher.
- `validate` ainda está acoplado à ideia de runtime health e pouco à consistência de artefatos.
- Testes e CI ainda não cobrem todos os cenários críticos de precedência, drift e contrato por runtime.
- A UX operacional ainda explica bem a arquitetura, mas oferece pouco suporte diagnóstico ao operador.

## Princípios de Evolução

- Fonte única de verdade declarativa.
- Compatibilidade com automação (`--json`) e rastreabilidade (`--trace`).
- Mudanças incrementais para evitar big-bang refactor.
- Contratos explícitos para extensão de runtimes.
- Separação clara entre config declarativa, adapter operacional e registry resolvido em runtime.

## Modelo Arquitetural Desejado

- O YAML descreve:
  - capacidades
  - comandos declarativos
  - metadata
  - comportamento configurável
- Os adapters implementam o contrato operacional.
- O dispatcher resolve a execução a partir da combinação entre config carregada e adapters registrados.

Esse modelo evita dois extremos indesejáveis:

- duplicação de verdade entre YAML e código
- excesso de comportamento executável codificado diretamente no YAML

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

**Meta:** remover duplicação estrutural entre YAML e dispatcher.

**Escopo**

- Runtime registry dinâmico derivado do YAML.
- Remoção progressiva de `runtimeProfiles` hardcoded.
- Capacidades por runtime declaradas no YAML.
- Resolução e normalização de flags orientadas por capabilities declaradas.
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

- `feat(config): runtime registry dinâmico`
- `refactor(dispatcher): consumir runtime config declarativa`
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

## Priorização Recomendada

1. M1A — segurança imediata
2. M1B — arquitetura canônica
3. M2 — UX e troubleshooting
4. M3 — diferenciação de plataforma

## Decisões de Arquitetura em Aberto

Antes de implementar M1B, três decisões precisam ser fechadas:

1. Até onde vai a responsabilidade declarativa do YAML
   - o que fica na config
   - o que permanece no adapter
   - o que é resolvido pelo dispatcher em runtime
2. Quais campos entram no contrato mínimo de `RuntimeAdapter`
   - escopo inicial obrigatório
   - pontos previstos de extensão futura
3. Definição operacional exata dos níveis `validate:*`
   - fronteiras sem sobreposição ambígua
   - ordenação e composição em `validate:all`

## Notas de Execução

- Entregar em PRs pequenos por feature.
- Preservar retrocompatibilidade da CLI durante transição.
- Migrar runtime internals por adapter, evitando refactor monolítico.
