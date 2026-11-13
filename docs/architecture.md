# Arquitectura inicial

## Estado deste documento

Este documento regista a fundação E1.01, a primeira aplicação desktop E1.02, a arquitectura de negócio consolidada em E1.02-H, os contratos multiempresa de E1.03 e a persistência SQLite de E1.04. “Definido” significa uma decisão já fornecida ou validada pelo projecto; “pendente” requer validação posterior e não deve ser inferido.

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

Nenhuma seta representa um endpoint já existente; indica somente limites e direcções arquitecturais pretendidas. A base SQLite pertence à camada de serviços locais, nunca ao renderer React nem ao processo principal Electron (D-028).

## Arquitectura de negócio

| Pilar | Definição registada | Estado na implementação (E1.04) |
| --- | --- | --- |
| Multiempresa | Definido: isolamento obrigatório por tenant/empresa em todas as camadas (`AGENTS.md`). Cada empresa juridicamente independente é um tenant identificado por UUID distinto do da empresa, em relação 1:1; o NIF não é chave (D-016, D-023). Grupos empresariais organizam empresas sem eliminar o isolamento (D-017). | Contratos em `packages/shared-types` e repositórios SQLite em `packages/database`, com filtro por tenant em todas as consultas e integridade garantida pelo esquema. `BusinessGroup` não implementado. A “empresa activa” na interface continua a ser texto fixo demonstrativo. |
| Quatro sectores | Definido (D-018): `PHARMACY` (Farmácia), `SUPERMARKET` (Supermercado), `FUEL_STATION` (Posto de combustível), `RESTAURANT` (Restauração). Uma empresa pode ter estabelecimentos de sectores diferentes. | `SECTOR_TYPES` no domínio e catálogo `sector_types` na base. Não existem módulos nem regras sectoriais. |
| Contabilidade integrada | Definido: fronteira `packages/accounting`, valores decimais seguros, lançamentos imutáveis ou corrigidos de forma auditável (`AGENTS.md`). | O pacote apenas exporta `accountingModuleStatus = 'not-implemented'`. O modelo de integração entre operações e contabilidade está pendente. |
| Funcionamento offline | Definido: o desktop opera com serviços e dados locais em SQLite. | Persistência SQLite local implementada em `packages/database`, ainda não integrada em `services/local-api` nem no desktop. A estratégia offline está pendente. |
| Sincronização | Definido: `services/sync-service` liga o ambiente local aos serviços centrais em PostgreSQL. | Fronteira sem implementação (`syncServiceStatus = 'contract-pending'`); protocolo pendente. |
| Monitor opcional | Definido: KIL Business Monitor em React Native, opcional, limitado à consulta de indicadores sincronizados. | `apps/mobile-monitor` é um marcador TypeScript sem dependências móveis. |

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
- `vitest.config.ts` define `resolve.conditions: ['source']`.
- O build de `packages/database` usa `tsconfig.build.json`, sem a condição, e consome `shared-types` a partir de `dist/`. O `pnpm -r build` respeita a ordem pela dependência `workspace:*`.
- Em execução Node, sem a condição, os pacotes resolvem para `dist/`.

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

## Estrutura do monorepositório

- `apps/desktop`: processo Electron e renderer React.
- `apps/admin-portal`: portal web administrativo.
- `apps/mobile-monitor`: marcador de fronteira para o futuro cliente React Native; sem dependências móveis nesta etapa.
- `services/local-api`: composição da API local Fastify.
- `services/central-api`: composição da API central Fastify.
- `services/sync-service`: fronteira do futuro mecanismo de sincronização.
- `packages/shared-types`: contratos de domínio multiempresa e interfaces de repositório, sem dependência de infraestrutura.
- `packages/database`: persistência SQLite local (ligação, migrações e repositórios multiempresa); fronteira futura para PostgreSQL.
- `packages/accounting`: fronteira do domínio contabilístico.
- `packages/fiscal`: fronteira do domínio fiscal.
- `packages/licensing`: porta de integração com licenciamento.
- `packages/ui`: componentes visuais partilháveis.
- `tests`: testes transversais; `tests/support` contém dados de teste, a suite de contrato, o duplo em memória e o suporte a bases SQLite temporárias.

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
- Canal entre o processo Electron e `services/local-api`, processo e runtime onde os serviços locais correm, e respectivo modelo de segurança. Um runtime Electron exigiria recompilar o `better-sqlite3` para a ABI do Electron.
- Localização definitiva da base local por instalação, cópias de segurança e recuperação.
- Unicidade do NIF (por jurisdição ou global) e obrigatoriedade do NIF em `SUSPENDED`/`INACTIVE`.
- Transições permitidas entre estados empresariais e respectiva auditoria.
- Modelo de `BusinessGroup`, autorização de relatórios consolidados e respectiva auditoria (D-017).
- Política de eliminação de dados empresariais em produção (D-027).

## Restrições da fundação

E1.01 a E1.04 não criam bases de produção, endpoints de negócio, POS, facturação, contabilidade ou módulos sectoriais. A persistência SQLite existe apenas como biblioteca, sem localização de produção definida. Os indicadores visuais da aplicação desktop são explicitamente demonstrativos. Os pacotes de domínio contêm apenas contratos e validações estruturais, sem regras fiscais, contabilísticas ou sectoriais.
