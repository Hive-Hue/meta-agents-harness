# Walkthrough E2E — Landing Page MAH com Context Memory + Expertise Evolution

## Objetivo

Demonstrar um ciclo completo de produto usando o MAH: da spec à landing page publicada, mostrando como **Expertise Catalog**, **Context Memory**, **Evidence** e **ClickUp MCP** evoluem organicamente à medida que o projeto avança.

## Aplicação Concreta

Construir a **landing page do Meta Agents Harness** — de spec a deploy — usando:
- **ClickUp MCP** para backlog/KANBAN
- **Google Stitch MCP** para design system e telas
- **Zeplin MCP** para handoff de design
- **Crew dev** existente (10 agentes)

---

## Estado Inicial — Reset de Expertise

### Premissa

Os agentes da crew `dev` já possuem expertise models preenchidos com o histórico do v0.8.0. Para este walkthrough, simulamos o estado **resetado** — expertise vazia — que vai sendo construída com a elaboração do projeto.

### Arquivos de Expertise (estado resetado)

Cada agente começa com o YAML mínimo:

```yaml
# .pi/crew/dev/expertise/<agent>-expertise-model.yaml
agent:
  name: "<agent-id>"
  role: "<role>"
  team: "<Team>"
meta:
  version: "1"
  max_lines: "120"
  last_updated: "2026-04-19T00:00:00.000Z"
patterns: []
risks: []
tools: []
workflows: []
decisions: []
lessons: []
observations: []
open_questions: []
```

### Agentes envolvidos no projeto LP

| Agente | Role | Time | Responsabilidade no LP |
|---|---|---|---|
| orchestrator | orchestrator | orchestration | Coordena escopo, delega para leads |
| planning-lead | lead | planning | Cria spec, backlog, milestones no ClickUp |
| solution-architect | worker | planning | Arquiteta solução técnica (framework, hosting) |
| repo-analyst | worker | planning | Mapeia assets existentes, dependências |
| engineering-lead | lead | engineering | Coordena implementação, split de PRs |
| backend-dev | worker | engineering | Cria design system via Stitch MCP, scaffolding |
| frontend-dev | worker | engineering | Implementa LP (componentes, páginas, deploy) |
| validation-lead | lead | validation | Define quality gates, aceita release |
| qa-reviewer | worker | validation | Testa responsividade, acessibilidade, performance |
| security-reviewer | worker | validation | Valida headers, CSP, SRI, secrets |

---

## Infraestrutura — MCPs e ClickUp

### .mcp.json (adicionar Stitch)

```json
{
  "mcpServers": {
    "stitch": {
      "url": "https://stitch.googleapis.com/mcp",
      "type": "http",
      "headers": {
        "Accept": "application/json",
        "X-Goog-Api-Key": "${STITCH_API_KEY}"
      }
    },
    "clickup": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.clickup.com/mcp"],
      "timeout_ms": 30000
    },
    "zeplin": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@zeplin/mcp-server@latest"],
      "env": { "ZEPLIN_ACCESS_TOKEN": "${ZEPLIN_ACCESS_TOKEN}" },
      "timeout_ms": 60000
    }
  }
}
```

### ClickUp — Workspace State

```
Workspace: 90133029534
  Space: GERAL - Espaço da equipe (901313186586)
    Folder: Meta Agents Harness (901317990134)
      (vazio — será populado pelo planning-lead via MCP)
```

---

## Fase 0 — Bootstrap do Projeto

### Ação do Operador

```bash
# Iniciar sessão com a crew dev
mah run --crew dev --with-context-memory

# Ou com runtime específico
mah run --crew dev --runtime opencode --with-context-memory --context-limit 5
```

### O que acontece internamente

1. `mah context find --agent orchestrator --task "landing page project bootstrap"`
2. Corpus vazio → nenhum match → retrieval silencioso, fallback limpo
3. Orchestrator recebe a missão com zero contexto prévio de Context Memory
4. Expertise model vazio → decisões baseadas puramente no prompt do agente

### Expertise Evolução — Fase 0

