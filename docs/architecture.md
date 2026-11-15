# Arquitectura inicial

## Estado deste documento

Este documento regista a fundação E1.01, a primeira aplicação desktop E1.02, a arquitectura de negócio consolidada em E1.02-H, os contratos multiempresa de E1.03, a persistência SQLite de E1.04, o ciclo de vida do serviço local de E1.05, o ambiente de execução e as decisões de E1.06, a actualização segura do Electron em E1.06-S1 e a modernização do Vitest em E1.06-S2. “Definido” significa uma decisão já fornecida ou validada pelo projecto; “pendente” requer validação posterior e não deve ser inferido.

## Visão geral

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
| Multiempresa | Definido: isolamento obrigatório por tenant/empresa em todas as camadas (`AGENTS.md`). Cada empresa juridicamente independente é um tenant identificado por UUID distinto do da empresa, em relação 1:1; o NIF não é chave (D-016, D-023). Grupos empresariais organizam empresas sem eliminar o isolamento (D-017). | Contratos em `packages/shared-types` e repositórios SQLite em `packages/database`, com filtro por tenant em todas as consultas e integridade garantida pelo esquema. `BusinessGroup` não implementado. A “empresa activa” na interface continua a ser texto fixo demonstrativo. |
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
- **Regras fiscais** (`tax-identification.ts`): `TaxIdRule` exige fonte normativa, e `TaxIdPolicy` agrupa as regras por jurisdição. A política falha fechada: sem regra configurada, nenhuma empresa pode ficar `ACTIVE`. O projecto não inclui nenhuma regra real.
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

- **Ligação** (`connection.ts`): `openSqliteDatabase` activa `foreign_keys` e confirma que ficou activo; aplica `busy_timeout` e, em ficheiro, `journal_mode = WAL`.
- **Localização** (`location.ts`): `resolveDatabaseLocation` exige um caminho absoluto com extensão `.sqlite`, `.sqlite3` ou `.db`, fora dos directórios protegidos (repositório e artefactos de build). Não existe localização por omissão (D-038).
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
  - Sequência de arranque:
    1. valida a localização;
    2. aplica `onMissingDatabase` (`fail` usa `fileMustExist` e não cria ficheiros);
    3. abre o SQLite;
    4. corre `inspectMigrations` (integridade);
    5. aplica `onPendingMigrations` (`fail` recusa sem alterar);
    6. corre `runMigrations`;
    7. cria os repositórios.

    Qualquer falha fecha a ligação antes de `FAILED`, com motivo `invalid-location`, `database-missing`, `database-open-failed`, `migration-integrity`, `pending-migrations`, `migration-failed` ou `unexpected` (D-048).
  - `companies`, `branches` e `transaction` delegam nos repositórios SQLite (isolamento por tenant inalterado) e recusam qualquer operação fora de `READY` com `LocalServiceStateError('not-ready')` (D-047).
- **Registos** (`logger.ts`, D-046): uma linha JSON por evento, com `time`, `level`, `event`, `instanceId` e campos escalares. Os eventos são `service.state_changed`, `service.starting`, `service.database_opened`, `service.ready`, `service.start_failed`, `service.stopped`, `service.stop_failed`, `service.release_failed`, `service.config_invalid`, `service.arguments_invalid`, `service.waiting_for_shutdown` e `service.shutdown_requested`. A base é identificada só pelo nome do ficheiro, as causas por nome e motivo, e as chaves sensíveis são redigidas.
- **Executável** (`main.ts`, `cli.ts`, D-049): `node dist/main.js` fica em `READY` até `SIGINT`/`SIGTERM` (e `SIGBREAK` em Windows); `--check` arranca e encerra. Códigos de saída: 0, 1 (arranque ou encerramento) e 2 (configuração ou argumentos).
- **Verificação**: `tests/local-service.test.ts` cobre o ciclo de vida, as falhas, a recuperação, a configuração, os registos, a CLI e a independência do Electron. A suite de contrato corre também através do serviço (D-051).

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

## Estrutura do monorepositório

- `apps/desktop`: processo Electron e renderer React.
- `apps/admin-portal`: portal web administrativo.
- `apps/mobile-monitor`: marcador de fronteira para o futuro cliente React Native; sem dependências móveis nesta etapa.
- `services/local-api`: serviço local Node.js (configuração, ciclo de vida, persistência SQLite e executável). A fábrica Fastify de E1.01 (`app.ts`) mantém-se sem uso.
- `services/central-api`: composição da API central Fastify.
- `services/sync-service`: fronteira do futuro mecanismo de sincronização.
- `packages/shared-types`: contratos de domínio multiempresa e interfaces de repositório, sem dependência de infraestrutura.
- `packages/database`: persistência SQLite local (ligação, migrações e repositórios multiempresa); fronteira futura para PostgreSQL.
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
- Estratégia de autenticação, autorização, gestão de sessões e recuperação de conta; origem autenticada do `TenantContext`.
- Hosting, observabilidade, backups, recuperação de desastre e topologia de implantação.
- Biblioteca de componentes e sistema visual definitivo.
- Versões e arquitectura concretas do React Native quando começar o monitor móvel.
- Requisitos fiscais angolanos detalhados, respectivas fontes normativas e processo de actualização, incluindo a regra de validação do NIF para `AO` (D-024).
- Âmbito funcional e regras de cada sector (D-018 identifica os sectores, não as respectivas regras).
- Modelo de integração contabilística: que operações geram lançamentos, em que momento e com que plano de contas.
- Transporte concreto entre a interface e o serviço local: mecanismo de loopback no modo A e terminação HTTPS e certificados no modo B (os princípios estão em D-062 e D-063). Inclui a tecnologia do serviço Windows (D-065) e o modelo de segurança.
- Localização definitiva da base local por instalação, cópias de segurança e recuperação.
- Regras concretas de normalização do NIF por jurisdição, que dependem da política fiscal (D-058, PD-09).
- Tabela concreta de transições permitidas entre estados empresariais e respectiva auditoria (o princípio está em D-061).
- Modelo de `BusinessGroup`, autorização de relatórios consolidados e respectiva auditoria (D-017).
- Política de eliminação de dados empresariais em produção (D-027).

## Restrições da fundação

E1.01 a E1.06 não criam bases de produção, endpoints de negócio, POS, facturação, contabilidade ou módulos sectoriais. A persistência SQLite é gerida pelo serviço local, sem servidor HTTP e sem localização de produção definida. Os indicadores visuais da aplicação desktop são explicitamente demonstrativos. Os pacotes de domínio contêm apenas contratos e validações estruturais, sem regras fiscais, contabilísticas ou sectoriais.
