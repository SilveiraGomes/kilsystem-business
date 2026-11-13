# Arquitectura inicial

## Estado deste documento

Este documento regista a fundação E1.01, a primeira aplicação desktop E1.02, a arquitectura de negócio consolidada em E1.02-H e os contratos multiempresa de E1.03. “Definido” significa uma decisão já fornecida ou validada pelo projecto; “pendente” requer validação posterior e não deve ser inferido.

## Visão geral

O KIL Business será um ERP híbrido e modular. A aplicação desktop operará com serviços e dados locais, enquanto serviços centrais em PostgreSQL suportarão capacidades centralizadas e sincronização. O monitor móvel será opcional e apenas consultará indicadores sincronizados quando for implementado.

```text
apps/desktop ──> services/local-api ──> SQLite local
                      │
                      └──> services/sync-service ──> services/central-api ──> PostgreSQL

apps/admin-portal ────────────────────────────────> services/central-api
apps/mobile-monitor (futuro) ─────────────────────> serviços centrais a definir

packages/licensing ──> adaptador futuro ──> servidor KIL independente
```

Nenhuma seta representa um endpoint já existente; indica somente limites e direcções arquitecturais pretendidas.

## Arquitectura de negócio

| Pilar | Definição registada | Estado na implementação (E1.03) |
| --- | --- | --- |
| Multiempresa | Definido: isolamento obrigatório por tenant/empresa em todas as camadas (`AGENTS.md`). Cada empresa juridicamente independente é um tenant identificado por UUID; o NIF não é chave (D-016). Grupos empresariais organizam empresas sem eliminar o isolamento (D-017). | Contratos `Company`, `Branch`, `TenantContext` e repositórios com escopo obrigatório em `packages/shared-types`, verificados por testes de isolamento. Sem persistência real; `BusinessGroup` não implementado. A “empresa activa” na interface continua a ser texto fixo demonstrativo. |
| Quatro sectores | Definido (D-018): `PHARMACY` (Farmácia), `SUPERMARKET` (Supermercado), `FUEL_STATION` (Posto de combustível), `RESTAURANT` (Restauração). Uma empresa pode ter estabelecimentos de sectores diferentes. | `SECTOR_TYPES` e `Branch.sectorType` em `packages/shared-types`. Não existem módulos nem regras sectoriais. |
| Contabilidade integrada | Definido: fronteira `packages/accounting`, valores decimais seguros, lançamentos imutáveis ou corrigidos de forma auditável (`AGENTS.md`). | O pacote apenas exporta `accountingModuleStatus = 'not-implemented'`. O modelo de integração entre operações e contabilidade está pendente. |
| Funcionamento offline | Definido: o desktop opera com serviços e dados locais em SQLite. | A estratégia offline está pendente. O desktop ainda não comunica com `services/local-api`, que só cria a instância Fastify. |
| Sincronização | Definido: `services/sync-service` liga o ambiente local aos serviços centrais em PostgreSQL. | Fronteira sem implementação (`syncServiceStatus = 'contract-pending'`); protocolo pendente. |
| Monitor opcional | Definido: KIL Business Monitor em React Native, opcional, limitado à consulta de indicadores sincronizados. | `apps/mobile-monitor` é um marcador TypeScript sem dependências móveis. |

## Contratos multiempresa (E1.03)

Localização: `packages/shared-types/src`. Os contratos e as interfaces de repositório pertencem ao domínio e não dependem de infraestrutura. As implementações de persistência ficarão em `packages/database` (E1.04).

- **Identificadores** (`identifiers.ts`): `TenantId`, `CompanyId` e `BranchId` são UUID em forma canónica (minúsculas, versões 1 a 8, sem UUID nulo), com marcas de tipo distintas que impedem trocas em compilação. `ActorId` e `CorrelationId` são texto não vazio com até 128 caracteres. Só se obtêm através das funções `parse*`.
- **Entidades** (`company.ts`, `branch.ts`): `createCompany` e `createBranch` validam a entrada, normalizam texto (`trim`) e devolvem objectos congelados. As datas (`createdAt`, `updatedAt`) são ISO 8601 UTC, com `updatedAt >= createdAt`. Os estados iniciais são `ACTIVE` e `INACTIVE`.
- **Sectores** (`sectors.ts`): `SECTOR_TYPES` é a lista única de sectores. Acrescentar um sector obriga, em compilação, a definir a sua designação em `SECTOR_LABELS`.
- **Contexto** (`tenant-context.ts`): `TenantContext { tenantId, actorId, correlationId }`. `assertTenantContext` rejeita contexto ausente ou inválido em execução.
- **Repositórios** (`repositories.ts`): `CompanyRepository` e `BranchRepository` exigem `TenantContext` em todas as operações. A semântica obrigatória está documentada no próprio ficheiro:
  - leitura cruzada devolve `undefined`;
  - alteração ou eliminação cruzada devolve `RecordNotFoundError`, sem revelar se o registo existe;
  - um registo de outro tenant devolve `TenantMismatchError`;
  - só existe uma empresa por tenant;
  - um estabelecimento exige empresa no mesmo tenant;
  - não se elimina uma empresa com estabelecimentos.
