# Arquitectura inicial

## Estado deste documento

Este documento regista a fundação E1.01, a primeira aplicação desktop E1.02, a arquitectura de negócio consolidada em E1.02-H, os contratos multiempresa de E1.03, a persistência SQLite de E1.04, o ciclo de vida do serviço local de E1.05, o ambiente de execução e as decisões de E1.06, a actualização segura do Electron em E1.06-S1, a modernização do Vitest em E1.06-S2, a identidade local com associações multiempresa de E1.07-A, a autenticação local offline de E1.07-B, as sessões locais revogáveis de E1.07-C, a exclusividade por base de E1.07-X, os contratos de autorização RBAC de E1.07-D1 e a persistência RBAC com motor interno de E1.07-D2 (ambos não operacionais), e — só na branch de E1.07-D3-G0, a rever — as protecções do Gate da instalação (migração 8, âncora, pré-verificação PD-76), sem nenhuma autoridade activada. “Definido” significa uma decisão já fornecida ou validada pelo projecto; “pendente” requer validação posterior e não deve ser inferido.

## Visão geral

### Correcção E1.07-D2-R1

A migração 7 acrescenta somente triggers contra substituições por `rowid` e mudanças das ligações de empresas, estabelecimentos e associações. Preserva migrações 1–6, dados e isolamento por tenant. O motor captura o pedido uma vez; nada é exposto por HTTP/IPC e não há autorização operacional. Revista em [E1.07-D2-R2](tasks/E1.07-D2-R2.md): NO-GO (D-190) — com `foreign_keys` desligado, a eliminação e reinserção de uma associação empresarial ainda transfere atribuições (D-191, PD-70), e as guardas de `rowid` dependem de `NEW.rowid` indefinido (D-192, PD-72). Não integrada em `main`.

Complementada por [E1.07-D2-R3](tasks/E1.07-D2-R3.md), que corrige a própria migração 7 (não integrada, sem bases não descartáveis dependentes; D-194): associações empresariais desactivadas, nunca eliminadas (D-195, PD-70); guardas de `rowid` só para `rowid` explícitos positivos e recusa de `rowid` não positivo num AFTER INSERT (D-196, PD-72); `installation_bootstrap` gravado uma vez, imutável e não eliminável (D-197, PD-73; política de identidades do administrador inicial em PD-75, Gate D3). Revista em [E1.07-D2-R4](tasks/E1.07-D2-R4.md): **GO** (D-200); integrada em `main` pelo PR #15 (merge `dc5b046`), o que encerra E1.07-D2 (D-203). Fronteira confirmada: os triggers protegem as ligações de autoridade contra escritas SQL pela ligação normal em qualquer configuração de `foreign_keys`/`recursive_triggers`, mas não a autenticação: um escritor SQL pode substituir credenciais. Com FK desligado, as linhas `users` e `branch_memberships` continuam elimináveis. Nenhuma autoridade baseada em `installation_bootstrap` fica operacional antes da política da PD-75 (D-201). **E1.07-D3-G0 (branch, a rever):** a migração 8 fecha essa eliminação em qualquer configuração; ver [Gate da instalação](#autorização-gate-da-instalação-e107-d3-g0).

O KIL Business será um ERP híbrido e modular. A aplicação desktop operará com serviços e dados locais, enquanto serviços centrais em PostgreSQL suportarão capacidades centralizadas e sincronização. O monitor móvel será opcional e apenas consultará indicadores sincronizados quando for implementado.

```text
apps/desktop ──> services/local-api ──> packages/database ──> SQLite local
                      │
                      └──> services/sync-service ──> services/central-api ──> PostgreSQL

apps/admin-portal ────────────────────────────────> services/central-api
apps/mobile-monitor (futuro) ─────────────────────> serviços centrais a definir

packages/licensing ──> adaptador futuro ──> servidor KIL independente
```

Nenhuma seta representa um endpoint já existente; indica somente limites e direcções arquitecturais pretendidas. A base SQLite pertence à camada de serviços locais, nunca ao renderer React nem ao processo principal Electron (D-028). Desde E1.05, `services/local-api` é um processo Node.js independente que gere a base (D-041). A seta `apps/desktop ──> services/local-api` continua por implementar e o respectivo canal está pendente.

## Arquitectura de negócio

| Pilar | Definição registada | Estado na implementação (E1.05) |
| --- | --- | --- |
| Multiempresa | Definido: isolamento obrigatório por tenant/empresa em todas as camadas (`AGENTS.md`). Cada empresa juridicamente independente é um tenant identificado por UUID distinto do da empresa, em relação 1:1; o NIF não é chave (D-016, D-023). Grupos empresariais organizam empresas sem eliminar o isolamento (D-017). | Contratos em `packages/shared-types` e repositórios SQLite em `packages/database`, com filtro por tenant em todas as consultas e integridade garantida pelo esquema. `BusinessGroup` não implementado. Desde E1.07-A, identidades locais com associações explícitas a empresas e estabelecimentos (D-080 a D-082), sem autenticação. A “empresa activa” na interface continua a ser texto fixo demonstrativo. |
| Quatro sectores | Definido (D-018): `PHARMACY` (Farmácia), `SUPERMARKET` (Supermercado), `FUEL_STATION` (Posto de combustível), `RESTAURANT` (Restauração). Uma empresa pode ter estabelecimentos de sectores diferentes. | `SECTOR_TYPES` no domínio e catálogo `sector_types` na base. Não existem módulos nem regras sectoriais. |
| Contabilidade integrada | Definido: fronteira `packages/accounting`, valores decimais seguros, lançamentos imutáveis ou corrigidos de forma auditável (`AGENTS.md`). | O pacote apenas exporta `accountingModuleStatus = 'not-implemented'`. O modelo de integração entre operações e contabilidade está pendente. |
| Funcionamento offline | Definido: o desktop opera com serviços e dados locais em SQLite. | Persistência SQLite local em `packages/database`, gerida pelo serviço local Node.js (`services/local-api`), que ainda não comunica com o desktop. A estratégia offline está pendente. |
| Sincronização | Definido: `services/sync-service` liga o ambiente local aos serviços centrais em PostgreSQL. | Fronteira sem implementação (`syncServiceStatus = 'contract-pending'`); protocolo pendente. |
| Monitor opcional | Definido: KIL Business Monitor em React Native, opcional, limitado à consulta de indicadores sincronizados. A licença principal é independente do Monitor, e a expiração do Monitor não interrompe as operações locais autorizadas (D-067). | `apps/mobile-monitor` é um marcador TypeScript sem dependências móveis. |

## Modos de implantação (E1.06)

Decisões do responsável, ainda não implementadas: não existem instaladores, serviço Windows, HTTP nem comunicação Electron/serviço.

| Modo | Topologia | Dados | Comunicação futura |
| --- | --- | --- | --- |
| **A — Autónomo** (D-062) | Serviço local e interface no mesmo computador. | SQLite local. | Autenticada, por loopback. |
| **B — Centralizado** (D-063) | Serviço operacional no servidor da empresa; vários terminais ligados ao serviço. | SQLite no servidor. **Nenhum terminal acede ao ficheiro SQLite por SMB ou outra partilha.** | HTTPS autenticado. |
| **C — Multiestabelecimento** (D-064) | Serviços locais independentes por estabelecimento. | SQLite por estabelecimento, com operação offline. | Sincronização com serviços centrais; Monitor móvel opcional. |

Em todos os modos:
- o serviço local será instalado como serviço Windows, com ciclo de vida independente do Electron (D-065);
- a API empresarial será REST em Fastify, com autenticação, autorização e isolamento por empresa (D-066).

## Licenciamento (decisões registadas em E1.06)

- O servidor de licenciamento KIL é independente e é integrado por adaptador, sem endpoints presumidos (D-009).
- A licença principal é independente do Monitor. O Monitor é opcional, e a sua expiração não interrompe as operações locais autorizadas (D-067).
- Os módulos sectoriais são activáveis individualmente (D-068).
- Nada disto está implementado; `packages/licensing` contém apenas a interface `LicenseProvider`.

## Ambiente de execução (E1.06)

