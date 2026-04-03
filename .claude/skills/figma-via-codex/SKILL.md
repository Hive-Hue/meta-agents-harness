---
name: figma-via-codex
description: Usa o Codex CLI como sidecar para acessar o MCP do Figma indiretamente quando o cliente atual nao suporta o MCP remoto do Figma.
---

# Figma via Codex

Use esta skill quando a tarefa depender de contexto do Figma e o runtime atual nao conseguir acessar o MCP remoto do Figma diretamente.

## Quando usar

- implementacao de UI baseada em URL do Figma
- extracao de metadados, layout, cores, copy ou screenshots do Figma
- validacao de design antes de delegar implementacao a outros agentes

## Regra principal

Nao tente conectar o Figma MCP no cliente nativo do Pi.

Em vez disso:

1. use o `codex` local como sidecar
2. deixe o `codex exec` acessar o MCP do Figma ja configurado em `~/.codex/config.toml`
3. extraia o contexto do Figma antes de implementar ou delegar

## Preflight

Antes de usar:

```bash
codex mcp list
```

O esperado e ver `figma` com `Status=enabled` e `Auth=OAuth`.

## Fluxo recomendado

1. Receba a URL do Figma do usuario.
2. Rode o helper:

```bash
bash .claude/skills/figma-via-codex/scripts/figma_codex_extract.sh "<FIGMA_URL>" "<OBJETIVO>"
```

3. Leia o arquivo de saida indicado pelo script.
4. Resuma para o usuario o que foi extraido.
5. Use esse contexto para implementar ou para passar a outro worker.

## Quando a extracao deve acontecer

Sempre antes de:

- spawn de subagente focado em frontend
- escrever codigo de UI
- revisar fidelidade visual

Isso evita delegar sem contexto de design.

## O que pedir ao Codex sidecar

O prompt do sidecar deve pedir explicitamente:

- uso das tools MCP do Figma disponiveis no ambiente do Codex
- leitura do node indicado pela URL
- resumo estruturado com layout, componentes, copy, cores, tipografia e observacoes

Se a tarefa pedir mais fidelidade visual, tambem solicitar screenshot ou design context.

## Fallback

Se `codex mcp list` nao mostrar `figma` habilitado:

- pare e reporte que o MCP do Figma nao esta autenticado no Codex CLI
- sugira `codex mcp login figma`

Se o Codex sidecar falhar mesmo autenticado:

- reporte erro com o comando usado
- siga com fallback por handoff textual, screenshot existente ou especificacao manual

## Referencia

- padrao observado no OpenClaw: `/home/ec2-user/workspace/TOOLS.md`
- o helper desta skill encapsula o `codex exec` em:
  - `.claude/skills/figma-via-codex/scripts/figma_codex_extract.sh`
