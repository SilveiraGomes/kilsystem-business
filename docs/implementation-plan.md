# Plano de implementação

Este plano regista apenas as etapas confirmadas no repositório e a próxima etapa definida. O planeamento posterior a E1.04 não consta do repositório (pendência PD-06 em [project-status.md](project-status.md)) e não deve ser antecipado.

## Princípios

- Etapas pequenas, auditáveis e restritas ao âmbito do respectivo ficheiro em `docs/tasks/`.
- Nenhuma funcionalidade de negócio antes de as decisões que a bloqueiam estarem registadas em [decisions.md](decisions.md).
- Cada etapa termina com `pnpm check` aprovado, documentação actualizada e um único commit.
- Uma etapa só começa com autorização explícita do responsável do projecto.

## Etapas

| Etapa | Âmbito | Estado | Commit |
| --- | --- | --- | --- |
| [E1.01](tasks/E1.01.md) | Fundação tecnológica do monorepositório | Concluída | `ff5ba65` |
| [E1.02](tasks/E1.02.md) | Aplicação desktop Electron funcional com interface demonstrativa | Concluída | `b113388` |
| E1.02-H | Handoff multi-IA: documentação de continuidade, sem alterações de código | Concluída | `68b7f98` |
| [E1.03](tasks/E1.03.md) | Contratos multiempresa e isolamento lógico | Concluída | `feat: establish multi-tenant domain contracts` |
| [E1.04](tasks/E1.04.md) | Persistência SQLite, migrações versionadas e implementação dos repositórios multiempresa | Definida, **não autorizada** | — |

## Dependências entre funcionalidades e decisões pendentes

Relação entre as funcionalidades ainda não desenvolvidas e as decisões pendentes de [architecture.md](architecture.md#decisões-pendentes) que as bloqueiam:

| Funcionalidade | Decisões necessárias antes de implementar |
| --- | --- |
| Persistência local (E1.04) | Driver SQLite e ferramenta de migrações; relação `Company.id`/`tenantId`; unicidade de NIF e código de estabelecimento |
| Persistência central | Driver PostgreSQL, modelo de tenancy e row-level security |
| Utilizadores e autenticação | Autenticação, autorização e sessões; origem autenticada do `TenantContext` |
| Grupos empresariais | Modelo de `BusinessGroup`, autorização e auditoria de relatórios consolidados (D-017) |
| Ligação desktop ↔ API local | Canal entre Electron e `services/local-api` e respectivo modelo de segurança |
| Módulos sectoriais | Âmbito funcional e regras de cada sector (D-018) |
| Vendas, POS, facturação | Requisitos fiscais angolanos com fontes normativas |
| Contabilidade integrada | Modelo de integração contabilística e plano de contas |
| Offline e sincronização | Protocolo de sincronização, conflitos e idempotência |
| Licenciamento | Contrato do servidor de licenciamento KIL |
| KIL Business Monitor | Versões e arquitectura React Native; serviços centrais a consultar |
| Distribuição do desktop | Empacotamento, assinatura e actualizações do Electron |