| Componente | Versão | Nota |
| --- | --- | --- |
| Node.js (serviços, ferramentas, testes) | 24.22.3 (`.node-version`; `engines.node >=24.22.3 <25`) | LTS “Krypton”, em *Maintenance* desde 2026-10-20 e com suporte até 2028-04-30. O Node 26 é a *Active LTS* desde 2026-10-28 (PD-21). |
| pnpm | 9.15.9 (`packageManager`; `engines.pnpm >=9.15.0 <10`) | `engine-strict=true` em `.npmrc` recusa versões fora de `engines` (D-069, D-073). |
| `better-sqlite3` | 12.11.1 | Binário pré-compilado `node-v137-win32-x64`, sem compilação local (D-070). |
| Electron | 45.3.2 (Chromium 156.0.8078.100; Node embutido 24.22.2) | Linha estável suportada, independente do Node 24.22.3 dos serviços. Windows 10 ou superior, apenas x64/arm64 (D-075). |
| TypeScript / Vite | 5.9.3 / 6.4.6 | Sem alteração desde E1.06. |
| Vitest | 5.1.0 | Linha com correcções regulares; usa o Vite 6.4.6 do projecto como dependência par, sem Vite interno próprio (D-077, E1.06-S2). |
| ESLint | 10.15.0 (`@eslint/js` 10.0.1, typescript-eslint 8.72.2) | Actualizado em E1.06 (D-072). |

## Segurança do Electron (E1.06-S1)

- `BrowserWindow` fixa `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false` e `navigateOnDragDrop: false`.
- O preload sandboxed expõe por `contextBridge` apenas `kilDesktop.runtime.platform`, uma estrutura imutável sem `ipcRenderer`, `require`, acesso a ficheiros ou acesso à base.
- O renderer não acede ao Node.js, ao serviço local nem ao SQLite. A base continua exclusivamente em `services/local-api`/`packages/database` (D-028, D-041).
- A sessão nega explicitamente todas as verificações e pedidos de permissão. Não existem capacidades que necessitem de câmara, microfone, geolocalização, notificações, captura de ecrã ou protocolos externos nesta etapa.
- Novas janelas e `webview` são recusadas. A navegação fica limitada ao documento da aplicação e aos seus fragmentos; em produção, o documento é carregado por `loadFile`, com caminho convertido por `pathToFileURL` para comparação canónica.
- O renderer declara CSP sem fontes remotas, plugins, frames ou submissão de formulários; a única excepção de ligação é o WebSocket de desenvolvimento fixo em `ws://127.0.0.1:5173` para o Vite.
- O smoke test real percorre as oito áreas, verifica dashboard, preload mínimo e ausência de `window.process`/`window.require`, e encerra a aplicação.

## Contratos multiempresa (E1.03, revistos em E1.04)

Localização: `packages/shared-types/src`. Os contratos e as interfaces de repositório pertencem ao domínio e não dependem de infraestrutura.

- **Identificadores** (`identifiers.ts`): `TenantId`, `CompanyId` e `BranchId` são UUID em forma canónica (minúsculas, versões 1 a 8, sem UUID nulo), com marcas de tipo distintas que impedem trocas em compilação. `ActorId` e `CorrelationId` são texto não vazio com até 128 caracteres.
- **Empresa** (`company.ts`):
  - estados `DRAFT`, `ACTIVE`, `SUSPENDED` e `INACTIVE` (D-025), sem relação com o licenciamento;
  - `id` diferente de `tenantId` (D-023);
  - `jurisdiction` em ISO 3166-1 alfa-2;
  - `nif` opcional, mas obrigatório quando `ACTIVE`.
- **Funções da empresa**:
  - `createCompany(input, taxIdPolicy)` cria ou altera uma empresa e aplica a regra fiscal da jurisdição quando `ACTIVE` (D-024);
  - `restoreCompany(input)` reconstrói registos já aceites e valida apenas a estrutura;
  - `deactivateCompany` faz a desactivação lógica (D-027).
- **Regras fiscais** (`tax-identification.ts`): `TaxIdRule` exige fonte normativa, e `TaxIdPolicy` agrupa as regras por jurisdição. A política falha fechada: sem regra configurada, nenhuma empresa pode ficar `ACTIVE`. O projecto não inclui nenhuma regra real. RV-D1-H-M-01 foi corrigido por E1.07-D1-H-R1 (D-176) e aprovado por E1.07-D1-H-R2 (D-178): `isValid` é uma função pura do NIF (`this: void`), invocada com um receptor neutro e congelado através de `Reflect.apply` capturado; cada propriedade da regra é lida uma vez e validada; instantâneo, invólucro, `ruleFor` e política congelados; nada do consumidor é congelado. Estado capturado pela própria função (fechos, `bind`) fica fora da garantia.
- **Estabelecimento** (`branch.ts`): estados `ACTIVE` e `INACTIVE`. O código é normalizado por `normalizeBranchCode` (D-026): remoção de espaços nas extremidades, NFKC, maiúsculas e espaços internos reduzidos a um. `deactivateBranch` faz a desactivação lógica.
- **Sectores** (`sectors.ts`): `SECTOR_TYPES` é a lista única de sectores. Acrescentar um sector obriga a definir a sua designação em `SECTOR_LABELS` e a criar uma migração que o insira em `sector_types`.
- **Contexto** (`tenant-context.ts`): `TenantContext { tenantId, actorId, correlationId }`. `assertTenantContext` rejeita contexto ausente ou inválido em execução.
- **Repositórios** (`repositories.ts`): `CompanyRepository` e `BranchRepository` exigem `TenantContext` em todas as operações e revalidam os registos recebidos. A semântica obrigatória (D-020):
  - leitura cruzada devolve `undefined`;
  - alteração ou eliminação cruzada devolve `RecordNotFoundError`;
  - registo de outro tenant devolve `TenantMismatchError`;
  - uma empresa por tenant;
  - código de estabelecimento único na empresa;
  - `createdAt` imutável;
  - eliminação física recusada para empresas com estabelecimentos.
- **Erros** (`errors.ts`): as mensagens indicam o campo ou a regra, mas nunca reproduzem valores recebidos.

## Persistência SQLite (E1.04)

Localização: `packages/database/src`. Driver `better-sqlite3` 12.x (D-029, D-040).

- **Ligação** (`connection.ts`): `openSqliteDatabase` activa `foreign_keys` e confirma que ficou activo; aplica `busy_timeout` e, em ficheiro, `journal_mode = WAL`. Com `exclusive: true` (E1.07-X, D-130), define `locking_mode = EXCLUSIVE` antes da primeira transacção (a abertura já abriu o ficheiro e leu o cabeçalho, D-135) e confirma a escrita com uma transacção vazia; `verifyExclusiveOwnership` comprova a posse do bloqueio.
- **Localização** (`location.ts`): `resolveDatabaseLocation` exige um caminho absoluto com extensão `.sqlite`, `.sqlite3` ou `.db`, fora dos directórios protegidos (repositório e artefactos de build), e recusa caminhos UNC, de rede e de dispositivo (E1.07-X). Não existe localização por omissão (D-038). `resolveDatabaseIdentity` identifica a base efectiva (D-131).
- **Migrações** (`migrations.ts`): definidas em código, sequenciais e imutáveis depois de publicadas. Cada uma corre na sua transacção e fica registada em `schema_migrations` com soma SHA-256. A reexecução é segura. A base é recusada se uma migração aplicada tiver sido alterada ou se o seu esquema for mais recente do que o código (D-033).
- **Esquema v1**: tabelas `STRICT`.
  - `companies` tem `tenant_id` único e `UNIQUE (id, tenant_id)`, e verificações para estado, `id <> tenant_id`, NIF obrigatório quando `ACTIVE` e cronologia.
  - `branches` usa a chave estrangeira composta `(company_id, tenant_id) → companies (id, tenant_id)`, o que impede um estabelecimento de apontar para uma empresa de outro tenant. Tem `ON DELETE RESTRICT`, `UNIQUE (company_id, code)` e chave estrangeira para `sector_types`.
  - O índice de isolamento é `branches_tenant_company_idx (tenant_id, company_id)`.
- **Repositórios** (`sqlite-tenant-persistence.ts`): `createSqliteTenantPersistence(database)` devolve `companies` e `branches`, que implementam os contratos assíncronos, e `transaction(work)`.
  - Todas as consultas a dados empresariais usam parâmetros preparados e filtram por `tenant_id`. Só a verificação de chave primária duplicada é global, porque os UUID são globais.
  - Cada escrita corre numa transacção `IMMEDIATE`.
  - `transaction(work)` dá acesso a versões síncronas dos repositórios para alterações relacionadas. Qualquer excepção reverte tudo, e trabalho assíncrono é recusado (D-034).
