---
name: secretctl
description: Uso seguro de segredos para agentes autônomos com secretctl, com fluxo suportado para ambientes com MCP e sem MCP.
---
# secretctl — uso essencial
## Objetivo
- Usar segredos sem expor valores em conversa, logs ou saída de comando.
- Em execução automatizada de agente, usar apenas `run` como canal operacional.
## Fluxo sem MCP (obrigatório para agentes shell-first)
- Sempre executar via wrapper protegido:
```bash
export SECRETCTL_WRAPPER_SHA256="bfc159eb383a810218e89268de25fe288d6ecea30b50faf84ffaab759d2cce5c"
SECRETCTL_PASSWORD="$(pass show secretctl/master-password)" \
  python3 "${HOME}/.secretctl/wrapper_secretctl.py" run -k OPENROUTER_API_KEY -- \
  curl -s -H "Authorization: Bearer {{OPENROUTER_API_KEY}}" \
  https://openrouter.ai/api/v1/models
```
- Manter bloqueio local para impedir `secretctl get|list|delete`.
## Fluxo com MCP
- Subir integração MCP do secretctl:
```bash
SECRETCTL_PASSWORD="$(pass show secretctl/master-password)" \
  secretctl mcp-server
```
- Mesmo com MCP, manter wrapper para qualquer execução local fora da superfície MCP.
## Regras mínimas de segurança
- Nunca usar `secretctl get` em execução de agente.
- Nunca usar `secretctl delete` em execução de agente.
- Manter `~/.secretctl/mcp-policy.yaml` com `default_action: deny`.
- Manter wrapper com integridade (`SECRETCTL_WRAPPER_SHA256`) e permissão restrita.
## Referência técnica
- Todos os detalhes técnicos, hardening, troubleshooting e smoke tests estão em `README.md` neste mesmo diretório.
