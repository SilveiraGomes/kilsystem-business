# Estado do projecto

Última verificação: 2026-11-15, na branch `chore/e106-s2-vitest-security` (E1.06-S2), a partir de `main` em `b890a89`.

Este documento é o ponto de retoma para qualquer agente ou pessoa. Contém apenas factos verificados no repositório ou por execução; o que não foi executado está marcado como tal.

## Resumo

| Etapa | Estado | Commit | Detalhe |
| --- | --- | --- | --- |
| E1.01 — Fundação tecnológica | Concluída | `ff5ba65` | [tasks/E1.01.md](tasks/E1.01.md) |
| E1.02 — Aplicação desktop funcional | Concluída | `b113388` | [tasks/E1.02.md](tasks/E1.02.md) |
| E1.02-H — Handoff multi-IA | Concluída | `68b7f98` | — |
| E1.03 — Contratos multiempresa e isolamento lógico | Concluída | `7ce5bb0` | [tasks/E1.03.md](tasks/E1.03.md) |
| E1.04 — Persistência SQLite e repositórios multiempresa | Concluída | `d713c3c` | [tasks/E1.04.md](tasks/E1.04.md) |
| E1.05 — Inicialização e ciclo de vida do serviço local | Concluída | `5f1b36e` | [tasks/E1.05.md](tasks/E1.05.md) |
| E1.06 — Modernização e estabilização do ambiente | Concluída | `7270646` | [tasks/E1.06.md](tasks/E1.06.md) |
| E1.06-G — Configuração/publicação GitHub | Concluída | `580d658` | [tasks/E1.06-G.md](tasks/E1.06-G.md) |
| E1.06-S1 — Actualização e segurança do Electron | Concluída e integrada | `c3219ad` | [tasks/E1.06-S1.md](tasks/E1.06-S1.md) |
| E1.06-S1-M — Revisão e integração da actualização Electron | Concluída e integrada | `2ca5b90` | [tasks/E1.06-S1-M.md](tasks/E1.06-S1-M.md) |
| E1.06-S2 — Modernização do Vitest e segurança dos testes | Concluída e publicada na branch; PR para `main` por integrar | `c5a23a0` (branch `chore/e106-s2-vitest-security`) | [tasks/E1.06-S2.md](tasks/E1.06-S2.md) |
| Política Git/GitHub | Adoptada | `docs: adopt git and github publication policy` | `AGENTS.md` (“Git e GitHub”), D-074 |
| E1.07 a E1.10 | Planeadas, não autorizadas | — | [implementation-plan.md](implementation-plan.md) |

Tarefa activa: E1.06-S2, implementada na branch `chore/e106-s2-vitest-security` e publicada com autorização expressa do responsável (repositório público). O PR para `main` aguarda revisão e integração pelo responsável. E1.07 continua planeada, não iniciada e não autorizada.

## Repositório remoto