- **Erros** (`errors.ts`): `PersistenceError(reason)`. Os erros do SQLite são traduzidos sem expor SQL nem valores, e registos corrompidos são reportados como `invalid-stored-record` (D-036).
- **Verificação**: a suite `tests/support/tenant-repository-contract.ts` corre sobre o duplo em memória e sobre SQLite em ficheiro temporário (D-021). `tests/sqlite-persistence.test.ts` cobre a ligação, as migrações, a persistência entre ligações, a integridade do esquema, as transacções, os dados corrompidos, a injecção SQL e a localização.

## Resolução de pacotes do workspace (PD-08)

Os pacotes que outros pacotes consomem (`shared-types`, `database`) declaram uma condição de exportação `source → ./src/index.ts`, antes de `types` e `default`, que apontam para `dist/` (D-037):

- `tsconfig.json` da raiz e `packages/database/tsconfig.json` definem `customConditions: ["source"]`. O typecheck e o lint usam o código-fonte e não dependem de `dist/`.
- `vitest.config.ts` define `resolve.conditions: ['source']` para o ambiente `client` do Vite (testes jsdom) e `ssr.resolve.conditions: ['source', 'import', 'default']` para o ambiente `ssr`, que o Vitest usa nos testes Node desde a versão 4 (D-078). Os 281 testes passam sem nenhum `dist/` presente.
- O build de `packages/database` usa `tsconfig.build.json`, sem a condição, e consome `shared-types` a partir de `dist/`. O `pnpm -r build` respeita a ordem pela dependência `workspace:*`.
- Em execução Node, sem a condição, os pacotes resolvem para `dist/`.
- `services/local-api` segue o mesmo padrão desde E1.05: `tsconfig.json` com a condição `source` para lint e editor, e `tsconfig.build.json` para o build.

## Serviço local (E1.05)

Localização: `services/local-api/src`. É um processo Node.js independente do Electron (D-041), sem servidor HTTP, sem portas de rede e sem integração com a interface. `app.ts` (fábrica Fastify de E1.01) não é usado pelo serviço.

```text
main.ts ──> cli.ts ──> config.ts (process.env → LocalServiceConfig validada)
                  └──> local-service.ts ──> packages/database ──> SQLite (ficheiro fora do repositório)
                                       └──> logger.ts (JSON Lines para stdout)
```

