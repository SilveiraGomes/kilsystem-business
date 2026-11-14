# Registo de decisões

Decisões em vigor no projecto, com a etapa e o commit de origem. As entradas não são reescritas: uma alteração cria uma nova entrada que indica a decisão substituída. As decisões em aberto estão em [architecture.md](architecture.md#decisões-pendentes).

| ID | Decisão | Origem |
| --- | --- | --- |
| D-001 | Monorepositório com pnpm workspaces (`apps/*`, `services/*`, `packages/*`) e Git. | E1.01 · `ff5ba65` |
| D-002 | TypeScript como linguagem comum, em modo `strict` com `noUncheckedIndexedAccess`. | E1.01 · `ff5ba65` |
| D-003 | Desktop em Electron, React e Vite. | E1.01 · `ff5ba65` |
| D-004 | APIs local e central em Node.js, TypeScript e Fastify, independentes entre si. | E1.01 · `ff5ba65` |
| D-005 | SQLite para operações locais; PostgreSQL para serviços centrais. | E1.01 · `ff5ba65` |
| D-006 | KIL Business Monitor futuro em React Native, opcional e limitado a indicadores sincronizados. | E1.01 · `ff5ba65` |
| D-007 | Vitest para testes automatizados; `pnpm check` como validação obrigatória. | E1.01 · `ff5ba65` |
| D-008 | Isolamento multiempresa obrigatório em todas as camadas com dados empresariais; tenant obtido de contexto autenticado. | E1.01 · `ff5ba65` (`AGENTS.md`) |
| D-009 | Licenciamento integrado por adaptador; o servidor de licenciamento KIL permanece independente e sem contratos presumidos. | E1.01 · `ff5ba65` |
| D-010 | Valores monetários em representação decimal segura; lançamentos e documentos fiscais imutáveis ou corrigidos por operações auditáveis; regras legais apenas com fonte, versão e vigência documentadas. | E1.01 · `ff5ba65` (`AGENTS.md`) |
| D-011 | Renderer Electron isolado: `contextIsolation`, `sandbox` e `webSecurity` activos; `nodeIntegration` e `allowRunningInsecureContent` desactivados; novas janelas e navegação externa bloqueadas. | E1.02 · `b113388` |
| D-012 | Preload com API mínima e imutável (`kilDesktop.runtime.platform`), compilado de `preload.cts` para CommonJS (`preload.cjs`) por compatibilidade com o sandbox. | E1.02 · `b113388` |
| D-013 | Navegação desktop demonstrativa, sem persistência, autenticação ou operações comerciais. | E1.02 · `b113388` |
| D-014 | `AGENTS.md` é a fonte única de regras para todos os agentes; `CLAUDE.md` apenas o importa e aponta para a documentação central. | E1.02-H |
| D-015 | A continuidade do trabalho assenta em `docs/project-status.md` (estado verificado e retoma) e `docs/tasks/<etapa>.md` (âmbito por etapa). | E1.02-H |
| D-016 | Identidade multiempresa: cada empresa juridicamente independente corresponde a um tenant, identificado internamente por UUID (`TenantId`). O NIF é um atributo fiscal e não constitui chave primária. | E1.03 (decisão do responsável) |
| D-017 | Grupo empresarial: uma futura entidade `BusinessGroup` poderá reunir várias empresas juridicamente independentes, para organização e relatórios consolidados autorizados, sem eliminar o isolamento entre empresas. Sem consolidação nem acessos entre empresas em E1.03. | E1.03 (decisão do responsável) |
| D-018 | Estabelecimentos: cada empresa pode ter múltiplos estabelecimentos, do mesmo sector ou de sectores diferentes. Sectores iniciais: `PHARMACY`, `SUPERMARKET`, `FUEL_STATION`, `RESTAURANT`; contratos preparados para novos sectores. | E1.03 (decisão do responsável) |
| D-019 | Contratos de domínio e interfaces de repositório multiempresa ficam em `packages/shared-types`; as implementações de persistência ficam em `packages/database`. | E1.03 |
| D-020 | Semântica de isolamento dos repositórios: leitura cruzada devolve `undefined`; alteração e eliminação cruzadas devolvem `RecordNotFoundError` sem revelar existência; registo de outro tenant devolve `TenantMismatchError`; contexto ausente ou inválido devolve `TenantContextError`. | E1.03 |
| D-021 | Toda a implementação de repositório multiempresa deve passar a suite `tests/support/tenant-repository-contract.ts`. | E1.03 |
| D-022 | O Vitest usa a raiz do monorepositório como `root` (`vitest.config.ts`), para que a configuração funcione a partir de qualquer pacote. Resolve PD-01. | E1.03 |
| D-023 | Identidades: `CompanyId` e `TenantId` são UUID distintos, em relação 1:1, com unicidade obrigatória. | E1.04 (decisão do responsável) |
| D-024 | NIF: uma empresa `ACTIVE` tem de ter NIF válido segundo as regras configuradas para a sua jurisdição, sem algoritmo fiscal presumido sem confirmação normativa. Empresas `DRAFT` podem não ter NIF. | E1.04 (decisão do responsável) |
| D-025 | Estados empresariais `DRAFT`, `ACTIVE`, `SUSPENDED` e `INACTIVE`, independentes de estados de licenciamento. | E1.04 (decisão do responsável) |
| D-026 | Código do estabelecimento único dentro da empresa, com normalização explícita; pode repetir-se noutras empresas. | E1.04 (decisão do responsável) |
| D-027 | Eliminação física de empresas com estabelecimentos impedida; desactivação lógica preparada; sem funcionalidades de eliminação de dados empresariais em produção. | E1.04 (decisão do responsável) |
| D-028 | A base SQLite pertence à camada de serviços locais, não ao renderer React nem ao processo principal Electron. | E1.04 (decisão do responsável) |
| D-029 | Driver SQLite: `better-sqlite3`, numa versão compatível com o ambiente existente, sem actualizar Node nem Electron. | E1.04 (decisão do responsável) |
| D-030 | Concretização de D-024: `Company.jurisdiction` (ISO 3166-1 alfa-2) e `TaxIdPolicy` com regras por jurisdição, cada uma com fonte normativa. A política falha fechada: sem regra, nenhuma empresa fica `ACTIVE`. `createCompany(input, policy)` aplica a regra; `restoreCompany(input)` reidrata dados persistidos só com validação estrutural. | E1.04 |
| D-031 | Interpretações a confirmar: D-023 aplicado como `id ≠ tenantId`; NIF estruturalmente obrigatório apenas em `ACTIVE`; D-025 aplicado às empresas, com estabelecimentos em `ACTIVE`/`INACTIVE`. | E1.04 |
| D-032 | Concretização de D-026: `normalizeBranchCode` remove espaços nas extremidades, aplica NFKC, converte para maiúsculas e reduz espaços internos consecutivos a um. | E1.04 |
| D-033 | Migrações em código, sequenciais a partir de 1, imutáveis depois de publicadas. Cada uma corre numa transacção e é registada em `schema_migrations` com SHA-256. Bases com migração alterada ou de versão superior são recusadas. | E1.04 |
| D-034 | Repositórios assíncronos (contrato E1.03) sobre núcleo síncrono; cada escrita numa transacção `IMMEDIATE`. Alterações relacionadas usam `transaction(work)` síncrono, que reverte em qualquer excepção e recusa trabalho assíncrono. | E1.04 |
| D-035 | Integridade no esquema: tabelas `STRICT`, chave estrangeira composta `(company_id, tenant_id)`, `ON DELETE RESTRICT`, verificações de estado, NIF, identidade e cronologia, e catálogo `sector_types` (um novo sector exige migração). | E1.04 |
| D-036 | Erros SQLite traduzidos para `PersistenceError(reason)` sem SQL nem valores na mensagem; erros de domínio propagados sem alteração; registos persistidos inválidos reportados como `invalid-stored-record`. | E1.04 |
| D-037 | PD-08: condição de exportação `source → src/index.ts` em `shared-types` e `database`, activada por `customConditions` (TypeScript) e `resolve.conditions` (Vitest). O build usa `tsconfig.build.json` e consome `dist/`. | E1.04 |
| D-038 | Localização da base: caminho absoluto obrigatório, extensões `.sqlite`/`.sqlite3`/`.db`, fora de directórios protegidos, sem valor por omissão. `LOCAL_DATABASE_PATH` em `.env.example` passa a vazio. | E1.04 |
| D-039 | Repositórios revalidam os registos recebidos (objectos forjados são recusados) e tratam `createdAt` como imutável (`RecordConflictError('immutable-field')`). | E1.04 |
| D-040 | `better-sqlite3` `^12.11.1` (MIT; declara suporte a Node 20.x) e `@types/better-sqlite3` `^7.6.13`. A série 13.x foi excluída por exigir Node ≥ 22. | E1.04 |
| D-041 | O serviço local é um processo Node.js independente do Electron, em `services/local-api`, sem API HTTP, sem portas de rede e sem integração com a interface. Concretiza D-028. O `better-sqlite3` mantém a ABI do Node, sem recompilação para o Electron. | E1.05 (decisão do responsável) |
| D-042 | Máquina de estados `STOPPED`, `STARTING`, `READY`, `STOPPING`, `FAILED`, com as transições de `LOCAL_SERVICE_TRANSITIONS`. `start()` e `stop()` são idempotentes, um arranque em curso é partilhado e `stop()` aguarda o arranque em curso antes de encerrar. | E1.05 |
| D-043 | Configuração explícita lida de um ambiente injectado (`process.env` no executável), sem carregar ficheiros `.env`. Variáveis `LOCAL_DATABASE_PATH` e `LOCAL_SERVICE_*`. O esquema programático é estrito e recusa propriedades desconhecidas (ex.: `sql`, `migrations`). Só o nível de registo tem valor por omissão (`info`). | E1.05 |
| D-044 | Política de inicialização: `onMissingDatabase` (`create`/`fail`; `fail` nunca cria ficheiros) e `onPendingMigrations` (`apply`/`fail`; `fail` inspecciona sem alterar a base). | E1.05 |
| D-045 | Directórios protegidos derivados da localização do código: raiz do pacote do serviço e, se existir, raiz do monorepositório. A localização é validada na configuração e novamente no arranque. | E1.05 |
| D-046 | Registos estruturados em JSON Lines. Só o nome do ficheiro da base é registado, nunca o caminho. As causas aparecem por nome e motivo, nunca pela mensagem. Chaves sensíveis (NIF, credenciais, nomes legais, contactos) são substituídas por `[REDACTED]`, e o `instanceId` tem conjunto de caracteres restrito. | E1.05 |
| D-047 | Os repositórios do serviço recusam qualquer operação fora de `READY` (`LocalServiceStateError('not-ready')`), incluindo `transaction`. O serviço não é acessível a partir de `apps/desktop`, o que é verificado por teste. | E1.05 |
| D-048 | Qualquer falha de arranque fecha a ligação antes de entrar em `FAILED`; os ficheiros da base nunca são apagados. `FAILED → STARTING` permite nova tentativa; `FAILED → STOPPED` encerra sem recursos pendentes. | E1.05 |
| D-049 | Executável `node dist/main.js`: sem argumentos, fica em `READY` até `SIGINT`/`SIGTERM` (e `SIGBREAK` em Windows); com `--check`, arranca e encerra. Códigos de saída: 0 sucesso, 1 falha de arranque ou encerramento, 2 configuração ou argumentos inválidos. | E1.05 |
| D-050 | `packages/database` ganha a opção `fileMustExist` em `openSqliteDatabase` e `inspectMigrations` (verificação sem escrita); `runMigrations` passa a usá-la, com comportamento inalterado. | E1.05 |
| D-051 | A suite de contrato multiempresa corre também através do serviço local em `READY` (D-021), com factory assíncrona. | E1.05 |
| D-052 | `CompanyId` e `TenantId` são UUID distintos, com relação obrigatória 1:1. Confirma D-023 e a interpretação `id ≠ tenantId` de D-031. | E1.06 (decisão do responsável; encerra PD-11) |
| D-053 | O NIF pode estar ausente numa empresa `DRAFT`. Confirma D-024. | E1.06 (decisão do responsável) |
| D-054 | O NIF é obrigatório em `ACTIVE` e sujeito à política fiscal aplicável. Confirma D-024. | E1.06 (decisão do responsável) |
| D-055 | Empresas anteriormente activadas preservam o NIF em `SUSPENDED` e `INACTIVE`. **Substitui** a interpretação de D-031 (“NIF estruturalmente obrigatório apenas em `ACTIVE`”). Implementação pendente: PD-14. | E1.06 (decisão do responsável) |
| D-056 | Estados empresariais `DRAFT`, `ACTIVE`, `SUSPENDED` e `INACTIVE`. Confirma D-025. | E1.06 (decisão do responsável) |
| D-057 | Estados dos estabelecimentos `ACTIVE` e `INACTIVE`. Confirma a interpretação de D-031. | E1.06 (decisão do responsável) |
| D-058 | O NIF é único por jurisdição e entidade jurídica, após normalização segundo a política fiscal aplicável. Implementação pendente: PD-15 (depende de PD-09). | E1.06 (decisão do responsável) |
| D-059 | Código do estabelecimento único dentro da empresa. Confirma D-026. | E1.06 (decisão do responsável) |
| D-060 | Desactivação lógica preferencial, com preservação do histórico. Confirma e reforça D-027. Histórico pendente: PD-16. | E1.06 (decisão do responsável) |
| D-061 | Transições entre estados empresariais controladas por regras explícitas. Implementação pendente: PD-16. | E1.06 (decisão do responsável) |
| D-062 | Modo de implantação **A — Autónomo**: serviço local e interface no mesmo computador, base SQLite local e comunicação futura autenticada por loopback. | E1.06 (decisão do responsável) |
| D-063 | Modo de implantação **B — Centralizado**: serviço operacional no servidor da empresa e vários terminais ligados ao serviço por HTTPS autenticado (futuro). Nenhum terminal acede directamente ao ficheiro SQLite por SMB ou outro mecanismo de partilha. | E1.06 (decisão do responsável) |
| D-064 | Modo de implantação **C — Multiestabelecimento**: serviços locais independentes, operação offline por estabelecimento, sincronização futura com serviços centrais e monitorização móvel opcional. | E1.06 (decisão do responsável) |
| D-065 | O serviço local será instalado futuramente como serviço Windows, com ciclo de vida independente do Electron. Complementa D-041. | E1.06 (decisão do responsável) |
| D-066 | A API empresarial usará REST e Fastify, com autenticação, autorização e isolamento por empresa. | E1.06 (decisão do responsável) |
| D-067 | Licenciamento: a licença principal é independente do Monitor; o Monitor é opcional, e a sua expiração não interrompe as operações locais autorizadas. Mantém D-009. | E1.06 (decisão do responsável; registo de decisão já aprovada) |
| D-068 | Licenciamento: os módulos sectoriais são activáveis individualmente. | E1.06 (decisão do responsável; registo de decisão já aprovada) |
| D-069 | Node.js 24 LTS (“Krypton”) como versão de referência, revisão **24.22.3**. Suporte oficial até 2028-04-30, em *Maintenance* desde 2026-10-20. Fixada em `.node-version` e em `engines.node` (`>=24.22.3 <25`), com `engine-strict=true` (`.npmrc`). Substitui o requisito `>=20.16.0 <23` de E1.01 e encerra PD-12. | E1.06 |
| D-070 | O `better-sqlite3` mantém-se em 12.11.1. Publica binário pré-compilado `node-v137-win32-x64` para Node 24, e a 13.1.1 não publica binários Windows. Não há razão técnica para actualizar. Complementa D-040. | E1.06 |
| D-071 | `@types/node` alinhado com o runtime: `^24.19.2` no catálogo do workspace, também usado pela raiz. | E1.06 |
| D-072 | ESLint 10 (`eslint ^10.15.0`, `@eslint/js ^10.0.1`). O ESLint 9 chegou ao fim de suporte; o typescript-eslint 8.72.2 declara `eslint ^10` e a configuração *flat* não mudou. | E1.06 |
| D-073 | O pnpm mantém-se em 9.15.9 (compatível com Node 24). A mudança para o pnpm 10 ou superior altera a política de *build scripts* e fica para avaliação própria (PD-20). | E1.06 |
| D-074 | Repositório oficial `https://github.com/SilveiraGomes/kilsystem-business` (remoto `origin`). Cada tarefa começa com verificação do remoto e `git fetch` e termina com publicação confirmada na branch autorizada (`main`, salvo indicação diferente). Sem *force push* nem *reset* destrutivo; bloqueios são comunicados, nunca forçados (`AGENTS.md`, “Git e GitHub”). | Política Git/GitHub (decisão do responsável) |
