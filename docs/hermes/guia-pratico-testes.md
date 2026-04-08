# Guia Prático de Testes — Hermes Runtime

> Versão: v0.4.0 | Última atualização: 2026-04-05

Este guia explica como testar o suporte ao Hermes no Meta Agents Harness, desde a criação do diretório `.hermes/` até a execução de comandos.

---

## Sobre a pasta `.hermes/`

### Por que ela não existe ainda

A pasta `.hermes/` é o **marcador de runtime** do Hermes — é assim que o MAH detecta que o Hermes está disponível no repositório. Ela não é criada automaticamente porque:

1. O Hermes é um runtime opcional — nem todo projeto usa todos os runtimes
2. O MAH segue o princípio de não criar artefatos sem solicitação explícita
3. O repositório atual usa PI, Claude e OpenCode, mas não tinha Hermes até v0.4.0

### Como criar a pasta

Use o comando `mah init`:

```bash
# Inicializa o Hermes e define a crew "dev"
mah init --runtime hermes --crew dev
```

Isso cria a pasta `.hermes/` e copia arquivos base (se ausentes):

```
mah init completed
created=.hermes
skipped=meta-agents.yaml
skipped=.mcp.json
crew_hint=dev
next=mah use dev
next=npm run sync:meta
```

Você também pode forçar o Hermes sem criar o marcador, usando a flag `--runtime`:

```bash
mah --runtime hermes detect
```

### Estrutura esperada da pasta `.hermes/`

Após `mah init` e `npm run sync:meta`, a estrutura completa é:

```
.hermes/
├── crew/
│   └── dev/
│       ├── config.yaml              ← Configuração da crew no Hermes
│       ├── multi-team.yaml          ← Topologia da crew (projetada do meta-agents.yaml)
│       ├── agents/
│       │   ├── orchestrator.md      ← Prompt do agente orchestrator
│       │   ├── lead.md              ← Prompt do agente lead
│       │   └── implementer.md       ← Prompt do agente worker
│       ├── expertise/
│       │   ├── orchestrator-expertise-model.yaml
│       │   ├── lead-expertise-model.yaml
│       │   └── implementer-expertise-model.yaml
│       └── sessions/                ← Sessões de execução
│           └── <session-id>/
└── skills/
    └── <skill-name>/
        └── SKILL.md
```

> **Nota:** Apenas `.hermes/` é criada por `mah init`. Os arquivos internos são gerados por `npm run sync:meta` a partir do `meta-agents.yaml`.

---

## Como testar

### Status atual da implementação

O adapter Hermes já está implementado no código-base. Os testes smoke já incluem verificações para Hermes:

| O que funciona agora | O que requer Hermes instalado |
|---|---|
| Detecção forçada via `--runtime hermes` | Execução real de sessões (`mah run`) |
| Help text mostra Hermes | Execução de comandos do wrapper (`hermesh`) |
| Validação de contrato do adapter | Comandos delegados ao runtime Hermes |
| Explain com payload JSON | Diagnósticos do runtime nativo |

### Comandos básicos — teste sem Hermes instalado

Estes comandos funcionam **mesmo sem o Hermes instalado**, pois usam o adapter interno do MAH:

#### 1. Verificar que Hermes é detectado (forçado)

```bash
mah --runtime hermes detect
```

Saída esperada:
```
runtime=hermes
reason=forced
```

#### 2. Verificar que Hermes aparece no help

```bash
mah --help
```

Deve conter `hermes` na lista de runtimes disponíveis.

#### 3. Verificar detecção por marcador

```bash
# Criar o marcador (se não existir)
mah init --runtime hermes

# Detectar automaticamente
mah detect
```

Saída esperada:
```
runtime=hermes
reason=marker
```

#### 4. Explain com trace (JSON)

```bash
mah --runtime hermes explain detect --json
```

Saída esperada (formatado):
```json
{
  "schema": "mah.diagnostics.v1",
  "command": "explain",
  "ok": true,
  "status": 0,
  "runtime": "hermes",
  "reason": "forced",
  "data": {
    "target": "detect",
    "runtime": "hermes",
    "crew_context": null
  },
  "errors": []
}
```

#### 5. Explain de execução (plano de resolução)

```bash
mah --runtime hermes explain run --trace
```

Mostra como o MAH resolveria a execução no Hermes, incluindo warnings se houver limitações.

#### 6. Validar contrato do adapter

```bash
mah contract:runtime
```

Saída esperada:
```
runtime adapter contract passed
```

Isso valida que o adapter Hermes satisfaz todos os campos obrigatórios e comandos necessários.

### Comandos que requerem Hermes instalado

Estes comandos precisam do binário global `hermes` no PATH:

#### 7. Doctor (diagnóstico completo)

```bash
mah --runtime hermes doctor
```

O wrapper local existe no repo, mas a parte que executa `hermes doctor` ainda depende do binário global.

#### 8. Run (execução interativa)

```bash
mah --runtime hermes run
```

Requer Hermes instalado. Sem o binário, vai falhar com erro honesto:

```
Hermes CLI not found in PATH.
```

#### 9. Listar crews

```bash
mah --runtime hermes list:crews
```

Funciona só com o wrapper local `.hermes/bin/hermesh`, sem depender do binário global `hermes`.

#### 10. Selecionar crew

```bash
mah --runtime hermes use dev
```

Funciona só com o wrapper local `.hermes/bin/hermesh`.

### Usando variáveis de ambiente

Em vez de passar `--runtime hermes` toda vez, você pode definir a variável de ambiente:

```bash
# Forçar Hermes globalmente
MAH_RUNTIME=hermes mah detect
MAH_RUNTIME=hermes mah doctor
MAH_RUNTIME=hermes mah explain run --trace
```

### Testes automatizados

O MAH inclui testes smoke que cobrem Hermes:

```bash
# Rodar todos os smoke tests (inclui testes de Hermes)
npm run test:smoke

# Rodar apenas testes de contrato (valida adapter Hermes)
npm run test:contract
```

Os testes smoke atuais para Hermes verificam:

1. **Detecção forçada**: `mah --runtime hermes detect` retorna `runtime=hermes`
2. **Help text**: `mah --help` contém a string `hermes`
3. **Explain JSON**: `mah --runtime hermes explain detect --json` retorna payload com `runtime: "hermes"`
4. **Wrapper local**: `mah --runtime hermes list:crews` resolve crews via `.hermes/bin/hermesh`

---

## Resumo do que testar agora

### ✅ Pode testar agora (sem Hermes instalado)

```bash
mah --runtime hermes detect                    # Detecção forçada
mah --runtime hermes explain detect --json     # Explain com JSON
mah --runtime hermes explain run --trace       # Plano de execução
mah --runtime hermes list:crews                # Lista crews via wrapper local
mah --runtime hermes use dev                   # Seleciona crew via wrapper local
mah --runtime hermes clear                     # Limpa seleção via wrapper local
mah contract:runtime                           # Contrato do adapter
mah --help                                     # Help mostra Hermes
npm run test:smoke                             # Smoke tests
npm run test:contract                          # Contract tests
```

### ⚠️ Requer Hermes instalado (`hermes` no PATH)

```bash
mah --runtime hermes doctor                    # Diagnóstico completo
mah --runtime hermes run                       # Execução interativa
mah --runtime hermes validate:runtime          # Validação de runtime
```

### ❌ Não implementado (fora do escopo v0.4.0)

- Paridade completa com Hermes
- Execução remota multi-backend
- Federação / policy engine
- Ciclo de vida nativo do Hermes no MAH
