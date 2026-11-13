# Estado do projecto

Última verificação: 2026-11-13, no fecho da tarefa E1.03 (ponto de partida `68b7f98`).

Este documento é o ponto de retoma para qualquer agente ou pessoa. Contém apenas factos verificados no repositório ou por execução; o que não foi executado está marcado como tal.

## Resumo

| Etapa | Estado | Commit | Detalhe |
| --- | --- | --- | --- |
| E1.01 — Fundação tecnológica | Concluída | `ff5ba65` | [tasks/E1.01.md](tasks/E1.01.md) |
| E1.02 — Aplicação desktop funcional | Concluída | `b113388` | [tasks/E1.02.md](tasks/E1.02.md) |
| E1.02-H — Handoff multi-IA | Concluída | `68b7f98` | — |
| E1.03 — Contratos multiempresa e isolamento lógico | Concluída | `feat: establish multi-tenant domain contracts` | [tasks/E1.03.md](tasks/E1.03.md) |
| E1.04 — Persistência SQLite e repositórios | Definida, não autorizada | — | [tasks/E1.04.md](tasks/E1.04.md) |

Tarefa activa: nenhuma. A E1.04 aguarda autorização explícita e as decisões listadas no respectivo ficheiro.

## Validação verificada

Executada em 2026-11-13 com Node.js 20.16.0 e pnpm 9.15.9, no fecho de E1.03:

- `pnpm.cmd lint` e `pnpm.cmd typecheck`: sem erros.
- `pnpm.cmd test`: 5 ficheiros, 74 testes aprovados:
  - `foundation` 1;
  - `desktop-security` 2;
  - `desktop-ui` 2;
  - `domain-contracts` 37;
  - `tenant-isolation` 32.
- `pnpm.cmd build`: 12 de 12 projectos do workspace (`Scope: 12 of 13 workspace projects`; o 13.º é a raiz, sem script `build`).
- `pnpm.cmd check`: código de saída 0.
- `pnpm.cmd test:desktop` e `pnpm.cmd --filter @kil-business/desktop test`: 2 ficheiros, 4 testes aprovados cada.
- `pnpm.cmd --filter @kil-business/desktop smoke`: `KIL_ELECTRON_SMOKE_OK`.
- `pnpm --filter @kil-business/desktop dev`: não executado (processo interactivo de longa duração).

## Comandos

Requisitos: Node.js `>=20.16.0 <23`, pnpm `>=9.15.0 <10` (fixado em `pnpm@9.15.9`). Em PowerShell, usar `pnpm.cmd` em vez de `pnpm` se a política de execução bloquear `pnpm.ps1`.

| Objectivo | Comando | Origem |
| --- | --- | --- |
| Instalar dependências | `pnpm install` | raiz |
| Validação completa | `pnpm check` (lint → typecheck → test → build) | `package.json` |
| Lint | `pnpm lint` | `package.json` |
| Typecheck global | `pnpm typecheck` | `package.json` |
| Testes | `pnpm test` | `package.json` |
| Testes do desktop | `pnpm test:desktop` ou `pnpm --filter @kil-business/desktop test` | `package.json`, `apps/desktop/package.json` |
| Testes multiempresa | `pnpm test tenant domain-contracts` | `package.json` (filtro do Vitest) |
| Testes em modo observação | `pnpm test:watch` | `package.json` |
| Build de todos os projectos | `pnpm build` | `package.json` |
| Desktop em desenvolvimento | `pnpm --filter @kil-business/desktop dev` | `apps/desktop/package.json` |
| Build do desktop | `pnpm --filter @kil-business/desktop build` | `apps/desktop/package.json` |
| Smoke test do Electron | `pnpm --filter @kil-business/desktop smoke` | `apps/desktop/package.json` |
| Typecheck do desktop | `pnpm --filter @kil-business/desktop typecheck` | `apps/desktop/package.json` |
| Portal administrativo | `pnpm --filter @kil-business/admin-portal dev` | `apps/admin-portal/package.json` |

Notas sobre o arranque do Electron:

- `dev` inicia o Vite em `http://127.0.0.1:5173` (porta fixa, `--strictPort`), compila o processo principal e o preload, aguarda a porta e arranca o Electron com `VITE_DEV_SERVER_URL`.
- Não existe script `start`. Fora do modo `dev`, o arranque é feito por `apps/desktop/scripts/run-electron.mjs` sobre o resultado do `build`, que é o mecanismo usado pelo `smoke`.
- `smoke` arranca o Electron com a janela oculta e verifica três condições: o dashboard está renderizado, o preload está carregado e `window.kilDesktop` expõe apenas `runtime`.

## Funcionalidades

### Implementadas

- Monorepositório pnpm com 12 projectos (`apps/*`, `services/*`, `packages/*`), TypeScript estrito, ESLint com verificação de tipos e Vitest.
- Processo principal Electron com renderer isolado: `contextIsolation`, `sandbox` e `webSecurity` activos; `nodeIntegration` e `allowRunningInsecureContent` desactivados. Também bloqueia novas janelas e navegação externa.
- Preload CommonJS (`preload.cts` → `dist-electron/preload.cjs`) que expõe apenas `kilDesktop.runtime.platform`, de forma imutável.
- Navegação funcional entre 8 áreas da interface desktop (estado React em memória).
- Modo de smoke test do Electron (`--smoke-test`).
- Contratos de domínio multiempresa em `packages/shared-types`:
  - `Company`, `Branch` e `TenantContext`;
  - identificadores UUID com tipos distintos;
  - os quatro sectores;
  - validação estrutural e erros sem eco de valores.
