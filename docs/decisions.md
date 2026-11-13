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
