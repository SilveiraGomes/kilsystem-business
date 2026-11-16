# Estado do projecto

Última verificação: 2026-11-16, na branch `feat/e107-c-secure-sessions`, criada a partir de `main` = `origin/main` = `ab22404` (E1.07-C; revisão independente E1.07-C-M concluída com o merge suspenso).

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
| E1.06-S2 — Modernização do Vitest e segurança dos testes | Concluída e integrada (PR #2) | `c5a23a0`; merge `d29a629` | [tasks/E1.06-S2.md](tasks/E1.06-S2.md) |
| E1.06-S2-M — Revisão e integração da modernização Vitest | Concluída | `docs: record vitest integration review` | [tasks/E1.06-S2-M.md](tasks/E1.06-S2-M.md) |
| Política Git/GitHub | Adoptada | `docs: adopt git and github publication policy` | `AGENTS.md` (“Git e GitHub”), D-074 |
| E1.07-A — Identidade, utilizadores e associações multiempresa | Concluída e integrada (PR #3) | `cc4adc0`; merge `4d0302b` | [tasks/E1.07-A.md](tasks/E1.07-A.md) |
| E1.07-B — Credenciais, autenticação local e provisionamento inicial | Concluída e integrada (PR #4) | `f443057`; merge `8e77091` | [tasks/E1.07-B.md](tasks/E1.07-B.md) |
| E1.07-B-M — Revisão de segurança e integração da autenticação local | Concluída e integrada (PR #5) | revisão `8ac21b0`; testes `0b6587e`; merge `581699a` | [tasks/E1.07-B-M.md](tasks/E1.07-B-M.md) |
| E1.07-C — Sessões, validade, revogação e continuidade da identidade | Implementada na branch `feat/e107-c-secure-sessions` (`0eb1e75`); revista em E1.07-C-M, **merge suspenso** até à correcção de RV-01 (PD-45) | `feat: implement secure revocable local sessions` | [tasks/E1.07-C.md](tasks/E1.07-C.md) |
| E1.07-C-M — Revisão independente de segurança das sessões | Concluída; recomenda suspender o merge (RV-01, Alto) | revisão de `0eb1e75`; documentação por commitar | [tasks/E1.07-C-M.md](tasks/E1.07-C-M.md) |
| E1.07-D a E1.07-F | Planeadas, não autorizadas | — | [tasks/E1.07.md](tasks/E1.07.md) |
| E1.08 a E1.10 | Planeadas, não autorizadas | — | [implementation-plan.md](implementation-plan.md) |

Tarefa activa: **E1.07-C**, implementada na branch `feat/e107-c-secure-sessions` e publicada para revisão independente. Não há merge: a integração em `main` exige revisão e aprovação explícita do responsável (D-117). E1.07-D a E1.07-F estão especificadas mas não autorizadas.

A revisão independente **E1.07-C-M** encontrou um defeito Alto (RV-01): depois de um avanço seguido de retrocesso do relógio de parede, o relógio efectivo das sessões congela e as sessões e comprovativos deixam de expirar até o tempo real alcançar o instante adiantado. Recomenda suspender o merge até à correcção, numa tarefa autorizada (PD-45). Detalhe em [tasks/E1.07-C-M.md](tasks/E1.07-C-M.md).

**Na branch de E1.07-C, o sistema tem autenticação local offline e sessões locais revogáveis, mas não tem autorização funcional.** Em `main` ainda não há sessões.

- Existem identidades locais, associações a empresas e estabelecimentos, e avaliação interna de elegibilidade.
- Existem credenciais Argon2id, `authenticate(username, password)`, limitação de tentativas e inicialização explícita da instalação.
- Na branch de E1.07-C:
  - a criação de sessões exige um comprovativo interno de 60 s, de utilização única e ligado ao arranque e às versões de segurança (PD-40 resolvida);
  - as sessões usam tokens opacos (só o digest é guardado), expiram por inactividade (30 min) e de forma absoluta (12 h) e são revogadas na suspensão, desactivação, substituição de credencial, alteração da versão de segurança e reinício.
- Tudo isto existe só na composição interna do serviço local, sem HTTP nem IPC.
- Uma sessão comprova apenas a identidade autenticada; não é uma autorização empresarial (D-107, D-116).
- O `TenantContext` continua a ser construído pelo chamador (PD-27, a encerrar em E1.07-D).

## Repositório remoto

- Repositório oficial: `https://github.com/SilveiraGomes/kilsystem-business`, configurado como `origin` (configuração local do repositório).
- `main` local e `origin/main` foram confirmadas em `580d6580fd945022999b0709801b37c9cfcfdc8c`, sem divergências, no início de E1.06-S1.
- A API pública do GitHub confirmou `private: false` e `visibility: public`. Nenhuma configuração administrativa foi alterada.
- Branch de E1.06-S1: `chore/e106-s1-electron-security`, publicada no checkpoint `a6ad525def75c5e301bc0b5ee559cf362107918f`.
- O PR [#1](https://github.com/SilveiraGomes/kilsystem-business/pull/1) foi integrado em 2026-11-15. `main` local e `origin/main` foram alinhadas no merge commit `2ca5b90a4157e8d82e955a64ea28f9e2d543012e`, que contém a cabeça da branch. O repositório continua público e a visibilidade não foi alterada.
- E1.06-S2 partiu de `main` = `origin/main` = `b890a892d2b1268c8a1b7a6c9c538c6e88d73103`, confirmado após `git fetch`, e criou a branch local `chore/e106-s2-vitest-security`. A API pública do GitHub voltou a confirmar `private: false` e `visibility: public`. O responsável autorizou expressamente, em 2026-11-15, a publicação desta branch nessa condição. O commit técnico é `c5a23a0`, e o registo de publicação é `79430f3`. Não houve merge automático.
- O PR [#2](https://github.com/SilveiraGomes/kilsystem-business/pull/2) foi integrado pelo responsável em 2026-11-15. A `main` local avançou por fast-forward para o merge commit `d29a629768904b1273b50fefd94d2b13f4f127d9`, cuja árvore é idêntica à cabeça da branch, e ficou alinhada com `origin/main`. Neste código integrado, `pnpm check` (281/281, 12/12), os testes do desktop (6/6) e o smoke Electron foram repetidos e aprovados.
- E1.06-S2-M: após `git fetch`, `main` local = `origin/main` = `0bb435cc5f989a11e25d78038aff04c60cfdce0b`. A API do GitHub confirmou o PR #2 (`merged: true`, cabeça `79430f3`, base `b890a89`, merge `d29a629`) e o repositório público.
  - Revisão do diff: dois commits autorizados; nenhum ficheiro de testes ou de código de aplicação alterado.
  - Validações: `lint`, `typecheck`, `test`, `build`, `check`, desktop, smoke e `git diff --check`, todas repetidas e aprovadas.
  - Detalhe em [tasks/E1.06-S2-M.md](tasks/E1.06-S2-M.md).
- E1.07-A: após `git fetch`, `main` local = `origin/main` = `e4e6848532c00acdefdda90db1ce1533b3a8353c`, com a árvore limpa. Trabalho na branch `feat/e107-a-user-identity`, publicada conforme a autorização da tarefa em `cc4adc0`, com o hash local igual ao remoto.
- O PR [#3](https://github.com/SilveiraGomes/kilsystem-business/pull/3) foi integrado pelo responsável em 2026-11-16, no merge commit `4d0302ba753381ef481e090e1a73783567a17f66`.
  - A árvore do merge é idêntica à cabeça da branch.
  - A `main` local avançou por fast-forward e ficou alinhada com `origin/main`.
  - No código integrado foram repetidos e aprovados `pnpm check` (439/439, 12/12), os testes do desktop (6/6), o smoke Electron e `git diff --check`.
- E1.07-B: após `git fetch`, `main` local = `origin/main` = `a44c4943355facfd8f43bb837ef72104dded9639`, com a árvore limpa e o PR #3 integrado.
  - Trabalho na branch `feat/e107-b-local-authentication`, publicada conforme a autorização da tarefa.
  - PR para `main` preparado, sem merge automático. A descrição está em [tasks/E1.07-B.md](tasks/E1.07-B.md#pull-request).
- E1.07-B-M: após `git fetch`, `origin/main` = `8e77091a977c98371e20fa37a9bd1a910bef8b1b`.
  - O PR [#4](https://github.com/SilveiraGomes/kilsystem-business/pull/4) foi integrado pelo responsável em 2026-11-16T06:40:53Z, antes da conclusão da revisão (registado como divergência de processo).
  - Cabeça `f443057`, igual ao checkpoint revisto; a árvore do merge é idêntica à cabeça.
  - A `main` local avançou por fast-forward de `a44c494` para `8e77091`. Repositório público, sem alterações administrativas.
  - Branch `test/e107-b-m-race-coverage` publicada em `0b6587e` (hash local igual ao remoto), autorizada pelo responsável.
  - O PR [#5](https://github.com/SilveiraGomes/kilsystem-business/pull/5) integrou os dois testes em `main`, no merge `581699a7590a992f9c53a359867165ecff60d750`. A API confirmou um único ficheiro alterado (+65/−0), estado `clean` e nenhuma verificação remota configurada.
  - Após `git fetch`, a `main` local avançou por fast-forward de `8ac21b0` para `581699a`; `0b6587e` foi confirmado como ancestral. `pnpm check` passou com 516/516 e 12/12 builds; desktop 6/6; smoke Electron aprovado; auditoria com o PD-19 inalterado e produção com 0 vulnerabilidades.
- E1.07-C: após `git fetch`, `main` local = `origin/main` = `ab22404e829fca28e7fe4546b0d9af0dace9d21f`, com a árvore limpa.
  - Trabalho na branch `feat/e107-c-secure-sessions`, publicada para revisão independente.
  - A confirmação do *push* (hash local igual ao remoto) consta do relatório de entrega da tarefa.
  - PR preparado sem merge; a descrição está em [tasks/E1.07-C.md](tasks/E1.07-C.md#pull-request). A ferramenta `gh` continua indisponível.

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

### E1.07-C-M (revisão independente das sessões), 2026-11-16

Node.js 24.22.3 e pnpm 9.15.9, sobre a cabeça `0eb1e75` (local = remoto), contra `main` = `ab22404`:

- `pnpm.cmd lint`, `typecheck`, `test` (**578/578**, 14 ficheiros), `build` (12/12) e `check`: aprovados. Os 13 ficheiros anteriores mantêm as contagens da base (516/516 executados no código de `ab22404`); 62 novos; sem `skip`/`todo`.
- 578/578 também com os 13 directórios de build retirados. Desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK`; `git diff --check` sem erros.
- Mutações: as 9 variantes declaradas detectadas pelos mesmos testes; 9 mutações próprias, 5 detectadas (R4, R5, R6 e R9 não; RV-05, PD-48). Todos os ficheiros repostos (blobs iguais a `HEAD`).
- **Migração real** independente de uma base criada pelo código compilado de `ab22404`: **25/25**.
- Triggers: 37/38 verificações; `INSERT OR REPLACE` repõe a versão da credencial (RV-03, PD-46).
- Ensaio com dois processos sobre a mesma base temporária: 19/19 observações; ambos atingem `READY` e revogam as sessões um do outro (RV-02, PD-43).
- **Defeito Alto reproduzido** (RV-01, PD-45): relógio efectivo congelado após avanço e retrocesso do relógio de parede; uma sessão sem actividade há 22 dias reais continua válida.
- `pnpm audit`: 1 moderado (PD-19); `--prod`: 0. Nenhuma dependência alterada.

Detalhe completo em [tasks/E1.07-C-M.md](tasks/E1.07-C-M.md).

### E1.07-C (sessões locais), 2026-11-16

Node.js 24.22.3, pnpm 9.15.9, Electron 45.3.2, Vitest 5.1.0 e `better-sqlite3` 12.11.1 (SQLite 3.53.2), na branch `feat/e107-c-secure-sessions`:

- `pnpm.cmd lint`, `typecheck`, `build` (12/12) e `check`: aprovados.
- `pnpm.cmd test`: 14 ficheiros, **578/578**, sem testes ignorados nem `todo`.
  - Os 516 anteriores mantêm as contagens por ficheiro. Um teste de `local-authentication` passou a migrar explicitamente até ao esquema E1.07-B.
  - Novos: `local-sessions` 62 (S01–S58, P01–P03, K01), com a correspondência aos 58 testes obrigatórios em [tasks/E1.07-C.md](tasks/E1.07-C.md#correspondência-com-os-testes-obrigatórios).
- Os 578 testes passam também com os 13 directórios de build retirados.
- Testes do desktop: 6/6. Smoke Electron: `KIL_ELECTRON_SMOKE_OK`. `git diff --check`: sem erros.
- Mutações (seis defeitos exigidos, nove variantes): todas detectadas individualmente e repostas com SHA-256 idêntico.
- **Migração real** de uma base E1.07-B criada pelo código compilado de `ab22404`, verificada com o código compilado desta branch (25/25):
  - recusa estrita sem alterar o ficheiro;
  - aplicação só da migração 4;
  - dados, credenciais e checksums 1–3 preservados;
  - autenticação, recálculo de parâmetros com nova versão da credencial, sessões, revogação e reinício.
- Sem portas de rede (S58). Nenhuma dependência alterada. `pnpm audit`: 1 moderado (PD-19); `--prod`: 0.

Detalhe completo em [tasks/E1.07-C.md](tasks/E1.07-C.md).

### E1.07-B-M (revisão de segurança), 2026-11-16

Node.js 24.22.3, pnpm 9.15.9, Electron 45.3.2, Vitest 5.1.0 e `better-sqlite3` 12.11.1. A revisão de produção foi feita sobre `main` = `8e77091` (árvore igual a `f443057`); a integração dos testes foi revalidada sobre `main` = `581699a`:

- `pnpm.cmd lint`, `typecheck`, `test`, `build` (12/12) e `check`: aprovados, com **514/514**, também sem os 13 directórios de build.
- Testes do desktop: 6/6. Smoke Electron: `KIL_ELECTRON_SMOKE_OK`. `git diff --check`: sem erros. Sem `.only`, `.skip` nem `.todo`.
- Argon2id: o vector de teste do RFC 9106 §5.3 foi confirmado no runtime. A API é estável na v24.22.3 (era *release candidate* na v24.7.0).
- **Mutações:** retirar a revalidação do estado (M1) ou do *hash* da credencial (M2) na confirmação deixava os 514 testes verdes (RV-01, PD-37).
  - Corrigido em `0b6587e` com dois testes de regressão: 516/516 e cada mutação detectada; integrado pelo PR #5 no merge `581699a`. PD-37 encerrada.
- **Negação de serviço reproduzida:** 100 falhas com usernames arbitrários suspendem as autenticações de toda a instalação até 5 min, de forma renovável (PD-35).
- **Migração real independente** de uma base criada pelo código compilado de `a44c494`:
  - recusa estrita sem alterar a base;
  - aplicação só da migração 3;
  - 20/20 verificações (dados, checksums, esquema, FK, autenticação, inicialização sem promoção, registos sem segredos).
- Nenhuma dependência alterada. `pnpm audit`: 1 moderado (PD-19); `--prod`: 0.

Detalhe completo em [tasks/E1.07-B-M.md](tasks/E1.07-B-M.md).

### E1.07-B (autenticação local), 2026-11-16

Node.js 24.22.3, pnpm 9.15.9, Electron 45.3.2, Vitest 5.1.0 e `better-sqlite3` 12.11.1, na branch `feat/e107-b-local-authentication`:

- `pnpm.cmd lint`, `typecheck`, `build` (12/12) e `check`: aprovados.
- `pnpm.cmd test`: 13 ficheiros, **514/514**, sem testes ignorados nem `todo`.
  - Os 439 anteriores mantêm as contagens por ficheiro. Quatro testes de `identity-persistence` passaram a derivar as versões de `MIGRATIONS`.
  - Novos: `password-policy` 19, `password-hashing` 15 e `local-authentication` 41.
- Os 514 testes passam também com os 12 `dist/` retirados.
- Testes do desktop: 6/6. Smoke Electron real: `KIL_ELECTRON_SMOKE_OK`.
- Cinco mutações detectadas e repostas com SHA-256 idêntico:
  - palavra-passe errada aceite;
  - identidade suspensa elegível;
  - inicialização repetível (duas variantes);
  - limitação desactivada.
- **Desempenho** (i7-10510U, Argon2id m = 64 MiB, t = 3, p = 4): ~330 ms por verificação, e 16 verificações em simultâneo em ~3,8 s, com um pico de ~130 MiB graças ao limite de 2 derivações.
- **Migração real** de uma base E1.07-A criada pelo código compilado de `a44c494`:
  - recusa com política estrita;
  - aplicação só da migração 3;
  - checksums 1 e 2 e todas as linhas preservados;
  - credencial, autenticação e inicialização com o código compilado desta branch.
- Nenhuma dependência alterada. `pnpm audit`: 1 moderado (PD-19); `--prod`: 0.

Detalhe completo em [tasks/E1.07-B.md](tasks/E1.07-B.md).

### E1.07-A (identidade e associações), 2026-11-15

Node.js 24.22.3, pnpm 9.15.9, Electron 45.3.2, Vitest 5.1.0 e `better-sqlite3` 12.11.1, na branch `feat/e107-a-user-identity`:

- `pnpm.cmd lint`, `typecheck`, `build` (12/12) e `check`: aprovados.
- `pnpm.cmd test`: 10 ficheiros, **439/439**, sem testes ignorados nem `todo`.
  - Os 281 anteriores mantêm as contagens por ficheiro. Oito foram ajustados para derivar as versões de `MIGRATIONS`, sem reduzir as asserções (lista em [tasks/E1.07-A.md](tasks/E1.07-A.md#testes-anteriores-281)).
  - Novos: `identity-contracts` 73, `identity-isolation` 60 (SQLite e serviço) e `identity-persistence` 25.
- Os 439 testes passam também com os 12 `dist/` retirados.
- Testes do desktop: 6/6. Smoke Electron real: `KIL_ELECTRON_SMOKE_OK`.
- Mutações controladas, todas detectadas e repostas com SHA-256 idêntico:
  - filtro de tenant nas associações;
  - estabelecimento de outro tenant (no repositório e na FK);
  - associação empresarial e local `INACTIVE` ignoradas.
- **Migração real** de uma base E1.04 criada pelo código compilado da `main` anterior, com dados fictícios:
  - o serviço desta branch recusou com política estrita;
  - aplicou só a migração 2 com `apply`, e a reexecução não aplicou nada;
  - checksum da migração 1 e linhas de empresas e estabelecimentos idênticos;
  - identidade e associação provisionadas sobre a empresa antiga.
- Nenhuma dependência alterada (`package.json` e `pnpm-lock.yaml` intactos).

Detalhe completo em [tasks/E1.07-A.md](tasks/E1.07-A.md).

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
| Testes de identidades e associações | `pnpm test identity` | `package.json` (filtro do Vitest) |
| Testes de autenticação e palavras-passe | `pnpm test authentication password` | `package.json` (filtro do Vitest) |
| Testes de sessões locais (E1.07-C) | `pnpm test local-sessions` | `package.json` (filtro do Vitest) |
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
- Identidades locais (`User`), associações a empresas (`CompanyMembership`) e a estabelecimentos (`BranchMembership`), migração 2 e avaliação interna de elegibilidade (E1.07-A). Disponíveis apenas na composição interna do serviço local.
- Autenticação local offline por username e palavra-passe (E1.07-B):
  - credenciais Argon2id (migração 3);
  - política NIST SP 800-63B;
  - limitação persistente de tentativas;
  - gestão interna de credenciais;
  - inicialização explícita da instalação.

  Sem permissões. Disponível apenas na composição interna do serviço local.
- Sessões locais revogáveis (E1.07-C, branch `feat/e107-c-secure-sessions`, por integrar):
  - comprovativo interno de autenticação;
  - versões de segurança (migração 4);
  - tokens opacos;
  - expiração por inactividade e absoluta, limite de 5 sessões, logout, revogação e limpeza.

  Sem permissões nem tenant. Disponível apenas na composição interna do serviço local.

### Demonstrativas, sem dados nem regras de negócio

- Dashboard com indicadores fixos, barra de contexto com textos fixos (incluindo “Sistema local disponível”), perfil, pesquisa e notificações apenas visuais.
- Páginas de módulos com estado vazio; ainda não usam os contratos, a persistência nem o serviço local.
- Portal administrativo estático.
- Duplo de teste em memória (`tests/support/in-memory-tenant-repositories.ts`): serve apenas para testes e não é persistência.

### Ainda não desenvolvidas

- Implementação das decisões de domínio D-055, D-058, D-060 e D-061 (PD-14 a PD-16).
- Autorização RBAC, protecção avançada de contas e auditoria (E1.07-D a E1.07-F); ferramenta operacional de inicialização (PD-31); API local e integração Electron (E1.08), incluindo o transporte da sessão (PD-42).
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
| PD-18 | Vitest 2.1.9 (só desenvolvimento): 3 alertas críticos (servidor UI do Vitest e `tinypool`) e outros via Vite 5 interno e `@vitest/mocker`. Não eram exploráveis no uso actual (sem servidor UI, sem entradas não confiáveis). | — | **Resolvida em E1.06-S2** (D-077, D-078): Vitest 5.1.0; os 15 alertas do Vitest, do Vite 5.4.21 interno, do `esbuild` 0.21.5 e do `tinypool` foram eliminados (15 → 0), com 281/281 testes e instalação limpa aprovados. **Encerrada** após a confirmação da integração em `main` (PR #2, `d29a629`) e a revalidação em E1.06-S2-M. |
| PD-19 | `minimatch` 10.2.6 (moderado, ReDoS, `GHSA-g3hv-75wg-m249`; corrigido em ≥ 11.0.1) via typescript-eslint 8.72.2. | Só desenvolvimento (lint). | Aberta. Reverificada em E1.06-S2: a 8.72.2 continua a ser a `latest` e declara `minimatch ^10.2.2`. Aguarda correcção a montante; sem *override*. Por D-079 (decisão do responsável em E1.06-S2-M), não bloqueia por si só a E1.07, desde que a avaliação de risco se mantenha documentada: só lint de desenvolvimento, padrões definidos pelo projecto, fora do runtime distribuído, `audit --prod` com 0. |
| PD-20 | pnpm 9.15.9 é uma linha antiga (última 12.18.0). O pnpm 10 ou superior bloqueia *build scripts* por omissão (`better-sqlite3`, `electron`, `esbuild`). | Manutenção do gestor de pacotes. | Aberta; avaliação própria. |
| PD-21 | O Node 24 está em *Maintenance* LTS (fim a 2028-04-30); o Node 26 é a *Active LTS* desde 2026-10-28. O `better-sqlite3` 12.11.1 não publica binário Windows para o Node 26. | Planeamento futuro. | Aberta; planear a migração antes do fim de suporte. |
| PD-22 | Um processo lançado por outro que ignore Ctrl+C (`SetConsoleCtrlHandler(NULL, TRUE)` herdado) não recebe `SIGINT`. Observado em E1.06 a partir de uma shell não interactiva. | Encerramento por Ctrl+C depende de quem lança o serviço. | Informativo; em instalação, o encerramento será feito pelo gestor de serviços Windows (E1.10). |
| PD-23 | Outras dependências com versões principais novas, sem alertas de segurança: React 19, Vite 8, TypeScript 7, jsdom 31, `@vitejs/plugin-react` 6, `lucide-react` 1.x, entre outras. Não foram actualizadas, por instrução. | Dívida técnica. | Informativo; lista em [tasks/E1.06.md](tasks/E1.06.md). O Vitest foi actualizado em E1.06-S2 (D-077). |
| PD-24 | O intervalo declarado do Vite (`^6.0.3` na raiz e no catálogo) admite versões abaixo do mínimo exigido pelo Vitest 5 (`>=6.4.0`). O lockfile fixa a 6.4.6, que cumpre o requisito. | Uma resolução nova fora do lockfile poderia escolher um Vite incompatível. | Aberta, de baixo impacto. Por decisão do responsável (E1.06-S2-M), a correcção do intervalo mínimo é feita numa tarefa controlada própria, e não nesta revisão. |
| PD-25 | O pnpm reporta as subdependências descontinuadas `prebuild-install` 7.1.3 (via `better-sqlite3`) e `whatwg-encoding` 3.1.1 (via jsdom 25). Já existiam no lockfile da `main` antes de E1.06-S2. | Nenhum alerta de segurança associado. | Informativo; reavaliar com futuras versões de `better-sqlite3` e jsdom (PD-23). |
| PD-26 | O provisionamento de identidades e as alterações de associações não registam o actor nem o histórico de alterações; só existem os registos com `updatedAt`. O `UserDirectory` não recebe contexto de actor. Desde E1.07-B, também não são auditados as autenticações, os bloqueios, a criação e substituição de credenciais e a inicialização da instalação, que de propósito não são escritos nos registos. Desde E1.07-C, também não são auditados a criação, expiração, revogação e encerramento de sessões (os registos do serviço só têm contagens no arranque). | Rastreabilidade administrativa e de segurança incompleta. | Aberta. Por D-098, a auditoria de autenticação, credenciais, sessões e provisionamento entra em E1.07-E. A retenção técnica das sessões (30 dias, D-115) é provisória. Por D-123, a auditoria inclui criação, expiração, revogação e encerramento de sessões. |
| PD-27 | O `TenantContext` continua a ser construído pelo chamador e não deriva de identidade autenticada (`AGENTS.md`). Os repositórios isolam correctamente, mas a origem do contexto não é verificada. | Nenhuma operação deve ser exposta antes da correcção. | Aberta; **avanço parcial em E1.07-C**: existe uma sessão confiável que comprova a identidade autenticada (D-107 a D-116), mas o `TenantContext` ainda não é derivado dela. Encerramento em E1.07-D, obrigatório antes de E1.08. |
| PD-28 | Criar uma associação com um `userId` inexistente devolve `RecordNotFoundError('User')`, o que permite a um chamador interno com contexto empresarial saber se uma identidade existe na instalação. | Aceitável enquanto o provisionamento for interno. | Aberta; rever antes de qualquer exposição (E1.08, E1.07-F). |
| PD-29 | A eliminação física de um estabelecimento ou de uma empresa com associações é recusada pela base (`PersistenceError('constraint')`), não por um erro de domínio específico. Os dados ficam preservados. | Mensagem menos explícita para o chamador. | Aberta. Por D-099, é resolvida antes da exposição da API empresarial. |
| PD-30 | A identidade só admite alteração de estado; nome de apresentação, email e telefone não podem ser alterados nesta etapa, por decisão de âmbito (sem alteração arbitrária de identidades partilhadas). | Correcções de dados pessoais exigem tarefa própria. | Aberta; definir o processo autorizado e auditado (E1.07-E). |
| PD-31 | Não existe ferramenta operacional para a inicialização da instalação (D-096). A operação só existe na composição interna do serviço. Quando existir, a ferramenta tem de usar entrada interactiva protegida, sem palavras-passe em argumentos nem em ficheiros de configuração. | Instalações reais não podem ser inicializadas por um operador. Hoje a única fronteira de confiança é o acesso ao processo do serviço e as permissões do ficheiro SQLite; até à inicialização, a primeira chamada vence. | Aberta. Por D-100, implementada em E1.07-E, antes de disponibilizar login operacional. |
| PD-32 | Sem *pepper*: a NIST SP 800-63B recomenda uma derivação com chave secreta guardada separadamente da base, que não foi implementada por falta de armazenamento de segredos protegido pelo sistema operativo (por exemplo, DPAPI). | Quem obtiver a base pode tentar ataques offline, abrandados apenas pelo Argon2id. | Aberta. Por D-101, *pepper*, armazenamento externo protegido, rotação e recuperação são avaliados em E1.07-E e E1.10. |
| PD-33 | A lista local de palavras-passe comuns ou comprometidas está vazia por omissão (`EMPTY_COMMON_PASSWORD_LIST`). O mecanismo existe e é configurável (`commonPasswords`). | Palavras-passe comuns de 15 ou mais caracteres não são recusadas. | Aberta. Por D-102, uma lista local efectiva é implementada em E1.07-E (fonte, licença e actualização a definir). |
| PD-34 | Canais temporais: as recusas `throttled` e as entradas com formato inválido respondem sem derivação; credenciais com parâmetros antigos têm custo diferente até serem recalculadas; o percurso não é de tempo constante de ponta a ponta. Não revela directamente a existência de utilizadores, mas não está demonstrado por medição. | Risco residual de enumeração por tempo. | Aberta. Por D-103, avaliada no Gate E1.07-F. |
| PD-35 | Desvio da NIST na limitação: não há desactivação após 100 falhas consecutivas, porque bloqueios permanentes estão proibidos. Depois da escalada, uma conta admite até 4 tentativas por hora (bloqueio máximo de 15 min). O limite da instância (100 falhas em 5 min) pode ser usado para negação de serviço local durante até 5 min. | Equilíbrio entre força bruta e disponibilidade por decidir. Reproduzido em E1.07-B-M: 100 falhas com usernames arbitrários suspendem toda a instalação até 5 min, de forma renovável; 1 tentativa a cada 15 min mantém uma conta bloqueada. | Aberta. Por D-104, em E1.07-E: limite de falhas consecutivas e recuperação controlada da credencial. Distinguir bloqueio temporário, desactivação da credencial e da identidade, sem bloqueio irreversível. Medidas propostas em [E1.07-B-M](tasks/E1.07-B-M.md#protecção-contra-abuso-e-negação-de-serviço). Nenhum controlo é retirado. |
| PD-36 | As chaves de limitação são `user:` + SHA-256 sem chave. Como os usernames são ASCII de baixa entropia, quem tiver a base pode recuperá-los por dicionário. | Exposição de usernames (incluindo tentados e inexistentes) a quem obtiver a base. | Aberta. Por D-105, avaliar HMAC com chave externa protegida; planeado para E1.07-E. |
| PD-37 | As revalidações do estado e do *hash* da credencial na confirmação da autenticação não estavam cobertas por testes. Retirar qualquer delas deixava os 514 testes verdes (RV-01). | Uma regressão permitiria autenticar uma identidade suspensa ou uma palavra-passe antiga durante uma corrida. | **Encerrada.** Corrigida em `0b6587e`: dois testes, 516/516, cada mutação detectada; integrada em `main` pelo PR #5, merge `581699a`. |
| PD-38 | Os limites superiores dos parâmetros Argon2id são largos (m ≤ 1 GiB, t ≤ 16, p ≤ 16), em código e em `CHECK` (RV-04). | Uma credencial adulterada pode custar ~1 GiB por verificação (2 GiB em paralelo). Exige acesso de escrita à base. | Aberta; proposta: limitar, por exemplo, a 4× os parâmetros de produção, com nova migração. Etapa por decidir (proposta: E1.07-E). |
| PD-39 | Uma recusa `busy` (fila de derivações cheia) lança `PasswordHashingError` depois de a falha já ter sido contada (RV-03). | Sob carga ou ataque, um utilizador legítimo acumula falhas e recebe uma excepção em vez de um resultado. | Aberta; proposta: devolver a falha antecipada e um resultado tipado. Antes de E1.08 (proposta: E1.07-E). |
| PD-40 | Uma `AuthenticatedIdentity` continua reconhecida por `isAuthenticatedIdentity` durante toda a vida do processo, após suspensão, substituição da credencial ou reinício do serviço (RV-05). | Sem consumidores hoje. Uma sessão que a aceite sem revalidar sobreviveria à perda de elegibilidade. | **Resolvida em E1.07-C** (branch por integrar): a criação de sessões exige um comprovativo interno de 60 s, de utilização única e atómica, ligado ao arranque e às versões de segurança, com revalidação na criação e em cada utilização (D-108, D-110, D-114). Testes S01–S12, S41–S44; mutações M1, M2a, M3a e M4a detectadas. Encerramento formal após revisão e integração (D-118). A revisão E1.07-C-M confirmou o comprovativo, mas suspendeu o merge por RV-01 (PD-45). |
| PD-41 | Qualquer reinício do serviço (actualização, falha, reinício do posto) termina todas as sessões (D-114). | Intencional e conservador, mas obriga a novo login em todos os postos após cada reinício. | Aberta. Por D-119, mantém-se na arquitectura actual, sem recuperação automática de sessões; disponibilidade a avaliar com os postos POS e a instalação (E1.08, E1.10). |
| PD-42 | O transporte e a guarda do token de sessão até à interface (loopback, memória do renderer, registos do Electron) não estão definidos. O token é um segredo ao portador. | Uma exposição errada permitiria usar a sessão a partir de outro processo local. | Aberta; requisito de E1.08. Por D-120, o token nunca é guardado em `localStorage`. |
| PD-43 | Assume-se um único serviço local por base, mas a premissa não é imposta. Reproduzido em E1.07-C-M (RV-02): dois processos atingem `READY` sobre a mesma base; cada arranque revoga as sessões do outro (`service-restarted`); o limite de 5 sessões passa a valer por processo; a limitação de tentativas é partilhada. | Revogações inesperadas, limite de sessões contornável e semântica do reinício perdida. | Aberta; **bloqueante para E1.08** (D-121). Proposta em [E1.07-C-M](tasks/E1.07-C-M.md#ciclo-de-vida-e-pd-43-secção-9): bloqueio exclusivo do SQLite (`locking_mode = EXCLUSIVE`) adquirido antes de `READY`, recusa `database-locked` e recuperação automática pelo sistema operativo após terminação inesperada (prova de conceito executada). Tarefa específica antes de E1.08. |
| PD-44 | Divergência de planeamento: a especificação preliminar de E1.07-C previa revogar sessões na desactivação de associações ou estabelecimentos. A autorização de E1.07-C não o inclui, porque a sessão não tem empresa. | A perda de elegibilidade empresarial não termina a sessão; tem de ser reavaliada em cada operação. | Aberta; a cumprir pela autorização em E1.07-D. Por D-122, a sessão global não é necessariamente revogada, mas o acesso à empresa afectada cessa imediatamente e a autorização é revalidada em cada operação protegida. |
| PD-45 | RV-01 (E1.07-C-M): `createSessionClock` congela o instante efectivo depois de um avanço seguido de retrocesso do relógio de parede. Sessões criadas no intervalo não expiram por inactividade nem de forma absoluta, e os comprovativos não expiram, até o tempo real alcançar o instante adiantado ou o serviço reiniciar. O teste K01 afirma o congelamento. | Prolongamento indevido de sessões, de dimensão igual ao salto do relógio. | Aberta; **bloqueia o merge de E1.07-C**. Correcção proposta (avanço pelo monotónico desde a última leitura) e testes K02 e S47b em [E1.07-C-M](tasks/E1.07-C-M.md#rv-01--relógio-efectivo-congelado-após-avanço-e-retrocesso-alto); exige autorização específica. |
| PD-46 | RV-03 (E1.07-C-M): `INSERT OR REPLACE` sobre `password_credentials` repõe `credential_version` a 1 sem revogar sessões, porque a eliminação implícita não activa `password_credentials_never_deleted`. Nenhum caminho do código o usa. | Defesa em profundidade incompleta; exige escrita SQL directa na base. | Aberta, baixa; proposta: trigger `BEFORE INSERT` que recuse credencial existente, numa migração aditiva. |
| PD-47 | RV-04 (E1.07-C-M): a limpeza no arranque calcula a retenção só com o relógio de parede; com a parede adiantada 1 ano, todos os registos terminados foram eliminados. | Perda de registos técnicos de sessões por erro de relógio. | Aberta, baixa; a tratar com a retenção definitiva e a auditoria (E1.07-E). |
| PD-48 | RV-05 (E1.07-C-M): mutações não detectadas pela suite: R4 (versões do comprovativo lidas antes do recálculo de parâmetros), R5 (tecto da política), R6 (registos no futuro) e R9 (idade negativa do comprovativo). | Uma regressão em R4 recusaria a primeira sessão após recálculo sem falhar testes. | Aberta, baixa; testes propostos em [E1.07-C-M](tasks/E1.07-C-M.md#mutações-secção-13). |

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
   - E1.06-S2 está integrada em `main` através do PR #2 (`d29a629`).
   - E1.07-A está integrada em `main` através do PR #3 (`4d0302b`).
   - E1.07-B está integrada em `main` através do PR #4 (`8e77091`) e revista em E1.07-B-M.
   - Os testes de regressão de E1.07-B-M estão integrados em `main` (PR #5, merge `581699a`).
   - E1.07-C está na branch `feat/e107-c-secure-sessions`, em revisão independente e sem merge.
   - E1.07-D a E1.07-F e E1.08 a E1.10 estão **planeadas mas não autorizadas**.
   - E1.06-S1 está integrada em `main` através do PR #1.
6. Trabalhar apenas no âmbito da tarefa. Regras a manter:
   - qualquer implementação nova de repositório tem de passar `tests/support/tenant-repository-contract.ts` (D-021);
   - qualquer implementação de identidades ou associações tem de passar `tests/support/membership-repository-contract.ts` (D-089);
   - o directório de identidades (`UserDirectory`) é provisionamento interno: nunca o expor a um tenant, por HTTP ou por IPC (D-087);
   - autenticação, credenciais e inicialização são internas (D-093 a D-096). Uma `AuthenticatedIdentity` só é válida se `isAuthenticatedIdentity` a reconhecer, e nunca é uma autorização empresarial;
   - sessões só se criam com o comprovativo interno (D-108). Tokens nunca em registos, erros, base ou documentação (D-113). Qualquer novo caminho de escrita sobre o estado da identidade ou a credencial tem de respeitar os triggers de versão da migração 4 (D-110, D-111). A administração de sessões é interna (D-116);
   - parâmetros de derivação nunca abaixo do mínimo OWASP (D-090); palavras-passe, *hashes* e sais nunca em registos;
   - o acesso à base passa pelo serviço local em `READY` (D-047).

   Registar divergências na tabela de pendências e decisões novas aprovadas em `decisions.md`.
7. Ao concluir:
   1. Executar `pnpm.cmd check` (e `smoke` se o desktop for alterado).
   2. Actualizar o ficheiro da tarefa e este documento.
   3. Criar um único commit com a mensagem indicada na tarefa e confirmar que a árvore de trabalho está limpa.
   4. Publicar a branch da tarefa com `git push origin <branch>`, sem *force*. A integração em `main` só acontece após revisão independente e aprovação do responsável (D-117).
   5. Confirmar que `git rev-parse HEAD` é igual a `git ls-remote origin refs/heads/<branch>`.

   A tarefa só conta como publicada depois desta confirmação. Se a autenticação falhar, comunicar o bloqueio. A ferramenta `gh` não está instalada nesta máquina; o `push` usa o gestor de credenciais do Git.