```yaml
# orchestrator-expertise-model.yaml (após Fase 0)
patterns:
  - date: "2026-04-19"
    note: "LP project bootstrap — crew dev tem 10 agentes. Delegar spec→planning-lead, design→engineering-lead(backend-dev com Stitch), impl→frontend-dev, QA→validation-lead. ClickUp folder 901317990134 está vazio."
decisions:
  - date: "2026-04-19"
    note: "LP usa Vite+React (não Next) para simplicidade de deploy em GitHub Pages ou Cloudflare Pages. Sem SSR necessário para LP estática."
```

```yaml
# planning-lead-expertise-model.yaml (após Fase 0)
patterns:
  - date: "2026-04-19"
    note: "ClickUp folder MAH (901317990134) está vazio — criar listas LP-Backlog, LP-Design, LP-Implementation, LP-QA via MCP antes de popular backlog."
workflows:
  - date: "2026-04-19"
    note: "Backlog LP flow: criar list no ClickUp folder → criar milestones → criar tasks por milestone → atribuir agents por task → monitorar via KANBAN view"
```

---

## Fase 1 — Spec + Backlog (planning-lead)

### Delegação

```
orchestrator → planning-lead:
  "Crie a spec da landing page do MAH. Popule o backlog no ClickUp
   folder 901317990134. Use ClickUp MCP diretamente."
```

### Ações do planning-lead

#### 1.1 — Criar estrutura no ClickUp via MCP

```bash
# Internamente o planning-lead usa ClickUp MCP:
clickup_create_list_in_folder(folder_id="901317990134", name="LP - Backlog")
clickup_create_list_in_folder(folder_id="901317990134", name="LP - Design")
clickup_create_list_in_folder(folder_id="901317990134", name="LP - Implementation")
clickup_create_list_in_folder(folder_id="901317990134", name="LP - QA")
```

#### 1.2 — Criar milestones e tasks

```bash
# Milestone M1: Design System
clickup_create_task(list_id="<LP-Backlog>", name="M1: Definir design system da LP",
  status="open", priority="high", assignees=["backend-dev"])

# Milestone M2: Implementação
clickup_create_task(list_id="<LP-Backlog>", name="M2: Scaffold projeto Vite+React",
  status="open", assignees=["frontend-dev"])

clickup_create_task(list_id="<LP-Backlog>", name="M2: Implementar Hero section",
  status="open", assignees=["frontend-dev"])

clickup_create_task(list_id="<LP-Backlog>", name="M2: Implementar Features section",
  status="open", assignees=["frontend-dev"])

clickup_create_task(list_id="<LP-Backlog>", name="M2: Implementar Footer + CTA",
  status="open", assignees=["frontend-dev"])

# Milestone M3: QA + Deploy
clickup_create_task(list_id="<LP-Backlog>", name="M3: Testes de responsividade e a11y",
  status="open", assignees=["qa-reviewer"])

clickup_create_task(list_id="<LP-Backlog>", name="M3: Security review (headers, CSP)",
  status="open", assignees=["security-reviewer"])

clickup_create_task(list_id="<LP-Backlog>", name="M3: Deploy para staging",
  status="open", assignees=["frontend-dev"])
```

#### 1.3 — Criar dependências

```bash
clickup_add_task_dependency(task_id="<M2-hero>", depends_on="<M1-design>", type="waiting_on")
clickup_add_task_dependency(task_id="<M3-qa>", depends_on="<M2-implementacao>", type="waiting_on")
```

#### 1.4 — Escrever spec em specs/lp-spec.md

O planning-lead delega a escrita da spec ao solution-architect:

```
planning-lead → solution-architect:
  "Escreva specs/lp-spec.md com a spec completa da LP do MAH.
   Framework: Vite+React+Tailwind. Deploy: Cloudflare Pages.
   Seções: Hero, Features, Architecture Diagram, CTA, Footer."
```

### Evidence gerada (automática)

```bash
mah expertise evidence --agent planning-lead --type workflow \
  --note "Created LP backlog structure in ClickUp folder 901317990134: 4 lists (Backlog, Design, Implementation, QA), 8 tasks across 3 milestones with dependency chain M1→M2→M3"
```

### Expertise Evolução — Fase 1

