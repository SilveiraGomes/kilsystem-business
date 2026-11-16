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
| [E1.06-S1](tasks/E1.06-S1.md) | Actualização e segurança do Electron (PD-17) | Concluída e integrada | `c3219ad` |
| [E1.06-S1-M](tasks/E1.06-S1-M.md) | Revisão e integração da actualização Electron | Concluída e integrada | `2ca5b90` |
| [E1.06-S2](tasks/E1.06-S2.md) | Modernização do Vitest e segurança da infraestrutura de testes (PD-18) | Concluída e integrada (PR #2) | `c5a23a0`; merge `d29a629` |
| [E1.06-S2-M](tasks/E1.06-S2-M.md) | Revisão e integração da modernização Vitest | Concluída | `docs: record vitest integration review` |
| [E1.07](tasks/E1.07.md) | Identidade, autenticação e autorização local (subdividida em A–F) | Em curso por subtarefas | — |
| [E1.07-A](tasks/E1.07-A.md) | Identidade local, utilizadores e associações multiempresa (migração 2) | Concluída e integrada (PR #3) | `cc4adc0`; merge `4d0302b` |
| [E1.07-B](tasks/E1.07-B.md) | Credenciais, autenticação local offline, limitação de tentativas e inicialização da instalação (migração 3) | Concluída e integrada (PR #4) | `f443057`; merge `8e77091` |
| [E1.07-B-M](tasks/E1.07-B-M.md) | Revisão de segurança e integração da autenticação local | Concluída; testes de regressão em PR por integrar (`test/e107-b-m-race-coverage`, `0b6587e`) | `docs: record local authentication security review` |
| [E1.07-C](tasks/E1.07-C.md) | Sessões, validade e revogação | Planeada, **não autorizada** | — |
| [E1.07-D](tasks/E1.07-D.md) | Perfis, permissões e autorização RBAC | Planeada, **não autorizada** | — |
| [E1.07-E](tasks/E1.07-E.md) | Protecção de contas e auditoria | Planeada, **não autorizada** | — |
| [E1.07-F](tasks/E1.07-F.md) | Validação integrada da segurança | Planeada, **não autorizada** | — |
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
| Correcção do `minimatch` quando o typescript-eslint a publicar | PD-19 | Quando existir versão a montante |
| Alinhar o intervalo declarado do Vite com o mínimo do Vitest 5 | PD-24 | Tarefa controlada própria (decisão em E1.06-S2-M) |

### Trabalho atribuído na revisão E1.07-B-M

Decisões do responsável D-098 a D-106. A implementação continua sujeita à autorização de cada subtarefa:

| Trabalho | Pendência | Etapa |
| --- | --- | --- |
| Auditoria de autenticação, credenciais e provisionamento | PD-26 | E1.07-E |
| Ferramenta de inicialização segura, antes do login operacional | PD-31 | E1.07-E |
| *Pepper*, armazenamento externo protegido, rotação e recuperação | PD-32 | Avaliação em E1.07-E e E1.10 |
| Lista local efectiva de palavras-passe comuns ou comprometidas | PD-33 | E1.07-E |
| Diferenças temporais e limites da protecção | PD-34 | Gate E1.07-F |
| Limite de falhas consecutivas e recuperação controlada, sem bloqueio irreversível; medidas contra a negação de serviço da instância | PD-35 | E1.07-E |
| HMAC com chave externa protegida nas chaves de limitação | PD-36 | E1.07-E |
| Limites superiores mais estreitos para os parâmetros guardados; recusas `busy` sem contar falha | PD-38, PD-39 | Proposta: E1.07-E (por decidir) |
| Sessões com `authenticatedAt` recente, ligação à geração do serviço e revalidação | PD-40 | E1.07-C |
| Resolução antes da exposição da API empresarial | PD-29 | Antes de E1.08 |

## Dependências entre funcionalidades e decisões pendentes

Relação entre as funcionalidades ainda não desenvolvidas e as decisões pendentes de [architecture.md](architecture.md#decisões-pendentes) que as bloqueiam:

| Funcionalidade | Decisões necessárias antes de implementar |
| --- | --- |
| Instalação do serviço local (E1.10) | Tecnologia do serviço Windows; localização da base por instalação; cópias de segurança |
| Empresas `ACTIVE` em produção | Regra de validação do NIF para `AO`, com fonte normativa (D-024, PD-09) |
| Persistência central (E1.09) | Driver PostgreSQL, modelo de tenancy e row-level security |
| Ferramenta operacional de inicialização | Entrada interactiva protegida, sem palavras-passe em argumentos ou ficheiros (PD-31) |
| Sessões (E1.07-C) | E1.07-B integrada (PR #4); duração, concorrência e transporte das sessões; uso obrigatório de `isAuthenticatedIdentity`, que por si só não autoriza nada; `authenticatedAt` recente, ligação à geração do serviço e revalidação (PD-40) |
| Autorização RBAC (E1.07-D) | E1.07-C; catálogo de perfis e permissões por sector; segregação de funções com fonte normativa |
| Protecção de contas e auditoria (E1.07-E) | Limiares de bloqueio; retenção e consulta da auditoria (PD-26) |
| API local e integração Electron (E1.08) | E1.07-B a E1.07-F; transporte em loopback; E1.06-S1 concluída; PD-27 e PD-28 resolvidas (bloqueantes, D-106); PD-29 resolvida (D-099); medidas contra a negação de serviço da instância (PD-35, PD-39) |
| Ciclo de vida das empresas | Tabela de transições e auditoria (D-061); preservação do NIF (D-055) |
| Grupos empresariais | Modelo de `BusinessGroup`, autorização e auditoria de relatórios consolidados (D-017) |
| Módulos sectoriais | Âmbito funcional e regras de cada sector (D-018); activação por licença (D-068) |
| Vendas, POS, facturação | Requisitos fiscais angolanos com fontes normativas |
| Contabilidade integrada | Modelo de integração contabilística e plano de contas |
| Offline e sincronização (modo C) | Protocolo de sincronização, conflitos e idempotência |
| Licenciamento | Contrato do servidor de licenciamento KIL (D-009, D-067, D-068) |
| KIL Business Monitor | Versões e arquitectura React Native; serviços centrais a consultar |
| Distribuição do desktop | Empacotamento, assinatura e actualizações do Electron (E1.10) |
