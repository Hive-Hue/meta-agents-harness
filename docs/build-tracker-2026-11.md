# MAH — Build tracker

Atualizado: 2026-11-05. Plano: [execution-plan-2026-11.md](execution-plan-2026-11.md).

Estados: pending → implementing → review → verified; partial indica aceite ainda incompleto. `verified` é limitado ao escopo descrito; testes com mocks não validam integração gráfica real.

| ID | Entrega | Responsável | Estado | Evidência / pendência |
|---|---|---|---|---|
| B01 | Autenticação WebUI | Sol medium + coordenador | verified | Defaults recusados, TTL, origem, limite de login, JSON inválido e exec desabilitado; testes HTTP |
| B02 | Runs persistentes/cancelamento | Sol medium + coordenador | verified | 15 min simulados, restart → interrupted, cancelamento; ID restaurado ao recarregar painel |
| B03 | Lifecycle tasks | Sol medium / execution_reliability | verified | Running antes do spawn; review/failed depois; dependências; sessão exata; task HTTP assíncrona |
| B04 | Escritas concorrentes | Sol medium + coordenador | verified | 60 criações concorrentes e 6 recuperadores de lock morto sem perda; escrita atômica por arquivo |
| B05 | Memória workspace | Luna max / memory_evidence | verified | Dois corpora isolados, sem fallback à instalação; callsites atualizados |
| B06 | Qualidade de evidência | Luna max / memory_evidence | verified | Review desconhecido sem avaliação atribuída; avaliações aprovadas/reprovadas e rejection count preservados |
| B07 | Delegação limitada/cancelável | Sol medium + coordenador | verified | MCP propaga AbortSignal; deadline, cancelamento, output cap e cancelamento anterior ao spawn |
| B08 | Backend/config produção | Sol medium + coordenador | verified | API extraída; build standalone Node; config TS única; smoke HTTP real do bundle |
| B09 | CI regressões | Coordenador | verified local | Workflow main/development, npm ci, matriz Win/Linux e build/smoke WebUI; execução remota ainda não realizada |
| B10 | MCP modalidades/bindings | Coordenador | verified | Imagens/resource refs/erros preservados; binding vazio PI não amplia acesso |
| B11 | Broker desktop | Sol medium + coordenador | verified em fixtures | Allowlist e modo explícito `allow_all_apps`; schemas restritos; `desktop_drag` exige canvas identificado em snapshot, endpoints limitados ao bounds/distância e refs consumidas; lease global, revogação, pause, deadline e shutdown. Não é sandbox. |
| B12 | CLI computer | Coordenador | verified | init/doctor/mcp/pause/resume; help pela CLI MAH; bootstrap sem overwrite e pin de versão |
| B13 | PoC Windows real | Coordenador | partial | Pi 1.5.0 via `mah --runtime pi run --headless`; driver 1.2.0. Notepad confirmou `desktop_set_value` + snapshot. Paint MSIX abriu pelo caminho de execução registrado; cinco arrastos para telhado e paredes passaram como `delivered_unverified`, com snapshot antes de cada traço. O app ficou aberto e nada foi salvo; a árvore de acessibilidade não confirma pixels, então falta verificação visual e ainda não há teste de clique em GUI descartável. |
| B14 | Ambiente persistente isolado | Não despachado | pending | Depende B13; implantação |
| B15 | Scheduler/responsabilidades | Não despachado | pending | Depende B14 |

## Registro de execução

