# Decisões de Arquitetura em Aberto

## Objetivo

Registrar as decisões que precisam ser cravadas antes da implementação do M1B, para reduzir ambiguidade e evitar refactors estruturais em cascata.

## D1 — Limite da responsabilidade declarativa do YAML

### Pergunta

Até onde o `meta-agents.yaml` deve descrever comportamento de runtime, e onde começa a responsabilidade dos adapters e do dispatcher?

### Opções

#### Opção A — YAML máximo

O YAML descreve quase tudo:

- runtimes suportados
- wrappers
- comandos
- capabilities
- regras de flags
- níveis de validate

**Prós**

- reduz duplicação aparente
- facilita adicionar runtime novo sem tocar tanto no core

**Contras**

- aumenta indireção
- pode transformar config em pseudo-código
- torna debugging mais difícil

#### Opção B — YAML mínimo

O YAML descreve só crews, modelos, skills, perfis e paths; quase todo comportamento fica em código.

**Prós**

- comportamento mais explícito no código
- menor risco de config frágil

**Contras**

- contradiz a ambição de “fonte canônica”
- mantém duplicação estrutural
- dificulta extensibilidade

#### Opção C — Modelo híbrido orientado a contrato

O YAML descreve:

- metadata de runtime
- capabilities declarativas
- comandos suportados
- parâmetros configuráveis

Os adapters implementam:

- lógica operacional
- integração com binários
- semântica de execução

O dispatcher resolve:

- seleção do runtime
- normalização baseada em capabilities
- despacho para adapter

### Recomendação

**Escolher a Opção C.**

É o melhor equilíbrio entre fonte canônica declarativa e comportamento operacional explícito.  
O YAML não deve substituir a camada de código; deve alimentar um registry resolvido em runtime.

### Decisão proposta

- `meta-agents.yaml` define **o quê** o runtime suporta e como ele é descrito.
- `RuntimeAdapter` define **como** o runtime executa.
- o dispatcher conecta ambos.

## D2 — Escopo mínimo do contrato `RuntimeAdapter`

### Pergunta

Qual deve ser o contrato inicial obrigatório para todos os runtimes?

### Opções

#### Opção A — Contrato muito pequeno

```ts
detect()
run()
validate()
```

**Prós**

- fácil de implementar
- baixa barreira inicial

**Contras**

- não cobre casos reais da CLI atual
- leva a exceções ad hoc fora do contrato

#### Opção B — Contrato muito amplo

```ts
detect()
validate()
run()
useCrew()
clearCrew()
listCrews()
doctor()
explain()
resumeSession()
normalizeArgs()
capabilities()
```

**Prós**

- visão completa desde o início

**Contras**

- risco de superprojetar cedo demais
- maior custo de migração

#### Opção C — Contrato mínimo evolutivo

```ts
interface RuntimeAdapter {
  name: string
  detect(context): DetectResult
  validate(level): ValidationResult
  run(args): RunResult
  useCrew(crew): CommandResult
  clearCrew(): CommandResult
  capabilities(): CapabilityMatrix
}
```

Com expansão planejada após M2 para:

- `doctor()`
- `listCrews()`
- `explain()`
- `resumeSession()` ou equivalente
- `normalizeArgs()` ou resolução padronizada por capabilities

### Recomendação

**Escolher a Opção C.**

É suficiente para tirar o dispatcher do hardcode sem inflar o contrato cedo demais.

### Decisão proposta

- contrato inicial mínimo e estável em M1B
- extensão formal do contrato apenas após estabilização de M2
- toda evolução do contrato exige contract tests correspondentes

## D3 — Definição exata dos níveis `validate:*`

### Pergunta

Como dividir `validate:runtime`, `validate:config`, `validate:sync` e `validate:all` sem sobreposição confusa?

### Opções

#### Opção A — Fronteiras soltas

Cada runtime decide livremente o que validar em cada comando.

**Prós**

- flexível

**Contras**

- inconsistente
- ruim para automação
- difícil de documentar

#### Opção B — Fronteiras fixas e semânticas

- `validate:config`
  - schema
  - versão
  - referências cruzadas
  - coerência da topologia
- `validate:runtime`
  - binários
  - wrappers
  - compatibilidade do ambiente
  - dependências necessárias
- `validate:sync`
  - drift entre config canônica e artefatos gerados
  - prompts, links, symlinks, arquivos de runtime
- `validate:all`
  - composição ordenada:
    1. config
    2. runtime
    3. sync

**Prós**

- previsível
- fácil de documentar
- ótimo para CI

**Contras**

- exige disciplina para evitar duplicação

### Recomendação

**Escolher a Opção B.**

Essa separação é clara para operador, para CI e para evolução interna.

### Decisão proposta

- `validate:config` é sempre semântico/declarativo
- `validate:runtime` é sempre operacional/ambiental
- `validate:sync` é sempre materialização/drift
- `validate:all` encadeia os três nessa ordem

## Impacto nas próximas fases

### Se essas decisões forem aceitas

- M1A pode seguir com schema/versionamento sem risco de retrabalho conceitual.
- M1B ganha fronteiras arquiteturais claras.
- M2 pode construir `explain`, `init` e `plan/diff` sobre um core previsível.
- M3 herda um contrato extensível e validável.

### Se ficarem em aberto

- o dispatcher pode continuar acoplado a exceções específicas
- `validate:*` pode nascer redundante
- a futura plugin API pode precisar ser redesenhada cedo demais

## Resumo Executivo

- **D1:** adotar modelo híbrido YAML + adapters + dispatcher
- **D2:** adotar contrato mínimo evolutivo para `RuntimeAdapter`
- **D3:** adotar fronteiras fixas para `validate:*`
