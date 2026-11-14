# Estado do projecto

Última verificação: 2026-11-14, no fecho da tarefa E1.05 (ponto de partida `d713c3c`).

Este documento é o ponto de retoma para qualquer agente ou pessoa. Contém apenas factos verificados no repositório ou por execução; o que não foi executado está marcado como tal.

## Resumo

| Etapa | Estado | Commit | Detalhe |
| --- | --- | --- | --- |
| E1.01 — Fundação tecnológica | Concluída | `ff5ba65` | [tasks/E1.01.md](tasks/E1.01.md) |
| E1.02 — Aplicação desktop funcional | Concluída | `b113388` | [tasks/E1.02.md](tasks/E1.02.md) |
| E1.02-H — Handoff multi-IA | Concluída | `68b7f98` | — |
| E1.03 — Contratos multiempresa e isolamento lógico | Concluída | `7ce5bb0` | [tasks/E1.03.md](tasks/E1.03.md) |
| E1.04 — Persistência SQLite e repositórios multiempresa | Concluída | `d713c3c` | [tasks/E1.04.md](tasks/E1.04.md) |
| E1.05 — Inicialização e ciclo de vida do serviço local | Concluída | `feat: implement local service lifecycle` | [tasks/E1.05.md](tasks/E1.05.md) |

Tarefa activa: nenhuma. A próxima etapa não está definida (PD-06) e exige autorização explícita.

## Validação verificada

Executada em 2026-11-14 com Node.js 20.16.0 e pnpm 9.15.9, no fecho de E1.05:

- `pnpm.cmd lint` e `pnpm.cmd typecheck`: sem erros.
- `pnpm.cmd test`: 7 ficheiros, 279 testes aprovados:
  - `foundation` 1;
  - `desktop-security` 2;
  - `desktop-ui` 2;
  - `domain-contracts` 56;
  - `tenant-isolation` 132 (suite de contrato × memória, SQLite e serviço local);
  - `sqlite-persistence` 34;
  - `local-service` 52.
- `pnpm.cmd build`: 12 de 12 projectos do workspace.
- `pnpm.cmd check`: código de saída 0.
- `pnpm.cmd --filter @kil-business/desktop test`: 2 ficheiros, 4 testes aprovados.
- `pnpm.cmd --filter @kil-business/desktop smoke`: `KIL_ELECTRON_SMOKE_OK` (detalhe da execução em [tasks/E1.05.md](tasks/E1.05.md)).
- Serviço local executado a partir de `dist/` em Node puro:
  - `--check` com criação e migração;
  - `--check` com política estrita;
  - caminho proibido recusado;
  - modo contínuo e reabertura após terminação forçada.
- Mutações do ciclo de vida detectadas pelos testes (detalhe em [tasks/E1.05.md](tasks/E1.05.md)).
- **Não verificado**:
  - `pnpm --filter @kil-business/desktop dev` (processo interactivo de longa duração);
  - encerramento do serviço por `Ctrl+C` numa consola real (coberto por teste com sinal injectado).

## Comandos

Requisitos: Node.js `>=20.16.0 <23`, pnpm `>=9.15.0 <10` (fixado em `pnpm@9.15.9`). Em Windows sem binário pré-compilado do `better-sqlite3`, `pnpm install` compila-o e precisa de Visual Studio 2022 (C++) e Python 3. Em PowerShell, usar `pnpm.cmd` em vez de `pnpm` se a política de execução bloquear `pnpm.ps1`.

| Objectivo | Comando | Origem |
| --- | --- | --- |
| Instalar dependências | `pnpm install` | raiz |
| Validação completa | `pnpm check` (lint → typecheck → test → build) | `package.json` |
| Lint | `pnpm lint` | `package.json` |
| Typecheck global | `pnpm typecheck` | `package.json` |
| Testes | `pnpm test` | `package.json` |
| Testes do desktop | `pnpm test:desktop` ou `pnpm --filter @kil-business/desktop test` | `package.json`, `apps/desktop/package.json` |
| Testes multiempresa e SQLite | `pnpm test tenant domain-contracts sqlite` | `package.json` (filtro do Vitest) |
| Testes do serviço local | `pnpm test local-service` | `package.json` (filtro do Vitest) |
| Testes em modo observação | `pnpm test:watch` | `package.json` |
| Build de todos os projectos | `pnpm build` | `package.json` |
| Build do serviço local | `pnpm --filter @kil-business/local-api build` | `services/local-api/package.json` |
| Verificar arranque do serviço | `pnpm --filter @kil-business/local-api start:check` | `services/local-api/package.json` |
| Iniciar o serviço (encerrar com Ctrl+C) | `pnpm --filter @kil-business/local-api start` | `services/local-api/package.json` |
| Desktop em desenvolvimento | `pnpm --filter @kil-business/desktop dev` | `apps/desktop/package.json` |
| Build do desktop | `pnpm --filter @kil-business/desktop build` | `apps/desktop/package.json` |
| Smoke test do Electron | `pnpm --filter @kil-business/desktop smoke` | `apps/desktop/package.json` |
| Typecheck do desktop | `pnpm --filter @kil-business/desktop typecheck` | `apps/desktop/package.json` |
| Portal administrativo | `pnpm --filter @kil-business/admin-portal dev` | `apps/admin-portal/package.json` |