- **Configuração** (`config.ts`, D-043): `loadLocalServiceConfigFromEnv(env, { protectedDirectories })` lê as variáveis abaixo de um ambiente injectado. Nenhum ficheiro `.env` é carregado. `parseLocalServiceConfig` recusa propriedades desconhecidas, pelo que a configuração não admite SQL, pragmas nem migrações.

  | Variável | Valores | Por omissão |
  | --- | --- | --- |
  | `LOCAL_DATABASE_PATH` | caminho absoluto `.sqlite`/`.sqlite3`/`.db` fora dos directórios protegidos | — (obrigatória) |
  | `LOCAL_SERVICE_ENVIRONMENT` | `development`, `test`, `production` | — (obrigatória) |
  | `LOCAL_SERVICE_INSTANCE_ID` | 1–64 caracteres `[A-Za-z0-9._-]` | — (obrigatória) |
  | `LOCAL_SERVICE_LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |
  | `LOCAL_SERVICE_ON_MISSING_DATABASE` | `create`, `fail` | — (obrigatória) |
  | `LOCAL_SERVICE_ON_PENDING_MIGRATIONS` | `apply`, `fail` | — (obrigatória) |

- **Directórios protegidos** (`protected-directories.ts`, D-045): a raiz do pacote do serviço e a raiz do monorepositório, derivadas da localização do código.
- **Ciclo de vida** (`local-service.ts`): `createLocalService(config, { logger, protectedDirectories, openDatabase? })`.

  | Estado | Transições permitidas | Significado |
  | --- | --- | --- |
  | `STOPPED` | `STARTING` | Sem ligação aberta (estado inicial). |
  | `STARTING` | `READY`, `FAILED` | Validação da localização, abertura, inspecção e aplicação de migrações. |
  | `READY` | `STOPPING` | Ligação aberta; repositórios disponíveis. |
  | `STOPPING` | `STOPPED`, `FAILED` | Repositórios desligados e ligação a fechar. |
  | `FAILED` | `STARTING`, `STOPPED` | Arranque falhado; ligação já fechada; nova tentativa ou encerramento. |

  - `start()`: em `READY` não faz nada. Em `STARTING` devolve o arranque em curso. Em `STOPPING` aguarda o encerramento e depois arranca. A partir de `STOPPED` ou `FAILED`, inicia (D-042).
  - `stop()`: em `STOPPED` não faz nada. Em `STARTING` aguarda o arranque e depois encerra. Em `FAILED` passa a `STOPPED`. Em `READY` fecha a ligação.
  - Sequência de arranque (desde E1.07-X):
    1. valida a localização e identifica a base efectiva (caminho final, sem *hard links* nem rede; D-131);
    2. aplica `onMissingDatabase` (`fail` usa `fileMustExist` e não cria ficheiros);
    3. abre o SQLite em modo exclusivo e adquire o bloqueio do ficheiro, com espera limitada (D-130, D-132);
    4. comprova a posse (`verifyExclusiveOwnership`), antes de qualquer leitura do esquema;
    5. corre `inspectMigrations` (integridade);
    6. aplica `onPendingMigrations` (`fail` recusa sem alterar);
    7. corre `runMigrations`;
    8. gera o `serviceRunId` do arranque e revoga as sessões de arranques anteriores (E1.07-C, D-114). Desde E1.07-C-R1, o arranque **não elimina** registos de sessões (D-125, PD-47);
    9. cria os repositórios e passa a `READY`.

    Qualquer falha fecha a ligação (e liberta o bloqueio) antes de `FAILED`, com motivo `invalid-location`, `database-missing`, `database-locked`, `database-access-denied`, `database-corrupt` (E1.07-X), `database-open-failed`, `migration-integrity`, `pending-migrations`, `migration-failed`, `session-reset-failed` (E1.07-C) ou `unexpected` (D-048).
  - `companies`, `branches` e `transaction` delegam nos repositórios SQLite (isolamento por tenant inalterado) e recusam qualquer operação fora de `READY` com `LocalServiceStateError('not-ready')` (D-047).
- **Registos** (`logger.ts`, D-046): uma linha JSON por evento, com `time`, `level`, `event`, `instanceId` e campos escalares. Os eventos são `service.state_changed`, `service.starting`, `service.database_opened`, `service.ready`, `service.start_failed`, `service.stopped`, `service.stop_failed`, `service.release_failed`, `service.config_invalid`, `service.arguments_invalid`, `service.waiting_for_shutdown`, `service.shutdown_requested`, `service.sessions_reset` (E1.07-C, só contagens) e `service.database_ownership_acquired` (E1.07-X, nome do ficheiro e espera configurada). A base é identificada só pelo nome do ficheiro, as causas por nome e motivo, e as chaves sensíveis são redigidas.
- **Executável** (`main.ts`, `cli.ts`, D-049): `node dist/main.js` fica em `READY` até `SIGINT`/`SIGTERM` (e `SIGBREAK` em Windows); `--check` arranca e encerra. Códigos de saída: 0, 1 (arranque ou encerramento) e 2 (configuração ou argumentos).
- **Verificação**: `tests/local-service.test.ts` cobre o ciclo de vida, as falhas, a recuperação, a configuração, os registos, a CLI e a independência do Electron. A suite de contrato corre também através do serviço (D-051).
- **Exclusividade por base (E1.07-X, D-130 a D-134)**: em cada momento, só um serviço opera sobre uma base.
  - **Mecanismo:** bloqueio do próprio SQLite. A ligação define `locking_mode = EXCLUSIVE` antes da primeira transacção e entra em WAL sem memória partilhada (sem ficheiro `-shm`). Antes disso, a abertura já abriu o ficheiro (criando-o vazio numa base nova com `create`) e leu, sem bloqueio, os 100 bytes do cabeçalho (D-135). O SQLite obtém então um bloqueio EXCLUSIVE do ficheiro principal, através do sistema operativo (`LockFileEx` em Windows), e só o liberta quando a ligação fecha ou o processo termina. Não há ficheiros de bloqueio, PID, *heartbeats* nem relógio.
  - **Momento da aquisição:** na abertura, antes de qualquer leitura do esquema, migração, revogação de sessões ou escrita. A posse é comprovada por uma segunda ligação independente, sem espera, que tem de receber `SQLITE_BUSY`; qualquer outro resultado falha fechado (`exclusive-lock-unverified`). Um `openDatabase` injectado que não adquira a exclusividade é recusado da mesma forma.
  - **Recusa:** outra instância (ou ferramenta) sobre a mesma base termina em `FAILED` com `database-locked`, depois de uma espera limitada (2000 ms por omissão), sem ler o esquema, páginas ou dados nem escrever (lê só metadados do caminho e o cabeçalho, D-135). A recusa efectiva pode exceder a espera configurada: medido 829 ms com 300 ms, 3,2 s com 2000 ms e 7,4 s com 5000 ms (E1.07-X-M); é sempre limitada. O motivo não identifica quem detém a base. Permissões, corrupção, ausência e caminho inválido têm motivos próprios.
  - **Identidade da base:** o bloqueio é do ficheiro, não do nome, pelo que aliases concorrentes (maiúsculas, separadores, `..`, *junctions*, ligações simbólicas, *hard links*, `\\?\`, `\\localhost\C$`) são recusados pelo sistema operativo. Para que o WAL tenha sempre o mesmo nome, o serviço abre o caminho final (`realpath`), recusa *hard links* e caminhos UNC/rede/dispositivo e reaplica a extensão e os directórios protegidos ao caminho final.
  - **Recuperação:** encerramento normal, falha no arranque, Ctrl+C, falha inesperada ou terminação forçada libertam o bloqueio (o sistema operativo fecha os *handles*). A instância seguinte recupera o WAL na abertura.
  - **Bases independentes:** a exclusividade é por base; serviços sobre bases diferentes funcionam em simultâneo.
  - **Sistemas de ficheiros suportados:** disco local NTFS em Windows (verificado; plataforma inicialmente homologada, D-136). Pastas de rede, partilhas SMB, unidades mapeadas e sistemas distribuídos não são suportados para a base operacional; outros sistemas locais (ReFS, FAT/exFAT) não foram ensaiados. Os caminhos UNC e os que o `realpath` resolve para UNC são recusados tecnicamente; unidades mapeadas e pastas sincronizadas estão só administrativamente proibidas (PD-52).
  - **Consequências:** com o serviço activo, nenhuma ferramenta externa abre a base pelo SQLite. Cópias de segurança consistentes fazem-se pela instância proprietária (Backup API do SQLite ou `VACUUM INTO`, E1.10). A cópia simples do ficheiro activo não é bloqueada e não é uma estratégia aprovada: o resultado depende do estado do WAL e pode omitir transacções confirmadas (D-138). As cópias contêm credenciais protegidas e *digests* de sessões.
  - **Fronteira de confiança (D-137):** o bloqueio só exclui clientes SQLite. Um programa com permissões sobre o ficheiro continua a poder ler e escrever os seus bytes; a protecção do ficheiro, do directório e das cópias depende das permissões NTFS e da conta do serviço (E1.10), e não há garantia contra administradores do sistema operativo.
- **Identidades e associações (E1.07-A)**: o serviço compõe internamente `identityProvisioning.users`, `companyMemberships`, `branchMemberships` e `membershipScopes` sobre a mesma ligação. Estão sujeitos à mesma guarda de `READY`, verificada em cada chamada, pelo que referências antigas falham depois do encerramento. Não são expostos pela CLI nem por qualquer canal externo (D-087).

## Identidade e associações (E1.07-A)

Localização: domínio em `packages/shared-types/src` (`user.ts`, `membership.ts`, `identity-repositories.ts`); persistência em `packages/database/src` (`sqlite-user-directory.ts`, `sqlite-membership-persistence.ts`). Não há autenticação nem autorização funcional: os contratos de identidade não provam quem é o utilizador, e o `TenantContext` continua a ser construído pelo chamador (PD-27).

```text
autoridade da instalação                         contexto empresarial (TenantContext)
┌────────────────────────────┐                   ┌──────────────────────────────────────────────┐
│ UserDirectory (interno)    │  userId apenas    │ CompanyMembershipRepository  (D-020)          │
│ users: id, username,       │◀──────────────────│ BranchMembershipRepository   (D-020)          │
│ displayName, email?, phone?│                   │ MembershipScopeReader → elegibilidade (D-088) │
│ status                     │                   └──────────────────────────────────────────────┘
└────────────────────────────┘
```

- **Identidade (D-080, D-085):** `User` é local à instalação, identificada por `UserId` (UUID) e independente de empresa, tenant, estabelecimento e credenciais.
  - O username é normalizado (ASCII `[a-z0-9._-]`, 3–64) e único.
  - Email e telefone são opcionais, não únicos e nunca chaves.
  - Estados: `ACTIVE`, `SUSPENDED` e `INACTIVE`. Só `ACTIVE` é elegível para autenticação futura.
  - O contrato não tem credenciais.
- **Associações (D-081, D-082, D-086):**
  - `CompanyMembership` é única por utilizador e tenant, com âmbito `COMPANY_WIDE` ou `BRANCH_RESTRICTED`.
  - `BranchMembership` liga uma associação `BRANCH_RESTRICTED` a um estabelecimento da mesma empresa.
  - Ambas usam desactivação lógica, sem eliminação.
  - A base garante a pertença ao mesmo tenant e empresa com chaves estrangeiras compostas, e as FK usam `ON DELETE RESTRICT`.
- **Elegibilidade (D-088):** `evaluateMembershipScope` indica se há âmbito efectivo, que estabelecimentos `ACTIVE` abrange e se a empresa é operacional (`ACTIVE`). Não é autorização: perfis e permissões ficam para E1.07-D.
- **Fronteira (D-087):**
  - O directório de identidades não tem contexto empresarial nem pesquisa ou listagem.
  - Os repositórios empresariais só devolvem dados de associação.
  - Nada é exposto por HTTP, IPC Electron ou interface. O desktop não referencia estes módulos, o que é verificado por teste.
- **Administração KIL (D-083):** autoridade distinta da administração empresarial, sem superutilizador global. Não implementada.
- **Licenciamento (D-084):** independente da identidade e da autorização.
- **Esquema (migração 2):** tabelas `users`, `company_memberships` e `branch_memberships`, e índice único `branches (id, tenant_id, company_id)`. Detalhe em [tasks/E1.07-A.md](tasks/E1.07-A.md#modelo-de-dados-e-migração-2-packagesdatabase).
- **Verificação:** suite de contrato `tests/support/membership-repository-contract.ts` (D-089) sobre SQLite e através do serviço, `tests/identity-contracts.test.ts` e `tests/identity-persistence.test.ts`.

## Autenticação local (E1.07-B)

Localização: política em `packages/shared-types/src/password-policy.ts`; persistência em `packages/database/src/sqlite-authentication-store.ts`; serviço em `services/local-api/src/authentication/`. Funciona offline, só dentro do serviço local, sem HTTP, IPC nem interface. O resultado não é uma sessão: as sessões são criadas a partir do comprovativo interno descrito em “Sessões locais (E1.07-C)”. Não há autorização funcional, e o `TenantContext` continua a ser construído pelo chamador (PD-27).

```text
authenticate(username, password)
  │ 1. READY? ── não ──▶ LocalServiceStateError('not-ready')
  │ 2. limites + normalização (username D-085; palavra-passe NFC D-091) ── inválido ──▶ recusa genérica
  │ 3. transacção IMMEDIATE: limitação (conta a tentativa) → identidade → estado ACTIVE → credencial
  │                                   └── bloqueado ──▶ { ok: false, reason: 'throttled', retryAfterSeconds }
  │ 4. UMA derivação Argon2id: verify(credencial) ou burn() sem credencial elegível (D-093)
  │ 5. ainda READY e a mesma ligação? ── não ──▶ not-ready, sem escrever (D-097)
  │ 6. transacção: reconfirma a identidade e a credencial, anula a falha, recalcula parâmetros antigos
  ▼
{ ok: true, identity: { userId, method: 'password', authenticatedAt } }   (só reconhecida por isAuthenticatedIdentity)
```

- **Derivação (D-090):** Argon2id nativo do Node.js 24.22.3.
  - Parâmetros: m = 64 MiB, t = 3, p = 4 (RFC 9106), salt de 16 bytes e *hash* de 32 bytes.
  - Mínimo de configuração: OWASP (m = 19 MiB, t = 2).
  - Concorrência: no máximo 2 derivações simultâneas.
- **Política (D-091):** NIST SP 800-63B, revisão 4.
  - Normalização NFC, de 15 a 256 *code points*, sem truncamento.
  - Espaços e Unicode permitidos; sem composição nem expiração.
  - Lista local de palavras-passe comuns, ainda vazia (PD-33).
- **Persistência (D-092, migração 3):**
  - `password_credentials`: separada de `users`, uma por utilizador.
  - `authentication_throttle`: chaves SHA-256, sem usernames em texto.
  - `installation_bootstrap`: linha única.
- **Limitação (D-094):** 5 falhas, depois bloqueios de 30 s a 15 min sem bloqueio permanente; limite da instância de 100 falhas em 5 min; contagem antecipada, segura com concorrência.
- **Inicialização (D-096):** explícita, atómica e irrepetível.
  - Cria uma identidade nova sem permissões empresariais.
  - Não há contas predefinidas.
  - Ainda não há ferramenta operacional (PD-31).
- **Gestão de credenciais (D-095):** só interna (`create`/`replace`).
- **Limites conhecidos:** canais temporais (PD-34), ausência de *pepper* (PD-32) e desvio NIST no limite de falhas consecutivas (PD-35). Detalhe em [tasks/E1.07-B.md](tasks/E1.07-B.md#limites-conhecidos).

## Sessões locais (E1.07-C)

Localização: contratos em `packages/shared-types/src/session.ts`; persistência em `packages/database/src/sqlite-session-store.ts` (migrações 4 e 5); serviço em `services/local-api/src/sessions/`. Só dentro do serviço local, sem HTTP, IPC nem interface. Uma sessão comprova apenas a identidade autenticada; não é uma autorização empresarial (D-107, D-116). Detalhe em [tasks/E1.07-C.md](tasks/E1.07-C.md).

```text
authenticate ──▶ AuthenticatedIdentity ◀── comprovativo privado (WeakMap do serviço):
                                           userId, versões, serviceRunId, emissão; 60 s; uso único