- Baseline audit: 61 testes existentes e dois typechecks aprovados; isso não comprova as correções novas.
- Agentes despachados nos modelos e esforços solicitados; nenhum arquivo alterado anteriormente pelo usuário deve ser revertido.
- Primeira suíte integrada: 92 testes, zero falhas (`node scripts/validation/run-audit-tests.mjs`), Windows / Node v24.22.1.
- Após ajustes finais de autenticação/cancelamento: 9 testes diretamente afetados passaram; dois typechecks WebUI passaram.
- Frontend Vite e API esbuild compilados; smoke do servidor standalone: 6 assertions HTTP aprovadas, sem runtime LLM.
- Build local precisou dos binários Windows de Rollup 4.60.2 e esbuild 0.27.7, instalados apenas em diretório temporário e usados por NODE_PATH/ESBUILD_BINARY_PATH. Nenhum lockfile foi alterado por essa validação. Bundle frontend avisa chunk de ~886 kB; code splitting permanece otimização futura.
- Driver real agent-desktop 1.2.0 em pasta temporária: checksum oficial conferido; MCP status retornou Windows e accessibility granted. Nenhum aplicativo pessoal editado.
- Validação Windows de runtimes (2026-11-05): Node v24.22.1 e Codex CLI 0.166.0-alpha.5.1 disponíveis; PI, Claude, OpenCode, Hermes e Kilo CLI ausentes. `codex mcp --help` funcionou sem iniciar modelo. Suítes de contratos/adaptadores/headless/plugins/MCP passaram (88/88) e `scripts/validation/run-audit-tests.mjs` passou (92/92). `tests/runtime-core-integration.test.mjs` encerrou o worker do Node com `3221226505` (`0xC0000409`), sem relatório de asserção; falha Windows permanece para diagnóstico. A repetição do doctor com o executável real foi bloqueada pela política de execução; o resultado anterior do probe permanece a evidência real do driver. Nenhum runtime de modelo ou ação GUI foi iniciado nesta rodada.
- Auditoria de dependências Windows: `npm audit` apontou 10 vulnerabilidades no grafo de produção. `npm audit fix` sem `--force` atualizou 14 pacotes e eliminou 9; os testes passaram novamente (92/92). Resta uma vulnerabilidade alta na dependência direta Zod 3; o npm indica atualização major para Zod 4, ainda não aplicada.
- Launcher Pi no Windows (2026-11-05): corrigida a detecção de executáveis via `where.exe` e a inicialização de shims `.cmd` com `cross-spawn`; conferido `mah --runtime pi run --help` contra Pi 1.5.0 e teste dedicado de shim aprovado. Suíte integrada Windows: 92/92. Isso valida a abertura do runtime, não a ação GUI do broker (B13 ainda parcial).
- Modelos e delegação Pi (2026-11-05): `meta-agents.yaml` agora seleciona `openai/gpt-6-luna` para orchestrator, leads, workers e QA no runtime Pi; as crews `dev` e `web-research-team` foram sincronizadas. O arquivo `meta-agents.yaml` é ignorado pelo Git, então essa seleção é local a este checkout. O launcher de delegação chama o `pi-launcher.js` pela instalação Windows; cópias em `~/.mah` conferidas por SHA-256. `--model` explícito continua prevalecendo. `sync --check`, validação do meta-config e quatro testes direcionados passaram. O diagnóstico `explain run` agora oculta os valores das variáveis de ambiente em trace e JSON. A chamada real de delegação pela sessão interativa ainda precisa ser repetida após reiniciar o Pi; B13 permanece parcial.
- Integração Pi/Agent Desktop (2026-11-05): broker registrado no MCP do projeto e vinculado ao runtime Pi. Política local limitada a `Notepad.exe`, com snapshot/status e ações apenas de clique e digitação. `mah computer doctor`, handshake MCP, `tools/list` e `desktop_status` passaram; snapshot e ação real pela sessão Pi ainda pendentes.
- Correções MCP do desktop (2026-11-05): schema de snapshot/launch enumera os nomes exatos da allowlist; erros informam nomes aceitos; chamadas sequenciais explicitadas; `desktop_launch` habilitado apenas para apps permitidos, sem args/env/cwd, com orçamento de ação e timeout próprio de 60 s. Validação por `mah computer doctor` PowerShell (Win32, agent-desktop 1.2.0, accessibility granted) e MCP real: launch permitido e snapshot `Notepad.exe` aprovado. Um segundo processo sem janela criado durante o teste foi encerrado; nenhum texto foi digitado. Suíte `tests/computer-broker.test.mjs`: 11/11; validação do meta-config aprovada. Pi interativo deve ser reiniciado para receber o schema novo.
- Teste real via `mah --runtime pi` (2026-11-05): primeira tentativa confirmou que `desktop_type` é recusado pelo driver Windows headless; o audit registrou duas recusas, sem texto inserido. A política passou a expor `desktop_set_value` e removeu `desktop_type` para este perfil. Nova sessão Pi chamou `desktop_set_value` e depois `desktop_snapshot`; ambas concluíram com `ok=true`, e o agente confirmou o texto no Notepad. Não houve edição do conteúdo existente segundo a verificação do agente. Suíte atual do broker: 12/12; `validate-meta-config` e `mah computer doctor` passaram.
- Teste real Paint/Computer Use (2026-11-05): broker local com `allow_all_apps:true` e `desktop_drag` headed. O basename `mspaint.exe` retornou `APP_NOT_FOUND`; o launcher do Paint empacotado foi encontrado via registro do Windows e aberto pelo alias absoluto usando `desktop_launch`. Snapshot completo não trazia `ref_id` no elemento Canvas; broker passou a expor `data.mah_canvases` com token derivado do snapshot apenas para elementos nomeados Canvas/superfície de desenho com bounds válidos. Pi então enviou cinco drags dentro do canvas (telhado, paredes e base; maior distância 500 px), renovando snapshot e token antes de cada um. Todos retornaram `delivered_unverified`; snapshot confirma janela, não os pixels desenhados. Paint permaneceu aberto e nenhum arquivo foi salvo. `tests/computer-broker.test.mjs`: 14/14; `node --check` dos dois módulos do broker passou.
- Os agentes Sol medium e Luna max foram realmente despachados e produziram alterações. Seus turnos posteriores atingiram limite de uso; o coordenador concluiu integração, revisão e verificações. Não houve commit, push ou deploy.