O serviço local exige as variáveis `LOCAL_DATABASE_PATH` e `LOCAL_SERVICE_*` no ambiente do processo; nenhum ficheiro `.env` é carregado. A tabela de variáveis está em [architecture.md](architecture.md#serviço-local-e105) e um exemplo completo em PowerShell em [tasks/E1.05.md](tasks/E1.05.md#comandos-do-serviço).

Notas sobre o arranque do Electron:

- `dev` inicia o Vite em `http://127.0.0.1:5173` (porta fixa, `--strictPort`), compila o processo principal e o preload, aguarda a porta e arranca o Electron com `VITE_DEV_SERVER_URL`.
- Não existe script `start` no desktop. Fora do modo `dev`, o arranque é feito por `apps/desktop/scripts/run-electron.mjs` sobre o resultado do `build`, que é o mecanismo usado pelo `smoke`.
- `smoke` arranca o Electron com a janela oculta e verifica três condições: o dashboard está renderizado, o preload está carregado e `window.kilDesktop` expõe apenas `runtime`.

## Funcionalidades

### Implementadas

- Monorepositório pnpm com 12 projectos, TypeScript estrito, ESLint com verificação de tipos e Vitest. Os pacotes do workspace resolvem a partir do código-fonte em typecheck, lint e testes (condição `source`) e a partir de `dist/` em execução.
- Processo principal Electron com renderer isolado e preload mínimo e imutável; modo de smoke test.
- Navegação funcional entre 8 áreas da interface desktop (estado React em memória).
- Contratos de domínio multiempresa (`packages/shared-types`):
  - `Company` com 4 estados, jurisdição e NIF validado por política fiscal configurável;
  - `Branch` com código normalizado;
  - `TenantContext`;
  - identificadores com tipos distintos;
  - os 4 sectores;
  - desactivação lógica.
- Persistência SQLite local (`packages/database`):
  - ligação com chaves estrangeiras activas;
  - validação da localização;
  - migrações versionadas com soma de verificação e inspecção sem escrita;
  - esquema com isolamento e integridade;
  - repositórios multiempresa com transacções e tradução de erros.
- Serviço local Node.js (`services/local-api`), independente do Electron:
  - configuração tipada a partir do ambiente;
  - política de inicialização;
  - máquina de estados com arranque e encerramento idempotentes;
  - libertação da ligação em qualquer falha e recuperação;
  - registos estruturados sem dados sensíveis;
  - repositórios disponíveis apenas em `READY`;
  - executável com `--check` e modo contínuo.

  Sem HTTP nem portas de rede.

### Demonstrativas, sem dados nem regras de negócio

- Dashboard com indicadores fixos (“Kz 0,00”, “0”), marcado como “Dados de demonstração”.
- Barra de contexto com “KIL Demonstração · Unidade Sede”, “Sistema local disponível” e “Sem dados reais”. São textos fixos.
- Perfil, pesquisa, notificações e botão “Hoje”: só existem visualmente.
- Páginas Empresas, Estabelecimentos, Utilizadores, Vendas, Stock, Contabilidade e Configurações: estado vazio. Ainda não usam os contratos, a persistência nem o serviço local.
- Portal administrativo: página estática.
- Duplo de teste em memória (`tests/support/in-memory-tenant-repositories.ts`): serve apenas para testes e não é persistência.

### Ainda não desenvolvidas

- Comunicação entre o desktop e o serviço local; quem inicia e supervisiona o serviço numa instalação.
- Localização de produção da base, cópias de segurança e recuperação.
- Regra de validação do NIF para qualquer jurisdição real. Sem ela, nenhuma empresa pode ficar `ACTIVE` (PD-09).
- Endpoints nas APIs local e central.
- Autenticação, autorização, sessões e utilizadores; o `TenantContext` ainda não provém de identidade autenticada.
- PostgreSQL e persistência central.
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
| PD-01 | `pnpm --filter @kil-business/desktop test` não encontrava testes. | — | Resolvida em E1.03 (D-022). |
| PD-02 | Os quatro sectores não estavam identificados. | — | Resolvida em E1.03 (D-018). |
| PD-03 | Variáveis de `.env.example` sem leitura no código. `LOCAL_DATABASE_PATH` e `LOCAL_SERVICE_*` passaram a ser lidas pelo serviço local (D-043). As restantes (`LOCAL_API_*`, `CENTRAL_*`, `SYNC_*`, `KIL_LICENSE_*`, `NODE_ENV`) continuam sem uso. | Apenas documental. | Parcialmente resolvida em E1.05. |
| PD-04 | A interface mostra “Sistema local disponível” sem verificação real. | Pode induzir em erro fora do contexto demonstrativo. | Rever quando existir comunicação com o serviço local. |
| PD-05 | O directório `.git` pertence ao utilizador `CodexSandboxOffline`. Outros utilizadores Windows recebem *dubious ownership*. | Bloqueia comandos Git noutros agentes. | Contornado com `git -c safe.directory=C:/KIL-BUSINESS`; decisão a cargo do responsável. |
| PD-06 | O plano de etapas posteriores a E1.05 não consta do repositório. | Agentes não podem antecipar etapas. | Requer planeamento do responsável. |
| PD-07 | Escolhas de concretização de E1.03. | — | Resolvida em E1.04 (D-023 a D-027). |
| PD-08 | Consumo de pacotes do workspace através de `dist/`. | — | Resolvida em E1.04 (D-037). |
| PD-09 | Validação fiscal angolana por consolidar: nenhuma regra de NIF está configurada para uma jurisdição real (incluindo `AO`). Com a política fail-closed (D-030), nenhuma empresa pode ser criada como `ACTIVE`, nem passar a esse estado, fora dos testes. Empresas `DRAFT` podem ser criadas. | Bloqueia empresas activas reais. | Mantida. Requer fonte normativa, versão e vigência (D-024, `AGENTS.md`). |
| PD-10 | Compilação nativa do driver: o `better-sqlite3` 12.11.1 não tem binário pré-compilado para Node 20.16 em Windows x64 e é compilado na instalação (Visual Studio 2022 C++ e Python 3). Com D-041 (serviço em Node), não é preciso recompilar para o Electron. | Afecta máquinas de desenvolvimento, CI e distribuição. | Mantida; estratégia de distribuição por decidir. |
| PD-11 | Interpretações de domínio de E1.04 a confirmar (D-031): `id ≠ tenantId`, NIF obrigatório só em `ACTIVE`, estados D-025 só nas empresas, NIF sem unicidade, transições de estado livres. A autorização E1.05 refere “decisões de domínio actualizadas nesta autorização”, mas o texto recebido não contém essas decisões. | Definem regras de dados e o esquema. | Mantida; nenhuma regra de domínio foi alterada em E1.05. Requer as decisões explícitas do responsável. |
| PD-12 | Migração futura do Node 20 para uma versão LTS suportada. O projecto exige Node.js `>=20.16 <23`; a linha 20 terminou o suporte oficial em 2026-04-30, segundo o calendário publicado do Node.js. O `better-sqlite3` 13.x já exige Node ≥ 22. | Risco de manutenção e de segurança. | Mantida (D-029); decisão do responsável. |
| PD-13 | Mensagens GPU ocasionais no encerramento do Electron (`ERROR:command_buffer_proxy_impl.cc(324)] GPU state invalid after WaitForGetOffsetInRange`). O smoke test terminou sempre com `KIL_ELECTRON_SMOKE_OK` e código 0. | Ruído de log do Chromium; não falha a verificação. | Mantida; `apps/desktop` não foi alterado em E1.05. |

As decisões arquitecturais ainda em aberto estão em [architecture.md](architecture.md#decisões-pendentes).

## Como retomar numa sessão nova

1. Ler [AGENTS.md](../AGENTS.md), este documento, [architecture.md](architecture.md), [decisions.md](decisions.md) e [implementation-plan.md](implementation-plan.md).
2. Confirmar o estado real:
   ```sh
   git -c safe.directory=C:/KIL-BUSINESS log --oneline -n 10
   git -c safe.directory=C:/KIL-BUSINESS status
   ```
   O último commit deve ser `feat: implement local service lifecycle` ou posterior a ele, com registo neste documento. Se não corresponder, actualizar este documento antes de outro trabalho.
3. Executar `pnpm.cmd install` (se `node_modules` não existir; ver os requisitos de compilação acima) e `pnpm.cmd check` para obter a linha de base. Registar qualquer falha antes de alterar código.
4. Identificar a tarefa activa em `docs/tasks/`. Não existe tarefa activa nem proposta: pedir ao responsável a definição e autorização da próxima etapa.
5. Trabalhar apenas no âmbito da tarefa. Regras a manter:
   - qualquer implementação nova de repositório tem de passar `tests/support/tenant-repository-contract.ts` (D-021);
   - o acesso à base passa pelo serviço local em `READY` (D-047).

   Registar divergências na tabela de pendências e decisões novas aprovadas em `decisions.md`.
6. Ao concluir: executar `pnpm.cmd check` (e `smoke` se o desktop for alterado). Depois, actualizar o ficheiro da tarefa e este documento, criar um único commit com a mensagem indicada na tarefa e confirmar que a árvore de trabalho está limpa.
