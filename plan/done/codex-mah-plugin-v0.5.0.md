# Plan — Plugin `mah` para Codex (v0.5.0)

## Status

- estado atual: [done]
- pasta correta: `plan/done/`
- slices 0, 1, 2, 3, 4 e 5: entregues
- status operacional atual:
  - plugin `mah` operacional como MCP local
  - `mah --runtime codex run` injeta automaticamente o servidor `mah` via `codex -c mcp_servers.mah=...`
  - uso validado sem depender de registro manual no `~/.codex/config.toml`
  - testes cobrem o bootstrap automático do MCP na sessão Codex gerenciada pelo MAH

## Objetivo

Adicionar um plugin local `mah` para o Codex que exponha ferramentas operacionais reais do Meta Agents Harness dentro da sessão `mah --runtime codex run`, sem substituir o adapter `codex` já existente e sem expandir escopo além de `v0.5.0`.

O resultado esperado é:
- o runtime `codex` continua responsável por bootstrap de crew, contexto e abertura de sessão
- o plugin `mah` adiciona tools executáveis para inspeção e delegação MAH
- a delegação dentro da sessão Codex deixa de depender de subagents nativos aleatórios e passa a usar o grafo real do MAH

---

## 1. Problema

Hoje o runtime Codex do MAH injeta contexto corretamente, mas não oferece a camada de controle do harness como ferramentas utilizáveis pela sessão.

### Estado atual confirmado

- `mah --runtime codex run` abre uma sessão com `initial_messages` e contexto de crew/agente
- o Codex consegue ler `.codex/crew/<crew>/multi-team.yaml` e os prompts dos agentes
- o prompt gerado declara `delegate_agent`, `mcp_servers`, `mcp_tools` e `mcp_call` no frontmatter
- o adapter Codex remove esse frontmatter ao carregar o prompt
- o runtime Codex não faz bind dessas tools
- quando o usuário pede delegação, o Codex usa seus próprios subagents nativos, não agentes MAH reais

### Evidência de código

- `mah-plugins/codex/index.mjs` monta contexto textual e usa `initial_messages`
- `mah-plugins/codex/index.mjs` remove frontmatter com `stripFrontmatter()`
- `scripts/sync-meta-agents.mjs` injeta `delegate_agent` no frontmatter gerado
- `extensions/multi-team.ts` implementa a tool real `delegate_agent`
- `scripts/runtime-core-integrations.mjs` carrega `extensions/multi-team.ts` para o runtime PI, não para Codex

---

## 2. Proposta

Criar um plugin `mah` para o Codex que funcione como bridge do control-plane do harness.

### Responsabilidade do runtime `codex`

- selecionar crew ativa
- selecionar agente inicial
- montar prompt contextual
- abrir sessão interativa ou execução autônoma quando explicitamente solicitado

### Responsabilidade do plugin `mah`

- expor tools do MAH como capacidades reais dentro da sessão Codex
- consultar estado ativo da crew e do agente
- listar agentes e rotas válidas
- delegar trabalho usando o mecanismo real do MAH
- retornar resultados legíveis e auditáveis para o operador

### Responsabilidade que NÃO muda

- o plugin `mah` não substitui `mah-plugins/codex`
- o plugin `mah` não implementa um segundo runtime
- o plugin `mah` não duplica sync de prompts, expertise ou sessions
- o plugin `mah` não cria policy engine, federation nem remote execution

---

## 3. Arquitetura mínima

### 3.1 Estrutura proposta

```text
plugins/
└── mah/
    ├── .codex-plugin/
    │   └── plugin.json
    ├── mcp/
    │   ├── server.mjs
    │   └── handlers/
    │       ├── get-active-context.mjs
    │       ├── list-agents.mjs
    │       └── delegate-agent.mjs
    └── README.md
```

### 3.2 Modelo operacional

O plugin roda como um pequeno MCP server local e expõe tools para a sessão do Codex.

Fluxo:
1. `mah --runtime codex run` abre a sessão com o contexto da crew
2. o plugin `mah` fica disponível como conjunto de tools
3. o Codex usa essas tools quando precisa consultar ou delegar algo
4. a tool chama o MAH real no workspace atual
5. o resultado volta para a sessão do Codex

### 3.3 Canal de integração

Para `v0.5.0`, a bridge deve ser simples e explícita:

