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
| [E1.07-B-M](tasks/E1.07-B-M.md) | Revisão de segurança e integração da autenticação local | Concluída e integrada (PR #5) | revisão `8ac21b0`; testes `0b6587e`; merge `581699a` |
| [E1.07-C](tasks/E1.07-C.md) | Sessões, validade, revogação e continuidade da identidade (migração 4) | Concluída e integrada (PR #6, merge `136a442`); revista (E1.07-C-M, E1.07-C-R2) e corrigida (E1.07-C-R1) | `feat: implement secure revocable local sessions` |
| [E1.07-C-M](tasks/E1.07-C-M.md) | Revisão independente de segurança das sessões | Concluída | `e19ef76` (`docs: record independent session security review`) |
| [E1.07-C-R1](tasks/E1.07-C-R1.md) | Correcções de segurança das sessões (RV-01, RV-03, RV-04, RV-05; migração 5) | Concluída e integrada (PR #6) | `d5f077e` (`fix: harden session clocks and revocation integrity`) |
| [E1.07-C-R2](tasks/E1.07-C-R2.md) | Revisão independente final das correcções das sessões | Concluída; GO com ressalvas (o merge do PR #6 antecedeu a conclusão) | `docs: record final session security review` |
| [E1.07-X](tasks/E1.07-X.md) | Exclusividade do serviço local por base (PD-43, PD-51) | Concluída e integrada (PR #7, merge `1872bdf`); revista em E1.07-X-M; PD-43 e PD-51 encerradas (D-140) | `76c7709` (`test: cover session replacement with a new identifier`); `cfd11fe` (`feat: enforce exclusive local service ownership per database`); merge `1872bdf` |
| [E1.07-X-M](tasks/E1.07-X-M.md) | Revisão independente da exclusividade operacional SQLite | Concluída; GO com ressalvas, aprovado; integrada (PR #7) | `92b2cce` (`docs: record independent database exclusivity review`); `docs: record database exclusivity integration completion` |
| [E1.07-D](tasks/E1.07-D.md) | Perfis, permissões e autorização RBAC (subdividida em D1–D4, D-146) | Em curso por subtarefas | — |
| [E1.07-D1](tasks/E1.07-D1.md) | Contratos de autoridade, perfis, permissões, catálogo, atribuições e regras puras (sem persistência nem integração) | Integrada no PR #8; corrigida no PR #9 e aprovada por R2; fecho definitivo ainda não anunciado | `c43cdaa`; `0f1f9a6`; merges `8f81d5f`, `1a69eb1` |
| [E1.07-D1-M](tasks/E1.07-D1-M.md) | Revisão independente dos contratos e da futura fronteira de autoridade | Concluída; **NO-GO**; registo integrado em `main` | `40d70cf` (`docs: record independent authorization contract review`); merge `f225366` |
| [E1.07-D1-R1](tasks/E1.07-D1-R1.md) | Integridade e proveniência das decisões e do catálogo; imutabilidade das definições (PD-62, PD-63) | Integrada pelo responsável no PR #9 antes da revisão; aprovada por E1.07-D1-R2 | `0f1f9a6`; merge `1a69eb1` |
| [E1.07-D1-R2](tasks/E1.07-D1-R2.md) | Revisão independente da correcção E1.07-D1-R1 | Concluída; **GO** para R1; não autoriza D2; registo integrado pelo responsável (PR #10) | `cbe2ad5`; merge `0539b15` |
| [E1.07-D1-H](tasks/E1.07-D1-H.md) | Imutabilidade transversal dos contratos de domínio (PD-64) | Integrada no PR #11; correcção fiscal integrada no PR #12 e aprovada por H-R2; PD-64 encerrada | `3d6358b`; merges `7076d1f`, `5745d3d` |
| [E1.07-D1-H-M](tasks/E1.07-D1-H-M.md) | Revisão independente da imutabilidade e estabilidade | Concluída; NO-GO por RV-D1-H-M-01; PD-64 aberta | `1ccb997` (`docs: record independent domain immutability review`) |
| [E1.07-D1-H-R1](tasks/E1.07-D1-H-R1.md) | Correcção do isolamento da política fiscal (RV-D1-H-M-01) e diagnóstico do OOM do ESLint | Integrada no PR #12; aprovada por E1.07-D1-H-R2 | `3831700`; merge `5745d3d` |
| [E1.07-D1-H-R2](tasks/E1.07-D1-H-R2.md) | Revisão independente da correcção R1 | Concluída; **GO**; PD-64 encerrada; não autoriza D2 | `docs: record final tax policy isolation review` |
| [E1.07-D2](tasks/E1.07-D2.md) | Persistência RBAC (migração 6), repositórios e motor sobre concessões persistidas | Integrada no PR #13 antes da revisão; revista em E1.07-D2-M; RBAC não operacional | `aa15864`; `b85381c`; merge `2c2b823` |
| [E1.07-D2-M](tasks/E1.07-D2-M.md) | Revisão independente da persistência RBAC e integridade multiempresa | Concluída; **GO com ressalvas** (PD-69 a PD-71); não autoriza D3 | `docs: record independent RBAC persistence review` |
| [E1.07-D2-R1](tasks/E1.07-D2-R1.md) | Correcção da integridade SQLite e cobertura RBAC | Revista em E1.07-D2-R2 (**NO-GO**); com a correcção R3, integrada pelo PR #15 (merge `dc5b046`) | `1942500`; `9d27418` |
| [E1.07-D2-R2](tasks/E1.07-D2-R2.md) | Revisão independente final da integridade RBAC | Concluída; **NO-GO** (PD-70 incompleta; PD-72 a PD-74); PD-69/PD-71 confirmadas; não autoriza D3 | `docs: record independent RBAC integrity correction review` |
| [E1.07-D2-R3](tasks/E1.07-D2-R3.md) | Correcção complementar de integridade SQLite e testes RBAC | Implementação concluída (PD-70, PD-72 a PD-74; D-194 a D-199); revista em E1.07-D2-R4 (GO); integrada pelo PR #15 (merge `dc5b046`) | `30126b6`; `198e6ca`; `0be82c3` |
| [E1.07-D2-R4](tasks/E1.07-D2-R4.md) | Revisão independente final da migração 7 e da integridade RBAC | Concluída; **GO**, aprovada pelo responsável; PD-75 condiciona a activação de D3 (D-200 a D-202) | `2f876d6` |
| E1.07-D2 — encerramento | Merge do PR #15 e registo do encerramento | **Concluído** (D-203, D-204): PD-69/70/71/72/74 encerradas; PD-73/PD-75 abertas para o Gate D3; PD-76 nova | merge `dc5b046` |
| [E1.07-D3-G0](tasks/E1.07-D3-G0.md) | Gate de segurança da administração da instalação (PD-73, PD-75, PD-76; contratos de D3) | **Implementação concluída na branch; aguarda E1.07-D3-G0-M** (sem merge); activação bloqueada (PD-77) | branch `feat/e107-d3-g0-installation-authority` |
| [E1.07-D3](tasks/E1.07-D3.md) | Autoridade inicial da instalação, administração empresarial, delegação e prevenção de escalada | Gate G0 em revisão; restante planeado, **não autorizado** | — |
| [E1.07-D4](tasks/E1.07-D4.md) | Contexto derivado de sessão e autorização integrada; encerra PD-27, PD-28 e PD-44 | Planeada, **não autorizada** | — |
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
| Sessões com `authenticatedAt` recente, ligação à geração do serviço e revalidação | PD-40 | Resolvida em E1.07-C, confirmada em E1.07-C-R2 e integrada (PR #6) |
| Resolução antes da exposição da API empresarial | PD-29 | Antes de E1.08 |

### Trabalho atribuído em E1.07-C-R1

| Trabalho | Pendência | Etapa |
| --- | --- | --- |
| Exclusividade do serviço local por base | PD-43 (D-121, D-127) | E1.07-X (D-130 a D-134): **encerrada** com a integração pelo PR #7 (`1872bdf`, D-140) |
| Retenção definitiva e referência temporal confiável para eliminar registos de sessões; crescimento dos registos | PD-47, PD-49 (D-125) | E1.07-E |
| Ensaio de suspensão e retoma real do computador, incluindo a suspensão depois de um avanço corrigido do relógio de parede (E1.07-C-R2, RV-02) | PD-50 | Gate E1.07-F |
| Teste para a reinserção de uma sessão com `id` novo e digest existente (lacuna da migração 5; E1.07-C-R2, RV-03) | PD-51 | E1.07-X (variante do S64; O3 detectada): **encerrada** com a integração pelo PR #7 (`1872bdf`, D-140) |

### Trabalho atribuído em E1.07-X

| Trabalho | Pendência | Etapa |
| --- | --- | --- |
| Unidades de rede mapeadas e sistemas de ficheiros locais além de NTFS: comportamento não verificado | PD-52 (D-136, D-141) | E1.10: validação operacional da política de armazenamento (NTFS local homologado) |
| Cópias de segurança e restauro pela instância proprietária, com confidencialidade, integridade e controlo de acesso das cópias; tempos de aquisição e recuperação e novas tentativas limitadas perante `database-locked` | PD-53 (D-133, D-138, D-142) | E1.10 |
| Ctrl+C real numa consola interactiva sobre o serviço com a base detida (o ensaio automático entrega o sinal por `process.emit`); paragem pelo gestor de serviços | PD-54 (D-139, D-143) | E1.07-F (consola); E1.10 (gestor de serviços) |

### Trabalho atribuído em E1.07-X-M

| Trabalho | Pendência | Etapa |
| --- | --- | --- |
| Diagnóstico de um ficheiro em uso por outro programa sem partilha (hoje `database-access-denied`) | PD-55 (D-144) | E1.10 |
| `inspectDatabase` sem anular transacções que não abriu; limpeza dos ensaios (`TEMP` isolado nos executores de mutações) | PD-56 (D-145) | E1.07-F |
| Limpeza intermitente da pasta temporária no `afterEach` dos ensaios com processos (`ENOTEMPTY`, 1 em 9 execuções do X31) | PD-57 | E1.07-F, com a PD-56 (D-158): novas tentativas limitadas, sem esconder fugas de recursos |

### Trabalho atribuído em E1.07-D1

| Trabalho | Pendência | Etapa |
| --- | --- | --- |
| `TenantContext` derivado de sessão validada; recusa e não divulgação efectivas; revalidação das associações em cada operação | PD-27, PD-28, PD-44 (D-157) | E1.07-D4 (PD-28 também em D3) |
| Política de operações por estado empresarial | PD-58 | Decidida em D-159; implementar em E1.07-D3/D4 |
| Autoridade sobre logout, gestão e revogação de sessões/acesso empresarial | PD-59 | Decidida em D-160; implementar em E1.07-D3/D4/E |
| Correspondência operação/permissão, perfis e catálogo sectorial | PD-60 | Princípio decidido em D-161; validação funcional em E1.07-D3 e etapas sectoriais |
| Códigos de permissão desconhecidos ou `WITHDRAWN` | PD-61 | Política decidida em D-162; tratamento inicial na persistência de E1.07-D2 (D-181); validação integrada em E1.07-D4 |
| Apresentação administrativa e limpeza auditada de concessões não reconhecidas | PD-68 | E1.07-D3 e E1.07-E |
| `REPLACE` por `rowid` com `recursive_triggers` desligado nas tabelas RBAC | PD-69 | **Encerrada** (D-204): migração 7 integrada pelo PR #15 |
| Imutabilidade das ligações das tabelas-pai (associações, estabelecimentos, empresas) | PD-70 | **Encerrada** (D-204): corrigida por E1.07-D2-R1/R3 (D-189, D-195), confirmada por E1.07-D2-R4 e integrada pelo PR #15 |
| Guardas de `rowid` dependentes de `NEW.rowid` indefinido | PD-72 | **Encerrada** (D-204): corrigida por E1.07-D2-R3 (D-196), confirmada por E1.07-D2-R4 e integrada; ressalva legada na PD-76 |
| `installation_bootstrap` mutável | PD-73 | Protecção integrada (D-197, D-204); âncora com recusa fechada na branch de E1.07-D3-G0 (D-207); encerramento após E1.07-D3-G0-M e merge |
| Asserções não discriminantes (R10, R12, R13) | PD-74 | **Encerrada** (D-204): corrigida por E1.07-D2-R3 (D-198), confirmada por E1.07-D2-R4 e integrada |
| Política de identidades e autoridade sobre o administrador inicial (linha `users` eliminável e reinserível com `foreign_keys` desligado) | PD-75 | Decisão no Gate de E1.07-D3; não bloqueia o merge de D2 nem o arranque da D3; bloqueia a activação operacional de autoridade baseada em `installation_bootstrap` (D-201); condição obrigatória mantida no encerramento de D2 (D-204). **Corrigida na branch de E1.07-D3-G0** (D-206 a D-209): migração 8, âncora, protecção do administrador inicial, fronteira; encerramento após E1.07-D3-G0-M e merge |
| Pré-verificação de `rowid` legados não positivos antes de migrar bases existentes não criadas só pela aplicação | PD-76 | **Corrigida na branch de E1.07-D3-G0** (D-211): pré-verificação no serviço local antes de migrar; não altera a migração 7; encerramento após E1.07-D3-G0-M e merge |
| Processo aprovado de recuperação/substituição do administrador inicial | PD-77 | **Bloqueia a activação** de qualquer autoridade da instalação; proposta R1/R2 (D-210) aguarda decisão do responsável |
| Empresas e estabelecimentos elimináveis (repositório; SQL com FK desligado e reinserção do mesmo `id`) | PD-78 | Decisão em E1.07-D3 (relaciona-se com D-027) |
| Instalador/actualizador obrigado à pré-verificação PD-76 | PD-79 | Antes da primeira distribuição (E1.10) |
| Cobertura: guarda `READY` RBAC, factos contraditórios em SQLite real, leitura única do pedido | PD-71 | **Encerrada** (D-204): cobertura integrada pelo PR #15 |
| Decisões `GRANTED` estruturalmente forjáveis | PD-62 | Encerrada por E1.07-D1-R2 (D-168), formalizada após o PR #10 (D-170); vinculação operacional permanece em D4 (D-167) |
| Proveniência do catálogo e definições iniciais superficialmente congeladas | PD-63 | Encerrada por E1.07-D1-R2 (D-168), formalizada após o PR #10 (D-170); composição só com o catálogo oficial permanece requisito de D2 (D-167) |

### Trabalho identificado em E1.07-D1-R1

| Trabalho | Pendência | Etapa |
| --- | --- | --- |
| Garantir imutabilidade transversal, incluindo independência das regras fiscais recebidas de consumidores | PD-64 | **Encerrada** por E1.07-D1-H-R2 (D-178); D2 continua dependente de aprovação explícita |

### Trabalho identificado em E1.07-D1-H

| Trabalho | Pendência | Etapa |
| --- | --- | --- |
| *Timeouts* intermitentes do limite de 5 s em testes Argon2/SQLite sob carga | PD-65 | **Aberta** (D-174); proposta para E1.07-F com PD-56/PD-57, por aprovar |
| `picomatch` alta (GHSA-fc5q-39xc-vjpf), só desenvolvimento | PD-66 | **Encerrada** (D-175): aviso retirado em 2026-11-18 e ausente do audit actual; reabrir se republicado |

### Trabalho identificado em E1.07-D1-H-R1

| Trabalho | Pendência | Etapa |
| --- | --- | --- |
| `eslint .` analisa worktrees/cópias dentro da raiz; dois worktrees excedem o *heap* por omissão (exit 134) | PD-67 | **Aberta** (D-177); proposta para E1.07-F, por aprovar: worktrees de ensaio fora da raiz e/ou exclusão explícita no ESLint |

## Dependências entre funcionalidades e decisões pendentes

Relação entre as funcionalidades ainda não desenvolvidas e as decisões pendentes de [architecture.md](architecture.md#decisões-pendentes) que as bloqueiam:

| Funcionalidade | Decisões necessárias antes de implementar |
| --- | --- |
| Instalação do serviço local (E1.10) | Tecnologia do serviço Windows; localização da base por instalação (NTFS local, D-136); permissões NTFS e conta do serviço (D-137); cópias de segurança pela instância proprietária, protegidas (D-133, D-138); tratamento de `database-locked` pelo gestor de serviços (PD-53) |
| Empresas `ACTIVE` em produção | Regra de validação do NIF para `AO`, com fonte normativa (D-024, PD-09) |
| Persistência central (E1.09) | Driver PostgreSQL, modelo de tenancy e row-level security |
| Ferramenta operacional de inicialização | Entrada interactiva protegida, sem palavras-passe em argumentos ou ficheiros (PD-31) |
| Sessões (E1.07-C) | Implementadas (D-107 a D-116) e corrigidas em E1.07-C-R1 (D-124 a D-127). Por decidir: transporte e guarda do token até à interface (E1.08, PD-42); política por tipo de posto; impacto operacional do fim das sessões no reinício (PD-41) |
| Autorização RBAC (E1.07-D) | Contratos D-146 a D-167; PD-62/PD-63 encerradas em D-168 e PD-64 encerrada por E1.07-D1-H-R2 (D-178). D2 integrada (PR #13) e revista em E1.07-D2-M, GO com ressalvas (D-179 a D-186): migração 6, repositórios, catálogo oficial, PD-61 e motor interno não operacional; PD-69 a PD-71 antes de D3; correcção E1.07-D2-R1/R3 (PR #15, migração 7 corrigida, D-187 a D-199) revista em E1.07-D2-R4 com GO (D-200 a D-202) e integrada pelo PR #15 (`dc5b046`); **E1.07-D2 encerrada** (D-203, D-204). D3 (Gate com PD-73/PD-75; condições D-201; **E1.07-D3-G0 implementado na branch e em revisão**, D-205 a D-213; activação bloqueada pela PD-77): autoridade do actor, `InstallationAuthorityGrant`, D-159 a D-161, PD-68. D4: PD-27, PD-28, PD-44 e autorização operacional distinta da decisão de domínio (D-167) |
| Protecção de contas e auditoria (E1.07-E) | Limiares de bloqueio; retenção e consulta da auditoria, incluindo eventos de sessão (PD-26) |
| API local e integração Electron (E1.08) | E1.07-B a E1.07-F; exclusividade do serviço por base (E1.07-X, PD-43, D-121; integrada pelo PR #7, D-140); transporte em loopback e do token de sessão, nunca em `localStorage` (PD-42, D-120); E1.06-S1 concluída; PD-27 e PD-28 resolvidas (bloqueantes, D-106); PD-29 resolvida (D-099); medidas contra a negação de serviço da instância (PD-35, PD-39) |
| Ciclo de vida das empresas | Tabela de transições e auditoria (D-061); preservação do NIF (D-055) |
| Grupos empresariais | Modelo de `BusinessGroup`, autorização e auditoria de relatórios consolidados (D-017) |
| Módulos sectoriais | Âmbito funcional e regras de cada sector (D-018); activação por licença (D-068) |
| Vendas, POS, facturação | Requisitos fiscais angolanos com fontes normativas |
| Contabilidade integrada | Modelo de integração contabilística e plano de contas |
| Offline e sincronização (modo C) | Protocolo de sincronização, conflitos e idempotência |
| Licenciamento | Contrato do servidor de licenciamento KIL (D-009, D-067, D-068) |
| KIL Business Monitor | Versões e arquitectura React Native; serviços centrais a consultar |
| Distribuição do desktop | Empacotamento, assinatura e actualizações do Electron (E1.10) |
