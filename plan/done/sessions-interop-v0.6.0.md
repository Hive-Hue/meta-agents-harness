# Plan — Integrated Sessions Interop (v0.6.0)

## Objetivo

Criar uma camada canônica de gestão de sessões no MAH, com export e injeção de contexto entre runtimes, sem assumir portabilidade perfeita de transcript bruto.

O resultado esperado é:
- sessões passam a ser recurso do MAH, não apenas do runtime
- `mah sessions` ganha export canônico
- o MAH consegue injetar contexto em outro runtime de forma bounded
- a fidelidade da portabilidade entre runtimes é explícita e auditável

---

## 1. Problema

Hoje cada runtime trata sessão de forma própria:

- ids diferentes
- storage diferente
- export diferente
- semântica de resume diferente
- contexto difícil de mover entre runtimes

### Limitação estrutural

O MAH já possui operações de sessão, mas ainda não tem uma camada canônica suficiente para:

- exportar de forma uniforme
- reconstruir contexto relevante
- reinjetar esse contexto em outro runtime

### Risco atual

Sem modelo canônico, “migrar” sessão entre runtimes tende a virar replay cego de transcript, o que é tecnicamente frágil.

---

## 2. Proposta

Separar claramente três conceitos:

1. sessão bruta do runtime
2. sessão canônica do MAH
3. projeção de contexto para runtime de destino

### Princípio central

Interop entre runtimes não deve ser baseada em transcript bruto por padrão. Deve ser baseada em export estruturado do MAH.

---

## 3. Modelo conceitual

### 3.1 Sessão bruta

Fonte nativa do runtime:

- transcript cru
- ids nativos
- metadata específica

### 3.2 Sessão canônica do MAH

Envelope intermediário:

```json
{
  "schema": "mah.session.v1",
  "mah_session_id": "codex:dev:abc123",
  "runtime": "codex",
  "runtime_session_id": "abc123",
  "crew": "dev",
  "agent": "planning-lead",
  "created_at": "2026-04-14T00:00:00.000Z",
  "last_active_at": "2026-04-14T01:00:00.000Z",
  "summary": "...",
  "artifacts": [],
  "provenance": [],
  "context_blocks": [],
  "raw_export_ref": null
}
```

### 3.3 Projeção para outro runtime

Transformação explícita:

- contexto relevante vira bloco de sistema/contexto
- artifacts viram referências
- provenance vira metadata opcional
- transcript bruto só entra se o runtime de destino realmente suportar

---

## 4. Contrato funcional mínimo

### 4.1 Operações

- `mah sessions list`
- `mah sessions export <id>`
- `mah sessions inject <id> --runtime <target>`
- `mah sessions bridge <id> --to <runtime>`

### 4.2 Export formats

- `mah-json`
- `runtime-raw` quando suportado
- `summary-md`

### 4.3 Injeção de contexto

Recebe:

- sessão origem
- runtime alvo
- crew/agente alvo opcionais
- modo de fidelidade

Retorna:

- runtime alvo
- estratégia usada
- nível de fidelidade
- warnings
- contexto gerado

---

## 5. Fidelity model

### Níveis

- `full`
  - só quando houver suporte real a replay/continue
- `contextual`
  - summary + artifacts + context blocks + provenance essencial
- `summary-only`
  - apenas resumo textual estruturado

### Regra

O default deve ser `contextual`, não `full`.

---

## 6. Arquitetura proposta

### 6.1 Novo `SessionAdapter`

Separar sessão do `RuntimeAdapter`.

```ts
interface SessionAdapter {
  runtime: string
  listSessions(ctx): Promise<SessionRef[]>
  exportSession(ctx): Promise<RuntimeSessionExport>
  supportsRawExport(): boolean
  supportsContextInjection(): boolean
  buildInjectionPayload(ctx): Promise<InjectionPayload>
}
```

### 6.2 Registry

- registry de session adapters paralelo ao de runtime adapters
- fallback quando runtime não implementar export estruturado

### 6.3 Storage canônico

Possível diretório:

```text
.mah/sessions/
  index.json
  exports/
  projections/
```

---

## 7. Mudanças de código previstas