- Repositório oficial: `https://github.com/SilveiraGomes/kilsystem-business`, configurado como `origin` (configuração local do repositório).
- `main` local e `origin/main` foram confirmadas em `580d6580fd945022999b0709801b37c9cfcfdc8c`, sem divergências, no início de E1.06-S1.
- A API pública do GitHub confirmou `private: false` e `visibility: public`. Nenhuma configuração administrativa foi alterada.
- Branch de E1.06-S1: `chore/e106-s1-electron-security`, publicada no checkpoint `a6ad525def75c5e301bc0b5ee559cf362107918f`.
- O PR [#1](https://github.com/SilveiraGomes/kilsystem-business/pull/1) foi integrado em 2026-11-15. `main` local e `origin/main` foram alinhadas no merge commit `2ca5b90a4157e8d82e955a64ea28f9e2d543012e`, que contém a cabeça da branch. O repositório continua público e a visibilidade não foi alterada.
- E1.06-S2 partiu de `main` = `origin/main` = `b890a892d2b1268c8a1b7a6c9c538c6e88d73103`, confirmado após `git fetch`, e criou a branch local `chore/e106-s2-vitest-security`. A API pública do GitHub voltou a confirmar `private: false` e `visibility: public`. O responsável autorizou expressamente, em 2026-11-15, a publicação desta branch nessa condição. O commit técnico é `c5a23a0`, e o registo de publicação segue num commit `docs:` posterior. Não houve merge automático.

## Ambiente de referência

| Ferramenta | Versão | Onde está fixada |
| --- | --- | --- |
| Node.js | **24.22.3** (LTS “Krypton”) | `.node-version`; `engines.node >=24.22.3 <25` |
| pnpm | 9.15.9 | `packageManager`; `engines.pnpm >=9.15.0 <10` |
| Verificação de versões | `engine-strict=true` | `.npmrc`: `pnpm install` falha com outra versão de Node (verificado com o Node 20.16.0) |

Nesta máquina (Windows x64):
- o Node 24.22.3 está instalado de forma isolada em `%LOCALAPPDATA%\KIL-Tools\node\node-v24.22.3-win-x64`, a partir do zip oficial com SHA-256 verificado;
- o Node do sistema (`C:\Program Files\nodejs`, 20.16.0) e o PATH global **não foram alterados**;
- antes de qualquer comando, cada sessão tem de pôr o Node 24 à frente no PATH, só para o processo em curso:

```powershell
$env:Path = "$env:LOCALAPPDATA\KIL-Tools\node\node-v24.22.3-win-x64;" + $env:Path
node -v   # v24.22.3
```

Noutra máquina, instale o Node 24.22.3 (instalador oficial ou um gestor de versões que leia `.node-version`, como o fnm) e o pnpm 9.15.9. Com o Node 24 em Windows x64 não são necessárias ferramentas de compilação C++: o `better-sqlite3` descarrega um binário pré-compilado.

## Validação verificada

### E1.06-S2 (Vitest 5.1.0), 2026-11-15

Node.js 24.22.3, pnpm 9.15.9, Vitest 5.1.0 e Vite 6.4.6, na branch `chore/e106-s2-vitest-security`:

- `pnpm.cmd lint`, `typecheck`, `build` (12/12) e `check`: aprovados.
- `pnpm.cmd test`: 7 ficheiros, **281/281**, com a mesma distribuição por ficheiro indicada abaixo. Sem testes ignorados nem `todo`.
- Os 281 testes passam também com os `dist/` dos pacotes retirados (D-078).
- Testes do desktop: 6/6 via `--filter`, `test:desktop` e dentro de `apps/desktop`. `pnpm test tenant domain-contracts sqlite`: 222/222. `pnpm test local-service`: 52/52.
- Smoke Electron real: `KIL_ELECTRON_RUNTIME electron=45.3.2 chromium=156.0.8078.100 node=24.22.2` e `KIL_ELECTRON_SMOKE_OK`.
- Quatro mutações controladas, todas detectadas e revertidas: filtro de tenant, duas violações do ciclo de vida e `sandbox: false`.
- Instalação limpa externa:
  - `pnpm install --frozen-lockfile` com *store*, cache npm e cache Electron novos: 390 pacotes descarregados, 0 reutilizados;
  - `better-sqlite3` com binário pré-compilado (ABI 137), sem `node-gyp`;
  - testes antes de qualquer build (281/281), `typecheck`, `build`, `check`, desktop 6/6 e smoke aprovados.
- **Auditoria** (`pnpm audit`):
  - desenvolvimento: 16 → **1** (0 críticos, 0 altos, 1 moderado, 0 baixos);
  - Vitest, Vite interno, `esbuild` e `tinypool`: 15 → 0;
  - restante: `minimatch` via typescript-eslint (PD-19);
  - produção: 0.

Detalhe completo em [tasks/E1.06-S2.md](tasks/E1.06-S2.md).

### E1.06-S1 (Vitest 2.1.9)

Executada inicialmente em 2026-11-14, repetida durante a revisão e novamente após o merge em 2026-11-15, com Node.js 24.22.3 e pnpm 9.15.9:

- `pnpm.cmd lint` e `pnpm.cmd typecheck`: sem erros.
- `pnpm.cmd test`: 7 ficheiros, **281 testes aprovados**:
  - `foundation` 1, `desktop-security` 4, `desktop-ui` 2;
  - `domain-contracts` 56;
  - `tenant-isolation` 132;
  - `sqlite-persistence` 34;
  - `local-service` 52.
- `pnpm.cmd build`: 12 de 12 projectos.
- `pnpm.cmd check`: código de saída 0.
- `pnpm.cmd --filter @kil-business/desktop test`: 6/6 aprovados.
- `pnpm.cmd --filter @kil-business/desktop smoke`: código 0, `KIL_ELECTRON_RUNTIME electron=45.3.2 chromium=156.0.8078.100 node=24.22.2` e `KIL_ELECTRON_SMOKE_OK`. O teste percorreu as oito áreas e verificou preload, API mínima e isolamento do renderer.
- Sete arranques/encerramentos do Electron terminaram com código 0, incluindo a cópia limpa; a mensagem GPU da PD-13 não ocorreu.
- **Instalação limpa** numa cópia temporária externa, a partir dos ficheiros versionáveis e não ignorados:
  - `pnpm install --frozen-lockfile` com *store*, cache npm e cache Electron novos: 407 pacotes descarregados, 0 reutilizados;
  - `better-sqlite3` usou o binário pré-compilado, sem `node-gyp`;
  - `pnpm check` (281 testes, 12/12), testes do desktop (6/6) e smoke Electron real aprovados.
- **SQLite real e código compilado** (Node puro):
  - o serviço `dist/main.js --check` criou a base, aplicou a migração 1 e voltou a abri-la com a política estrita;
  - o pacote `database` compilado executou migrações e uma transacção com ABI 137.
- **Ctrl+C numa consola real**: um `CTRL_C_EVENT` enviado por `GenerateConsoleCtrlEvent` produziu `SIGINT`, `READY→STOPPING→STOPPED`, código 0 e nenhum `-wal` residual (detalhe e ressalva em [tasks/E1.06.md](tasks/E1.06.md)).
- **Auditoria** (`pnpm audit`):
  - produção: 0 alertas;
  - desenvolvimento: 16 alertas (3 críticos, 1 alto, 11 moderados, 1 baixo), apenas via Vitest 2 e typescript-eslint (PD-18, PD-19);
  - Electron: 46 → 0; `extract-zip` antigo: 2 altos → 0.
- **Não verificado**: `pnpm --filter @kil-business/desktop dev` (processo interactivo de longa duração).

## Comandos

Requisitos: Node.js 24.22.3 (`.node-version`) e pnpm 9.15.9. Em PowerShell, usar `pnpm.cmd` se a política de execução bloquear `pnpm.ps1`.

| Objectivo | Comando | Origem |
| --- | --- | --- |
| Instalar dependências (reprodutível) | `pnpm install --frozen-lockfile` | raiz |
| Validação completa | `pnpm check` (lint → typecheck → test → build) | `package.json` |
| Lint | `pnpm lint` | `package.json` |
| Typecheck global | `pnpm typecheck` | `package.json` |
| Testes | `pnpm test` | `package.json` |
| Testes do desktop | `pnpm test:desktop` ou `pnpm --filter @kil-business/desktop test` | `package.json`, `apps/desktop/package.json` |
| Testes multiempresa e SQLite | `pnpm test tenant domain-contracts sqlite` | `package.json` (filtro do Vitest) |
| Testes do serviço local | `pnpm test local-service` | `package.json` (filtro do Vitest) |
| Testes em modo observação | `pnpm test:watch` | `package.json` |
| Auditoria de dependências | `pnpm audit` e `pnpm audit --prod` | pnpm |
| Build de todos os projectos | `pnpm build` | `package.json` |
| Build do serviço local | `pnpm --filter @kil-business/local-api build` | `services/local-api/package.json` |
| Verificar arranque do serviço | `pnpm --filter @kil-business/local-api start:check` | `services/local-api/package.json` |
| Iniciar o serviço (encerrar com Ctrl+C) | `pnpm --filter @kil-business/local-api start` | `services/local-api/package.json` |
| Desktop em desenvolvimento | `pnpm --filter @kil-business/desktop dev` | `apps/desktop/package.json` |
| Build do desktop | `pnpm --filter @kil-business/desktop build` | `apps/desktop/package.json` |
| Smoke test do Electron | `pnpm --filter @kil-business/desktop smoke` | `apps/desktop/package.json` |
| Typecheck do desktop | `pnpm --filter @kil-business/desktop typecheck` | `apps/desktop/package.json` |
| Portal administrativo | `pnpm --filter @kil-business/admin-portal dev` | `apps/admin-portal/package.json` |

O serviço local exige as variáveis `LOCAL_DATABASE_PATH` e `LOCAL_SERVICE_*` no ambiente do processo; nenhum ficheiro `.env` é carregado. A tabela de variáveis está em [architecture.md](architecture.md#serviço-local-e105) e um exemplo em PowerShell em [tasks/E1.05.md](tasks/E1.05.md#comandos-do-serviço).

Notas sobre o arranque do Electron:

- `dev` inicia o Vite em `http://127.0.0.1:5173` (porta fixa, `--strictPort`), compila o processo principal e o preload, aguarda a porta e arranca o Electron com `VITE_DEV_SERVER_URL`.
- Não existe script `start` no desktop. Fora do modo `dev`, o arranque é feito por `apps/desktop/scripts/run-electron.mjs` sobre o resultado do `build`, que é o mecanismo usado pelo `smoke`.
- O Electron usa o seu próprio runtime (Electron 45.3.2, Chromium 156.0.8078.100 e Node 24.22.2), independente do Node 24.22.3 dos serviços e ferramentas.

## Funcionalidades

### Implementadas

- Monorepositório pnpm com 12 projectos, TypeScript estrito, ESLint 10 com verificação de tipos e Vitest 5.1.0. Os pacotes do workspace resolvem a partir de `src/` em typecheck, lint e testes, e a partir de `dist/` em execução.
- Processo principal Electron suportado, com renderer isolado, CSP, permissões negadas, navegação/janelas/`webview` bloqueados e preload mínimo e imutável; modo de smoke test real ampliado.
- Navegação funcional entre 8 áreas da interface desktop (estado React em memória).
- Contratos de domínio multiempresa (`packages/shared-types`).
- Persistência SQLite local (`packages/database`).
- Serviço local Node.js (`services/local-api`), independente do Electron, sem HTTP.

### Demonstrativas, sem dados nem regras de negócio

- Dashboard com indicadores fixos, barra de contexto com textos fixos (incluindo “Sistema local disponível”), perfil, pesquisa e notificações apenas visuais.
- Páginas de módulos com estado vazio; ainda não usam os contratos, a persistência nem o serviço local.
- Portal administrativo estático.
- Duplo de teste em memória (`tests/support/in-memory-tenant-repositories.ts`): serve apenas para testes e não é persistência.

### Ainda não desenvolvidas

- Implementação das decisões de domínio D-055, D-058, D-060 e D-061 (PD-14 a PD-16).
- Identidade, autenticação e autorização (E1.07); API local e integração Electron (E1.08).
- Serviços centrais e PostgreSQL (E1.09); instalação, serviço Windows, cópias de segurança e Gate E1 (E1.10).
- Regra de validação do NIF para qualquer jurisdição real (PD-09).
- Modos de implantação B e C, sincronização e funcionamento offline entre estabelecimentos.
- Grupos empresariais, módulos sectoriais, vendas, POS, facturação, stock, contabilidade e fiscalidade.
- Integração de licenciamento (apenas a interface `LicenseProvider`) e KIL Business Monitor.

## Pendências e divergências

| ID | Descrição | Impacto | Estado |
| --- | --- | --- | --- |
| PD-01 | `pnpm --filter @kil-business/desktop test` não encontrava testes. | — | Resolvida em E1.03 (D-022). |
| PD-02 | Os quatro sectores não estavam identificados. | — | Resolvida em E1.03 (D-018). |
| PD-03 | Variáveis de `.env.example` sem leitura no código. As do serviço local são lidas desde E1.05; `LOCAL_API_*`, `CENTRAL_*`, `SYNC_*`, `KIL_LICENSE_*` e `NODE_ENV` continuam sem uso. | Apenas documental. | Parcialmente resolvida. |
| PD-04 | A interface mostra “Sistema local disponível” sem verificação real. | Pode induzir em erro fora do contexto demonstrativo. | Mantida até à integração Electron/serviço (E1.08). |
| PD-05 | O directório `.git` pertence ao utilizador `CodexSandboxOffline`. Outros utilizadores Windows recebem *dubious ownership*. | Bloqueia comandos Git noutros agentes. | Mantida. Contornada com `git -c safe.directory=C:/KIL-BUSINESS`, sem alterar permissões globais. |
| PD-06 | O plano de etapas posteriores não constava do repositório. | — | **Resolvida em E1.06** para a fase E1 (E1.07–E1.10 planeadas). O planeamento após o Gate E1 está por definir. |
| PD-07 | Escolhas de concretização de E1.03. | — | Resolvida em E1.04. |
| PD-08 | Consumo de pacotes do workspace através de `dist/`. | — | Resolvida em E1.04 (D-037). |
| PD-09 | Validação fiscal angolana por consolidar: nenhuma regra de NIF está configurada para uma jurisdição real. Com a política fail-closed (D-030), nenhuma empresa fica `ACTIVE` fora dos testes. | Bloqueia empresas activas reais. | **Aberta.** Requer fonte normativa, versão e vigência. |
| PD-10 | Compilação nativa do driver SQLite. | — | **Resolvida em E1.06** para Windows x64 com Node 24: binário pré-compilado `node-v137-win32-x64` obtido numa instalação limpa (caches vazias), sem compilação local (D-070). Outras plataformas ou versões de Node exigem nova verificação. |
| PD-11 | Decisões de domínio por confirmar. | — | **Encerrada em E1.06** (D-052 a D-061). A implementação em falta está em PD-14 a PD-16. |
| PD-12 | Node 20 fora de suporte desde 2026-04-30. | — | **Resolvida em E1.06** (D-069): migração efectiva para o Node 24.22.3 e validação completa executada nesta versão. |
| PD-13 | Mensagens GPU ocasionais no encerramento do Electron 33 (`GPU state invalid after WaitForGetOffsetInRange`). | Ruído de log do Chromium; não afectou o código de saída. | Em observação: não ocorreu em sete execuções do Electron 45.3.2, incluindo uma instalação/cache limpa. Por ser ocasional, não se declara eliminada definitivamente. |
| PD-14 | Implementar D-055: preservar o NIF em `SUSPENDED`/`INACTIVE` nas empresas anteriormente activadas. Hoje o NIF só é exigido em `ACTIVE` (contrato e `CHECK` SQLite). | Uma empresa activada pode perder o NIF ao mudar de estado. | Aberta; exige registo da activação ou regras de transição (PD-16). |
| PD-15 | Implementar D-058: unicidade do NIF por jurisdição e entidade jurídica após normalização. | NIF duplicados possíveis. | Aberta; depende da normalização fiscal (PD-09). |
| PD-16 | Implementar D-060 e D-061: histórico de alterações e tabela explícita de transições de estado das empresas. | Transições livres; sem histórico. | Aberta. |
| PD-17 | Electron 33.4.11 fora de suporte e 48 alertas na cadeia do runtime. | Segurança do desktop distribuído. | **Resolvida em E1.06-S1** (D-075, D-076): Electron 45.3.2 suportado; 0 alertas do Electron/`extract-zip`; smoke e instalação limpa aprovados. |
| PD-18 | Vitest 2.1.9 (só desenvolvimento): 3 alertas críticos (servidor UI do Vitest e `tinypool`) e outros via Vite 5 interno e `@vitest/mocker`. Não eram exploráveis no uso actual (sem servidor UI, sem entradas não confiáveis). | — | **Resolvida em E1.06-S2** (D-077, D-078): Vitest 5.1.0; os 15 alertas do Vitest, do Vite 5.4.21 interno, do `esbuild` 0.21.5 e do `tinypool` foram eliminados (15 → 0), com 281/281 testes e instalação limpa aprovados. |
| PD-19 | `minimatch` 10.2.6 (moderado, ReDoS, `GHSA-g3hv-75wg-m249`; corrigido em ≥ 11.0.1) via typescript-eslint 8.72.2. | Só desenvolvimento (lint). | Aberta. Reverificada em E1.06-S2: a 8.72.2 continua a ser a `latest` e declara `minimatch ^10.2.2`. Aguarda correcção a montante; sem *override*. |
| PD-20 | pnpm 9.15.9 é uma linha antiga (última 12.18.0). O pnpm 10 ou superior bloqueia *build scripts* por omissão (`better-sqlite3`, `electron`, `esbuild`). | Manutenção do gestor de pacotes. | Aberta; avaliação própria. |
| PD-21 | O Node 24 está em *Maintenance* LTS (fim a 2028-04-30); o Node 26 é a *Active LTS* desde 2026-10-28. O `better-sqlite3` 12.11.1 não publica binário Windows para o Node 26. | Planeamento futuro. | Aberta; planear a migração antes do fim de suporte. |
| PD-22 | Um processo lançado por outro que ignore Ctrl+C (`SetConsoleCtrlHandler(NULL, TRUE)` herdado) não recebe `SIGINT`. Observado em E1.06 a partir de uma shell não interactiva. | Encerramento por Ctrl+C depende de quem lança o serviço. | Informativo; em instalação, o encerramento será feito pelo gestor de serviços Windows (E1.10). |
| PD-23 | Outras dependências com versões principais novas, sem alertas de segurança: React 19, Vite 8, TypeScript 7, jsdom 31, `@vitejs/plugin-react` 6, `lucide-react` 1.x, entre outras. Não foram actualizadas, por instrução. | Dívida técnica. | Informativo; lista em [tasks/E1.06.md](tasks/E1.06.md). O Vitest foi actualizado em E1.06-S2 (D-077). |
| PD-24 | O intervalo declarado do Vite (`^6.0.3` na raiz e no catálogo) admite versões abaixo do mínimo exigido pelo Vitest 5 (`>=6.4.0`). O lockfile fixa a 6.4.6, que cumpre o requisito. | Uma resolução nova fora do lockfile poderia escolher um Vite incompatível. | Aberta, de baixo impacto; alinhar o intervalo numa manutenção de dependências autorizada. |
| PD-25 | O pnpm reporta as subdependências descontinuadas `prebuild-install` 7.1.3 (via `better-sqlite3`) e `whatwg-encoding` 3.1.1 (via jsdom 25). Já existiam no lockfile da `main` antes de E1.06-S2. | Nenhum alerta de segurança associado. | Informativo; reavaliar com futuras versões de `better-sqlite3` e jsdom (PD-23). |

As decisões arquitecturais ainda em aberto estão em [architecture.md](architecture.md#decisões-pendentes).

## Como retomar numa sessão nova

1. Ler [AGENTS.md](../AGENTS.md), este documento, [architecture.md](architecture.md), [decisions.md](decisions.md) e [implementation-plan.md](implementation-plan.md).
2. Activar o Node 24.22.3 (ver “Ambiente de referência”) e confirmar com `node -v`.
3. Confirmar o estado real, local e remoto (`AGENTS.md`, “Git e GitHub”):
   ```sh
   git -c safe.directory=C:/KIL-BUSINESS remote -v          # origin → github.com/SilveiraGomes/kilsystem-business
   git -c safe.directory=C:/KIL-BUSINESS fetch origin
   git -c safe.directory=C:/KIL-BUSINESS status -sb         # sem "ahead"/"behind" inesperados
   git -c safe.directory=C:/KIL-BUSINESS log --oneline -n 10
   ```
   O último checkpoint publicado em `main` deve ser `580d658` ou posterior, com registo neste documento. Se não corresponder, ou se o remoto divergir, registar e comunicar antes de outro trabalho; nunca forçar.
4. Executar `pnpm.cmd install --frozen-lockfile` (se `node_modules` não existir ou se a versão do Node mudou) e `pnpm.cmd check` para obter a linha de base. Registar qualquer falha antes de alterar código.
5. Identificar a tarefa activa em `docs/tasks/`.
   - E1.06-S2 está publicada na branch `chore/e106-s2-vitest-security`. O PR para `main` aguarda integração pelo responsável; ver [tasks/E1.06-S2.md](tasks/E1.06-S2.md#retoma-por-outro-agente).
   - E1.07–E1.10 estão **planeadas mas não autorizadas**.
   - E1.06-S1 está integrada em `main` através do PR #1.
6. Trabalhar apenas no âmbito da tarefa. Regras a manter:
   - qualquer implementação nova de repositório tem de passar `tests/support/tenant-repository-contract.ts` (D-021);
   - o acesso à base passa pelo serviço local em `READY` (D-047).

   Registar divergências na tabela de pendências e decisões novas aprovadas em `decisions.md`.
7. Ao concluir:
   1. Executar `pnpm.cmd check` (e `smoke` se o desktop for alterado).
   2. Actualizar o ficheiro da tarefa e este documento.
   3. Criar um único commit com a mensagem indicada na tarefa e confirmar que a árvore de trabalho está limpa.
   4. Publicar com `git push origin main`, sem *force*.
   5. Confirmar que `git rev-parse HEAD` é igual a `git ls-remote origin refs/heads/main`.

   A tarefa só conta como publicada depois desta confirmação. Se a autenticação falhar, comunicar o bloqueio. A ferramenta `gh` não está instalada nesta máquina; o `push` usa o gestor de credenciais do Git.
