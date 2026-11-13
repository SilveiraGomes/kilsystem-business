# Plano de implementação

Este plano regista apenas as etapas confirmadas no repositório e a próxima etapa proposta. O planeamento posterior a E1.05 não consta do repositório (pendência PD-06 em [project-status.md](project-status.md)) e não deve ser antecipado.

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
| [E1.03](tasks/E1.03.md) | Contratos multiempresa e isolamento lógico | Concluída | `7ce5bb0` |
| [E1.04](tasks/E1.04.md) | Persistência SQLite, migrações versionadas e repositórios multiempresa | Concluída | `feat: implement tenant-isolated sqlite persistence` |
| [E1.05](tasks/E1.05.md) | Proposta: composição do serviço local de dados | Proposta, **não autorizada** | — |

## Dependências entre funcionalidades e decisões pendentes

Relação entre as funcionalidades ainda não desenvolvidas e as decisões pendentes de [architecture.md](architecture.md#decisões-pendentes) que as bloqueiam:

| Funcionalidade | Decisões necessárias antes de implementar |
| --- | --- |
| Serviço local de dados (E1.05) | Processo e runtime dos serviços locais; localização da base por instalação |
| Empresas `ACTIVE` em produção | Regra de validação do NIF para `AO`, com fonte normativa (D-024) |
| Persistência central | Driver PostgreSQL, modelo de tenancy e row-level security |
| Utilizadores e autenticação | Autenticação, autorização e sessões; origem autenticada do `TenantContext` |
| Exposição de dados pela API local | Autenticação; canal desktop ↔ API local e modelo de segurança |
| Ciclo de vida das empresas | Transições entre estados, auditoria e obrigatoriedade do NIF em `SUSPENDED`/`INACTIVE` |
| Grupos empresariais | Modelo de `BusinessGroup`, autorização e auditoria de relatórios consolidados (D-017) |
| Módulos sectoriais | Âmbito funcional e regras de cada sector (D-018) |
| Vendas, POS, facturação | Requisitos fiscais angolanos com fontes normativas |
| Contabilidade integrada | Modelo de integração contabilística e plano de contas |
| Offline e sincronização | Protocolo de sincronização, conflitos e idempotência |
| Licenciamento | Contrato do servidor de licenciamento KIL |
| KIL Business Monitor | Versões e arquitectura React Native; serviços centrais a consultar |
| Distribuição do desktop | Empacotamento, assinatura e actualizações do Electron; compilação do `better-sqlite3` para o runtime escolhido |