- **Erros** (`errors.ts`): as mensagens indicam o campo ou a regra, mas nunca reproduzem valores recebidos.
- **Verificação**: `tests/support/tenant-repository-contract.ts` é uma suite de contrato reutilizável. Em E1.03 é executada sobre um duplo em memória (`tests/support/in-memory-tenant-repositories.ts`), que não constitui persistência e não pode ser usado em produção.

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
- Cada empresa juridicamente independente é um tenant identificado por UUID; o NIF é atributo fiscal, não chave (D-016).
- Grupo empresarial (`BusinessGroup`, futuro) organiza empresas e relatórios consolidados autorizados, sem eliminar o isolamento (D-017).
- Empresas com múltiplos estabelecimentos de um ou vários dos quatro sectores iniciais, extensíveis (D-018).

## Estrutura do monorepositório

- `apps/desktop`: processo Electron e renderer React.
- `apps/admin-portal`: portal web administrativo.
- `apps/mobile-monitor`: marcador de fronteira para o futuro cliente React Native; sem dependências móveis nesta etapa.
- `services/local-api`: composição da API local Fastify.
- `services/central-api`: composição da API central Fastify.
- `services/sync-service`: fronteira do futuro mecanismo de sincronização.
- `packages/shared-types`: contratos de domínio multiempresa e interfaces de repositório, sem dependência de infraestrutura.
- `packages/database`: fronteira para persistência local e central.
- `packages/accounting`: fronteira do domínio contabilístico.
- `packages/fiscal`: fronteira do domínio fiscal.
- `packages/licensing`: porta de integração com licenciamento.
- `packages/ui`: componentes visuais partilháveis.
- `tests`: testes transversais; `tests/support` contém dados de teste, a suite de contrato e duplos de teste.

## Decisões pendentes

- Contrato, autenticação e disponibilidade do servidor de licenciamento KIL; nenhum endpoint foi presumido.
- Estratégia e protocolo de sincronização, resolução de conflitos, idempotência e operação offline.
- Modelo de tenancy no PostgreSQL (colunas, schemas ou bases separadas) e política de row-level security.
- Bibliotecas/drivers concretos para SQLite e PostgreSQL, migrações e gestão de ligações.
- Framework de empacotamento, actualizações e assinatura de código do Electron.
- Estratégia de autenticação, autorização, gestão de sessões e recuperação de conta.
- Hosting, observabilidade, backups, recuperação de desastre e topologia de implantação.
- Biblioteca de componentes e sistema visual definitivo.
- Versões e arquitectura concretas do React Native quando começar o monitor móvel.
- Requisitos fiscais angolanos detalhados, respectivas fontes normativas e processo de actualização.
- Âmbito funcional e regras de cada sector (D-018 identifica os sectores, não as respectivas regras).
- Modelo de integração contabilística: que operações geram lançamentos, em que momento e com que plano de contas.
- Canal entre o processo Electron e `services/local-api` (processo separado, embutido ou IPC) e respectivo modelo de segurança.
- Relação entre `Company.id` e `Company.tenantId`: os contratos tratam-nos como UUID distintos na relação 1:1, sem exigir igualdade nem diferença.
- Formato e unicidade do NIF (validação actual: texto obrigatório, sem regra de formato até existir fonte normativa).
- Ciclo de vida dos estados de empresa e estabelecimento para além de `ACTIVE` e `INACTIVE`.
- Unicidade do código interno do estabelecimento (por empresa ou global); ainda não exigida.
- Modelo de `BusinessGroup`, autorização de relatórios consolidados e respectiva auditoria (D-017).

## Restrições da fundação

E1.01 a E1.03 não criam esquemas ou bases de produção, endpoints de negócio, POS, facturação, contabilidade ou módulos sectoriais. Os indicadores visuais da aplicação desktop são explicitamente demonstrativos. Os pacotes de domínio contêm apenas contratos e validações estruturais, sem regras fiscais, contabilísticas ou sectoriais.