```yaml
# planning-lead (incremental)
patterns:
  - date: "2026-04-19"
    note: "LP spec+backlog pattern: criar 4 lists (Backlog/Design/Impl/QA) no ClickUp folder → milestones como tasks de prioridade alta → tasks filhas com assignees → dependências M1→M2→M3"
lessons:
  - date: "2026-04-19"
    note: "ClickUp MCP clickup_create_list_in_folder requer folder_id numérico, não nome. Usar clickup_get_folder para resolver nome→ID antes de criar."
workflows:
  - date: "2026-04-19"
    note: "Spec→Backlog: (1) solution-architect escreve spec em specs/ (2) planning-lead cria lists no ClickUp folder (3) cria milestones (4) cria tasks por milestone (5) seta dependências (6) delega primeiro milestone"
```

```yaml
# solution-architect (incremental)
decisions:
  - date: "2026-04-19"
    note: "LP tech stack: Vite+React+Tailwind+TypeScript. Justificativa: deploy estático em Cloudflare Pages, sem SSR, bundle mínimo, HMR rápido para iteração de design."
patterns:
  - date: "2026-04-19"
    note: "Spec de LP: seções canônicas — Hero (headline+CTA), Features (3-4 cards), Architecture (diagrama mermaid ou imagem), How It Works (timeline), CTA (form ou link), Footer (links+license)"
```

---

## Fase 2 — Design System via Google Stitch (backend-dev)

### Delegação

```
engineering-lead → backend-dev:
  "Crie o design system da LP usando Google Stitch MCP.
   Exporte tokens e componentes para Zeplin para handoff.
   O design system deve cobrir: cores, tipografia, espaçamento,
   componentes (Button, Card, Section, Hero, Footer).
   Framework target: Tailwind CSS."
```

### Ações do backend-dev

#### 2.1 — Context Memory Retrieval (primeira vez com corpus populado)

```bash
mah context find --agent backend-dev --task "create design system for landing page with stitch mcp and tailwind"
```

Resultado: nenhum match (corpus ainda vazio para esta capability).

#### 2.2 — Usar Stitch MCP para gerar design

```
# backend-dev invoca Stitch MCP:
stitch.generate_design({
  prompt: "Landing page design system for Meta Agents Harness — 
           an open-source multi-agent orchestration layer. 
           Dark theme, professional, developer-focused. 
           Components: Hero, Feature Cards, Architecture Diagram, 
           Call-to-Action, Footer. Style: clean, minimal, 
           monospace accents for code references.",
  format: "design_tokens",
  framework: "tailwind"
})
```

#### 2.3 — Exportar para Zeplin

```
# backend-dev usa Zeplin MCP para handoff:
zeplin.create_project(name: "MAH Landing Page")
zeplin.push_design_tokens(project_id, tokens_from_stitch)
zeplin.push_components(project_id, components_from_stitch)
```

#### 2.4 — Gerar tailwind.config.js + design tokens

O backend-dev cria:

```
lp/
  design-system/
    tailwind.config.js    # Extende tema com tokens do Stitch
    tokens.json           # Design tokens canônicos (source of truth)
    components/
      Button.tsx
      Card.tsx
      Section.tsx
      Hero.tsx
      Footer.tsx
```

### Evidence gerada

```bash
mah expertise evidence --agent backend-dev --type pattern \
  --note "Stitch MCP generate_design retorna tokens + componentes. Para exportar Zeplin: push_design_tokens depois push_components. Tokens são source-of-truth para tailwind.config.js extend."
```

### Expertise Evolução — Fase 2

```yaml
# backend-dev (após Fase 2)
patterns:
  - date: "2026-04-19"
    note: "Stitch→Zeplin flow: stitch.generate_design(prompt, format='design_tokens') → extrair tokens → zeplin.push_design_tokens → zeplin.push_components. Tokens são JSON canônico que alimenta tailwind.config.js extend."
tools:
  - date: "2026-04-19"
    note: "Stitch MCP é HTTP (não stdio) — url https://stitch.googleapis.com/mcp. Requer X-Goog-Api-Key no header. Response é JSON com design_tokens e components."
  - date: "2026-04-19"
    note: "Zeplin MCP é stdio via npx @zeplin/mcp-server. Ferramentas: get_screen, get_component, get_design_tokens, download_layer_asset. Read-only — push requer API direta ou Stitch export."
lessons:
  - date: "2026-04-19"
    note: "Stitch gera tokens em formato anêmico (cores como hex simples). Converter para Tailwind com naming semântico (primary, secondary, accent, surface, etc.) antes de commit."
decisions:
  - date: "2026-04-19"
    note: "Design system do MAH LP: dark theme, primary=#6366f1 (indigo), accent=#22d3ee (cyan), surface=#0f172a (slate-900). Monospace: JetBrains Mono."
```

