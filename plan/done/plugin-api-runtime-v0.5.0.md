# Plan — Plugin API para Runtimes (v0.5.0)

## Objetivo

Introduzir um mecanismo formal de plugins para runtimes externos, permitindo que operadores adicionem ou removam runtimes sem modificar o core do MAH. Preserva a retrocompatibilidade total com os runtimes existentes (pi, claude, opencode, hermes) e não introduz scope creep para v0.5.0.

---

## 1. Motivação

### Problema atual

Adicionar um novo runtime hoje exige editar 2 arquivos do core do MAH:
- `scripts/runtime/runtime-adapters.mjs` — adicionar `createAdapter({...})`
- `scripts/meta-agents-harness.mjs` — adicionar o runtime em `RUNTIME_ORDER`

**Problemas:**
- Cada update do MAH pode sobrescrever as customizações
- Fork permanente necessário para runtimes proprietários
- Sem uninstall path limpo — o que exatamente foi modificado?
- Runtimes internos de cada equipe não são compartilháveis

### Solução Plugin API

Runtimes são instalados como plugins em `mah-plugins/` ou carregados de `node_modules/@mah/runtime-*`. O core do MAH escaneia, valida versão, e registra automaticamente. Nada de core é editado.

---

## 2. Arquitetura

### 2.1 Plugin discovery

Dois pontos de carga para permitir flexibilidade máxima:

```
mah-plugins/                           # Local, operador-controlled
node_modules/@mah/runtime-*/           # npm-installed, team-shared
```

**Descoberta em duas fases:**
1. Carregar built-ins de `RUNTIME_ADAPTERS` (sem mudança — `runtime-adapters.mjs` continua existindo)
2. Escanear `mah-plugins/` e `node_modules/@mah/runtime-*`, validar e carregar plugins

**Nota de design:** `mah-plugins/` usa formato simples (plugin.json + index.mjs). `node_modules/@mah/runtime-*` usa package.json padrão para distribuição npm. Ambos convergem no mesmo plugin contract.

### 2.2 Plugin contract

O `runtimePlugin` é o contrato mínimo que todo plugin deve exportar:

```js
// mah-plugins/runtime-my-runtime/index.mjs
export const runtimePlugin = {
  // Identificação
  name: "my-runtime",              // [required] string único — usado emmah detect, --runtime
  version: "1.0.0",                // [required] semver do plugin
  mahVersion: "^0.4.0",            // [required] versão mínima do MAH (semver range)

  // O RuntimeAdapter — mesmo shape que built-ins usam hoje
  adapter: {                       // [required] o objeto adapter completo
    name: "my-runtime",
    markerDir: ".myruntime",
    wrapper: "myruntime-mh",
    directCli: "myruntime",
    capabilities: { ... },
    commands: { ... }
  },

  // Lifecycle (opcional)
  init(ctx) { },                    // chamado após loading bem-sucedido
  teardown() { }                   // chamado antes do MAH encerrar
}
```

### 2.3 Compatibilidade retroativa

Os 4 runtimes existentes (pi, claude, opencode, hermes) são built-ins e NÃO se tornam plugins — continuarão sendo carregados via `RUNTIME_ADAPTERS` estático em `runtime-adapters.mjs`.

```
RUNTIME_ADAPTERS (built-ins)     ← nunca alterados por plugins
     + discovered plugins        ← mah-plugins/ + node_modules/@mah/runtime-*
     = ALL_RUNTIMES
```

**Regras de prioridade:**
- Built-ins (`pi`, `claude`, `opencode`, `hermes`) sempre ganham de plugins com mesmo nome
- Plugins com `name` conflitante são rejeitados com warning
- Plugins com `mahVersion` incompatível são skipados silenciosamente

### 2.4 Plugin validation

Antes de um plugin ser registrado:

```js
// 1. Verificar mahVersion compatibility
if (!semver.satisfies(MAH_VERSION, plugin.mahVersion)) {
  throw `Plugin ${plugin.name}@${plugin.version} requires MAH ${plugin.mahVersion}, but ${MAH_VERSION} is running`
}

// 2. Verificar adapter shape mínimo
const requiredFields = ["name", "markerDir", "commands"]
for (const field of requiredFields) {
  if (!plugin.adapter[field]) throw `Plugin missing required field: adapter.${field}`
}

// 3. Validar adapter via runtime-adapter-contract.mjs (já existente)
validateAdapter(plugin.adapter)  // mesma validação que built-ins usam
```

---

## 3. Nova estrutura de arquivos

