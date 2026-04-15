# Plan — Headless Cross-Runtime Execution (v0.6.0)

## Objetivo

Permitir execução headless previsível em qualquer runtime suportado pelo MAH, sem depender de TUI interativa e sem introduzir semânticas divergentes por runtime.

O resultado esperado é:
- `mah run --runtime <x> --headless "<task>"` funciona de forma consistente
- `mah explain run --headless --trace` mostra exatamente o plano operacional
- runtimes sem suporte headless nativo falham com erro honesto ou usam fallback explícito
- o comportamento continua bounded por `RuntimeAdapter`, sem virar uma camada de automação opaca

---

## 1. Problema

Hoje o MAH já consegue despachar `run` em múltiplos runtimes, mas a semântica de execução não interativa não é uniforme.

### Limitações atuais

- alguns runtimes têm caminho interativo bem definido, mas não contrato headless explícito
- alguns suportam autonomia por env/flags, outros por subcomando, outros não
- `run` ainda mistura:
  - bootstrap de contexto
  - semântica de sessão
  - modo interativo
  - modo autônomo
- o operador não tem um contrato único de:
  - prompt de entrada
  - output
  - exit status
  - cwd
  - artifacts

### Consequência

Sem um contrato único, cada runtime exige interpretação própria e o `run` do MAH não pode ser tratado como API estável para automação.

---

## 2. Proposta

Definir uma camada headless explícita, orientada por capability e por adapter.

### Princípio central

O MAH não deve fingir que todos os runtimes são iguais. Ele deve:

- modelar a capacidade headless
- normalizar a interface externa
- manter diferenças internas dentro do adapter

### Resultado operacional

O operador passa a ter:

```bash
mah run --runtime codex --headless "Implement the migration"
mah run --runtime hermes --headless "Summarize the diagnostics"
mah explain run --runtime pi --headless --trace
```

---

## 3. Contrato funcional mínimo

### 3.1 Novo modo explícito

Adicionar modo headless ao surface do MAH:

- `mah run --headless "<task>"`
- `mah explain run --headless`

### 3.2 Envelope de execução

Toda execução headless deve produzir resultado canônico:

```json
{
  "schema": "mah.headless-run.v1",
  "ok": true,
  "runtime": "codex",
  "crew": "dev",
  "agent": "planning-lead",
  "mode": "headless",
  "exec": "codex",
  "execArgs": ["..."],
  "cwd": "/repo",
  "status": 0,
  "stdout": "...",
  "stderr": "",
  "artifacts": [],
  "warnings": []
}
```

### 3.3 Semântica mínima obrigatória

Todo runtime precisa declarar:

- se suporta headless nativamente
- qual comando usar
- como o prompt é injetado
- se requer sessão
- se produz output capturável

---

## 4. Arquitetura proposta

### 4.1 Extensão do `RuntimeAdapter`

Adicionar capability explícita:

```ts
capabilities: {
  headless: {
    supported: boolean,
    native: boolean,
    requiresSession: boolean,
    promptMode: "argv" | "stdin" | "env" | "unsupported",
    outputMode: "stdout" | "file" | "mixed"
  }
}
```

### 4.2 Novo método opcional/obrigatório por contrato

```ts
prepareHeadlessRunContext(context): {
  ok: boolean,
  exec: string,
  args: string[],
  passthrough: string[],
  envOverrides: object,
  warnings: string[],
  internal?: object,
  error?: string
}
```

### 4.3 Regra de compatibilidade

- se `capabilities.headless.supported === true`, o adapter deve implementar `prepareHeadlessRunContext()`
- se `supported === false`, `mah run --headless` falha com erro claro
- sem fallback implícito para “abrir TUI e torcer”

---

## 5. Semântica por runtime

### Codex

- suporte provável: `codex exec`
- prompt por argv ou stdin
- output capturado por stdout
- pode reutilizar parte do bootstrap já existente no plugin `codex`

### PI