### Context Memory — Primeiro documento operacional

O backend-dev (ou orchestrator) cria o primeiro documento operacional do corpus:

```markdown
<!-- .mah/context/operational/dev/backend-dev/design-system/stitch-zeplin-tailwind.md -->
---
id: dev/backend-dev/design-system/stitch-zeplin-tailwind
kind: operational-memory
crew: dev
agent: backend-dev
capabilities:
  - design-system-creation
  - design-token-management
domains:
  - design
  - frontend
systems:
  - stitch
  - zeplin
tools:
  - mcp_call
task_patterns:
  - "create design system"
  - "generate design tokens"
  - "export design to zeplin"
priority: high
stability: curated
source_type: human-authored
last_reviewed_at: "2026-04-19"
refs:
  - lp/design-system/tokens.json
---

# Design System via Stitch + Zeplin + Tailwind

## Fluxo Canônico

1. Gerar design via Stitch MCP: `stitch.generate_design(prompt, format='design_tokens')`
2. Converter tokens Stitch → Tailwind naming semântico
3. Exportar tokens para Zeplin: `zeplin.push_design_tokens(project_id, tokens)`
4. Exportar componentes: `zeplin.push_components(project_id, components)`
5. Gerar `tailwind.config.js` com extend baseado nos tokens

## Tokens do MAH LP

- primary: #6366f1 (indigo-500)
- accent: #22d3ee (cyan-400)
- surface: #0f172a (slate-900)
- text: #f8fafc (slate-50)
- monospace: JetBrains Mono

## Gotchas

- Stitch retorna cores como hex simples — mapear para nomes semânticos
- Zeplin MCP é read-only — push requer chamadas separadas ou export
- Tailwind requires `content` paths configurados para HMR no Vite
```

### Index rebuild

```bash
mah context index --rebuild
# Agora o retrieval encontra este documento para tasks de design system
```

---

## Fase 3 — Scaffold + Implementação (frontend-dev)

### Delegação

```
engineering-lead → frontend-dev:
  "Implemente a landing page do MAH seguindo a spec em specs/lp-spec.md
   e o design system em lp/design-system/. Framework: Vite+React+Tailwind.
   Deploy target: Cloudflare Pages."
```

### Ações do frontend-dev

#### 3.1 — Context Memory Retrieval (agora com corpus)

```bash
mah context find --agent frontend-dev --task "implement landing page with vite react tailwind" --capability design-system-creation
```

Resultado:
```json
{
  "matched_docs": [
    {
      "id": "dev/backend-dev/design-system/stitch-zeplin-tailwind",
      "score": 0.72,
      "reasons": ["task pattern overlap", "tailwind match", "design system match"]
    }
  ]
}
```

O frontend-dev recebe o documento operacional com tokens e gotchas antes de começar.

#### 3.2 — Scaffold do projeto

```bash
npm create vite@latest mah-lp -- --template react-ts
cd mah-lp
npm install -D tailwindcss @tailwindcss/vite
```

#### 3.3 — Implementar seções

```
mah-lp/
  src/
    components/
      Hero.tsx          # Headline + subheadline + CTA button
      FeatureCards.tsx   # 3-4 cards: Orchestration, Expertise, Context Memory, Runtime Agnostic
      Architecture.tsx   # Mermaid diagram ou imagem estática
      HowItWorks.tsx     # Timeline: Define→Route→Execute→Remember
      CTA.tsx            # GitHub link + "Get Started"
      Footer.tsx         # Links, license AGPL-3.0
    App.tsx
    main.tsx
  tailwind.config.js     # Importa tokens de lp/design-system/tokens.json
  vite.config.ts
```

#### 3.4 — Consultar Zeplin para fidelidade

```
# frontend-dev verifica design no Zeplin:
zeplin.get_screen(project_id="mah-lp", screen_name="Hero Section")
zeplin.get_design_tokens(project_id="mah-lp")
```

### Evidence gerada

```bash
mah expertise evidence --agent frontend-dev --type pattern \
  --note "LP scaffold: Vite+React+Tailwind+TypeScript. tailwind.config.js importa tokens de design-system/tokens.json. Deploy via wrangler pages deploy ./dist."
```