- usar `MAH_ACTIVE_CREW` e `MAH_AGENT` como contexto primário
- ler `.codex/.active-crew.json` e `.codex/crew/<crew>/multi-team.yaml` como fonte local de suporte
- executar delegação pelo próprio MAH CLI, não por reimplementação paralela do grafo

### 3.4 Estratégia de delegação

Para manter bounded scope em `v0.5.0`, a tool `mah_delegate_agent` deve:

- validar o alvo com base na crew ativa
- respeitar a hierarquia declarada
- chamar o MAH como control-plane
- retornar:
  - target resolvido
  - status
  - tempo decorrido
  - resumo do output
  - referência de artifact quando existir

O plugin não deve depender da inferência livre do modelo para roteamento.

---

## 4. Tools mínimas para v0.5.0

### 4.1 `mah_get_active_context`

Retorna:
- crew ativa
- agente atual
- role
- team
- sprint metadata essencial
- caminho do config ativo

Uso:
- diagnóstico
- explicabilidade
- confirmação de contexto antes de delegar

### 4.2 `mah_list_agents`

Retorna:
- orchestrator
- leads
- workers
- rota permitida a partir do agente atual

Uso:
- elimina leitura manual do YAML
- evita que o Codex tente “adivinhar” a topologia

### 4.3 `mah_delegate_agent`

Recebe:
- `target`
- `task`

Executa:
- validação do target
- resolução de rota
- chamada do mecanismo real do MAH

Retorna:
- target efetivo
- status
- elapsed
- output resumido
- output completo opcional

---

## 5. Contrato funcional

### 5.1 Regras de comportamento

- a sessão Codex continua interativa por padrão
- nenhuma tool do plugin deve iniciar autonomia por conta própria
- `mah_delegate_agent` deve disparar execução apenas quando for chamada explicitamente
- o plugin deve falhar com mensagens claras quando não houver crew ativa ou quando o target for inválido

### 5.2 Regras de boundary

- o plugin só opera sobre a crew ativa no runtime corrente
- sem cross-runtime federation
- sem dispatch remoto
- sem múltiplas crews simultâneas
- sem override implícito de modelo por plugin

### 5.3 Regras de explicabilidade

Cada resposta operacional deve deixar claro:
- de onde veio o contexto
- qual target foi solicitado
- qual target foi efetivamente resolvido
- se houve reroute
- qual mecanismo foi usado para delegação

---

## 6. Mudanças de código previstas

### 6.1 Novos arquivos

- `plugins/mah/.codex-plugin/plugin.json`
- `plugins/mah/mcp/server.mjs`
- `plugins/mah/mcp/handlers/get-active-context.mjs`
- `plugins/mah/mcp/handlers/list-agents.mjs`
- `plugins/mah/mcp/handlers/delegate-agent.mjs`
- `plugins/mah/README.md`

### 6.2 Ajustes no runtime Codex

Mudança mínima no adapter `codex` apenas para garantir que a sessão carregada pelo MAH exponha o plugin `mah` quando disponível.

Isso pode significar:
- materializar ou referenciar o plugin na árvore ativa do Codex
- ou garantir que o ambiente de execução do `codex` enxergue `plugins/mah`

O adapter não deve absorver lógica de delegação.

### 6.3 Reuso obrigatório

Reusar o máximo possível de:
- resolução de crew ativa
- parsing de `multi-team.yaml`
- validação de targets
- resultado de delegação

Se já houver helpers aproveitáveis no MAH, o plugin deve chamá-los ou invocar o CLI do próprio MAH em vez de reimplementar comportamento.

---

## 7. Plano de execução por slice

### Slice 0 — Spec e contrato mínimo

**Entrega**
- definir contrato das 3 tools
- definir formato mínimo de resposta
- definir fonte de contexto ativa

**Arquivos**
- `plan/todo/codex-mah-plugin-v0.5.0.md`
- `plugins/mah/README.md`

**Gate**
- contrato aprovado e sem dependência de arquitetura v0.6.0+

### Slice 1 — Scaffold do plugin `mah`

**Entrega**
- plugin Codex local estruturado
- manifesto `.codex-plugin/plugin.json`
- MCP server sobe e responde health check simples

**Arquivos**
- `plugins/mah/.codex-plugin/plugin.json`
- `plugins/mah/mcp/server.mjs`