## Limites que ainda impedem declarar todo o roadmap concluído

1. B13: validar visualmente os traços do Paint e testar click/type em GUI descartável. O driver confirma entrega dos cinco drags (`delivered_unverified`), mas snapshots de acessibilidade não comprovam pixels ou persistência do desenho.
2. B14: não há VM provisionada, fronteira de segurança de OS, serviço de worker remoto autenticado nem reanexação automática a processos órfãos. Restart marca runs como interrupted; não presume término físico nem reexecuta efeitos.
3. B15: scheduler durável, gatilhos externos, quotas compartilhadas e responsabilidades contínuas ainda não implementados.
4. Paridade MCP de Codex/Hermes e headless top-level Codex permanecem lacunas de F11; os bindings e modalidades corrigidos são o subconjunto explicitamente testado.
5. A validação de contratos de runtime no Windows passou, mas PI/Claude/OpenCode/Hermes/Kilo não estão instalados nesta máquina; não houve teste de processo real nesses CLIs. `runtime-core-integration.test.mjs` termina com código nativo Windows `0xC0000409` sob o test runner e requer investigação.
6. Persistência YAML é protegida contra concorrência por operação/arquivo; alterações envolvendo tasks e missions não são uma transação ACID de múltiplos arquivos. SQLite/migração continua possível evolução.
7. Broker restringe ferramentas/argumentos e coordena uso local; shell do mesmo usuário pode contorná-lo. Não há review semântico de transações, aprovação humana assinada, preview remoto ou vault.
8. CI foi configurada e validada localmente; os jobs remotos só terão resultado após publicação autorizada.

## Arquivos de entrada

- Plano: [execution-plan-2026-11.md](execution-plan-2026-11.md)
- Operação do desktop: [computer-use.md](computer-use.md)
- Testes: `npm run test:audit`
- Build: `npm run build --prefix webui`; smoke: `node webui/server/smoke.mjs`
- Servidor: `mah webui --prod` ou, após build, `npm run start --prefix webui`
- Desktop: `mah computer init`, configurar pin/apps, `mah computer doctor`, `mah computer mcp`