```
mah-plugins/                          # [opcional] criado pelo operador
└── runtime-kilo/
    ├── plugin.json                   # { name, version, mahVersion, entry }
    └── index.mjs                     # exporta runtimePlugin

scripts/
├── runtime-adapters.mjs             # [existente] built-ins (pi, claude, opencode, hermes)
├── runtime-adapter-contract.mjs      # [existente] validação de adapter shape
└── plugin-loader.mjs                 # [NOVO] descoberta e loading de plugins
```

### `scripts/runtime/plugin-loader.mjs` — interface pública

```js
// Carrega todos os plugins disponíveis
export function loadPlugins(pluginPaths, mahVersion) → Promise<Plugin[]>

// Retorna todos os runtimes (built-in + plugins)
export function getAllRuntimes() → Promise<RuntimeRegistry>

// Valida um plugin sem registrá-lo
export function validatePlugin(pluginPath) → ValidationResult

// Desregistra um plugin (para reload ou uninstall)
export function unloadPlugin(name) → void
```

---

## 4. Comandos operacionais

### `mah plugins` — listar plugins carregados

```
$ mah plugins
[
  { name: "pi", source: "builtin", version: "1.0.0" },
  { name: "claude", source: "builtin", version: "1.0.0" },
  { name: "opencode", source: "builtin", version: "1.0.0" },
  { name: "hermes", source: "builtin", version: "1.0.0" },
  { name: "kilo-cli", source: "mah-plugins/runtime-kilo", version: "1.0.0" }
]
```

### `mah plugins install <path>` — instalar plugin local

```
$ mah plugins install ./mah-plugins/runtime-kilo
Installing runtime-kilo@1.0.0...
Plugin validated: adapter shape OK, mahVersion ^0.4.0 compatible with 0.4.0
Runtime "kilo-cli" registered. Run 'mah detect' to confirm.
```

### `mah plugins uninstall <name>` — desinstalar plugin

```
$ mah plugins uninstall kilo-cli
Removing mah-plugins/runtime-kilo...
Runtime "kilo-cli" unregistered.
```

### `mah plugins validate <path>` — validar plugin sem instalar

```
$ mah plugins validate ./mah-plugins/runtime-kilo
{ ok: true, name: "kilo-cli", mahVersion: "^0.4.0", adapter: { ... }, warnings: [] }
```

---

## 5. Descoberta automática

Na inicialização do CLI (primeiro comando executado):

```js
async function bootstrapRuntimeRegistry() {
  // 1. Built-ins (sincrônico, não falha)
  const builtIns = RUNTIME_ADAPTERS

  // 2. Descoberta de plugins
  const searchPaths = [
    "mah-plugins/",                              // local operator dir
    ...discoverNodeModules("@mah/runtime-")    // npm installed
  ]

  const plugins = await loadPlugins(searchPaths, MAH_VERSION)

  // 3. Merge — built-ins têm prioridade
  const registry = {
    ...builtIns,
    ...Object.fromEntries(plugins.map(p => [p.name, p]))
  }

  // 4. Warn on conflicts
  for (const [name, adapter] of Object.entries(registry)) {
    if (builtIns[name] && plugins.find(p => p.name === name)) {
      console.warn(`[MAH] Plugin ${name} shadows built-in — built-in takes priority`)
    }
  }

  return registry
}
```

---

## 6. CLI affected

### Comandos que usam ALL_RUNTIMES

| Comando | Impacto |
|---|---|
| `mah detect` | Usa registry para iterar adapters — já suporta dynamismo |
| `mah doctor` | Usa registry para check individual |
| `mah validate:runtime` | Usa registry para validar runtime |
| `mah validate:all` | Usa registry completo |
| `mah run` | Usa registry para selecionar runtime |
| `mah sessions` | Usa registry para session operations |
| `mah graph` | Usa registry para topology |

**Impacto no código:** O dispatcher precisa usar `getAllRuntimes()` ao invés do import estático de `RUNTIME_ADAPTERS` — uma mudança de linha no local onde o registry é consumido.

### Comandos novos

| Comando | Descrição |
|---|---|
| `mah plugins` | Lista plugins carregados |
| `mah plugins install <path>` | Instala plugin local |
| `mah plugins uninstall <name>` | Remove plugin |
| `mah plugins validate <path>` | Valida plugin sem instalar |

---

## 7. O que NÃO entra em v0.5.0

- **Remote execution foundation** — carrega runtimes de URL/remoto
- **Plugin that modifies MAH core behavior** — plugins são restritos a runtime adapters
- **Plugin marketplace / registry** — só carregamento local e npm
- **Policy engine** — fora do escopo
- **Federation / interconnect** — fora do escopo
- **Plugin hooking into MAH lifecycle events** — `init`/`teardown` existem mas não disparam eventos internos
- **Multiple plugin directories** — um único `mah-plugins/` por enquanto