- verificar se o caminho atual já é naturalmente headless
- modelar requirements de sessão/env

### Claude

- verificar execução não interativa real
- não assumir equivalência com Codex

### OpenCode

- validar surface atual para execução de task sem TUI

### Hermes

- suportar apenas se houver superfície não interativa honesta
- se não houver, declarar `unsupported`

---

## 6. Mudanças de código previstas

### Arquivos principais

- `scripts/runtime-adapter-contract.mjs`
- `scripts/meta-agents-harness.mjs`
- `scripts/runtime-core-integrations.mjs`
- `plugins/codex/index.mjs`
- `plugins/runtime-claude/index.mjs`
- `plugins/runtime-opencode/index.mjs`
- `plugins/runtime-hermes/index.mjs`
- `plugins/runtime-pi/index.mjs`
- `tests/runtime-contract.test.mjs`
- `tests/runtime-core-integration.test.mjs`
- testes novos específicos de headless

### Possíveis arquivos novos

- `tests/headless-run.test.mjs`
- `docs/headless-runtime.md`

---

## 7. CLI proposta

### Comandos

```bash
mah run --runtime codex --headless "Implement the plugin loader"
mah run --runtime hermes --headless "Summarize runtime health"
mah explain run --runtime codex --headless --trace
```

### Flags

- `--headless`
- `--output json|text`
- `--stdin-prompt`
- `--allow-unsupported-fallback` (se realmente necessário; default deve ser `false`)

---

## 8. Regras de boundary

- não introduzir scheduler distribuído
- não introduzir remote execution foundation
- não introduzir session federation
- não reescrever `run` inteiro por runtime
- não tratar headless como “qualquer automação vale”

---

## 9. Test plan

### 9.1 Unit

- contract valida `capabilities.headless`
- runtimes suportados implementam `prepareHeadlessRunContext`
- runtimes não suportados retornam erro explícito

### 9.2 Integração

- `mah explain run --headless --trace` funciona para cada runtime suportado
- `mah run --headless` retorna envelope estável
- output e status são capturados de forma previsível

### 9.3 Não-regressão

- `mah run` interativo continua igual
- `mah explain run` sem `--headless` continua igual
- `use/clear/list:crews/sessions` não regressam

---

## 10. Execução por slice

### Slice 0 — Discovery real por runtime

**Entrega**
- matriz real de suporte headless
- semântica de prompt/output por runtime

**Gate**
- nenhum runtime entra como suportado sem evidência

### Slice 1 — Contrato e capability

**Entrega**
- extensão do `RuntimeAdapter`
- validação no contract test

**Gate**
- adapters quebrados falham cedo

### Slice 2 — Core CLI

**Entrega**
- `mah run --headless`
- `mah explain run --headless`

**Gate**
- envelope canônico estável

### Slice 3 — Implementação por runtime

**Entrega**
- codex
- pi
- claude
- opencode
- hermes (suporte ou unsupported explícito)

**Gate**
- nenhum runtime usa fallback opaco

### Slice 4 — Testes e docs

**Entrega**
- suíte dedicada
- documentação operacional

**Gate**
- fluxo automatizado reproduzível

---

## 11. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Fingir paridade onde não existe | alto | capability explícita + unsupported honesto |
| Quebrar `run` interativo | alto | caminho headless separado |
| Misturar sessão e headless cedo demais | alto | contrato minimalista focado em execução |
| Captura de output inconsistente | médio | envelope canônico e testes por runtime |

---

## 12. O que NÃO entra em v0.6.0

- execução remota
- fleet scheduling
- retries orquestrados
- policy engine
- replay de transcript como session migration
- multiplexação multi-runtime na mesma execução

---

## 13. Critério de sucesso

Ao final:

- existe contrato headless único do MAH
- ao menos os runtimes com suporte real conseguem executar `--headless`
- os runtimes sem suporte falham com erro claro
- `explain run --headless --trace` é suficiente para depuração operacional
- o modo interativo não regressa