sessions.create(identity) ── READY e mesmo arranque ── consome o comprovativo ── idade ≤ 60 s
   └─ transacção IMMEDIATE: identidade ACTIVE, versões iguais, sessões válidas < 5
        └─ token 32 bytes (Base64URL) ──▶ SHA-256 ──▶ local_sessions          (token devolvido só aqui)
sessions.validate / registerActivity / logout          identityProvisioning.sessions.* (interno)
```

- **Comprovativo (D-108):** associado pelo serviço ao objecto devolvido por `authenticate`, não persistido e não construível. Ligado às versões lidas na transacção de confirmação e ao arranque. Retirado antes de qualquer verificação, pelo que só serve uma vez, mesmo com utilizações concorrentes. `isAuthenticatedIdentity` não basta (PD-40 resolvida).
- **Versões de segurança (D-110, D-111, D-126):** `users.security_version` e `password_credentials.credential_version`, monotónicas, inicializadas a 1. Triggers da migração 4 avançam a versão e revogam as sessões, na mesma instrução, em qualquer alteração de estado ou do verificador da credencial. As credenciais nunca são eliminadas. A migração 5 (E1.07-C-R1) impede reinserções:
  - identidades, credenciais e sessões existentes nunca são reinseridas (`INSERT OR REPLACE`, `REPLACE`, UPSERT ou `INSERT` repetido), com `foreign_keys` e `recursive_triggers` em qualquer valor, porque os triggers `BEFORE INSERT` correm antes da resolução de conflitos;
  - uma linha reinserida após uma eliminação nunca reutiliza uma versão já ligada a sessões da identidade, e as sessões ainda activas dessa identidade são revogadas;
  - as chaves `users.id` e `password_credentials.user_id` são imutáveis.
- **Distinções (E1.07-C-R1):**
  - *recálculo de parâmetros* (D-092): na primeira autenticação bem sucedida com parâmetros antigos, o mesmo segredo é derivado de novo; a versão da credencial avança e as sessões da identidade são revogadas, mas o comprovativo emitido nessa autenticação já tem a versão nova;
  - *troca de palavra-passe* (`credentials.replace`): novo verificador e nova versão; revoga as sessões e limpa a limitação do username;
  - *revogação*: marcador definitivo (`revoked_at`, motivo); a validade depende também das versões e do arranque, pelo que versões diferentes recusam mesmo sem marcador;
  - *versões*: inteiros monotónicos que invalidam sessões e comprovativos ligados a valores anteriores;
  - *fontes temporais dos triggers* (RV-07): `revoked_at` vem de `updated_at` fornecido pelo chamador (estado e credencial) ou do relógio do SQLite (`security_version`). São informativas: nenhuma decisão de validade as usa, e a eliminação exige também a expiração absoluta antiga, calculada pelo relógio das sessões.
- **Fronteira de confiança da base:** os triggers protegem contra defeitos da aplicação e contra escritas SQL pela ligação normal, incluindo `REPLACE`/UPSERT e pragmas desligados. Não protegem contra quem controle o esquema ou o ficheiro (eliminar triggers, `writable_schema`, edição directa) nem contra quem insira sessões directamente: com escrita arbitrária na base, um actor pode criar uma sessão com um token que conheça. A protecção do ficheiro da base é do sistema operativo e da instalação (E1.10).
- **Modelo (D-109):** `local_sessions` guarda `SessionId`, `user_id`, digest SHA-256 (`UNIQUE`), versões, `service_run_id`, criação, última actividade, expiração absoluta e revogação com motivo. A ligação é imutável, a revogação é definitiva e a actividade nunca recua (triggers).
- **Tokens (D-113):** 32 bytes de `crypto.randomBytes`, Base64URL de 43 caracteres, formato canónico obrigatório. Só o digest é persistido. O token nunca é registado nem guardado.
- **Política (D-107, D-115):**
  - valores iniciais: 30 min de inactividade, 12 h absolutas, 5 sessões válidas por identidade (recusa controlada, sem revogar outras), comprovativo de 60 s e retenção de 30 dias;
  - configuração tipada e limitada (`sessionPolicy`).
- **Validação:** existência, digest em tempo constante, revogação, arranque, estado da identidade, versões, inactividade e expiração absoluta, numa única consulta. Versões ou arranque incompatíveis recusam mesmo sem marcador de revogação. A actividade só é registada após uma validação bem-sucedida, nunca além da expiração absoluta.
- **Revogação:** logout, revogação individual e de todas as sessões da identidade (que avança também a versão), suspensão, desactivação, substituição de credencial, alteração da versão e reinício. As sessões revogadas mantêm-se até à retenção.
- **Relógio (D-112, corrigido por D-124):** `efectivo = max(parede, efectivo anterior + Δmonotónico)`, ambos em milissegundos, calculado a partir de uma base que só muda quando o relógio de parede passa à frente (sem erro acumulado em leituras frequentes). O instante nunca recua e avança sempre, pelo menos, o tempo monotónico decorrido: um retrocesso não prolonga validades, um avanço antecipa-as, e um avanço seguido de retrocesso já não congela o relógio (RV-01, corrigido em E1.07-C-R1). Uma única autoridade temporal decide todas as validades das sessões: emissão e idade do comprovativo, criação, actividade, inactividade, expiração absoluta, contagem do limite e expiração administrativa.
- **Eliminação e retenção (D-125):** distinguem-se a expiração do acesso (conservadora, pelo instante efectivo), a revogação (definitiva), a retenção dos registos e a eliminação física. A eliminação física nunca é decidida só pelo relógio de parede:
  - o arranque **não elimina** registos (suspensão autorizada até E1.07-E); só revoga as sessões de arranques anteriores;
  - `cleanupSessions()` (interna, explícita, sem invocação automática) corta pelo instante mais antigo plausível do processo, `min(parede, parede inicial + monotónico decorrido)`: um avanço do relógio durante o arranque não elimina nada. Não detecta um relógio que já estava errado quando o processo começou; por isso nenhuma limpeza é automática;
  - sem eliminação automática, os registos de sessões terminadas crescem até existir a retenção definitiva (PD-49, E1.07-E).
- **Ciclo de vida (D-114):**
  - cada arranque tem um `serviceRunId` de 128 bits, distinto do identificador da instalação;
  - as operações exigem `READY` e ficam ligadas ao arranque em que foram obtidas;
  - as sessões anteriores são revogadas antes de `READY`.
- **Fronteira (D-116):** a validação devolve só `sessionId`, `userId` e expirações. Sem tenant, âmbito ou permissões. E1.07-D derivará o `TenantContext` a partir de uma sessão validada, da associação, do âmbito e da permissão.
- **Premissa de instância única (D-127):** todas as garantias das sessões (revogação no reinício, limite de sessões, comprovativos por processo, relógio monotónico por processo) pressupõem **um único serviço operacional por base**. Desde E1.07-X ([tasks/E1.07-X.md](tasks/E1.07-X.md), na branch `feat/e107-x-database-exclusivity`), a premissa é imposta pelo bloqueio exclusivo da base (ver “Serviço local”): uma segunda instância é recusada antes de revogar sessões ou escrever (PD-43, resolvida na branch).
- **Limites conhecidos:** reinício termina todas as sessões (PD-41); transporte do token por definir em E1.08 (PD-42); auditoria das sessões em E1.07-E (PD-26); retenção definitiva e crescimento dos registos (PD-47, PD-49); suspensão real do computador não ensaiada (PD-50, Gate E1.07-F).

## Autorização: contratos RBAC (E1.07-D1)

Localização: `packages/shared-types/src` (`permission.ts`, `role.ts`, `role-assignment.ts`, `authorization.ts`, `authorization-repositories.ts`). **Só contratos de domínio e regras puras**: sem persistência, sem ligação ao serviço local, sem emissão de `TenantContext`. Não são uma fronteira de segurança efectiva; o RBAC só fica operacional em E1.07-D4 (D-146, D-155). Detalhe em [tasks/E1.07-D1.md](tasks/E1.07-D1.md).

A revisão independente [E1.07-D1-M](tasks/E1.07-D1-M.md), realizada depois de o responsável integrar o PR #8, recomendou historicamente NO-GO: `isAuthorizationGranted(unknown)` reconhecia `{ outcome: 'GRANTED' }`, e o contrato não distinguia a proveniência do catálogo. E1.07-D1-R1 corrigiu os defeitos e E1.07-D1-R2 encerrou PD-62/PD-63 (D-168). D2 continua não autorizada e aguarda D1-H/PD-64 (D-169).

**Correcção [E1.07-D1-R1](tasks/E1.07-D1-R1.md)** (D-163 a D-167), integrada pelo responsável no PR #9 antes da revisão e aprovada por [E1.07-D1-R2](tasks/E1.07-D1-R2.md) (D-168). PD-62 e PD-63 estão encerradas. O desenho integrado é:

- **Proveniência das decisões (D-163):** um `WeakMap` privado de `authorization.ts` regista cada decisão emitida por `evaluateAuthorizationFacts`, com o resultado e a proveniência do catálogo fixados na emissão. `inspectDomainDecision` distingue a decisão genuína (`recognized: true`) de qualquer outro valor. Estruturas fabricadas, asserções de tipo, cópias, clones, *proxies* e valores desserializados nunca são reconhecidos. Nenhuma função pública fabrica decisões.
- **Resposta externa (D-164):** `toExternalDomainEvaluationResponse` é uma avaliação de domínio ilustrativa. Só uma concessão genuína sobre o catálogo oficial dá `{ allowed: true }`; tudo o resto dá a mesma recusa genérica `access-denied`.
- **Proveniência dos catálogos (D-165):** `OFFICIAL` (só `OFFICIAL_PERMISSION_CATALOG`), `EXPERIMENTAL` (criados ou estendidos para testes) e `UNKNOWN` (recusado por todas as funções, `untrusted-catalog`). A versão e as definições idênticas não provam origem. `PermissionCatalogProvider` foi retirada; o caminho operacional usa só o catálogo oficial (`requireOfficialPermissionCatalog`).
- **Imutabilidade (D-166):** definições, listas de valores, catálogo, permissões, decisões e colecções devolvidas congelados em execução. As listas e estruturas dos restantes módulos são tratadas por E1.07-D1-H (D-171).
- **Fronteira de confiança (D-167):** protege contra fabricação e confusão de autoridade através das interfaces suportadas, não contra código com controlo total do processo. É local à instância do módulo (falha fechada). Uma decisão de domínio não substitui a autorização operacional de D4 (sessão, recurso, associação persistida, permissão, execução controlada).
- **PD-64 encerrada (D-178):** [E1.07-D1-H](tasks/E1.07-D1-H.md) protegeu listas, configuração, transições e limites; [E1.07-D1-H-R1](tasks/E1.07-D1-H-R1.md) corrigiu RV-D1-H-M-01 com receptor neutro, leitura única e contrato `this: void`; [E1.07-D1-H-R2](tasks/E1.07-D1-H-R2.md) aprovou a correcção. Estado operacional, entradas dos consumidores e registos privados permanecem legitimamente mutáveis. A fronteira de confiança de D-172/D-176 mantém-se.

```text
pedido do consumidor ──▶ evaluateAuthorizationFacts(catálogo reconhecido, factos) ──▶ decisão de domínio (registada)
                                                                                     │
  valor fabricado / clone / JSON ──▶ inspectDomainDecision: recognized=false ◀──────┤
                                                                                     ▼
              toExternalDomainEvaluationResponse: allowed=true só se GRANTED ∧ catálogo OFFICIAL
                                                                                     ▼
              autorização operacional (E1.07-D4, não existe): sessão + recurso + associação persistida + execução