---

## 8. Config

O `meta-agents.yaml` não muda. A configuração de runtimes permanece YAML-driven. Plugins são detectados automaticamente na inicialização — não há declaração de plugins no YAML.

Se um operador quiser desabilitar um plugin sem remover os arquivos:
```bash
MAH_PLUGINS_ENABLED=0 mah detect   # desabilita plugin discovery
```

---

## 9. Test plan

### 9.1 Testes unitários

```bash
# plugin-loader.test.mjs
test("loadPlugins discovers mah-plugins/ directory")
test("loadPlugins discovers node_modules/@mah/runtime-*")
test("loadPlugins skips incompatible mahVersion")
test("loadPlugins rejects malformed plugin.json")
test("loadPlugins rejects missing runtimePlugin export")
test("built-ins always take priority over plugins with same name")
test("unloadPlugin removes plugin from registry")
test("getAllRuntimes returns built-ins + plugins merged")
```

### 9.2 Testes de integração

```bash
# plugins-cli.test.mjs
test("mah plugins lists all loaded runtimes")
test("mah plugins install ./path installs and validates")
test("mah plugins uninstall <name> removes and deregisters")
test("mah plugins validate ./path returns validation result without installing")
test("mah detect shows plugin runtime after install")
test("mah detect no longer shows plugin runtime after uninstall")
```

### 9.3 Testes de контракта

```bash
# Usar runtime-adapter-contract.mjs existente para validar plugins
test("plugin adapter passes runtime-adapter-contract validation")
test("plugin adapter without required fields fails validation")
test("plugin adapter with missing commands fails validation")
```

### 9.4 Testes de compatibilidade

```bash
# Retrocompatibilidade com built-ins
test("mah detect still returns pi, claude, opencode, hermes")
test("mah validate:runtime --runtime hermes still works")
test("mah validate:all still works with no plugins installed")
```

---

## 10. Slice-by-slice execution

### Slice 0 — Plugin loader core
**Arquivos:** `scripts/runtime/plugin-loader.mjs`
**Entrega:** `loadPlugins()`, `getAllRuntimes()`, `validatePlugin()`, `unloadPlugin()`
**Gate:** Todos os testes unitários passam

### Slice 1 — Built-in registry integration
**Arquivos:** `scripts/meta-agents-harness.mjs` (pequena mudança)
**Entrega:** `mah detect` usa `getAllRuntimes()` ao invés de import estático
**Gate:** `mah detect` ainda retorna pi, claude, opencode, hermes corretamente

### Slice 2 — Plugin commands
**Arquivos:** `scripts/meta-agents-harness.mjs` (comandos novos)
**Entrega:** `mah plugins`, `mah plugins install`, `mah plugins uninstall`, `mah plugins validate`
**Gate:** Comandos funcionam sem installed plugins (lista built-ins)

### Slice 3 — End-to-end plugin test
**Arquivos:** `tests/plugins-e2e.test.mjs`
**Entrega:** Instalação e desinstalação de um runtime fictício de teste
**Gate:** mah detect inclui/exclui o runtime de teste corretamente

### Slice 4 — Contract validation for plugins
**Arquivos:** `scripts/runtime/plugin-loader.mjs` (atualizar), `tests/plugins-contract.test.mjs`
**Entrega:** Plugins passam por `validateAdapter()` antes de serem registrados
**Gate:** Plugin com adapter incompleto é rejeitado com mensagem clara

---

## 11. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Plugin com versão errada quebra loading | baixa | alta | mahVersion check obrigatório antes de qualquer registration |
| Plugin com mesmo nome de built-in | baixa | média | Built-in sempre vence; warning no log |
| Plugin faz sync de meta-agents.yaml com runtime próprio | baixa | alta | Plugins são read-only; sync continua usando config canônica |
| Operador cria loop de plugin-loading | muito baixa | alta | Limite máximo de 20 plugins por família; fail-fast |
| Plugin registry grow sem limite | baixa | baixa | Cada plugin é explicitamente carregado; GC funciona |

---

## 12. Resultado esperado

Ao final da v0.5.0:

```
$ mah plugins
builtin:
  - pi
  - claude
  - opencode
  - hermes
plugins:
  - kilo-cli (mah-plugins/runtime-kilo, v1.0.0)

$ mah detect
runtime=kilo-cli reason=marker .kilo directory found

$ rm -rf mah-plugins/runtime-kilo
$ mah detect
# kilo-cli não aparece mais
```

O operador adicionou um runtime sem tocar em nenhum arquivo do core do MAH. O kilo-cli persiste através de updates do MAH. A remoção é `rm -rf`. Sem fork, sem merge conflicts, sem customização do core.