- Interfaces `CompanyRepository` e `BranchRepository` com escopo obrigatório por tenant, e suite de contrato reutilizável que verifica o isolamento.

### Demonstrativas, sem dados nem regras de negócio

- Dashboard com indicadores fixos (“Kz 0,00”, “0”), marcado na interface como “Dados de demonstração”.
- Barra de contexto com “KIL Demonstração · Unidade Sede”, “Sistema local disponível” e “Sem dados reais”. São textos fixos e o estado do sistema local não é verificado.
- Perfil “Administrador”, pesquisa, notificações e botão “Hoje”: só existem visualmente, sem comportamento.
- Páginas Empresas, Estabelecimentos, Utilizadores, Vendas, Stock, Contabilidade e Configurações: estado vazio “Área preparada para a próxima etapa”. Ainda não usam os contratos de E1.03.
- Portal administrativo: página estática “Portal administrativo em preparação”.
- Duplo de teste em memória (`tests/support/in-memory-tenant-repositories.ts`): serve apenas para testes e não é persistência.

### Ainda não desenvolvidas

- Persistência local (SQLite) ou central (PostgreSQL), esquemas e migrações (SQLite previsto em E1.04).
- Implementações reais de `CompanyRepository` e `BranchRepository`.
- Endpoints nas APIs local e central, que só criam a instância Fastify.
- Ligação entre o desktop e a API local.
- Autenticação, autorização, sessões e utilizadores; o `TenantContext` ainda não provém de identidade autenticada.
- Grupos empresariais (`BusinessGroup`) e relatórios consolidados.
- Módulos e regras sectoriais, vendas, POS, facturação, stock.
- Contabilidade e fiscalidade (pacotes com estado `not-implemented`).
- Sincronização e funcionamento offline.
- Integração de licenciamento (apenas a interface `LicenseProvider`).
- KIL Business Monitor (React Native).
- Empacotamento, assinatura e actualização da aplicação Electron.

## Pendências e divergências

| ID | Descrição | Impacto | Estado |
| --- | --- | --- | --- |
| PD-01 | `pnpm --filter @kil-business/desktop test` não encontrava testes. | — | **Resolvida em E1.03** (`root` em `vitest.config.ts`, D-022). |
| PD-02 | Os quatro sectores não estavam identificados. | — | **Resolvida em E1.03** (D-018). Âmbito funcional por sector continua pendente. |
| PD-03 | As variáveis de `.env.example` (`LOCAL_API_*`, `CENTRAL_API_*`, `LOCAL_DATABASE_PATH`, `SYNC_INTERVAL_SECONDS`, `KIL_LICENSE_*`) ainda não são lidas por nenhum código. | Apenas documental; não há configuração efectiva. | Informativo; `LOCAL_DATABASE_PATH` é relevante para E1.04. |
| PD-04 | A interface mostra “Sistema local disponível” sem qualquer verificação real. | Pode induzir em erro fora do contexto demonstrativo. | Rever quando existir ligação à API local. |
| PD-05 | O directório `.git` pertence ao utilizador `CodexSandboxOffline`. Outros utilizadores Windows recebem *dubious ownership*. | Bloqueia comandos Git noutros agentes. | Contornado com `git -c safe.directory=C:/KIL-BUSINESS`; decisão sobre propriedade a cargo do responsável. |
| PD-06 | O plano de etapas posteriores a E1.04 não consta do repositório. | Agentes não podem antecipar etapas. | Requer planeamento do responsável. |
| PD-07 | Escolhas de concretização de E1.03 a confirmar: relação `Company.id`/`tenantId`, NIF sem formato nem unicidade, estados `ACTIVE`/`INACTIVE`, código de estabelecimento sem unicidade. | Definem restrições do esquema SQLite em E1.04. | Requer confirmação do responsável (ver [tasks/E1.03.md](tasks/E1.03.md)). |
| PD-08 | A importação entre pacotes do workspace depende de `dist/`, que não é versionado. Pode afectar o `typecheck` num clone limpo quando `packages/database` importar `shared-types`. | Previsto para E1.04; não verificado por execução. | Resolver e validar em E1.04 (ver [tasks/E1.04.md](tasks/E1.04.md)). |

As decisões arquitecturais ainda em aberto estão em [architecture.md](architecture.md#decisões-pendentes).

## Como retomar numa sessão nova

1. Ler [AGENTS.md](../AGENTS.md), este documento, [architecture.md](architecture.md), [decisions.md](decisions.md) e [implementation-plan.md](implementation-plan.md).
2. Confirmar o estado real:
   ```sh
   git -c safe.directory=C:/KIL-BUSINESS log --oneline -n 10
   git -c safe.directory=C:/KIL-BUSINESS status
   ```
   O último commit deve ser `feat: establish multi-tenant domain contracts` ou posterior a ele, com registo neste documento. Se não corresponder, actualizar este documento antes de outro trabalho.
3. Executar `pnpm.cmd install` (se `node_modules` não existir) e `pnpm.cmd check` para obter a linha de base. Registar qualquer falha antes de alterar código.
4. Identificar a tarefa activa em `docs/tasks/`. A E1.04 está definida mas **não autorizada**: pedir autorização ao responsável antes de implementar.
5. Trabalhar apenas no âmbito da tarefa. Registar divergências na tabela de pendências e decisões novas aprovadas em `decisions.md`.
6. Ao concluir: executar `pnpm.cmd check` (e `smoke` se o desktop for alterado). Depois, actualizar o ficheiro da tarefa e este documento, criar um único commit com a mensagem indicada na tarefa e confirmar que a árvore de trabalho está limpa.
