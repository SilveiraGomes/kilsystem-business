# Plano de implementação

Este plano regista as etapas concluídas e o planeamento inicial da fase E1 até ao Gate E1, definido pelo responsável na autorização de E1.06. As etapas planeadas não estão autorizadas: cada uma exige autorização explícita antes de começar. O planeamento posterior ao Gate E1 ainda não existe.

## Princípios

- Etapas pequenas, auditáveis e restritas ao âmbito do respectivo ficheiro em `docs/tasks/`.
- Nenhuma funcionalidade de negócio antes de as decisões que a bloqueiam estarem registadas em [decisions.md](decisions.md).
- Cada etapa termina com `pnpm check` aprovado, documentação actualizada e um único commit.
- Uma etapa só começa com autorização explícita do responsável do projecto.
- Uma etapa só está publicada quando o *push* para a branch autorizada de `origin` estiver confirmado (`AGENTS.md`, “Git e GitHub”; D-074).

## Etapas

| Etapa | Âmbito | Estado | Commit |
| --- | --- | --- | --- |
| [E1.01](tasks/E1.01.md) | Fundação tecnológica do monorepositório | Concluída | `ff5ba65` |
| [E1.02](tasks/E1.02.md) | Aplicação desktop Electron funcional com interface demonstrativa | Concluída | `b113388` |
| E1.02-H | Handoff multi-IA: documentação de continuidade, sem alterações de código | Concluída | `68b7f98` |
| [E1.03](tasks/E1.03.md) | Contratos multiempresa e isolamento lógico | Concluída | `7ce5bb0` |
| [E1.04](tasks/E1.04.md) | Persistência SQLite, migrações versionadas e repositórios multiempresa | Concluída | `d713c3c` |
| [E1.05](tasks/E1.05.md) | Inicialização e ciclo de vida do serviço local | Concluída | `5f1b36e` |
| [E1.06](tasks/E1.06.md) | Modernização e estabilização do ambiente tecnológico | Concluída | `7270646` |
| [E1.06-G](tasks/E1.06-G.md) | Configuração e publicação inicial no GitHub | Concluída | `580d658` |
| [E1.06-S1](tasks/E1.06-S1.md) | Actualização e segurança do Electron (PD-17) | Concluída e publicada | `chore: upgrade electron to supported secure runtime` |
| [E1.06-S2](tasks/E1.06-S2.md) | Actualização do Vitest e alertas de ferramentas (PD-18) | Planeada, **não autorizada** | — |
| [E1.07](tasks/E1.07.md) | Identidade, autenticação e autorização local | Planeada, **não autorizada** | — |
| [E1.08](tasks/E1.08.md) | API local segura e integração Electron | Planeada, **não autorizada** | — |
| [E1.09](tasks/E1.09.md) | Infraestrutura de serviços centrais e PostgreSQL | Planeada, **não autorizada** | — |
| [E1.10](tasks/E1.10.md) | Instalação, recuperação, segurança operacional e Gate E1 | Planeada, **não autorizada** | — |

### Trabalho identificado ainda sem etapa atribuída

Precisa de autorização e de uma posição no plano, a decidir pelo responsável:

| Trabalho | Pendência | Prazo recomendado |
| --- | --- | --- |
| Implementação das decisões de domínio D-055, D-058, D-060 e D-061 | PD-14, PD-15, PD-16 | Antes de empresas reais; PD-15 depende de PD-09 |
| Avaliação do pnpm 10 ou superior | PD-20 | Sem urgência |
| Plano de migração para o Node 26 LTS | PD-21 | Antes de 2028-04-30 |

## Dependências entre funcionalidades e decisões pendentes

Relação entre as funcionalidades ainda não desenvolvidas e as decisões pendentes de [architecture.md](architecture.md#decisões-pendentes) que as bloqueiam:

| Funcionalidade | Decisões necessárias antes de implementar |
| --- | --- |
| Instalação do serviço local (E1.10) | Tecnologia do serviço Windows; localização da base por instalação; cópias de segurança |
| Empresas `ACTIVE` em produção | Regra de validação do NIF para `AO`, com fonte normativa (D-024, PD-09) |
| Persistência central (E1.09) | Driver PostgreSQL, modelo de tenancy e row-level security |
| Utilizadores e autenticação (E1.07) | Derivação de palavras-passe, papéis, *bootstrap* e autenticação offline |
| API local e integração Electron (E1.08) | E1.07; transporte em loopback; E1.06-S1 concluída |
| Ciclo de vida das empresas | Tabela de transições e auditoria (D-061); preservação do NIF (D-055) |
| Grupos empresariais | Modelo de `BusinessGroup`, autorização e auditoria de relatórios consolidados (D-017) |
| Módulos sectoriais | Âmbito funcional e regras de cada sector (D-018); activação por licença (D-068) |
| Vendas, POS, facturação | Requisitos fiscais angolanos com fontes normativas |
| Contabilidade integrada | Modelo de integração contabilística e plano de contas |
| Offline e sincronização (modo C) | Protocolo de sincronização, conflitos e idempotência |
| Licenciamento | Contrato do servidor de licenciamento KIL (D-009, D-067, D-068) |
| KIL Business Monitor | Versões e arquitectura React Native; serviços centrais a consultar |
| Distribuição do desktop | Empacotamento, assinatura e actualizações do Electron (E1.10) |
