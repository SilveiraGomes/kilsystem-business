# Arquitectura inicial

## Estado deste documento

Este documento regista a fundação E1.01, a primeira aplicação desktop E1.02 e a arquitectura de negócio consolidada em E1.02-H. “Definido” significa uma decisão já fornecida ou validada pelo projecto; “pendente” requer validação posterior e não deve ser inferido.

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

| Pilar | Definição registada | Estado na implementação (b113388) |
| --- | --- | --- |
| Multiempresa | Definido: isolamento obrigatório por tenant/empresa em todas as camadas (`AGENTS.md`). | Apenas tipos `TenantId` e `TenantContext` em `packages/shared-types`. A “empresa activa” na interface é texto fixo demonstrativo. |
| Quatro sectores | O produto é multissectorial (`README.md`); o planeamento indica quatro sectores. | Os sectores não estão identificados em nenhum documento do repositório (pendente). Não existem módulos sectoriais. |
| Contabilidade integrada | Definido: fronteira `packages/accounting`, valores decimais seguros, lançamentos imutáveis ou corrigidos de forma auditável (`AGENTS.md`). | O pacote apenas exporta `accountingModuleStatus = 'not-implemented'`. O modelo de integração entre operações e contabilidade está pendente. |
| Funcionamento offline | Definido: o desktop opera com serviços e dados locais em SQLite. | A estratégia offline está pendente. O desktop ainda não comunica com `services/local-api`, que só cria a instância Fastify. |
| Sincronização | Definido: `services/sync-service` liga o ambiente local aos serviços centrais em PostgreSQL. | Fronteira sem implementação (`syncServiceStatus = 'contract-pending'`); protocolo pendente. |
| Monitor opcional | Definido: KIL Business Monitor em React Native, opcional, limitado à consulta de indicadores sincronizados. | `apps/mobile-monitor` é um marcador TypeScript sem dependências móveis. |

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

## Estrutura do monorepositório

- `apps/desktop`: processo Electron e renderer React.
- `apps/admin-portal`: portal web administrativo.
- `apps/mobile-monitor`: marcador de fronteira para o futuro cliente React Native; sem dependências móveis nesta etapa.
- `services/local-api`: composição da API local Fastify.
- `services/central-api`: composição da API central Fastify.
- `services/sync-service`: fronteira do futuro mecanismo de sincronização.
- `packages/shared-types`: tipos e contratos sem dependência de infraestrutura.
- `packages/database`: fronteira para persistência local e central.
- `packages/accounting`: fronteira do domínio contabilístico.
- `packages/fiscal`: fronteira do domínio fiscal.
- `packages/licensing`: porta de integração com licenciamento.
- `packages/ui`: componentes visuais partilháveis.
- `tests`: testes transversais.

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
- Identificação dos quatro sectores de negócio e respectivo âmbito funcional.
- Modelo de integração contabilística: que operações geram lançamentos, em que momento e com que plano de contas.
- Canal entre o processo Electron e `services/local-api` (processo separado, embutido ou IPC) e respectivo modelo de segurança.

## Restrições da fundação

E1.01 e E1.02 não criam esquemas ou bases de produção, endpoints de negócio, POS, facturação, contabilidade ou módulos sectoriais. Os indicadores visuais da aplicação desktop são explicitamente demonstrativos, e os pacotes de domínio continuam deliberadamente sem regras de negócio.
