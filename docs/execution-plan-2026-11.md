# MAH — Execution plan

Data: 2026-11-05. Baseline: v0.9.0 / d1cfa6d, incluindo alterações locais pré-existentes preservadas.

## Objetivo e estratégia

Implementar os achados F01–F11 do audit e estabelecer computer use via agent-desktop. A entrega é incremental: correção de fundamentos, integração local supervisionada, depois operação contínua. Código escrito, teste automatizado e validação real são estados diferentes; o build tracker registra a evidência de cada um.

## Distribuição dos agentes

| Frente | Modelo / esforço | Ownership |
|---|---|---|
| Execução e persistência | GPT-6 Sol / medium | tasks store/CLI, handler de delegação, supervisor de subprocessos e testes |
| WebUI e segurança | GPT-6 Sol / medium | backend WebUI, autenticação, runs, configuração Vite, testes HTTP |
| Memória e evidência | GPT-6 Luna / max | context memory, assistant state, evidence pipeline/store e regressões |
| Integração e revisão | Agente coordenador | plano/tracker, computer broker, MCP bridge/registry, CLI central e CI |

Trabalho compartilhado no checkout, com arquivos exclusivos por frente. Não sobrescrever alterações anteriores; nenhum commit, publicação, instalação global ou chamada a modelos reais faz parte da validação automatizada. O coordenador integra mudanças transversais e revisa resultados antes de marcar concluído.

## Backlog e critérios de aceite

| ID | Audit | Entrega | Dependências | Aceite |
|---|---|---|---|---|
| B01 | F01 | Autenticação explícita, TTL servidor, limites e origem | — | Defaults conhecidos recusados; token expirado falha; endpoints privilegiados protegidos |
| B02 | F02 | Runs persistentes e cancelamento | B01 | >10 min visíveis; restart reconciliado; cancelamento do processo |
| B03 | F03 | Lifecycle de tasks e sessão exata | B04 | Running antes do spawn; terminal correto; dependências verificadas; dupla execução recusada |
| B04 | F04 | Escritas transacionais locais | — | Escritores concorrentes preservados; escrita atômica; locks recuperáveis |
| B05 | F05 | Memória por workspace explícito | — | Dois workspaces não compartilham corpus por engano |
| B06 | F06 | Review separado de sucesso de processo | — | Exit zero não gera aprovação; evidência verificável necessária |
| B07 | F08 | Subprocessos assíncronos limitados/canceláveis | — | Timeout e cancelamento terminam execução; output limitado |
| B08 | F09 | Backend de produção e config única | B01/B02 | Preview/produção servem API; sem ambiguidade JS/TS |
| B09 | F10 | CI regressões + WebUI | B01–B08 | Testes novos executados e build/typecheck cobrados |
| B10 | F11 | Conteúdo MCP multimodal e bindings | — | Imagem preservada; erro propagado; binding vazio não habilita tudo |
| B11 | F07/F11 | Broker desktop com política fail-closed | B10 | Subset explícito; apps limitados; serialização; auditoria sem conteúdo sensível |
| B12 | melhoria | CLI de diagnóstico e configuração computer | B11 | Nenhuma instalação implícita; status e capacidades claros |
| B13 | melhoria | PoC Windows interativa | B11/B12 | Um app alvo real observado e manipulado conforme política |
| B14 | melhoria | Desktop remoto isolado e supervisor contínuo | B02/B07/B13 | Recover após crash; isolamento de credenciais e estado |
| B15 | melhoria | Responsabilidades, scheduler e métricas | B14 | Wakeups duráveis/deduplicados, orçamento e notificações acionáveis |

## Sequência

1. B01–B08 e B10 em frentes independentes; contratos de computador em paralelo.
2. Integrar B09/B11/B12, executar regressões e documentar limitações.
3. B13 em sessão gráfica real: separar host Windows de WSL; exigir agent-desktop instalado na plataforma alvo e versão validada. Teste com aplicativo/arquivo descartável, sem dados pessoais.
4. B14/B15 exigem projeto de implantação e validação operacional; não confundir MCP local com sandbox, VM persistente ou agente sempre ativo.

## Gates de entrega

- G1: regressões determinísticas, nenhuma chamada paga, nenhuma alteração em dados reais.
- G2: typecheck/build frontend e smoke HTTP local com fixtures.
- G3: testes do broker com driver MCP fake: recusas, erros, concorrência e conteúdo multimodal.
- G4: teste real desktop por plataforma; não declarar compatibilidade end-to-end somente com mocks.
- G5: reinício/crash/cancelamento e isolamento em ambiente persistente antes de automações autônomas.

## Riscos e limites

Permissão de shell irrestrita pode contornar um broker: modo local confiável não equivale a enforcement de sandbox. Aprovação de ferramenta de clique não prova autorização semântica de uma transação. Conteúdo visto na UI não concede novas permissões. Diante de timeout após efeito externo, verificar estado em vez de repetir automaticamente. Custos não fornecidos pelo runtime permanecem desconhecidos.

## Validação e rollback

Cada frente adiciona regressões no ponto de comportamento. Alterações de estado devem manter formato legado legível ou apresentar migração explícita. Backup/rollback não deve apagar dados do usuário. Estado de execução recuperado após crash deve ser marcado interrupted/unknown, nunca success presumido. O tracker contém comandos, resultados e pendências de validação real.