### Expertise Evolução — Fase 3

```yaml
# frontend-dev (após Fase 3)
patterns:
  - date: "2026-04-19"
    note: "LP Vite scaffold: npm create vite@latest mah-lp --template react-ts → instalar tailwindcss @tailwindcss/vite → importar tokens de design-system → criar componentes por seção da spec"
workflows:
  - date: "2026-04-19"
    note: "LP implementation: (1) mah context find para recuperar design system doc (2) scaffold Vite (3) config tailwind com tokens (4) implementar seções na ordem Hero→Features→Architecture→HowItWorks→CTA→Footer (5) verificar fidelidade via Zeplin get_screen"
lessons:
  - date: "2026-04-19"
    note: "Context Memory retrieval cruzou agente backend-dev para trazer doc de design system — o retrieval não filtra por agente quando capability_hint match é forte. Isso é comportamento correto (cross-agent knowledge sharing)."
tools:
  - date: "2026-04-19"
    note: "Cloudflare Pages deploy: wrangler pages deploy ./dist --project-name=mah-landing. Requer CLOUDFLARE_API_TOKEN. Branch principal faz deploy automático se conectado ao GitHub."
```

### Context Memory — Novos documentos

```markdown
<!-- .mah/context/operational/dev/frontend-dev/lp-implementation/vite-react-tailwind-lp.md -->
---
id: dev/frontend-dev/lp-implementation/vite-react-tailwind-lp
kind: operational-memory
crew: dev
agent: frontend-dev
capabilities:
  - lp-implementation
  - component-development
domains:
  - frontend
  - landing-page
systems:
  - cloudflare-pages
tools:
  - npm
  - vite
task_patterns:
  - "implement landing page"
  - "scaffold vite react"
  - "deploy cloudflare pages"
priority: high
stability: curated
source_type: human-authored
last_reviewed_at: "2026-04-19"
refs:
  - specs/lp-spec.md
  - lp/design-system/tokens.json
---

# Vite+React+Tailwind LP Implementation

## Scaffold

```bash
npm create vite@latest mah-lp -- --template react-ts
npm install -D tailwindcss @tailwindcss/vite
```

## Seções canônicas (ordem)

1. Hero — headline + subheadline + CTA
2. FeatureCards — 3-4 cards com ícones
3. Architecture — diagram or image
4. HowItWorks — 4-step timeline
5. CTA — GitHub link + getting started
6. Footer — links + license

## Deploy

```bash
wrangler pages deploy ./dist --project-name=mah-landing
```

## Gotchas

- tailwind.config.js content paths devem incluir src/** e lp/design-system/**
- Cloudflare Pages requer CLOUDFLARE_API_TOKEN
- Assets estáticos (imagens, diagramas) em public/
```

---

## Fase 4 — QA + Security Review

### Delegação

```
validation-lead → qa-reviewer:
  "Teste a LP em staging: responsividade (mobile/tablet/desktop),
   acessibilidade (Lighthouse a11y score ≥ 90), performance
   (Lighthouse perf score ≥ 85), cross-browser (Chrome, Firefox, Safari)."

validation-lead → security-reviewer:
  "Security review da LP: headers HTTP (CSP, HSTS, X-Frame-Options),
   SRI para CDN assets, sem secrets no bundle, CSP permite apenas
   domínios necessários."
```

### Ações do qa-reviewer

```bash
# Lighthouse CI
npx lighthouse http://localhost:4173 --output=json --chrome-flags="--headless"
```

### Ações do security-reviewer

```
# Verificar headers
curl -I https://mah-lp.pages.dev

# Verificar secrets no bundle
grep -r "api_key\|secret\|token" ./dist/
```

### Evidence e Expertise — Fase 4

```yaml
# qa-reviewer
patterns:
  - date: "2026-04-19"
    note: "LP QA checklist: Lighthouse a11y≥90, perf≥85, mobile 375px ok, tablet 768px ok, desktop 1440px ok. Testar CTA links, form submits, asset loading."
workflows:
  - date: "2026-04-19"
    note: "LP QA flow: (1) build staging (2) lighthouse --headless (3) verificar responsive no Chrome DevTools (4) testar todos os links (5) verificar a11y (aria labels, contrast, alt text) (6) reportar resultados via ClickUp MCP comment"
```