```

```text
autoridade da plataforma KIL   (sem permissões no catálogo; não implementada, D-083)
autoridade da instalação       installation.*  ──▶ InstallationAuthorityGrant (contrato; emissão em D3)
autoridade da empresa          Role ──(RolePermission: concessões explícitas)──▶ PermissionCode do catálogo
                                  └──(RoleAssignment: COMPANY_WIDE | BRANCH)──▶ CompanyMembership (D-081)

decisão = associação empresarial ∩ associação local ∩ âmbito da atribuição ∩ âmbito exigido
        → união das concessões aplicáveis a ESSE alvo → GRANTED | DENIED(motivo interno) → resposta externa genérica
```

- **Autoridades (D-147):** plataforma, instalação e empresa são distintas; nenhuma implica outra. A instalação não tem operações comerciais nem acede a dados comerciais; os perfis empresariais nunca recebem permissões `installation.*`.
- **Permissões (D-148, D-149):** `PermissionCode` com gramática explícita (2–4 segmentos ASCII minúsculos, até 96 caracteres, sem *wildcards* nem `all`/`any`). Catálogo tipado, versionado e imutável, definido em código e estendido só por versão superior. Cada permissão tem âmbito (`INSTALLATION`, `COMPANY`, `BRANCH`), categoria (`ADMINISTRATION`, `OPERATION`) e estado (`AVAILABLE`, `WITHDRAWN`). Catálogo inicial: 24 permissões de administração.
- **Perfis e concessões (D-150, D-151):** perfis por tenant, com código normalizado e único no tenant; nome só de apresentação. Concessões explícitas, sem permissões negativas, *wildcards* nem hierarquias.
- **Atribuições (D-152):** sempre através de uma associação empresarial do mesmo tenant; `COMPANY_WIDE` exige associação `COMPANY_WIDE`; `BRANCH` exige estabelecimento activo e, sob `BRANCH_RESTRICTED`, associação local activa.
- **Avaliação pura (D-153, D-154):** recusa por omissão; permissão registada, disponível e com o âmbito do alvo; factos de outro tenant recusam toda a decisão; concessões de um estabelecimento nunca valem noutro; permissões `OPERATION` exigem empresa `ACTIVE`. Motivos internos tipados; resposta externa idêntica para todas as recusas.
- **Repositórios (D-155):** interfaces `RoleRepository`, `RolePermissionRepository` e `RoleAssignmentRepository`, com `TenantContext` e semântica D-020; implementadas em SQLite por E1.07-D2 (secção seguinte).
- **Prevenção de escalada (D-156):** requisitos de delegação para E1.07-D3 e E1.07-D4.
- **Estados, sessões e catálogo (D-159 a D-162):** política explícita por estado empresarial; autoridades distintas para logout e revogação de sessões/acesso; correspondência obrigatória operação/permissão; códigos desconhecidos ou retirados nunca concedem nem são convertidos ou eliminados silenciosamente.

## Autorização: persistência RBAC e motor interno (E1.07-D2)

Integrada em `main` pelo PR #13 e revista em E1.07-D2-M, GO com ressalvas (D-179 a D-186). **Não é autorização operacional**: o `TenantContext` continua construído pelo chamador (PD-27), nada é exposto por HTTP/IPC e nenhuma operação aceita decisões de domínio. Detalhe em [tasks/E1.07-D2.md](tasks/E1.07-D2.md).

```text
LocalService.internalAuthorization (interno, não autenticado, READY)
  ├─ roles / rolePermissions / roleAssignments ──▶ SQLite (migração 6, D-180)
  ├─ diagnostics.listUnrecognized ──▶ concessões fora do catálogo vigente (PD-61, D-181)
  └─ domainEvaluator.evaluate({ userId, permissionCode, scope })
        │  pedido reconstruído; catálogo OFICIAL fixo; contexto interno "unauthenticated:…"
        ▼
     readCompanyAuthorizationFacts (uma transacção de leitura, só o tenant do alvo)
        ▼
     evaluateAuthorizationFacts (regras puras D1) ──▶ decisão de DOMÍNIO (não operacional)