**Gate**
- Codex detecta o plugin
- servidor sobe sem tocar no fluxo de runtime existente

### Slice 2 — Contexto e inspeção

**Entrega**
- `mah_get_active_context`
- `mah_list_agents`

**Arquivos**
- `plugins/mah/mcp/handlers/get-active-context.mjs`
- `plugins/mah/mcp/handlers/list-agents.mjs`
- testes correspondentes

**Gate**
- sessão Codex consegue consultar crew/agente ativos
- resposta inclui roteamento permitido

### Slice 3 — Delegação MAH real

**Entrega**
- `mah_delegate_agent`
- chamada do control-plane real do MAH
- mensagens de erro e reroute explicáveis

**Arquivos**
- `plugins/mah/mcp/handlers/delegate-agent.mjs`
- helpers mínimos compartilhados, se necessários
- testes de integração

**Gate**
- delegação feita a partir da sessão Codex usa o grafo MAH, não subagents nativos

### Slice 4 — Integração do runtime Codex com o plugin

**Entrega**
- runtime Codex passa a expor o plugin `mah` na sessão MAH-managed
- documentação operacional mínima

**Arquivos**
- `mah-plugins/codex/index.mjs`
- `plugins/codex/index.mjs`
- docs/changelog se aplicável

**Gate**
- `mah --runtime codex run` abre sessão com contexto e com tools `mah_*` disponíveis

### Slice 5 — Validação final

**Entrega**
- cobertura integrada para contexto, listagem e delegação
- prova de não-regressão do modo interativo padrão do Codex

**Gate**
- suites específicas passam
- fluxo manual básico reproduz o caso de uso que motivou este plano

---

## 8. Test plan

### 8.1 Testes unitários

- resolver crew ativa a partir de env e `.codex/.active-crew.json`
- listar agentes corretamente a partir de `multi-team.yaml`
- rejeitar target inválido
- preservar mensagens explicáveis quando não houver crew ativa

### 8.2 Testes de integração

- `mah --runtime codex run` continua interativo
- a sessão expõe `mah_get_active_context`
- a sessão expõe `mah_list_agents`
- `mah_delegate_agent` aciona o control-plane MAH e retorna resultado estruturado

### 8.3 Testes de não-regressão

- o runtime Codex continua suportando `list:crews`, `use`, `clear`, `run`
- o modo autônomo explícito com `MAH_CODEX_AUTONOMOUS=1` continua funcionando
- o plugin ausente não quebra o runtime `codex`

### 8.4 Validação manual mínima

Fluxo alvo:

1. `mah --runtime codex use --crew dev`
2. `mah --runtime codex run`
3. pedir `mah_get_active_context`
4. pedir `mah_list_agents`
5. pedir `mah_delegate_agent` para um lead válido
6. confirmar que o resultado veio do MAH e não de subagent nativo do Codex

---

## 9. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Plugin duplicar lógica do harness | alto | delegação via MAH CLI ou helpers compartilhados; não reimplementar grafo |
| Coupling excessivo entre plugin e runtime Codex | alto | manter adapter responsável só por bootstrap/sessão |
| Sessão Codex perder simplicidade operacional | médio | começar com 3 tools apenas |
| Tool de delegação gerar side effects opacos | alto | resposta estruturada com target, status, elapsed e output |
| Plugin exigir infraestrutura v0.6.0+ | alto | sem remote execution, sem policy engine, sem federation |

---

## 10. O que NÃO entra em v0.5.0

- paridade completa entre todos os runtimes
- bridge genérica de tools MAH para qualquer runtime
- federation entre crews ou workspaces
- roteamento remoto
- observabilidade distribuída
- policy engine
- scheduler de subagents
- multiplexação de múltiplas crews na mesma sessão Codex
- reescrita do `delegate_agent` para fora do MAH atual

---

## 11. Critério de sucesso

Ao final do slice:

- `mah --runtime codex run` continua abrindo uma sessão interativa com contexto
- a sessão consegue consultar o contexto MAH sem ler YAML manualmente
- a sessão consegue delegar para agentes da crew via mecanismo MAH real
- o operador consegue distinguir claramente delegação MAH de subagent nativo do Codex
- tudo isso cabe em `v0.5.0` sem puxar fundações de `v0.6.0+`