### Arquivos principais

- `scripts/meta-agents-harness.mjs`
- `scripts/runtime-core-integrations.mjs`
- `scripts/runtime-adapter-contract.mjs`
- novos adapters/suporte de sessão por runtime
- `tests/sessions-operations.test.mjs`

### Arquivos novos prováveis

- `scripts/session-adapter-contract.mjs`
- `scripts/session-export.mjs`
- `scripts/session-injection.mjs`
- `tests/session-interop.test.mjs`
- `docs/sessions-interop.md`

---

## 8. CLI proposta

### Export

```bash
mah sessions export codex:dev:abc123 --format mah-json
mah sessions export codex:dev:abc123 --format summary-md
mah sessions export codex:dev:abc123 --format runtime-raw
```

### Injection

```bash
mah sessions inject codex:dev:abc123 --runtime hermes
mah sessions inject codex:dev:abc123 --runtime codex --agent backend-dev
```

### Bridge

```bash
mah sessions bridge codex:dev:abc123 --to hermes
```

`bridge` é atalho operacional para:
- exportar sessão
- projetar contexto
- preparar payload para runtime alvo

---

## 9. Regras de boundary

- sem replay universal de transcript
- sem garantia falsa de “resume em qualquer runtime”
- sem federation entre workspaces
- sem remote session transport
- sem storage distribuído

---

## 10. Estratégia por runtime

### Codex

- mapear sessões locais e exportar contexto relevante
- suportar injection como bloco de contexto em nova sessão

### PI

- reaproveitar o que já existe em sessions ops
- validar export canônico

### Claude

- suportar export e injection conforme superfície real disponível

### OpenCode

- usar metadata e artifacts quando replay não existir

### Hermes

- definir capability de export e de injection separadamente

---

## 11. Test plan

### 11.1 Unit

- normalização `mah_session_id`
- export canônico
- projection builder
- fidelity selection

### 11.2 Integração

- `mah sessions export <id> --format mah-json`
- `mah sessions inject <id> --runtime <target>`
- `mah sessions bridge <id> --to <target>`

### 11.3 Não-regressão

- `mah sessions list`
- `mah sessions resume`
- `mah sessions delete`
- `mah sessions export` atual não quebra

---

## 12. Execução por slice

### Slice 0 — Modelo canônico

**Entrega**
- `mah.session.v1`
- definição de fidelity levels

**Gate**
- sem export canônico não existe injection

### Slice 1 — SessionAdapter contract

**Entrega**
- contrato separado de sessão
- validação mínima por runtime

**Gate**
- o core consegue distinguir runtime support de session support

### Slice 2 — Export

**Entrega**
- `mah sessions export`
- formato `mah-json`
- summary export

**Gate**
- export auditável e reproduzível

### Slice 3 — Injection

**Entrega**
- projection builder
- `mah sessions inject`

**Gate**
- injection usa contexto projetado, não transcript bruto por default

### Slice 4 — Bridge UX

**Entrega**
- `mah sessions bridge`
- explainability e warnings

**Gate**
- operador entende o nível de fidelidade usado

### Slice 5 — Testes e docs

**Entrega**
- suíte dedicada
- documentação operacional

**Gate**
- interop mínima demonstrável entre ao menos dois runtimes

---

## 13. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Falsa promessa de portabilidade total | alto | fidelity model explícito |
| Acoplar sessão ao runtime demais | alto | `SessionAdapter` separado |
| Replay bruto quebrar contexto | alto | default em `contextual`, não `full` |
| Export canônico pobre demais | médio | incluir artifacts, provenance e summary estruturado |

---

## 14. O que NÃO entra em v0.6.0

- sync live de sessão entre runtimes
- merge de duas sessões
- cluster/cloud session broker
- federation multi-workspace
- replay universal de transcript
- garantia de resume cross-runtime

---

## 15. Critério de sucesso

Ao final:

- sessões têm envelope canônico do MAH
- export é uniforme e auditável
- injection entre runtimes existe como operação bounded
- o operador sabe quando a fidelidade é `full`, `contextual` ou `summary-only`
- tudo continua compatível com a surface atual de `mah sessions`