```

- **Migração 6 (D-180):** `roles`, `role_permissions`, `role_assignments` (`STRICT`, sem dados iniciais); FK compostas com `tenant_id`/`company_id`; índices únicos parciais para `COMPANY_WIDE` (`branch_id` nulo) e `BRANCH`; `CHECK` de gramática, estados e âmbitos; triggers que recusam reinserções, referências de outro tenant, atribuições inelegíveis (criação e reactivação), alterações de referências e eliminação de perfis e atribuições, com `foreign_keys` ligado ou desligado. **Limite (D-185, PD-69):** com `recursive_triggers` desligado (configuração do serviço), `REPLACE`/`UPDATE OR REPLACE` por conflito de `rowid` contorna a não eliminação e a imutabilidade das ligações; a correcção é uma migração aditiva futura. As ligações das tabelas-pai (associações, estabelecimentos, empresas) não são imutáveis na base (PD-70).
- **Migração 7 (D-188, D-194 a D-197; integrada em `main` pelo PR #15, `dc5b046`):** só triggers. Guardas de inserção e de alteração de `rowid` em 10 tabelas (identidades, credenciais, sessões, empresas, estabelecimentos, associações e RBAC), comparando apenas `rowid` explícitos positivos, e recusa de `rowid` não positivo depois da inserção; ligações imutáveis e não reinserção de empresas, estabelecimentos e associações; associações empresariais nunca eliminadas; `installation_bootstrap` gravado uma vez, imutável e não eliminável. Eficaz com qualquer configuração de `foreign_keys`/`recursive_triggers`; não protege contra quem controla o esquema ou o ficheiro. Ressalva (PD-76): uma tabela que já só tenha `rowid` não positivos (escritos por SQL directo antes da 7) deixa de aceitar inserções depois da actualização. Por isso, migrar uma base existente que não tenha sido criada e mantida só pela aplicação exige pré-verificação.
- **Catálogo (D-181):** continua em código, sem tabela de permissões; só o oficial é admitido; `catalog_version` por concessão; códigos não reconhecidos nunca concedem, ficam identificáveis e só saem por `remove` explícito.
- **Motor (D-182):** leitor de factos no pacote `database`, motor no serviço local; sem *cache* de permissões; pedidos da instalação recusados até D3; estados empresariais segundo D1: em qualquer estado o motor concede as permissões `ADMINISTRATION`, sem operação executável (D-186; aplicação de D-159 em D3/D4).
- **Repositórios (D-183):** D-020, D-034, D-039; suites de contrato sobre SQLite e através do serviço.

## Autorização: Gate da instalação (E1.07-D3-G0)

Implementado na branch `feat/e107-d3-g0-installation-authority`, a rever em E1.07-D3-G0-M (D-205 a D-213). **Não activa nenhuma autoridade**: o motor continua a recusar todos os pedidos da instalação (`no-installation-authority`) e a activação está bloqueada até à recuperação aprovada (PD-77). Detalhe, reprodução da PD-75 e modelo de ameaças em [tasks/E1.07-D3-G0.md](tasks/E1.07-D3-G0.md). Revisto em E1.07-D3-G0-M: GO com ressalvas (D-214, D-218). Corrigido em [E1.07-D3-G0-R1](tasks/E1.07-D3-G0-R1.md) (PD-80, PD-81; D-220 a D-224), a rever em E1.07-D3-G0-R2.

```text
installation_bootstrap (imutável, migração 7) ──▶ initial_administrator_id
        │                                              │
        │   readInstallationAnchor() / verifyAnchor()  ▼
        └──────────────▶ users (nunca eliminado, created_at imutável — migração 8)
                         + password_credentials (nunca eliminada — migração 4)
                         intact  ⇔ existe ∧ created_at = completed_at ∧ tem credencial (consistência estrutural; não prova origem nem estado, D-218)
                         broken  ⇔ caso contrário (recusa fechada, sem procurar outra identidade)

identityProvisioning.users.changeStatus / credentials.create / credentials.replace
        └─ administrador inicial ──▶ InitialAdministratorProtectedError (sem autoridade da instalação;
                                     com ou sem credencial; antes de qualquer outra validação — D-220)

LocalService.start ──▶ inspectMigrations ──▶ [pendentes] findNonPositiveRowids (10 tabelas)
        └─ linhas rowid ≤ 0 ──▶ legacy-rowid-incompatible (dados e esquema inalterados; sem renumeração; ver D-218 sobre WAL)