```yaml
# security-reviewer
patterns:
  - date: "2026-04-19"
    note: "LP security checklist: CSP header permite self+fonts.googleapis+cdn.jsdelivr.net, HSTS max-age≥31536000, X-Frame-Options DENY, sem secrets no dist/, SRI para CDN scripts"
decisions:
  - date: "2026-04-19"
    note: "LP CSP: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:"
```

### Context Memory — QA docs

```markdown
<!-- .mah/context/operational/dev/qa-reviewer/lp-quality/lp-qa-checklist.md -->
---
id: dev/qa-reviewer/lp-quality/lp-qa-checklist
kind: operational-memory
crew: dev
agent: qa-reviewer
capabilities:
  - lp-testing
  - accessibility-testing
domains:
  - quality-assurance
  - landing-page
systems:
  - cloudflare-pages
tools:
  - lighthouse
task_patterns:
  - "test landing page"
  - "accessibility audit"
  - "performance audit"
priority: high
stability: curated
source_type: human-authored
last_reviewed_at: "2026-04-19"
---

# LP QA Checklist

## Lighthouse Targets
- Performance: ≥ 85
- Accessibility: ≥ 90
- Best Practices: ≥ 90
- SEO: ≥ 80

## Responsive Breakpoints
- Mobile: 375px
- Tablet: 768px
- Desktop: 1440px

## A11y
- All images have alt text
- Color contrast ≥ 4.5:1
- Aria labels on interactive elements
- Keyboard navigable
```

---

## Fase 5 — Deploy + Proposal Flow

### Deploy final

```
engineering-lead → frontend-dev:
  "Deploy da LP para produção. Use wrangler pages deploy.
   Atualize task no ClickUp para Done."
```

### Atualizar ClickUp

```bash
# Mover tasks para Done via MCP
clickup_update_task(task_id="<M1-design>", status="done")
clickup_update_task(task_id="<M2-hero>", status="done")
clickup_update_task(task_id="<M2-features>", status="done")
clickup_update_task(task_id="<M3-deploy>", status="done")
```

### Proposal Flow — Derivar memória da sessão

```bash
# Gerar proposta de memória a partir da sessão
mah context propose --from-session opencode:dev:lp-project-session-001
```

Isso cria `.mah/context/proposals/2026-04-19-lp-project-learnings.md`:

```markdown
---
id: proposal/2026-04-19-lp-project-learnings
kind: operational-memory
stability: draft
source_type: session-derived
source_session: opencode:dev:lp-project-session-001
crew: dev
agent: orchestrator
capabilities:
  - project-coordination
  - landing-page-delivery
domains:
  - project-management
  - landing-page
systems:
  - clickup
  - stitch
  - zeplin
  - cloudflare-pages
task_patterns:
  - "deliver landing page project"
priority: medium
---

# LP Project Learnings (Proposta)

## Timeline real
- Fase 0→1 (spec+backlog): ~30min
- Fase 2 (design system): ~45min
- Fase 3 (implementação): ~90min
- Fase 4 (QA+security): ~30min
- Fase 5 (deploy): ~15min

## Fluxo que funcionou
orchestrator → planning-lead (spec+backlog ClickUp)
             → engineering-lead → backend-dev (Stitch design system)
                                → frontend-dev (implementação)
             → validation-lead → qa-reviewer + security-reviewer

## Lições para próximo projeto LP
- Criar ClickUp lists antes de tasks
- Design system doc no Context Memory antes de implementação
- QA reviewer deve ter Context Memory de testes anteriores
- Stitch MCP retorna tokens flat — normalizar para Tailwind
```

### Revisão e promoção

O operador revisa a proposta e decide:

```bash
# Se aprovado — mover para corpus curado
mv .mah/context/proposals/2026-04-19-lp-project-learnings.md \
   .mah/context/operational/dev/orchestrator/project-delivery/lp-project-pattern.md

# Atualizar stability
# Editar frontmatter: stability: draft → stability: curated

# Rebuild index
mah context index --rebuild
```

---

## Estado Final — Expertise Evoluída

### Comparação: Antes → Depois