```

- **Migração 8 (D-206):** só triggers; `users` e `branch_memberships` desactivados, nunca eliminados; `UPDATE OF username` para o de outra identidade recusado antes da resolução de conflitos (fecha a eliminação implícita de `UPDATE OR REPLACE`); `users.created_at` imutável. Somas 1–7 inalteradas.
- **Âncora (D-207, D-218):** única fonte admissível da identidade do administrador inicial para a futura autoridade, sempre combinada com identidade ACTIVE e sessão autenticada; `status()` é descritivo; `intact` é consistência estrutural, não prova de origem face a um escritor SQL.
- **Administrador inicial (D-208, D-220):** estado, criação e substituição da credencial recusados pelo provisionamento interno enquanto não existir autoridade da instalação, também quando a credencial falta (a âncora fica `broken` até à recuperação R1, D-215/D-223; na branch, E1.07-D3-G0-R1, PD-80). A identidade também não é recriada: `users.create` recusa o identificador do registo, exista ou não a linha, antes de qualquer validação e de novo na transacção do directório (E1.07-D3-G0-R3, D-227, PD-82; a `main` integrada pelo PR #17 ainda não tem esta correcção, PD-83).
- **Empresas e estabelecimentos (D-222):** política decidida — desactivados, nunca eliminados nem substituídos silenciosamente; implementação numa tarefa própria antes das operações empresariais (PD-78).
- **Fronteira (D-209):** o esquema impede eliminar, reutilizar e redireccionar; não impede editar no lugar (nome, estado, credencial) por SQL. Sem garantias contra quem controla o esquema, o ficheiro, o código ou o sistema operativo.
- **PD-76 (D-211):** pré-verificação no serviço local antes de qualquer migração pendente; `runMigrations` continua primitiva (PD-79 para o instalador).

## Decisões definidas

- Monorepositório com pnpm workspaces e Git.
- TypeScript como linguagem comum, com verificações estritas.
- Desktop em Electron, React e Vite.
- APIs em Node.js, TypeScript e Fastify.
- SQLite para operações locais e PostgreSQL para serviços centrais.
- React Native para a futura aplicação KIL Business Monitor.
- Vitest para testes automatizados.
- Organização modular em aplicações, serviços e pacotes reutilizáveis.
- Isolamento multiempresa obrigatório em todas as camadas que tratem dados empresariais.
- Integração de licenciamento por adaptador, mantendo o servidor existente independente.
- Renderer Electron isolado, com `contextIsolation`, sandbox e segurança web activos, e integração Node.js desactivada.
- Preload com API mínima e imutável; módulos Node/Electron não são expostos ao renderer.
- Navegação desktop demonstrativa sem persistência, autenticação ou operações comerciais.
- Cada empresa juridicamente independente é um tenant identificado por UUID; o NIF é atributo fiscal, não chave (D-016, D-023).
- Grupo empresarial (`BusinessGroup`, futuro) organiza empresas e relatórios consolidados autorizados, sem eliminar o isolamento (D-017).
- Empresas com múltiplos estabelecimentos de um ou vários dos quatro sectores iniciais, extensíveis (D-018).
- NIF validado por regras configuradas por jurisdição, sem algoritmo presumido (D-024).
- Estados empresariais `DRAFT`, `ACTIVE`, `SUSPENDED` e `INACTIVE` (D-025).
- Código de estabelecimento normalizado e único por empresa (D-026).
- Desactivação lógica preferida à eliminação física; eliminação física bloqueada com estabelecimentos (D-027).
- SQLite na camada de serviços locais, com `better-sqlite3` (D-028, D-029).
- Serviço local como processo Node.js independente do Electron, sem HTTP nem rede (D-041).
- Decisões de domínio da PD-11 (D-052 a D-061): identidades 1:1 distintas; NIF ausente só em `DRAFT`; NIF obrigatório em `ACTIVE` e preservado em `SUSPENDED`/`INACTIVE` após activação; NIF único por jurisdição e entidade jurídica após normalização; estados de empresa e de estabelecimento; código único por empresa; desactivação lógica com histórico; transições com regras explícitas.
- Modos de implantação A, B e C; serviço Windows; API REST em Fastify (D-062 a D-066).
- Licença principal independente do Monitor; módulos sectoriais activáveis individualmente (D-067, D-068).
- Node.js 24.22.3 como referência; ESLint 10 (D-069 a D-073).
- Electron 45.3.2 como runtime suportado e política explícita de menor privilégio para renderer, sessão, navegação e recursos locais (D-075 e D-076).
- Vitest 5.1.0, com condições de resolução `source` declaradas para os ambientes `client` e `ssr` (D-077 e D-078).
- Identidade local com `UserId` próprio; acesso a empresas só por associação explícita; âmbitos `COMPANY_WIDE`/`BRANCH_RESTRICTED` sem permissões; administração KIL como autoridade distinta; identidade, autorização e licenciamento separados (D-080 a D-084). Concretização em E1.07-A (D-085 a D-089).
- Autenticação local offline com Argon2id nativo (RFC 9106), política NIST SP 800-63B, limitação persistente de tentativas, inicialização explícita da instalação e integração segura no ciclo de vida do serviço (D-090 a D-097).
- Sessões locais revogáveis com tokens opacos, comprovativo interno de utilização única, versões de segurança monotónicas, relógio efectivo conservador e ligação ao arranque do serviço; uma sessão não é uma autorização empresarial (D-107 a D-116).
- Exclusividade do serviço local por base SQLite, pelo bloqueio exclusivo do próprio SQLite adquirido e comprovado antes de qualquer leitura ou escrita, com identificação canónica da base e recusa tipada `database-locked` (D-130 a D-134, E1.07-X).
- Autorização RBAC em quatro subtarefas (D-146). Contratos de E1.07-D1 e políticas D-147 a D-167; E1.07-D1-R2 encerrou PD-62/PD-63 (D-168). E1.07-D1-H-R2 aprovou a correcção fiscal integrada no PR #12 e encerrou PD-64 (D-178). E1.07-D2 (D-179 a D-183) persiste perfis, concessões e atribuições e avalia factos persistidos num motor interno; integrada no PR #13 e revista em E1.07-D2-M (GO com ressalvas, D-184 a D-186). O RBAC não é operacional até E1.07-D4.

## Estrutura do monorepositório

- `apps/desktop`: processo Electron e renderer React.
- `apps/admin-portal`: portal web administrativo.
- `apps/mobile-monitor`: marcador de fronteira para o futuro cliente React Native; sem dependências móveis nesta etapa.
- `services/local-api`: serviço local Node.js (configuração, ciclo de vida, persistência SQLite e executável). A fábrica Fastify de E1.01 (`app.ts`) mantém-se sem uso.
- `services/central-api`: composição da API central Fastify.
- `services/sync-service`: fronteira do futuro mecanismo de sincronização.
- `packages/shared-types`: contratos de domínio multiempresa, de identidade, de associações, de sessões e de autorização (E1.07-D1), e interfaces de repositório, sem dependência de infraestrutura.
- `packages/database`: persistência SQLite local (ligação, migrações, repositórios multiempresa, directório de identidades e associações); fronteira futura para PostgreSQL.
- `packages/accounting`: fronteira do domínio contabilístico.
- `packages/fiscal`: fronteira do domínio fiscal.
- `packages/licensing`: porta de integração com licenciamento.
- `packages/ui`: componentes visuais partilháveis.
- `tests`: testes transversais; `tests/support` contém dados de teste, a suite de contrato, o duplo em memória, o suporte a bases SQLite temporárias e o suporte ao serviço local.

## Decisões pendentes

- Contrato, autenticação e disponibilidade do servidor de licenciamento KIL; nenhum endpoint foi presumido.
- Estratégia e protocolo de sincronização, resolução de conflitos, idempotência e operação offline.
- Modelo de tenancy no PostgreSQL (colunas, schemas ou bases separadas), row-level security e driver PostgreSQL.
- Framework de empacotamento, actualizações e assinatura de código do Electron.
- Administração e integração da autorização (E1.07-D3 e E1.07-D4; a persistência de E1.07-D2 está integrada, com as ressalvas PD-69 a PD-71; a correcção E1.07-D2-R1, complementada por E1.07-D2-R3 (PD-70, PD-72 a PD-74, D-194 a D-199), revista em E1.07-D2-R4 com GO (D-200) e integrada pelo PR #15, `dc5b046`; PD-75 no Gate D3 e condição de activação, D-201; PD-76 antes de migrar bases existentes; ambas tratadas na branch de E1.07-D3-G0, D-206 a D-211, a rever), recuperação administrativa do administrador inicial (proposta R1/R2, D-210; PD-77 bloqueia a activação) e recuperação de conta (E1.07-E); política de eliminação de empresas e estabelecimentos (PD-78); origem autenticada do `TenantContext` (E1.07-D4). O modelo de identidade e associações está definido desde E1.07-A, a autenticação local desde E1.07-B e as sessões locais desde E1.07-C; o transporte da sessão até à interface fica para E1.08 (PD-42).
- Hosting, observabilidade, backups, recuperação de desastre e topologia de implantação.
- Biblioteca de componentes e sistema visual definitivo.
- Versões e arquitectura concretas do React Native quando começar o monitor móvel.
- Requisitos fiscais angolanos detalhados, respectivas fontes normativas e processo de actualização, incluindo a regra de validação do NIF para `AO` (D-024).
- Âmbito funcional e regras de cada sector (D-018 identifica os sectores, não as respectivas regras).
- Modelo de integração contabilística: que operações geram lançamentos, em que momento e com que plano de contas.
- Transporte concreto entre a interface e o serviço local: mecanismo de loopback no modo A e terminação HTTPS e certificados no modo B (os princípios estão em D-062 e D-063). Inclui a tecnologia do serviço Windows (D-065) e o modelo de segurança.
- Localização definitiva da base local por instalação, cópias de segurança e recuperação. Desde E1.07-X, as cópias consistentes têm de ser feitas pela instância proprietária (Backup API ou `VACUUM INTO`), a implementar em E1.10.
- Regras concretas de normalização do NIF por jurisdição, que dependem da política fiscal (D-058, PD-09).
- Tabela concreta de transições permitidas entre estados empresariais e respectiva auditoria (o princípio está em D-061).
- Modelo de `BusinessGroup`, autorização de relatórios consolidados e respectiva auditoria (D-017).
- Política de eliminação de dados empresariais em produção (D-027).

## Restrições da fundação

E1.01 a E1.07-C não criam bases de produção, endpoints de negócio, POS, facturação, contabilidade ou módulos sectoriais. E1.07-A cria identidades e associações. E1.07-B acrescenta credenciais e autenticação local. E1.07-C acrescenta sessões locais revogáveis, sem permissões, RBAC, JWT nem qualquer exposição externa. E1.07-X impõe um único serviço por base, sem HTTP, IPC nem dependências novas. E1.07-D1 acrescenta só contratos e regras puras de autorização, sem persistência, migração nem integração. E1.07-D2 acrescenta a migração 6, repositórios RBAC e um motor interno de domínio, sem perfis predefinidos, HTTP, IPC nem autorização operacional. A persistência SQLite é gerida pelo serviço local, sem servidor HTTP e sem localização de produção definida. Os indicadores visuais da aplicação desktop são explicitamente demonstrativos. Os pacotes de domínio contêm apenas contratos e validações estruturais, sem regras fiscais, contabilísticas ou sectoriais.