| Agente | Antes (Fase 0) | Depois (Fase 5) |
|---|---|---|
| orchestrator | vazio | 2 patterns, 1 decision — coordenação de LP |
| planning-lead | vazio | 2 patterns, 1 workflow, 1 lesson — ClickUp backlog flow |
| solution-architect | vazio | 1 decision, 1 pattern — spec de LP, tech stack |
| engineering-lead | vazio | 1 workflow — coordenação cross-team design→impl |
| backend-dev | vazio | 2 patterns, 2 tools, 1 lesson, 1 decision — Stitch+Zeplin+Tailwind |
| frontend-dev | vazio | 1 pattern, 1 workflow, 1 lesson, 1 tool — Vite+React+Cloudflare |
| qa-reviewer | vazio | 1 pattern, 1 workflow — LP QA checklist |
| security-reviewer | vazio | 1 pattern, 1 decision — LP security headers |

### Context Memory — Corpus Final

```
.mah/context/operational/
  dev/
    orchestrator/
      project-delivery/
        lp-project-pattern.md              # Fluxo canônico de entrega de LP
    planning-lead/
      backlog-planning/
        clickup-backlog-triage.md          # (existente do v0.8.0)
      lp-backlog/
        clickup-lp-backlog-creation.md     # ClickUp folder→lists→tasks flow
    backend-dev/
      design-system/
        stitch-zeplin-tailwind.md          # Stitch→Zeplin→Tailwind tokens flow
    frontend-dev/
      lp-implementation/
        vite-react-tailwind-lp.md          # Scaffold + seções + deploy
    qa-reviewer/
      lp-quality/
        lp-qa-checklist.md                 # Lighthouse + responsive + a11y
    security-reviewer/
      lp-security/
        lp-security-headers.md             # CSP + HSTS + SRI checklist

.mah/context/proposals/
  2026-04-19-lp-project-learnings.md       # (aprovado → promovido para corpus)
```

### Expertise Registry — Confidence Evolution

```json
{
  "dev:backend-dev": {
    "confidence": { "score": 0.82, "band": "high" },
    "capabilities": [
      "persistence", "routing-engine", "mcp-integration", "evidence-pipeline",
      "design-system-creation", "design-token-management"
    ],
    "domains": [
      "software-engineering", "backend-systems", "design", "frontend"
    ]
  },
  "dev:frontend-dev": {
    "confidence": { "score": 0.72, "band": "high" },
    "capabilities": [
      "cli-ux", "explainability-output", "operator-surface", "output-formatting",
      "lp-implementation", "component-development"
    ],
    "domains": [
      "software-engineering", "cli", "frontend", "landing-page"
    ]
  }
}
```

---

## Retrospectiva — O que o MAH proveu

### Sem Context Memory (estado anterior)

- Agentes começam cada sessão sem memória operacional
- backend-dev precisa redescobrir como usar Stitch MCP
- frontend-dev não tem playbook de implementação
- qa-reviewer improvisa checklist a cada projeto
- Nenhum rastro de "como fizemos da última vez"

### Com Context Memory (estado atual)

- `mah context find` retorna playbooks curados antes da execução
- Expertise evolui organicamente com evidence + proposals
- ClickUp MCP é o sistema de registro para backlog e progresso
- Stitch MCP é a ponte design→código com tokens exportáveis
- Zeplin MCP é o canal de handoff e verificação de fidelidade
- Proposal flow captura aprendizados da sessão para revisão e promoção

### O ciclo virtuoso

```
Sessão 1 (LP MAH)
  ↓ expertise evolves
  ↓ context memory populated
  ↓ evidence recorded
Sessão 2 (LP outro projeto, ou feature da LP)
  ↓ mah context find → recupera playbooks
  ↓ execução mais rápida e consistente
  ↓ nova expertise evolui sobre a base existente
  ↓ nova evidence alimenta o catálogo
```

---

## Comandos de Verificação Final

```bash
# Verificar expertise registry
mah expertise list --json

# Verificar contexto operacional
mah context list --json

# Verificar retrieval funciona
mah context find --agent backend-dev --task "create design system with stitch"
mah context find --agent frontend-dev --task "implement landing page with vite"
mah context find --agent qa-reviewer --task "test landing page accessibility"

# Verificar explainability
mah context explain --agent backend-dev --task "create design system with stitch"

# Verificar ClickUp está populado
# (via MCP: clickup_filter_tasks com folder_id=901317990134)

# Verificar proposals
mah context list --path .mah/context/proposals/

# Rebuild final
mah context index --rebuild
```
