# Estado do projecto

Última verificação: 2026-11-22, no encerramento de E1.07-D3-G0-R4 (integração da PD-82), na branch documental `docs/e107-d3-g0-closure` criada a partir de `main`. **`origin/main` = `49581ade56fbd0dd453bbabbe02263fd0167ff83`** (merge do PR #18, pais `eb5350b` e `9cf48a8`, árvore igual a `9cf48a8`; `main` local = remota): a `main` contém o Gate G0, a R1 e a correcção da PD-82 (`7742950`). Validada na `main`: `pnpm check` 930/930 e 12/12, desktop 6/6, *smoke*, `git diff --check` limpo. **PD-82 e PD-83 encerradas** (D-231). A D3-A, a R1 e a activação de qualquer autoridade da instalação continuam não autorizadas (PD-77 bloqueante).

Este documento é o ponto de retoma para qualquer agente ou pessoa. Contém apenas factos verificados no repositório ou por execução; o que não foi executado está marcado como tal.

## Resumo

| Etapa | Estado | Commit | Detalhe |
| --- | --- | --- | --- |
| E1.01 — Fundação tecnológica | Concluída | `ff5ba65` | [tasks/E1.01.md](tasks/E1.01.md) |
| E1.02 — Aplicação desktop funcional | Concluída | `b113388` | [tasks/E1.02.md](tasks/E1.02.md) |
| E1.02-H — Handoff multi-IA | Concluída | `68b7f98` | — |
| E1.03 — Contratos multiempresa e isolamento lógico | Concluída | `7ce5bb0` | [tasks/E1.03.md](tasks/E1.03.md) |
| E1.04 — Persistência SQLite e repositórios multiempresa | Concluída | `d713c3c` | [tasks/E1.04.md](tasks/E1.04.md) |
| E1.05 — Inicialização e ciclo de vida do serviço local | Concluída | `5f1b36e` | [tasks/E1.05.md](tasks/E1.05.md) |
| E1.06 — Modernização e estabilização do ambiente | Concluída | `7270646` | [tasks/E1.06.md](tasks/E1.06.md) |
| E1.06-G — Configuração/publicação GitHub | Concluída | `580d658` | [tasks/E1.06-G.md](tasks/E1.06-G.md) |
| E1.06-S1 — Actualização e segurança do Electron | Concluída e integrada | `c3219ad` | [tasks/E1.06-S1.md](tasks/E1.06-S1.md) |
| E1.06-S1-M — Revisão e integração da actualização Electron | Concluída e integrada | `2ca5b90` | [tasks/E1.06-S1-M.md](tasks/E1.06-S1-M.md) |
| E1.06-S2 — Modernização do Vitest e segurança dos testes | Concluída e integrada (PR #2) | `c5a23a0`; merge `d29a629` | [tasks/E1.06-S2.md](tasks/E1.06-S2.md) |
| E1.06-S2-M — Revisão e integração da modernização Vitest | Concluída | `docs: record vitest integration review` | [tasks/E1.06-S2-M.md](tasks/E1.06-S2-M.md) |
| Política Git/GitHub | Adoptada | `docs: adopt git and github publication policy` | `AGENTS.md` (“Git e GitHub”), D-074 |
| E1.07-A — Identidade, utilizadores e associações multiempresa | Concluída e integrada (PR #3) | `cc4adc0`; merge `4d0302b` | [tasks/E1.07-A.md](tasks/E1.07-A.md) |
| E1.07-B — Credenciais, autenticação local e provisionamento inicial | Concluída e integrada (PR #4) | `f443057`; merge `8e77091` | [tasks/E1.07-B.md](tasks/E1.07-B.md) |
| E1.07-B-M — Revisão de segurança e integração da autenticação local | Concluída e integrada (PR #5) | revisão `8ac21b0`; testes `0b6587e`; merge `581699a` | [tasks/E1.07-B-M.md](tasks/E1.07-B-M.md) |
| E1.07-C — Sessões, validade, revogação e continuidade da identidade | Concluída e integrada (PR #6); revista em E1.07-C-M e E1.07-C-R2, corrigida em E1.07-C-R1 | `0eb1e75`; merge `136a442` | [tasks/E1.07-C.md](tasks/E1.07-C.md) |
| E1.07-C-M — Revisão independente de segurança das sessões | Concluída; recomendou suspender o merge (RV-01, Alto) | `e19ef76` (`docs: record independent session security review`) | [tasks/E1.07-C-M.md](tasks/E1.07-C-M.md) |
| E1.07-C-R1 — Correcções de segurança das sessões | Concluída e integrada (PR #6) | `d5f077e` (`fix: harden session clocks and revocation integrity`) | [tasks/E1.07-C-R1.md](tasks/E1.07-C-R1.md) |
| E1.07-C-R2 — Revisão independente final das sessões | Concluída; GO com ressalvas (o merge do PR #6 antecedeu a conclusão); registo integrado em `main` | `cc7070d`; merge `030b101` | [tasks/E1.07-C-R2.md](tasks/E1.07-C-R2.md) |
| E1.07-X — Exclusividade do serviço por base | Concluída e integrada (PR #7); revista em E1.07-X-M; PD-43 e PD-51 encerradas | `76c7709`; `cfd11fe`; merge `1872bdf` | [tasks/E1.07-X.md](tasks/E1.07-X.md) |
| E1.07-X-M — Revisão independente da exclusividade | Concluída; **GO com ressalvas**, aprovado pelo responsável; integrada (PR #7) | `92b2cce`; merge `1872bdf`; `docs: record database exclusivity integration completion` | [tasks/E1.07-X-M.md](tasks/E1.07-X-M.md) |
| E1.07-D1 — Contratos de autoridade, perfis e permissões RBAC | Integrada pelo responsável no PR #8 antes da revisão; RBAC não operacional | `c43cdaa`; merge `8f81d5f` | [tasks/E1.07-D1.md](tasks/E1.07-D1.md) |
| E1.07-D1-M — Revisão independente dos contratos RBAC | Concluída; **NO-GO** até corrigir RV-D1-M-01/RV-D1-M-02 e repetir a revisão; registo integrado em `main` | `40d70cf`; merge `f225366` | [tasks/E1.07-D1-M.md](tasks/E1.07-D1-M.md) |
| E1.07-D1-R1 — Integridade e proveniência dos contratos de autorização | Integrada pelo responsável no PR #9 antes da revisão; aprovada por E1.07-D1-R2 | `0f1f9a6`; merge `1a69eb1` | [tasks/E1.07-D1-R1.md](tasks/E1.07-D1-R1.md) |
| E1.07-D1-R2 — Revisão independente final da integridade | Concluída; **GO para R1**; não autoriza D2; registo integrado pelo responsável (PR #10) | `cbe2ad5`; merge `0539b15` | [tasks/E1.07-D1-R2.md](tasks/E1.07-D1-R2.md) |
| E1.07-D1-H — Imutabilidade transversal dos contratos de domínio (PD-64) | Integrada no PR #11; correcção fiscal integrada no PR #12 e aprovada por H-R2; PD-64 encerrada | `3d6358b`; merges `7076d1f`, `5745d3d` | [tasks/E1.07-D1-H.md](tasks/E1.07-D1-H.md) |
| E1.07-D1-H-M — Revisão independente da imutabilidade | Concluída; **NO-GO** por RV-D1-H-M-01; PD-64 aberta | `1ccb997` (`docs: record independent domain immutability review`) | [tasks/E1.07-D1-H-M.md](tasks/E1.07-D1-H-M.md) |
| E1.07-D1-H-R1 — Isolamento da política fiscal (RV-D1-H-M-01) | Integrada no PR #12; aprovada por H-R2 | `3831700`; merge `5745d3d` | [tasks/E1.07-D1-H-R1.md](tasks/E1.07-D1-H-R1.md) |
| E1.07-D1-H-R2 — Revisão final da correcção fiscal | Concluída; **GO**; PD-64 encerrada; não autoriza D2 | `docs: record final tax policy isolation review` | [tasks/E1.07-D1-H-R2.md](tasks/E1.07-D1-H-R2.md) |
| E1.07-D1-H-R2 — integração do registo em `main` | Autorizada pelo responsável nesta sessão; merge sem *fast-forward* | `5bf2e00` (pais `5745d3d`, `db6a582`) | D-179 |
| E1.07-D2 — Persistência RBAC e motor interno sobre concessões persistidas | Integrada pelo responsável no PR #13 antes da revisão; revista em E1.07-D2-M (GO com ressalvas); RBAC não operacional | `aa15864`; `b85381c`; merge `2c2b823` | [tasks/E1.07-D2.md](tasks/E1.07-D2.md) |
| E1.07-D2-M — Revisão independente da persistência RBAC | Concluída; **GO com ressalvas** (RV-D2-M-01 Médio; RV-D2-M-03/04 Baixo); não autoriza D3 | `docs: record independent RBAC persistence review` | [tasks/E1.07-D2-M.md](tasks/E1.07-D2-M.md) |
| E1.07-D2-R1 — Correcção de integridade SQLite | Revista em E1.07-D2-R2 (**NO-GO**: PD-70 incompleta); com a correcção R3, integrada pelo PR #15 (merge `dc5b046`) | `1942500`; `9d27418` | [tasks/E1.07-D2-R1.md](tasks/E1.07-D2-R1.md) |
| E1.07-D2-R2 — Revisão independente da correcção R1 | Concluída; **NO-GO** (RV-D2-R2-01 Médio; RV-D2-R2-02 a 05 Baixo); PD-69/PD-71 confirmadas; não autoriza D3 | `docs: record independent RBAC integrity correction review` | [tasks/E1.07-D2-R2.md](tasks/E1.07-D2-R2.md) |
| E1.07-D2-R3 — Correcção complementar de integridade SQLite e testes RBAC | Implementação concluída; migração 7 corrigida (D-194); PD-70/PD-72/PD-74 corrigidas e PD-73 protegida na branch; revista em E1.07-D2-R4 (**GO**); integrada pelo PR #15 (merge `dc5b046`) | `30126b6`; `198e6ca`; `0be82c3` | [tasks/E1.07-D2-R3.md](tasks/E1.07-D2-R3.md) |
| E1.07-D2-R4 — Revisão independente final da migração 7 e da integridade RBAC | Concluída; **GO**, aprovada pelo responsável; PD-70/72/73/74 confirmadas; PD-75 condiciona a activação de D3 (D-201); não autoriza D3 | `2f876d6` | [tasks/E1.07-D2-R4.md](tasks/E1.07-D2-R4.md) |
| E1.07-D2 — Encerramento (merge do PR #15) | **Concluído**: merge autorizado, validado e publicado; PD-69/70/71/72/74 encerradas; PD-73/PD-75 abertas para o Gate D3; nova PD-76 (D-203, D-204) | merge `dc5b046` | [tasks/E1.07-D2.md](tasks/E1.07-D2.md#encerramento) |
| E1.07-D3-G0 — Gate de segurança da administração da instalação | Implementação revista (G0-M, R2) e integrada em `main` pelo PR #17 (`eb5350b`) antes da correcção da PD-82 (PD-83); correcção R3, revista em R4 (GO), **integrada pelo PR #18 (`49581ad`)**. Migração 8 (identidades persistentes), âncora da instalação com recusa fechada, protecção do administrador inicial, pré-verificação PD-76; recuperação só proposta; activação bloqueada (PD-77) | ver [tarefa](tasks/E1.07-D3-G0.md#15-commits-branch-e-pr) | [tasks/E1.07-D3-G0.md](tasks/E1.07-D3-G0.md) |
| E1.07-D3-G0-M — Revisão independente do Gate de segurança da instalação | Concluída; **GO** com ressalvas (RV-D3-G0-M-01 Médio; sem bloqueantes); PD-73/75/76 confirmadas; PD-77 com R1 aprovada e R2 adiada; PD-78 avaliada; PD-79 especificada; novas PD-80/PD-81 | ver relatório de entrega | [tasks/E1.07-D3-G0-M.md](tasks/E1.07-D3-G0-M.md) |
| E1.07-D3-G0-R1 — Protecção da criação de credencial do administrador inicial e reforço dos testes | **Correcção concluída na branch; aguarda E1.07-D3-G0-R2** (sem merge). PD-80 corrigida (D-220); PD-81 coberta nas mutações K06/P02/P03/P04 (D-221); PD-78 decidida (D-222); PD-77 aberta (D-223) | ver [tarefa](tasks/E1.07-D3-G0-R1.md#15-commits-branch-e-pr) | [tasks/E1.07-D3-G0-R1.md](tasks/E1.07-D3-G0-R1.md) |
| E1.07-D3-G0-R2 — Revisão independente da protecção de credenciais e da cobertura dos testes | Concluída; **NO-GO** segundo os critérios da missão (RV-R2-01 Médio → PD-82); GO condicionado admissível com decisão do responsável (D-225); PD-80 demonstrada; PD-81 demonstrada nas mutações, aberta no registo (Baixo); PD-77/78/79 inalteradas (D-226) | `docs: record independent installation authority credential review` | [tasks/E1.07-D3-G0-R2.md](tasks/E1.07-D3-G0-R2.md) |
| E1.07-D3-G0-R3 — Correcção da PD-82 (recriação indevida do administrador inicial) | **Concluída e integrada (PR #18, merge `49581ad`)**; revista em E1.07-D3-G0-R4 (GO). `users.create` recusa o administrador inicial, presente ou ausente, antes e dentro da transacção (D-227); 10 testes novos (930); mutações R00, M1–M7 detectadas; nova PD-83 (PR #17 integrado antes da correcção, D-228) | `fix: prevent initial administrator identity reprovisioning` | [tasks/E1.07-D3-G0-R3.md](tasks/E1.07-D3-G0-R3.md) |
| E1.07-D3-G0-R4 — Revisão independente da PD-82 e regularização da PD-83 | Concluída; **GO**, condicionado à aprovação do responsável e a um PR novo (D-229). PD-82 reproduzida na base e recusada na cabeça em 116 cenários; 17 mutações, 16 detectadas (R4e sobrevive sem impacto de segurança, RV-R4-01 Baixo); PD-83 confirmada, integração sem conflitos (D-230) | `docs: record independent initial administrator identity review` | [tasks/E1.07-D3-G0-R4.md](tasks/E1.07-D3-G0-R4.md) |
| E1.07-D3-G0-R4 — Encerramento (merge do PR #18) | **Concluído**: GO aprovado pelo responsável; PR #18 integrado (merge sem *fast-forward*, árvore igual ao checkpoint aprovado) e validado na `main`; PD-82 e PD-83 encerradas; PD-77 bloqueante; PD-78/79 abertas; PD-81 aberta só no registo (D-231) | merge `49581ad`; `docs: record E1.07-D3-G0-R4 integration closure` | [tasks/E1.07-D3-G0-R4.md](tasks/E1.07-D3-G0-R4.md#14-encerramento-integração-pelo-pr-18) |
| E1.07-D3 (restante), E1.07-D4, E1.07-E, E1.07-F | Planeadas, não autorizadas | — | [tasks/E1.07-D.md](tasks/E1.07-D.md), [tasks/E1.07.md](tasks/E1.07.md) |
| E1.08 a E1.10 | Planeadas, não autorizadas | — | [implementation-plan.md](implementation-plan.md) |

Tarefa activa: **nenhuma em execução. [E1.07-D3-G0-R4](tasks/E1.07-D3-G0-R4.md#14-encerramento-integração-pelo-pr-18) encerrada (D-231).** O responsável aprovou o GO e a correcção da PD-82 entrou na `main` pelo PR #18 (`49581ade56fbd0dd453bbabbe02263fd0167ff83`, pais `eb5350b` e `9cf48a8`, árvore `bbe9e5b` igual ao checkpoint aprovado; só `7742950`, `c21aa1b` e `9cf48a8`). Validada na `main`: `pnpm check` (930/930, 12/12), desktop 6/6, *smoke* `KIL_ELECTRON_SMOKE_OK`, `git diff --check` limpo. PD-82 e PD-83 encerradas. Divergência de processo: o PR #18 foi aberto e integrado pelo responsável antes desta sessão, com o título predefinido e sem a descrição da R4 §13 (conteúdo igual ao aprovado). Continuam: **PD-77 aberta e bloqueante da activação**; PD-78 e PD-79 abertas; PD-81 aberta só quanto ao registo `[REDACTED]` (Baixo); RV-R4-01 (reforço de G24) e RV-R4-03 (normalização de `id` em `changeStatus`/`credentials`) registadas como melhorias de baixa gravidade para uma tarefa futura autorizada. PD-73, PD-75, PD-76 e PD-80 encerradas formalmente por decisão do responsável, com as ressalvas preservadas (D-232). D3-A, R1 e qualquer autoridade da instalação continuam não autorizadas.

Anterior (G0-R4): **[E1.07-D3-G0-R4](tasks/E1.07-D3-G0-R4.md), revisão independente concluída com GO para a correcção da PD-82 (`7742950`), condicionado à aprovação explícita do responsável e à integração por um PR novo (PD-83); sem merge.** Reprodução no código compilado e SQLite real: na base (`eb5350b` = `df416c1`) `users.create` recria o administrador inicial ausente em todos os cenários sem sessões, e a âncora passa a `intact` (ou `administrator-mismatch`) com o impostor a autenticar-se; na cabeça é recusado em 97 cenários de ausência e 19 de presença (4 configurações FK/RT, *getters*, `Proxy`, maiúsculas), sem escrita, âncora `broken`, ninguém autentica. Alegação da R3 (R00, M1–M7) confirmada; 17 mutações, 16 detectadas; R4e sobrevive, equivalente na segurança (RV-R4-01, Baixo). RV-R4-03 (Baixo, anterior): `changeStatus`/`credentials` não normalizam o `id`, sem escrita. PD-83: `origin/main...HEAD` contém só `7742950` e `c21aa1b`; `merge-tree` sem conflitos; exige commit de merge. 930/930 com e sem `dist`, 12/12. Condições: aprovação, PR novo, merge autorizado, `pnpm check` na `main` e só então encerrar PD-82 e PD-83 (D-229, D-230).

Anterior (G0-R3): **[E1.07-D3-G0-R3](tasks/E1.07-D3-G0-R3.md), correcção da PD-82 concluída na branch `feat/e107-d3-g0-installation-authority`; aguarda a revisão independente E1.07-D3-G0-R4 e aprovação explícita (sem merge da correcção).** Decisão do responsável: NO-GO mantido e PD-82 corrigida antes do merge. Reproduzida no código compilado de `df416c1`: sem sessões, `users.create` com o id do registo é aceite, a âncora passa de `broken` a `intact` (ou a `administrator-mismatch`) e a identidade recriada autentica-se com a credencial órfã; com sessão, só a migração 5 a trava por coincidência. Corrigida: recusa `InitialAdministratorProtectedError` antes da validação, dos conflitos e da escrita, e de novo na transacção do directório (D-227); G20 passa de `duplicate-id` à protecção. 930 testes (920 + 10). **PD-83:** o PR #17 foi integrado em `main` (`eb5350b`) antes da correcção; a correcção segue por um PR novo depois da R4 (D-228).

Anterior (G0-R2): **[E1.07-D3-G0-R2](tasks/E1.07-D3-G0-R2.md), revisão concluída com NO-GO segundo os critérios da missão; o responsável manteve o NO-GO e mandou corrigir a PD-82 (E1.07-D3-G0-R3).** PD-80 reproduzida em `a1f7293` (sem sessões, `credentials.create` aceite e âncora `broken` → `intact`, com a identidade activa ou desactivada; com sessão, recusada só pela migração 5) e demonstrada como corrigida em `7a82026` (recusa antes da política e do *hash*, 0 credenciais, âncora continua `broken`). K06/P02/P03/P04 sobrevivem à suite antiga e são detectadas pela nova; N03/N04 sem regressão demonstrável (defesa em profundidade). **Achado novo RV-R2-01 (Médio, PD-82):** `identityProvisioning.users.create` aceita recriar o administrador inicial ausente (base adulterada, sem sessões); a âncora passa a `intact` e a identidade recriada autentica-se com a credencial órfã. Anterior à R1; sem superfície externa; nenhuma autoridade concedida. RV-R2-02 (`[REDACTED]` na contagem, Baixo, não bloqueante). 920/920 com e sem `dist`, 12/12. Decisão a tomar pelo responsável: GO condicionado com a PD-82 bloqueante da D3-A, ou correcção antes do merge.

Anterior (G0-R1): **[E1.07-D3-G0-R1](tasks/E1.07-D3-G0-R1.md), correcção concluída na branch `feat/e107-d3-g0-installation-authority`; revista em E1.07-D3-G0-R2 (sem merge).** PD-80 reproduzida com o código compilado de `a1f7293` (sem sessões, `credentials.create` aceite, âncora `broken` → `intact`, a palavra-passe proposta autentica; com sessão anterior, recusada só pela guarda de versões da migração 5) e corrigida: `create` e `replace` recusam o administrador inicial antes de qualquer outra validação, com ou sem credencial (D-220). PD-81: K06, P02, P03 e P04 passam a ser detectadas (D-221); o registo da pré-verificação (RV-D3-G0-M-04) continua aberto. PD-78: desactivar, nunca eliminar (D-222), por implementar. PD-77 aberta (D-223). 920 testes (908 anteriores inalterados + 12). Sem migração nova.

Anterior (G0-M): **[E1.07-D3-G0-M](tasks/E1.07-D3-G0-M.md), concluída com GO para o merge da branch `feat/e107-d3-g0-installation-authority` (`a994705`), a aguardar a aprovação do responsável.** Migração 8 confirmada (aditiva, somas 1–7 iguais, actualização real v7 → v8 com código compilado, *downgrade* recusado). PD-75: 0/112 tentativas aceites nas 4 configurações, contra as eliminações e tomadas reproduzidas em `5e60b7f`. Âncora com recusa fechada; a sua garantia é só estrutural (D-218). PD-76: 40/40 bases legadas recusadas sem alterar dados. Achado principal: RV-D3-G0-M-01 (Médio) — `credentials.create` não protege o administrador inicial (PD-80). PD-77: direcção R1 aprovada pelo responsável, R2 adiada (D-215). PD-78: Médio, bloqueia operações sobre empresas e estabelecimentos (D-216). PD-79: requisitos do instalador (D-217). 908/908 com e sem `dist`, 12/12. O RBAC continua não operacional; merge e D3-A não autorizados por esta revisão.

Anterior (G0): **[E1.07-D3-G0](tasks/E1.07-D3-G0.md), implementação concluída na branch `feat/e107-d3-g0-installation-authority`; aguarda a revisão independente E1.07-D3-G0-M e aprovação explícita (sem merge).** PD-75 reproduzida em `5e60b7f` (com achados novos: eliminação implícita por `UPDATE OR REPLACE` de `username`; identidades e associações locais sem linhas filhas elimináveis mesmo com FK ligado; `users.created_at` mutável) e fechada pela migração 8 nas 4 configurações (D-206); âncora da instalação com recusa fechada (D-207); estado e credencial do administrador inicial recusados pelo provisionamento interno enquanto não houver autoridade da instalação (D-208); fronteira e modelo de ameaças A–F (D-209); recuperação administrativa apenas proposta (D-210); pré-verificação PD-76 no serviço local (D-211). PD-73/PD-75/PD-76 corrigidas na branch, a encerrar depois da revisão e do merge; novas PD-77 (activação bloqueada até à recuperação aprovada), PD-78 e PD-79 (D-213). 908/908 testes. O RBAC continua não operacional.

Anterior (encerramento de D2): **E1.07-D2 está encerrada (D-203).** O PR #15 foi integrado em `main` pelo merge `dc5b046` (pais `0e1e509` e `2f876d6`, árvore igual a `2f876d6`), autorizado pelo responsável depois de confirmar que o código aprovado é `0be82c3` e que `2f876d6` só contém documentação. A migração 7 está em `main`. PD-69, PD-70, PD-71, PD-72 e PD-74 estão encerradas (D-204). Continuam em aberto a PD-73, a **PD-75** (condição obrigatória antes da activação operacional de E1.07-D3, D-201) e a nova **PD-76** (pré-verificação de `rowid` legados não positivos antes de migrar bases existentes). O RBAC continua não operacional; E1.07-D3 está planeada e não autorizada.

Anterior (R4): **[E1.07-D2-R4](tasks/E1.07-D2-R4.md), concluída com GO para o merge do PR #15 (`0be82c3`), aprovada pelo responsável.** As falhas PD-70, PD-72 e PD-73 foram reproduzidas em `975af26` e não se reproduzem na cabeça nas 4 configurações SQLite (0/208 transferências). A migração 7 foi confirmada com o código compilado em bases v5 e v6 reais, incluindo falha transaccional, *downgrade* e a 7 antiga. Resultados: 876/876 com e sem `dist`, 12/12, desktop 6/6, smoke e `audit --prod` 0; mutações 31/32 detectadas, sendo a sobrevivente equivalente. PD-75: Baixa para D2; não bloqueia o merge nem o arranque da D3, mas bloqueia a activação operacional de autoridade baseada em `installation_bootstrap` (D-201). Observações RV-D2-R4-01 a 04 (D-200, D-202). Merge e E1.07-D3 não autorizados por esta revisão.

Anterior (R3): **[E1.07-D2-R3](tasks/E1.07-D2-R3.md), implementação concluída e revista em E1.07-D2-R4 (GO).** A migração 7, ainda não integrada, foi corrigida no próprio ficheiro depois de confirmar que nenhuma base não descartável dependia da soma anterior (D-194; somas 1–6 inalteradas). PD-70: associações empresariais nunca eliminadas, `DELETE` + `INSERT` deixou de transferir atribuições (D-195). PD-72: guardas só para `rowid` explícitos positivos e recusa de `rowid` não positivo (D-196). PD-73: `installation_bootstrap` gravado uma vez e imutável (D-197, commit separado; sujeita a aprovação). PD-74: RI05g detecta R10/R12/R13 (D-198). RV-04 corrigida; RV-05: as 10 mutações de D2-R1 não têm evidência e foram substituídas por 25 mutações identificadas, todas detectadas. 876/876 com e sem `dist`. Nova PD-75 para o Gate D3. Merge e E1.07-D3 não autorizados.

Anterior: **[E1.07-D2-R2](tasks/E1.07-D2-R2.md), concluída com NO-GO para o merge de E1.07-D2-R1 (PR #15, `9d27418`).** A migração 7 é aditiva e preserva dados e somas 1–6 em bases v5/v6 reais; PD-69 e PD-71 estão corrigidas e confirmadas (encerramento formal após merge autorizado). A PD-70 permanece aberta: com `foreign_keys` desligado, `DELETE` + `INSERT` da associação com o mesmo `id` transfere atribuições (RV-D2-R2-01, D-191). Novas PD-72 a PD-74. Antes de nova revisão: correcção complementar autorizada. E1.07-D3 continua não autorizada.

Mais antiga: **[E1.07-D2-M](tasks/E1.07-D2-M.md), concluída com GO com ressalvas para E1.07-D2.** E1.07-D2 (`aa15864`/`b85381c`) já foi integrada em `main` pelo PR #13 (`2c2b823`, árvore igual a `b85381c`) 20 s depois da abertura e antes da revisão; a integração aguarda ratificação do responsável (D-184). A revisão confirmou por execução a migração 6 em bases reais, o isolamento por tenant, a unicidade com `NULL`, PD-61 e o motor interno (834/834 com e sem `dist`, 12/12, 22 mutações com 21 detectadas). Ressalvas antes de E1.07-D3: `REPLACE` por `rowid` com `recursive_triggers` desligado elimina perfis e atribuições e reescreve ligações (RV-D2-M-01, PD-69, D-185); ligações das tabelas-pai mutáveis (PD-70); lacunas de cobertura (PD-71). **O RBAC continua não operacional**: sem HTTP, IPC, login RBAC nem `TenantContext` autenticado (PD-27 em D4).

Anterior: [E1.07-D1-H-R2](tasks/E1.07-D1-H-R2.md) aprovou a correcção fiscal `3831700`, já integrada pelo responsável no PR #12 (`5745d3d`), e encerrou PD-64 (D-178). A revisão confirmou receptor neutro e congelado, `Reflect.apply` capturado, leitura única, contrato `this: void`, H13 corrigido, HR01–HR15 e 7/7 mutações críticas. PD-65 e PD-67 permanecem abertas para E1.07-F. E1.07-D2 continua suspensa e não autorizada até aprovação explícita.

- **Inventário** de todas as estruturas de nível de módulo de `packages`, `services` e `apps`, classificadas A/B/C/D.
- **16 riscos reproduzidos** sobre o build da `main` (as sete listas da PD-64, regra fiscal exposta por `TaxIdPolicy.ruleFor`, extensões da base, arrays internos das transições do serviço, limites internos das credenciais e listas da configuração); nenhum acima de gravidade baixa.
- **Protecção (D-171), com ressalva D-173 corrigida na branch por D-176:** `Object.freeze` em listas e em cada nível das estruturas aninhadas; a regra fiscal devolvida conservava uma referência ao receptor original mutável (RV-D1-H-M-01), corrigido em H-R1.
- **Testes e mutações:** H01–H20 (D1-H) e HR01–HR15 (H-R1), 755 testes no total; 27/27 mutações em D1-H e 17/17 em H-R1.

PD-64 está encerrada (D-178). PD-65 permanece para diagnóstico definitivo em E1.07-F (D-174/D-177), e PD-67 permanece aberta (D-177). PD-66 está encerrada (D-175). **O RBAC não está operacional**: desde o PR #13, `main` tem a persistência RBAC (migração 6) e um motor interno não autenticado, sem consumidor nem exposição, e o `TenantContext` continua construído pelo chamador. D3/D4, E1.07-E/F e E1.08–E1.10 permanecem não autorizadas.

Validação final da revisão H-M: `pnpm check` foi executado em 2026-11-20 com Node 24.22.3 e falhou durante `eslint .` por `JavaScript heap out of memory` (cerca de 4,1 GB; exit 134), antes de `typecheck`, testes e build. Não foi repetido nem contornado com aumento de heap. Nas execuções independentes anteriores, `pnpm lint`, `pnpm typecheck` e `pnpm build` (12/12) passaram; a suite permaneceu instável conforme PD-65. O resultado obrigatório não é declarado aprovado. H-R1 reproduziu essa falha com dois worktrees dentro da raiz e explicou-a (D-177); o resultado de `pnpm check` em H-R1 está na secção “Validação verificada”.

Validação de H-R2: `pnpm check` final aprovado (lint, typecheck, 755/755, 12/12), desktop 6/6, smoke `KIL_ELECTRON_SMOKE_OK`, suite sem `dist` 755/755 e 7/7 mutações críticas detectadas. Sem OOM, timeout, nova dependência ou alteração de migrações/lockfile. A primeira suite no sandbox teve apenas X15 ambiental; a execução fora do sandbox, com ACLs reais, passou 755/755.

Anterior: **E1.07-D1-R2** aprovou a correcção R1 (GO), integrada pelo responsável no PR #9 (`1a69eb1`) antes da conclusão da revisão, e encerrou PD-62 (proveniência das decisões) e PD-63 (proveniência e imutabilidade do catálogo) (D-168).

Anterior: E1.07-X (exclusividade do serviço por base) foi revista em **E1.07-X-M** (GO com ressalvas, aprovado pelo responsável) e integrada em `main` pelo PR #7, no merge `1872bdf` (checkpoint documental `92b2cce`; técnico `cfd11fe`). PD-43 e PD-51 estão encerradas (D-140). E1.07-C, com E1.07-C-R1, está em `main` (PR #6, `136a442`), e o registo da revisão E1.07-C-R2 foi integrado em `030b101`.

A revisão independente **E1.07-C-M** encontrou um defeito Alto (RV-01): depois de um avanço seguido de retrocesso do relógio de parede, o relógio efectivo das sessões congelava e as sessões e comprovativos deixavam de expirar. A tarefa **E1.07-C-R1** corrigiu-o na mesma branch, juntamente com RV-03 (migração 5 contra reinserções, incluindo a anulação de revogações por `REPLACE`), RV-04 (sem eliminação no arranque) e RV-05 (testes para R4, R5, R6 e R9). O merge continua suspenso até uma revisão independente curta do checkpoint corrigido e aprovação explícita. A PD-43 (exclusividade por base) continua aberta e bloqueia E1.08 (E1.07-X). Detalhe em [tasks/E1.07-C-R1.md](tasks/E1.07-C-R1.md).

A revisão independente final **E1.07-C-R2** (`d5f077e`) confirmou por execução PD-45, PD-46 e PD-48 resolvidas, PD-40 confirmada e PD-47 mitigada, sem defeitos bloqueantes: recomendação **GO com ressalvas**. Ressalvas: suspensão depois de um avanço corrigido do relógio (RV-02, Baixo, na PD-50); lacuna de cobertura na migração 5 (RV-03, Baixo, PD-51); o merge do PR #6 aconteceu antes da conclusão da revisão (RV-01, processo). Detalhe em [tasks/E1.07-C-R2.md](tasks/E1.07-C-R2.md).

**Em `main` (desde o merge `136a442`), o sistema tem autenticação local offline e sessões locais revogáveis, mas não tem autorização funcional.** Desde o merge `1872bdf` (E1.07-X), a premissa de um único serviço por base (D-127) é imposta pelo bloqueio exclusivo da base: uma segunda instância é recusada (`database-locked`) antes de qualquer leitura ou escrita (D-130 a D-140).

- Existem identidades locais, associações a empresas e estabelecimentos, e avaliação interna de elegibilidade.
- Existem credenciais Argon2id, `authenticate(username, password)`, limitação de tentativas e inicialização explícita da instalação.
- Com E1.07-C (PR #6):
  - a criação de sessões exige um comprovativo interno de 60 s, de utilização única e ligado ao arranque e às versões de segurança (PD-40 resolvida);
  - as sessões usam tokens opacos (só o digest é guardado), expiram por inactividade (30 min) e de forma absoluta (12 h) e são revogadas na suspensão, desactivação, substituição de credencial, alteração da versão de segurança e reinício.
- Tudo isto existe só na composição interna do serviço local, sem HTTP nem IPC.
- Uma sessão comprova apenas a identidade autenticada; não é uma autorização empresarial (D-107, D-116).
- O `TenantContext` continua a ser construído pelo chamador (PD-27, a encerrar em E1.07-D4).
- Em `main`, PD-62/PD-63 estão encerradas desde R2; o PR #12 integrou `3831700` e H-R2 encerrou PD-64 (D-178). Não há persistência nem integração operacional.

## Repositório remoto

- Repositório oficial: `https://github.com/SilveiraGomes/kilsystem-business`, configurado como `origin` (configuração local do repositório).
- `main` local e `origin/main` foram confirmadas em `580d6580fd945022999b0709801b37c9cfcfdc8c`, sem divergências, no início de E1.06-S1.
- A API pública do GitHub confirmou `private: false` e `visibility: public`. Nenhuma configuração administrativa foi alterada.
- Branch de E1.06-S1: `chore/e106-s1-electron-security`, publicada no checkpoint `a6ad525def75c5e301bc0b5ee559cf362107918f`.
- O PR [#1](https://github.com/SilveiraGomes/kilsystem-business/pull/1) foi integrado em 2026-11-15. `main` local e `origin/main` foram alinhadas no merge commit `2ca5b90a4157e8d82e955a64ea28f9e2d543012e`, que contém a cabeça da branch. O repositório continua público e a visibilidade não foi alterada.
- E1.06-S2 partiu de `main` = `origin/main` = `b890a892d2b1268c8a1b7a6c9c538c6e88d73103`, confirmado após `git fetch`, e criou a branch local `chore/e106-s2-vitest-security`. A API pública do GitHub voltou a confirmar `private: false` e `visibility: public`. O responsável autorizou expressamente, em 2026-11-15, a publicação desta branch nessa condição. O commit técnico é `c5a23a0`, e o registo de publicação é `79430f3`. Não houve merge automático.
- O PR [#2](https://github.com/SilveiraGomes/kilsystem-business/pull/2) foi integrado pelo responsável em 2026-11-15. A `main` local avançou por fast-forward para o merge commit `d29a629768904b1273b50fefd94d2b13f4f127d9`, cuja árvore é idêntica à cabeça da branch, e ficou alinhada com `origin/main`. Neste código integrado, `pnpm check` (281/281, 12/12), os testes do desktop (6/6) e o smoke Electron foram repetidos e aprovados.
- E1.06-S2-M: após `git fetch`, `main` local = `origin/main` = `0bb435cc5f989a11e25d78038aff04c60cfdce0b`. A API do GitHub confirmou o PR #2 (`merged: true`, cabeça `79430f3`, base `b890a89`, merge `d29a629`) e o repositório público.
  - Revisão do diff: dois commits autorizados; nenhum ficheiro de testes ou de código de aplicação alterado.
  - Validações: `lint`, `typecheck`, `test`, `build`, `check`, desktop, smoke e `git diff --check`, todas repetidas e aprovadas.
  - Detalhe em [tasks/E1.06-S2-M.md](tasks/E1.06-S2-M.md).
- E1.07-A: após `git fetch`, `main` local = `origin/main` = `e4e6848532c00acdefdda90db1ce1533b3a8353c`, com a árvore limpa. Trabalho na branch `feat/e107-a-user-identity`, publicada conforme a autorização da tarefa em `cc4adc0`, com o hash local igual ao remoto.
- O PR [#3](https://github.com/SilveiraGomes/kilsystem-business/pull/3) foi integrado pelo responsável em 2026-11-16, no merge commit `4d0302ba753381ef481e090e1a73783567a17f66`.
  - A árvore do merge é idêntica à cabeça da branch.
  - A `main` local avançou por fast-forward e ficou alinhada com `origin/main`.
  - No código integrado foram repetidos e aprovados `pnpm check` (439/439, 12/12), os testes do desktop (6/6), o smoke Electron e `git diff --check`.
- E1.07-B: após `git fetch`, `main` local = `origin/main` = `a44c4943355facfd8f43bb837ef72104dded9639`, com a árvore limpa e o PR #3 integrado.
  - Trabalho na branch `feat/e107-b-local-authentication`, publicada conforme a autorização da tarefa.
  - PR para `main` preparado, sem merge automático. A descrição está em [tasks/E1.07-B.md](tasks/E1.07-B.md#pull-request).
- E1.07-B-M: após `git fetch`, `origin/main` = `8e77091a977c98371e20fa37a9bd1a910bef8b1b`.
  - O PR [#4](https://github.com/SilveiraGomes/kilsystem-business/pull/4) foi integrado pelo responsável em 2026-11-16T06:40:53Z, antes da conclusão da revisão (registado como divergência de processo).
  - Cabeça `f443057`, igual ao checkpoint revisto; a árvore do merge é idêntica à cabeça.
  - A `main` local avançou por fast-forward de `a44c494` para `8e77091`. Repositório público, sem alterações administrativas.
  - Branch `test/e107-b-m-race-coverage` publicada em `0b6587e` (hash local igual ao remoto), autorizada pelo responsável.
  - O PR [#5](https://github.com/SilveiraGomes/kilsystem-business/pull/5) integrou os dois testes em `main`, no merge `581699a7590a992f9c53a359867165ecff60d750`. A API confirmou um único ficheiro alterado (+65/−0), estado `clean` e nenhuma verificação remota configurada.
  - Após `git fetch`, a `main` local avançou por fast-forward de `8ac21b0` para `581699a`; `0b6587e` foi confirmado como ancestral. `pnpm check` passou com 516/516 e 12/12 builds; desktop 6/6; smoke Electron aprovado; auditoria com o PD-19 inalterado e produção com 0 vulnerabilidades.
- E1.07-C: após `git fetch`, `main` local = `origin/main` = `ab22404e829fca28e7fe4546b0d9af0dace9d21f`, com a árvore limpa.
  - Trabalho na branch `feat/e107-c-secure-sessions`, publicada para revisão independente.
  - A confirmação do *push* (hash local igual ao remoto) consta do relatório de entrega da tarefa.
  - PR preparado sem merge; a descrição está em [tasks/E1.07-C.md](tasks/E1.07-C.md#pull-request). A ferramenta `gh` continua indisponível.
- E1.07-C-M e E1.07-C-R1: após `git fetch`, `origin/main` = `ab22404` e a branch local = remota = `0eb1e75`, só com a documentação da revisão por commitar.
  - Commit documental `e19ef76` (só documentação), publicado na branch com o hash local igual ao remoto.
  - Commit de correcção `fix: harden session clocks and revocation integrity` na mesma branch, sem *force push*; a confirmação do *push* consta do relatório de entrega.
  - PR ainda inexistente; descrição actualizada em [tasks/E1.07-C-R1.md](tasks/E1.07-C-R1.md#pull-request). Sem merge.
- E1.07-C-R2: após `git fetch`, a branch local = remota = `d5f077eef2336b48de42dcfc91d03d90426fca11` e `origin/main` = `136a442fb86e2dbc8d9fce9e3dd8175eeacc1b77`.
  - `136a442` é o merge do PR [#6](https://github.com/SilveiraGomes/kilsystem-business/pull/6) (pais `ab22404` e `d5f077e`; árvore idêntica a `d5f077e`), feito pela conta do responsável em 2026-11-16T14:24:18Z, 49 s depois da abertura, com a descrição “Correções feitas”. A API pública confirmou 3 commits, 31 ficheiros, +4705/−80 e o repositório público.
  - O merge antecedeu a conclusão desta revisão (divergência de processo, como em E1.07-B-M). A `main` local não foi actualizada nesta revisão.
  - O registo documental de E1.07-C-R2 fica por commitar; publicado na branch já integrada, só chega a `main` por um novo PR ou por decisão do responsável.
- E1.07-X: após `git fetch`, `cc7070d` (registo de E1.07-C-R2) estava só em `origin/feat/e107-c-secure-sessions` e não existia PR posterior ao #6 (API pública). A implementação foi suspensa e o responsável autorizou a integração.
  - `main` local avançou por *fast-forward* de `ab22404` para `136a442`; merge sem *fast-forward* de `cc7070d`: `030b101b602489021d5adc2ac69828d16b53b2c6` (só `docs/`, árvore igual a `cc7070d`). Validado (597/597, 12/12, desktop 6/6, smoke) e publicado com `git push origin main` (sem *force*); local = remoto.
  - Branch `feat/e107-x-database-exclusivity` criada a partir de `030b101`. A confirmação do *push* (hash local igual ao remoto) consta do relatório de entrega. PR por abrir manualmente (`gh` indisponível); descrição em [tasks/E1.07-X.md](tasks/E1.07-X.md#pull-request).
- E1.07-X-M: commit documental `92b2cce` publicado na branch (local = remoto). Encerramento autorizado pelo responsável (GO aprovado; merge autorizado só para `92b2cce`):
  - após `git fetch`, `origin/main` = `030b101` (sem alterações inesperadas) e a branch remota = `92b2cce`. Entre `cfd11fe` e `92b2cce` só há alterações em `docs/` (7 ficheiros);
  - a API pública mostrou o PR [#7](https://github.com/SilveiraGomes/kilsystem-business/pull/7) aberto, base `main` (`030b101`), cabeça `92b2cce`, 3 commits, 20 ficheiros;
  - sem `gh`, o merge foi feito localmente, sem *fast-forward*, a partir de `92b2cce` (como em `030b101`): `1872bdf4ef89f15e3198b86b2cc06536d1d8338e`, pais `030b101` e `92b2cce`, árvore igual à de `92b2cce` (`ca8a579`);
  - validado antes da publicação (ver “Validação verificada”) e publicado com `git push origin main` (`030b101..1872bdf`, sem *force*); local = remoto. A API confirmou o PR #7 `merged: true`, com o commit de merge `1872bdf`.
- E1.07-D1: a implementação foi publicada em `c43cdaa0b9e13eaa716a0a15c1b3710005bcec0f`. O responsável integrou-a pessoalmente pelo PR [#8](https://github.com/SilveiraGomes/kilsystem-business/pull/8), merge `8f81d5ffaf0de4c295f4d9c754d471f4a993ee10`, em 2026-11-17T07:17:15Z, antes da revisão independente. A API pública confirmou `merged: true`, base `5db43c2`, cabeça `c43cdaa`, um commit e 23 ficheiros. A árvore do merge e a cabeça técnica são idênticas (`780cf9e`).
- E1.07-D1-M: após `git fetch origin --prune`, `origin/main` = `8f81d5f`, a branch técnica local = remota = `c43cdaa` e não existiam alterações inesperadas. A revisão decorreu em `review/e107-d1-m-independent-review`, criada directamente de `origin/main`; a `main` local ficou intocada em `5db43c2`. Resultado: NO-GO, detalhe em [tasks/E1.07-D1-M.md](tasks/E1.07-D1-M.md).
- E1.07-D1-R1 (integração documental autorizada): após `git fetch origin`, `origin/main` = `8f81d5f` e a branch documental = `40d70cf`, só com `README.md` e `docs/` (12 ficheiros). A API pública não mostrou PR para essa branch.
  - A `main` local avançou por *fast-forward* de `5db43c2` para `8f81d5f`. Sem `gh`, merge local sem *fast-forward* de `40d70cf` (como em `030b101` e `1872bdf`): `f2253665552e717297cc575158ae0ba86096ef52`, pais `8f81d5f` e `40d70cf`, árvore igual à de `40d70cf`.
  - Validado antes do *push* (`pnpm check` 682/682, 12/12) e publicado com `git push origin main` (`8f81d5f..f225366`, sem *force*); local = remoto. O PR #8 não foi revertido.
  - Branch `feat/e107-d1-r1-authorization-integrity` criada a partir de `f225366`. A confirmação do *push* (hash local igual ao remoto) consta do relatório de entrega. PR por abrir manualmente; descrição em [tasks/E1.07-D1-R1.md](tasks/E1.07-D1-R1.md#pull-request). Sem merge.
- E1.07-D1-R2: `git fetch origin` revelou `origin/main` = `1a69eb1598ab7dce46f5d939bcc6f46e9c1d2c99`, merge do PR #9 com pais `f225366` e `0f1f9a6`. A árvore do merge e do checkpoint técnico é `0579371326e98081bcadd7563cbef6593ed1bcc8`. A `main` local permaneceu em `f225366`; a revisão não efectuou merge. O commit documental posterior na branch exige novo PR, porque o PR #9 já está integrado.
- E1.07-D1-H (regularização): após `git fetch origin`, `origin/main` = `0539b15c0c6cf67241da8c7bd943a1d8b2370f89`, merge do PR #10 com pais `1a69eb1` e `cbe2ad5`; `git diff cbe2ad5 0539b15` vazio; entre `1a69eb1` e `0539b15` só `README.md` e `docs/`. A `main` local avançou por *fast-forward* de `030b101` para `0539b15` (local = `origin/main` = `git ls-remote`), sem commits novos na `main`. Validada antes de qualquer alteração (ver “Validação verificada”). Branch `feat/e107-d1-h-domain-immutability` criada a partir de `0539b15`; a confirmação do *push* consta do relatório de entrega. PR por abrir manualmente (`gh` indisponível), em Draft; descrição em [tasks/E1.07-D1-H.md](tasks/E1.07-D1-H.md#pull-request). Sem merge.
- E1.07-D2-M: após `git fetch`, a branch `feat/e107-d2-rbac-persistence` local = remota = `b85381cec9f43a6b3316a72850c106f7f2a96704` e `origin/main` = `2c2b82317147764a2794ef75a5d7f9630e8f39a0`.
  - `2c2b823` é o merge do PR [#13](https://github.com/SilveiraGomes/kilsystem-business/pull/13) (pais `5bf2e00` e `b85381c`; árvore igual a `b85381c`), feito pela conta do responsável em 2026-11-21T01:07:32Z, 20 s depois da abertura, sem comentários de revisão e com o título “Feat/e107 d2 rbac persistence”. A API pública confirmou que é o único PR da branch.
  - O merge antecedeu a revisão independente (divergência de processo, como nos PR #4, #6, #9, #11 e #12). A `main` local não foi actualizada pela revisão.
- Encerramento de E1.07-D2: depois de `git fetch origin`, `origin/main` = `0e1e509` e branch = `2f876d6`; `git diff 0be82c3 2f876d6` fora de `docs/` vazio. Como o `gh` não está disponível, fez-se um merge local sem *fast-forward* na `main` (local = `origin/main` = `0e1e509` antes do merge): `dc5b04607c8640ecca2d14f44b2f0a10be71ca0d`, pais `0e1e509` e `2f876d6`, árvore igual a `2f876d6`. Foi validado com `pnpm check` antes do *push* e publicado com `git push origin main` (`0e1e509..dc5b046`, sem *force*); local = `origin/main` = `git ls-remote`. A API pública do GitHub regista o PR #15 como `merged`, com o commit de merge `dc5b046`. O registo documental do encerramento está na branch `docs/e107-d2-closure`.
- Encerramento de E1.07-D3-G0-R4: depois de `git fetch origin`, `origin/main` tinha avançado de `eb5350b` para `49581ade56fbd0dd453bbabbe02263fd0167ff83`, merge do PR [#18](https://github.com/SilveiraGomes/kilsystem-business/pull/18) (pais `eb5350b` e `9cf48a8`; árvore `bbe9e5b` igual a `9cf48a8`). A API pública do GitHub confirmou: aberto e integrado pela conta do responsável em 2026-11-22T14:14:53Z/14:15:08Z, base `eb5350b`, cabeça `9cf48a8`, 3 commits (`7742950`, `c21aa1b`, `9cf48a8`), 11 ficheiros, título predefinido e corpo vazio. Não foi criado PR duplicado. A `main` local avançou por *fast-forward* (`5e60b7f..49581ad`; local = `git ls-remote`) e foi validada antes de qualquer alteração. O registo documental está na branch `docs/e107-d3-g0-closure`, criada a partir de `49581ad`; sem merge.
- E1.07-D2-R4: após `git fetch origin`, a branch `fix/e107-d2-r1-rbac-integrity` local = remota = `0be82c3424a38f48b7c8dd2f56c49e15010a08a3` e `origin/main` = `0e1e509b9931a284da8c44409172e05b67553ca6`. A API pública do GitHub confirmou o PR #15 aberto, em Draft, `mergeable`, cabeça `0be82c3`, 6 commits, 23 ficheiros, sem comentários. O registo da revisão foi publicado na mesma branch por commit documental, sem *force push*. Sem merge.
- E1.07-D2-R3: após `git fetch origin`, a branch `fix/e107-d2-r1-rbac-integrity` local = remota = `975af2627441476fa22cc74b03b4a2b43f6ce3a9` e `origin/main` = `0e1e509b9931a284da8c44409172e05b67553ca6`. A API pública confirmou o PR #15 aberto, em Draft, cabeça `975af26`, sem comentários. A correcção foi publicada na mesma branch, sem *force push*; a descrição do PR não foi editada (`gh` indisponível) e a proposta está em [tasks/E1.07-D2-R3.md](tasks/E1.07-D2-R3.md#15-publicação). Sem merge.

## Ambiente de referência

| Ferramenta | Versão | Onde está fixada |
| --- | --- | --- |
| Node.js | **24.22.3** (LTS “Krypton”) | `.node-version`; `engines.node >=24.22.3 <25` |
| pnpm | 9.15.9 | `packageManager`; `engines.pnpm >=9.15.0 <10` |
| Verificação de versões | `engine-strict=true` | `.npmrc`: `pnpm install` falha com outra versão de Node (verificado com o Node 20.16.0) |

Nesta máquina (Windows x64):
- o Node 24.22.3 está instalado de forma isolada em `%LOCALAPPDATA%\KIL-Tools\node\node-v24.22.3-win-x64`, a partir do zip oficial com SHA-256 verificado;
- o Node do sistema (`C:\Program Files\nodejs`, 20.16.0) e o PATH global **não foram alterados**;
- antes de qualquer comando, cada sessão tem de pôr o Node 24 à frente no PATH, só para o processo em curso:

```powershell
$env:Path = "$env:LOCALAPPDATA\KIL-Tools\node\node-v24.22.3-win-x64;" + $env:Path
node -v   # v24.22.3
```

Noutra máquina, instale o Node 24.22.3 (instalador oficial ou um gestor de versões que leia `.node-version`, como o fnm) e o pnpm 9.15.9. Com o Node 24 em Windows x64 não são necessárias ferramentas de compilação C++: o `better-sqlite3` descarrega um binário pré-compilado.

## Validação verificada

### Encerramento de E1.07-D3-G0-R4 (`main` em `49581ad`, depois do PR #18), 2026-11-22

Executado pela sessão principal com Node.js 24.22.3 e pnpm 9.15.9, no directório canónico, sobre a `main` integrada (`49581ad`), em sequência; detalhe na [tarefa](tasks/E1.07-D3-G0-R4.md#142-validação-na-main-49581ad):

- `pnpm.cmd check` aprovado (121 s): lint, typecheck, **930/930** (23 ficheiros), build **12/12**.
- Desktop 6/6; *smoke* `KIL_ELECTRON_SMOKE_OK` (Electron 45.3.2, Chromium 156.0.8078.100, Node 24.22.2); `git diff --check` limpo; árvore limpa.
- Não executado nesta sessão: suite sem `dist`, `pnpm audit`, mutações.
- Branch documental `docs/e107-d3-g0-closure` (só `docs/`): `pnpm check` aprovado em `d2d1fc8` (930/930, 12/12). Depois das alterações de D-232, duas execuções completas falharam só por *timeouts* de 5 s em testes diferentes (`[RM04]` em `rbac-sqlite-integrity`; depois `[G18]` em `identity-persistence-gate` e `[S11]` em `local-sessions`), sem relação com a documentação; `rbac-sqlite-integrity` isolado passou 68/68 e a terceira execução completa passou (**930/930, 12/12**, 174 s). Sem carga concorrente observada. Registado como nova ocorrência da **PD-65** (aberta). Por erro de processo, o commit `e8906cf` foi publicado na branch antes da execução aprovada; não foi integrado antes dela.

### E1.07-D3-G0-R4 (revisão independente da PD-82), 2026-11-22

Executado pelo revisor independente com Node.js 24.22.3 e pnpm 9.15.9, no directório canónico em `c21aa1b`, cada comando sozinho; detalhe na [tarefa](tasks/E1.07-D3-G0-R4.md#9-validações):

- `pnpm.cmd lint`, `typecheck`, `test` (**930/930**, 23 ficheiros), `build` (**12/12**) e `check` aprovados (246,5 s); desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK`; `git diff --check` limpo (árvore e `origin/main...HEAD`); `audit` 1 moderada (PD-19); `audit --prod` 0.
- Suite sem `dist` numa cópia `git archive` fora do repositório: cabeça **930/930**, base 920/920.
- PD-82 reproduzida no código compilado de `eb5350b` e recusada no de `c21aa1b` (97 + 19 cenários). Mutações R00, M1–M7 e R4a–R4i na cópia: 16 de 17 detectadas (R4e sobrevive, equivalente na segurança). SHA-256 repostos e confirmados; repositório canónico nunca mutado. Sem falhas intermitentes em 3 suites e 18 execuções de mutação.

### E1.07-D3-G0-R3 (correcção da PD-82), 2026-11-22

Executado com Node.js 24.22.3 e pnpm 9.15.9, na branch `feat/e107-d3-g0-installation-authority`, cada comando sozinho; resultados e números na [tarefa, secção 8](tasks/E1.07-D3-G0-R3.md#8-validações):

- Reprodução da PD-82 com o código compilado de `df416c1` (cenários A–E; aceite sem sessões, com a âncora a passar a `intact`) e do commit técnico (recusada em todos, âncora `broken`, sem escrita).
- `pnpm.cmd lint`, `typecheck`, `test` (**930/930**), `build` (**12/12**), `check`, desktop, smoke, `git diff --check`, `audit` e `audit --prod`: ver a tarefa.
- Suite sem `dist` numa cópia `git archive` fora da raiz; mutações R00 e M1–M7 nessa cópia, todas detectadas; SHA-256 repostos e confirmados.

### E1.07-D3-G0-R2 (revisão independente da protecção de credenciais), 2026-11-22

Executado pelo revisor independente com Node.js 24.22.3 e pnpm 9.15.9, no directório canónico em `7a82026`, cada comando sozinho:

- `pnpm.cmd lint`, `typecheck`, `test` (**920/920**, 23 ficheiros), `build` (**12/12**) e `check` aprovados (159,9 s); desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK`; `git diff --check` limpo; `audit` 1 moderada (PD-19); `audit --prod` 0.
- Suite sem `dist` (worktree fora do repositório, `--frozen-lockfile --offline`, 0 directórios de build): **920/920** (51,4 s); worktree removido por `fs.rmSync` e `git worktree prune`, confirmado.
- PD-80 reproduzida em `a1f7293` e confirmada como corrigida em `7a82026` (cenários A–E e concorrência); RV-R2-01 reproduzido em ambos (anterior à R1). Detalhe na [tarefa](tasks/E1.07-D3-G0-R2.md).
- Mutações sobre a suite completa (worktree isolado): K06F, P02, P03 e P04 sobrevivem à suite antiga (908) e são detectadas pela nova (920); N03/N04 sobrevivem sem regressão demonstrável. SHA-256 repostos e confirmados. Intermitências: *timeouts* de 5 s e um `EPERM` de limpeza em 5 de 21 suites no worktree, não determinísticos; 3 suites canónicas sem falhas.

### E1.07-D3-G0-R1 (protecção da criação de credencial do administrador inicial), 2026-11-22

Executado com Node.js 24.22.3 e pnpm 9.15.9, na branch `feat/e107-d3-g0-installation-authority`, cada comando sozinho:

- Reprodução da PD-80 com o código compilado de `a1f7293` (aceite sem sessões; recusada só pela migração 5 com sessão anterior) e de `f0b79b0` (recusada nos dois cenários); secção 2 da [tarefa](tasks/E1.07-D3-G0-R1.md).
- Código final (`f0b79b0`): `pnpm.cmd lint`, `typecheck`, `test` (**920/920**, 23 ficheiros; 908 anteriores inalterados + 12 novos), `build` (**12/12**) e `check` aprovados (187 s; sem *timeouts* nem OOM); desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK`; `git diff --check` limpo; `audit` 1 moderada (PD-19); `audit --prod` 0.
- Suite sem `dist` (cópia `git archive` de `f0b79b0` fora da raiz, 0 directórios de build): **920/920** (39,2 s); cópia removida por `fs.rmSync` e confirmada.
- Mutações (na cópia): K06, P02, P03 e P04 sobrevivem com a suite de `a1f7293` e são detectadas com a nova; 13 sobre a suite nova, 11 detectadas e 2 equivalentes (N03, N04). Ficheiros repostos e confirmados por SHA-256. Intermitências na primeira passagem (falhas fora do Gate e um processo sem código de saída), não reproduzidas ao repetir; detalhe na [tarefa, secção 8](tasks/E1.07-D3-G0-R1.md#8-mutações).

### E1.07-D3-G0-M (revisão independente do Gate da instalação), 2026-11-21

Executado com Node.js 24.22.3 e pnpm 9.15.9, na árvore em `a994705`, cada comando sozinho:

- `pnpm.cmd lint`, `typecheck`, `test` (**908/908**, 23 ficheiros), `build` (**12/12**) e `check` aprovados (228,5 s; sem *timeouts* nem OOM); desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK`; `git diff --check` limpo; `audit` 1 moderada (PD-19); `audit --prod` 0.
- Suite sem `dist` (cópia `git archive` de `a994705`, fora da raiz): **908/908** (53,3 s). Contagem por ficheiro igual a `5e60b7f` nos 22 ficheiros anteriores, nenhum título removido.
- Ensaios próprios com SQLite real (cópias de `5e60b7f` e `a994705`): 112 tentativas PD-75 por versão; 40 bases legadas PD-76; WAL pendente; PD-78; actualização real v7 → v8 e *downgrade* com código compilado. Mutações: 22 executadas, 17 detectadas, 1 equivalente, 4 sobreviventes por falta de cobertura (PD-81); ficheiros repostos e confirmados por SHA-256.
- Incidente: 2 *timeouts* transitórios (5 s) em `local-authentication` só na cópia de `main` sem `dist`; repetido sozinho 43/43. Detalhe na [tarefa](tasks/E1.07-D3-G0-M.md#12-validações).

### E1.07-D3-G0 (Gate de segurança da administração da instalação), 2026-11-21

Executado com Node.js 24.22.3 e pnpm 9.15.9, na branch `feat/e107-d3-g0-installation-authority`:

- Linha de base em `main` = `5e60b7f`: `pnpm.cmd check` aprovado (876/876, 22 ficheiros, 12/12).
- Reprodução da PD-75 com o código compilado de `5e60b7f` e da branch (4 configurações; secção 2 da tarefa).
- Código final (`83480da`): `pnpm.cmd check` aprovado — lint, typecheck, **908/908** (23 ficheiros; 876 anteriores + 32 novos), **12/12** builds; sem *timeouts* nem OOM.
- `pnpm.cmd --filter @kil-business/desktop test` 6/6; `smoke` `KIL_ELECTRON_SMOKE_OK` (Electron 45.3.2, Chromium 156.0.8078.100, Node 24.22.2); `git diff --check` limpo.
- `pnpm.cmd audit`: 1 moderada, a PD-19 inalterada (minimatch via typescript-eslint, só lint); `pnpm.cmd audit --prod`: 0. Sem dependências novas nem alteração do lockfile.
- Mutações: 19/20 detectadas; a sobrevivente (M14) é equivalente. Ficheiros repostos e confirmados por SHA-256.
- Suite sem `dist` (cópia `git archive` de `83480da` fora da raiz, 0 directórios de build): **908/908** (83 s); cópia removida por `fs.rmSync` e confirmada. Detalhe na [tarefa, secção 13](tasks/E1.07-D3-G0.md#13-validações).

### Encerramento de E1.07-D2 (merge do PR #15), 2026-11-21

Executado com Node.js 24.22.3 e pnpm 9.15.9, cada comando sozinho:

- Merge `dc5b046` antes do *push*: `pnpm.cmd check` aprovado (lint, typecheck, **876/876**, 22 ficheiros, **12/12**; 148,3 s; sem *timeouts* nem OOM).
- Em `main` = `origin/main` = `dc5b046` depois do *push*: `pnpm.cmd --filter @kil-business/desktop test` 6/6; `pnpm.cmd --filter @kil-business/desktop smoke` `KIL_ELECTRON_SMOKE_OK` (Electron 45.3.2, Chromium 156.0.8078.100, Node 24.22.2).
- Registo documental (`docs/e107-d2-closure`): `git diff --check` e `pnpm.cmd check` sobre a árvore final (ver relatório de entrega).

### E1.07-D2-R4 (revisão independente final da integridade RBAC), 2026-11-21

Executado com Node.js 24.22.3, pnpm 9.15.9 e SQLite 3.53.2 sobre `0be82c3`, cada comando sozinho e sem suites concorrentes:

- `pnpm.cmd lint` (73 s, sem OOM), `typecheck` (11,2 s), `test` **876/876** (22 ficheiros, 58,6 s, sem *timeouts*), `build` **12/12**, `check` aprovado (198,9 s); desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK` (Electron 45.3.2); `git diff --check` sem erros; `audit` 1 moderada (`minimatch`, PD-19); `audit --prod` 0.
- Cópias isoladas fora da raiz (`git archive`, `--frozen-lockfile --offline`): suite sem `dist` **876/876**; `975af26` → cabeça 856 → 876, 0 títulos removidos.
- Reprodução própria (motor real, estado persistido comparado): `975af26` 8 transferências Alice → Mallory, cabeça 0/208; `rowid` não positivo recusado nas 10 tabelas × 4 configurações; bootstrap redireccionável em `975af26`, imutável na cabeça.
- Migração real com o código compilado: v5 (`5bf2e00`) → `[6, 7]`, v6 (`0e1e509`) → `[7]`; somas 1–6 iguais; dados preservados; falha transaccional sem triggers parciais; *downgrade* e a 7 antiga recusados sem alterar o ficheiro; instalação limpa `[1..7]`.
- Mutações independentes: controlo 212/212; **32 executadas, 31 detectadas** (a sobrevivente M-N02x é equivalente); SHA-256 reposto e confirmado. Detalhe em [tasks/E1.07-D2-R4.md](tasks/E1.07-D2-R4.md).

### E1.07-D2-R3 (correcção complementar da integridade RBAC), 2026-11-21

Executado com Node.js 24.22.3 e pnpm 9.15.9 sobre `198e6ca` (árvore final com a documentação), cada comando sozinho:

- `pnpm.cmd lint` (38,5 s, sem OOM), `typecheck`, `test` **876/876** (22 ficheiros, sem *timeouts*), `build` **12/12**, `check` aprovado (161,7 s); desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK` (Electron 45.3.2); `git diff --check` sem erros; `audit` 1 moderada (PD-19); `audit --prod` 0.
- Cópias isoladas fora da raiz (`git archive`, `--frozen-lockfile --offline`): suite sem `dist` **876/876**; 856 → 876, só testes novos.
- Reprodução antes/depois com código compilado (`975af26` e cabeça), 4 configurações: PD-70 (`DELETE` + `INSERT` transferia com FK OFF), PD-72 (`rowid` −1 bloqueava inserções normais) e PD-73 (administrador inicial redireccionável) reproduzidas e fechadas.
- Migração real: bases v5 (`5bf2e00`) e v6 (`0e1e509`) com dados fictícios; política estrita sem tocar no ficheiro; só `[6, 7]`/`[7]`; somas 1–6 iguais; autorização coerente; *downgrade* recusado; base com a 7 antiga recusada (`migration-checksum-mismatch`).
- Mutações: controlo 212/212; **25 executadas, 25 detectadas** (incluindo R10, R12, R13); SHA-256 reposto e confirmado. Detalhe em [tasks/E1.07-D2-R3.md](tasks/E1.07-D2-R3.md).

### E1.07-D2-R2 (revisão independente da correcção R1), 2026-11-21

Executado com Node.js 24.22.3 e pnpm 9.15.9 sobre `9d27418`, cada comando sozinho:

- `pnpm.cmd lint` (72,9 s, sem OOM), `typecheck`, `test` **856/856** (22 ficheiros, sem *timeouts*), `build` **12/12**, `check` aprovado (200,9 s); desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK` (Electron 45.3.2); `git diff --check` sem erros; `audit` 1 moderada (PD-19); `audit --prod` 0.
- Cópias isoladas fora da raiz (`git archive`, `--frozen-lockfile --offline`): suite sem `dist` **856/856**; base `0e1e509` 834/834; 22 testes novos, nenhum removido.
- Migração real com código compilado: bases v5 (`5bf2e00`) e v6 (`0e1e509`) com dados fictícios; política estrita sem tocar no ficheiro; só `[6, 7]`/`[7]` aplicadas; linhas e somas 1–6 iguais; funcionamento posterior; reversão, interrupção real e *downgrade* (`migration-integrity`) confirmados.
- SQL directo nas 4 configurações: PD-69 não reproduzível (reproduzida na base); PD-70 fechada para `UPDATE`/`REPLACE`, mas `DELETE` + `INSERT` da associação com FK OFF transfere atribuições (RV-D2-R2-01); `rowid` −1 bloqueia inserções normais (RV-D2-R2-02).
- Mutações: **14 executadas, 11 detectadas** (R10, R12 e R13 sobrevivem: RV-D2-R2-03). SHA-256 reposto e confirmado. Detalhe em [tasks/E1.07-D2-R2.md](tasks/E1.07-D2-R2.md).

### E1.07-D2-M (revisão independente da persistência RBAC), 2026-11-21

Executado com Node.js 24.22.3 e pnpm 9.15.9 sobre `b85381c`, cada comando sozinho:

- `pnpm.cmd lint` (57,4 s, sem OOM), `typecheck`, `test` **834/834** (22 ficheiros, sem *timeouts*), `build` **12/12**, `check` aprovado (127,1 s); desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK` (Electron 45.3.2); `git diff --check` sem erros; `audit` 1 moderada (PD-19); `audit --prod` 0.
- Cópias isoladas fora da raiz (`git archive`, instalação `--frozen-lockfile --offline`): suite sem `dist` **834/834** (0 directórios de build); base `5bf2e00` 755/755; nenhum teste removido (só os títulos D60, D61, D64 mudaram; 79 novos).
- Migração real com o código compilado da base e da cabeça: base nova, base até à 5 vazia e com dados (credenciais, associações, sessões, limitação), política estrita sem tocar no ficheiro, só a migração 6 aplicada, dados iguais byte a byte, funcionamento posterior; *downgrade* recusado (`migration-integrity`).
- Ensaio SQL directo nas 4 configurações de `foreign_keys`/`recursive_triggers`: unicidade com `NULL`, UPSERT, `OR IGNORE`, imutabilidade e tenant confirmados; `REPLACE` por `rowid` com `recursive_triggers` desligado elimina perfis e atribuições (RV-D2-M-01).
- Mutações: controlo 196/196; **22 executadas, 21 detectadas** (M06b sobrevive, só em `listApplicablePermissionCodes`); O1, O2 e M10 só detectadas por guardas do revisor. SHA-256 reposto e confirmado. Detalhe em [tasks/E1.07-D2-M.md](tasks/E1.07-D2-M.md).

### E1.07-D2 (persistência RBAC e motor interno), 2026-11-21

Executado com Node.js 24.22.3 e pnpm 9.15.9, cada comando sozinho, sem suites concorrentes:

- Linha de base em `main` `5bf2e00`: `pnpm.cmd check` aprovado (755/755, 12/12).
- Na branch: `pnpm.cmd check` final **aprovado** (lint, typecheck, **834/834** em 22 ficheiros, 12/12; 138,6 s), sem *timeouts* nem OOM; desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK`; `git diff --check` sem erros.
- Mutações: **19/19 detectadas**; SHA-256 dos quatro ficheiros reposto e confirmado depois de cada uma.
- `pnpm audit`: só `minimatch` moderada (PD-19); `audit --prod` 0. Sem dependências novas; `migrations.ts` só com adições; somas das migrações 1–5 inalteradas.
- Suite sem `dist` num worktree externo do commit `aa15864` (0 directórios de build): **834/834**, 56,1 s; worktree removido e confirmado. Detalhe em [tasks/E1.07-D2.md](tasks/E1.07-D2.md).

### E1.07-D1-H-R1 (isolamento da política fiscal), 2026-11-20/21

Executado com Node.js 24.22.3 e pnpm 9.15.9, cada comando sozinho, sem suites concorrentes:

- Reprodução de RV-D1-H-M-01 antes da correcção, sobre `src` e `dist`: o mesmo resultado nos dois (P1–P8); depois da correcção e do `build`, `src` e `dist` voltaram a coincidir e P1–P6 deixaram de reproduzir; P7 (fecho) é o limite documentado (D-176).
- `pnpm.cmd lint` aprovado; `pnpm.cmd typecheck` aprovado; `pnpm.cmd test` **755/755** (20 ficheiros, 50,3 s, sem *timeouts*); `pnpm.cmd build` 12/12; desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK`; `git diff --check` sem erros.
- Suite sem `dist` num worktree isolado fora do repositório (`install --frozen-lockfile --offline`): **755/755**, 55,7 s.
- Mutações: controlo 91/91; **17/17 detectadas** (MR00 = implementação anterior completa); SHA-256 reposto e confirmado depois de cada uma.
- ESLint: pico ~2,46 GiB sem worktrees (duas execuções); base `0539b15` 2473 MiB vs branch + R1 2484 MiB; com dois worktrees dentro da raiz, exit 134 (*heap* ~4,1 GB, limite 4288 MiB) — reproduz a falha da H-M (D-177, PD-67).
- `pnpm audit`: só `minimatch` moderada (PD-19); `audit --prod` 0; PD-66 confirmada encerrada. Migrações 1–5 (blob `9312348…`), dependências e lockfile sem alterações.
- `pnpm.cmd check` final, depois da documentação: **aprovado** (lint, typecheck, 755/755, 12/12; 193,8 s), única execução. Detalhe em [tasks/E1.07-D1-H-R1.md](tasks/E1.07-D1-H-R1.md).

### E1.07-D1-H (imutabilidade transversal dos contratos de domínio), 2026-11-17

Executado com Node.js 24.22.3 e pnpm 9.15.9 (`pnpm install --frozen-lockfile`, lockfile inalterado):

- `main` regularizada (`0539b15`), antes de alterar código: `pnpm.cmd check` aprovado; `pnpm.cmd test` **720/720** (18 ficheiros); desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK`.
- Reprodução da PD-64 sobre o build da `main`: 16/16 riscos reproduzidos (RP-01 a RP-16); repetida sobre o build corrigido: 16/16 recusados com `TypeError`, validadores com o comportamento original.
- Branch: `lint`, `typecheck` e `build` (12/12) aprovados; `tests/domain-immutability.test.ts` 20/20; desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK`; `git diff --check` sem erros.
- `pnpm.cmd check` final, depois da documentação: **aprovado, 740/740 (19 ficheiros), 12/12**.
- Suite completa (19 ficheiros, 740 testes): 740/740 em 4 execuções (incluindo o `check` final); **3 execuções com *timeouts* de 5 s** em testes Argon2/SQLite (3, 1 e 2 testes; sem asserções falhadas): dois `pnpm check` e a suite sem os 13 directórios de build (738/740; 13/13 repostos com manifesto SHA-256 idêntico). Nas mesmas condições, a `main` passou 5/5 (36,5–59,8 s). Isolados, os testes afectados passam em 0,2–0,4 s. Registado como PD-65; nenhum teste alterado. Tabela completa em [tasks/E1.07-D1-H.md](tasks/E1.07-D1-H.md#9-validações).
- Mutações: **27/27 detectadas** (22 de D1-H e 5 críticas de R1), ficheiros repostos com SHA-256 confirmado, pasta do ensaio removida. Os testes anteriores não detectavam a remoção do congelamento das listas.
- `pnpm audit`: `minimatch` moderada (PD-19) e **`picomatch` alta, GHSA-fc5q-39xc-vjpf, nova** (PD-66), só desenvolvimento; `audit --prod`: 0. Migrações 1–5, dependências e lockfile sem alterações. A PD-57 não ocorreu.
- Não executado: instalação limpa (sem dependências novas).

Detalhe completo em [tasks/E1.07-D1-H.md](tasks/E1.07-D1-H.md).

### E1.07-D1-R2 (revisão independente final da integridade), 2026-11-17

Executado com Node.js 24.22.3 e pnpm 9.15.9 sobre `0f1f9a6`/árvore integrada `1a69eb1`:

- `lint`, `typecheck`, `test` (720/720), `build` (12/12), `check` (720/720 e 12/12), desktop (6/6), smoke Electron e `git diff --check`: aprovados.
- Suite sem 13 directórios `dist`/`dist-electron`: 720/720; 13/13 repostos, com SHA-256 idêntico.
- Duas cópias físicas do módulo: catálogo cruzado `UNKNOWN`, decisão cruzada não reconhecida e resposta `access-denied`.
- Mutações independentes: 13/13 detectadas; os ficheiros foram repostos depois de cada mutação com SHA-256 confirmado.
- Auditoria: 1 moderada conhecida em `minimatch` (PD-19; código 1); produção 0. Migrações 1–5, dependências e lockfile sem alterações.
- A PD-57 não ocorreu. Instalação limpa não repetida (sem dependências novas).
- Resultado: GO para R1; PD-62/PD-63 encerradas; PD-64 baixa para D1-H antes de D2; D2 não autorizada.

Detalhe completo em [tasks/E1.07-D1-R2.md](tasks/E1.07-D1-R2.md).

### E1.07-D1-R1 (integridade e proveniência dos contratos de autorização), 2026-11-17

Executado nesta sessão com Node.js 24.22.3 e pnpm 9.15.9:

- `main` depois da integração documental (`f225366`, antes do *push*): `pnpm.cmd check` 682/682 (17 ficheiros), 12/12.
- Branch `feat/e107-d1-r1-authorization-integrity`:
  - `lint`, `typecheck`, `test` (**720/720**, 18 ficheiros: os 682 anteriores e 38 novos), `build` (12/12) e `check`: aprovados; `check` repetido depois da documentação.
  - Testes anteriores ajustados só por mudança de contrato, com justificação individual; nenhum removido, ignorado ou focado.
- Suite sem os 13 directórios de build: 720/720; 13/13 repostos com SHA-256 idêntico. Desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK` (Electron 45.3.2); `git diff --check` sem erros.
- Reprodução antes da correcção, sobre o build de `f225366`: `{ outcome: 'GRANTED' }`, a estrutura completa e um clone JSON alterado davam `{ allowed: true }`; catálogos oficial, experimental, fabricado e clonado eram indistinguíveis; definições alteráveis. Achado adicional: `PERMISSION_SCOPES.push('GLOBAL')` era aceite e `createPermission` passava a aceitar `GLOBAL`. Repetido sobre o build corrigido: todos os ataques recusados.
- Mutações: **29/29 detectadas** (17 novas: decisões fabricadas, clonadas e convertidas, catálogos experimentais, fabricados e por versão, definições e referências alteráveis, DENIED → GRANTED; e 12 regressões de isolamento, âmbito e autoridade). Ficheiros repostos com SHA-256 confirmado; pastas dos ensaios removidas.
- Migrações 1–5 inalteradas; nenhum diff em `packages/database`, `services`, `apps`, `package.json` ou `pnpm-lock.yaml`; nenhuma dependência nova.
- `pnpm audit`: 1 moderada (PD-19, inalterada); `--prod`: 0. A PD-57 não ocorreu.
- Não executado: instalação limpa (sem dependências novas); persistência RBAC (D2 não autorizada).

Detalhe completo em [tasks/E1.07-D1-R1.md](tasks/E1.07-D1-R1.md).

### E1.07-D1-M (revisão independente dos contratos RBAC), 2026-11-17

Executado com Node.js 24.22.3 e pnpm 9.15.9 sobre a árvore integrada do PR #8:

- `lint`, `typecheck`, `test` (682/682), `build` (12/12), desktop (6/6), smoke Electron e `git diff --check`: aprovados; `pnpm check` repetido depois da documentação.
- Suite sem os 13 directórios `dist`/`dist-electron`: 682/682; directórios restaurados 13/13 e SHA-256 idêntico; pasta temporária própria removida.
- Testes dirigidos de autorização: 56/56. A matriz documental cobre os 50 requisitos; os 626 testes anteriores foram preservados.
- Mutações independentes: 12/12 detectadas, incluindo identidade incorrecta, empresa/tenant alvo, atribuição inactiva, associação local inactiva e catálogo mutável. `authorization.ts`, `membership.ts` e `permission.ts` foram repostos com SHA-256 confirmado; pasta temporária e executor removidos.
- Migrações 1–5 inalteradas; nenhum diff em `apps`, `services`, `packages/database`, `package.json` ou `pnpm-lock.yaml`; nenhuma dependência nova.
- `pnpm audit`: 1 moderada (PD-19, inalterada); `pnpm audit --prod`: 0.
- Reprodução RV-D1-M-01: `{ outcome: 'GRANTED' }` é aceite por `isAuthorizationGranted` e convertido em `{ allowed: true }`. RV-D1-M-02: `PermissionCatalog` não distingue a proveniência do catálogo de teste da futura fonte operacional. RV-D1-M-03: elementos das definições iniciais não estão congelados, sem alterar o catálogo vivo.
- Não executado: instalação limpa (sem dependências novas); persistência RBAC (D2 inexistente e não autorizada).

Detalhe completo em [tasks/E1.07-D1-M.md](tasks/E1.07-D1-M.md).

### E1.07-D1 (contratos de autorização RBAC), 2026-11-17

Executado nesta sessão, com Node.js 24.22.3 e pnpm 9.15.9, na branch `feat/e107-d1-authorization-contracts` (a partir de `5db43c2`):

- Linha de base em `main` antes de alterar código: `pnpm.cmd check` 626/626 (15 ficheiros), 12/12; a PD-57 não ocorreu.
- `pnpm.cmd lint`, `typecheck`, `test` (**682/682**, 17 ficheiros), `build` (12/12) e `check` (682/682, 12/12): aprovados. Os 626 anteriores mantêm-se (nenhum ficheiro de teste anterior alterado); 56 novos (`authorization-contracts` 33, `authorization-evaluation` 23); 0 ignorados.
- Suite sem os 13 directórios de build: 682/682. Desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK` (Electron 45.3.2); `git diff --check` sem erros.
- Migrações 1–5 inalteradas (versões e SHA-256, D60); sem alterações em `packages/database`, `services` e `apps`.
- Mutações: **14/14 detectadas** (M1–M8 e variantes), ficheiros repostos com SHA-256 confirmado. M3b exigiu reforçar o D47 (sem alterar código de produção).
- `pnpm audit`: 1 moderada (PD-19); `--prod`: 0. Sem dependências novas.
- Não executado: instalação limpa (sem dependências novas); a PD-57 não ocorreu.

Detalhe completo em [tasks/E1.07-D1.md](tasks/E1.07-D1.md).

### Encerramento de E1.07-X-M (integração em `main`), 2026-11-17

Executado nesta sessão, com Node.js 24.22.3 e pnpm 9.15.9, sobre o merge `1872bdf` na `main` local, antes do *push* (a árvore é idêntica à de `92b2cce`):

- `pnpm.cmd check`: **uma falha intermitente na primeira execução** (625/626). Todas as afirmações do X31 passaram; falhou o `afterEach`: `rmSync` com `ENOTEMPTY` sobre a pasta temporária do teste, logo após a saída dos processos filho. Momentos depois, a pasta estava vazia, e foi removida pelo caminho literal com `fs.rmSync` (remoção verificada). Registado como PD-57.
- `pnpm.cmd check` repetido duas vezes: **626/626** (15 ficheiros) e **12/12 builds** em ambas. `tests/database-exclusivity.test.ts` sozinho, cinco vezes: 29/29 em todas. Depois das alterações documentais do encerramento, `pnpm.cmd check` voltou a dar 626/626 e 12/12. Em suma, houve 1 falha de limpeza em 9 execuções do X31, sem nenhuma pasta `kil-business-*` deixada em `TEMP`.
- `pnpm.cmd --filter @kil-business/desktop test`: 6/6. `pnpm.cmd --filter @kil-business/desktop smoke`: `KIL_ELECTRON_SMOKE_OK` (Electron 45.3.2). `git diff --check 030b101 1872bdf`: sem erros.
- `pnpm.cmd audit`: 1 moderada (`minimatch`, PD-19, inalterada); `pnpm.cmd audit --prod`: 0.
- Aceite dos relatórios anteriores, não repetido aqui: os ensaios multiprocesso próprios, os aliases, o backup e as mutações de E1.07-X-M; a suite sem `dist` e a instalação limpa de E1.07-X.

### E1.07-X-M (revisão independente da exclusividade), 2026-11-16

Executado nesta revisão, com Node.js 24.22.3 e pnpm 9.15.9, sobre `cfd11fe` (local = remoto; `main` = `030b101`):

- `pnpm.cmd check` (626/626, 15 ficheiros; 12/12 builds), `lint`, `typecheck`, `test` e `build` aprovados; 0 ignorados e 0 focados. Desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK` (Electron 45.3.2); `git diff --check` sem erros; `migrations.ts` igual ao de `030b101` (mesmo blob), somas 1–5 confirmadas nas bases dos ensaios.
- Ensaios multiprocesso próprios com o código compilado e o ponto de entrada real, com barreira IPC: 12 cenários da secção 4 aprovados; nunca dois `READY` (20 rondas concorrentes). Aliases recusados pelo próprio SO, incluindo `\\?\`, `\\localhost\C$`, *hard link* e ligação simbólica de ficheiro.
- Mutações repetidas de forma independente (executor próprio, `TEMP` isolado, SHA-256 confirmado na reposição): ver [tasks/E1.07-X-M.md](tasks/E1.07-X-M.md#mutações-secção-10).
- `pnpm audit`: 1 moderado (PD-19); `--prod`: 0. Sem dependências novas.
- Ressalvas não bloqueantes: RM-01 a RM-07 (precisões documentais D-135 a D-138; PD-55 e PD-56 novas; PD-53 com dados novos).
- Não executado: Ctrl+C real de consola (PD-54); unidades mapeadas, pastas sincronizadas e sistemas além de NTFS (PD-52); nomes 8.3 (indisponíveis no volume); troca concorrente de *junctions* entre a validação e a abertura; instalação limpa (não repetida, demonstrada pelo autor).

### E1.07-X (exclusividade do serviço por base), 2026-11-16

Node.js 24.22.3 e pnpm 9.15.9, na branch `feat/e107-x-database-exclusivity` (a partir de `030b101`):

- `pnpm.cmd lint`, `typecheck`, `test` (**626/626**, 15 ficheiros), `build` (12/12) e `check` (626/626, 12/12): aprovados. Os 597 testes anteriores estão presentes; 29 novos (`tests/database-exclusivity.test.ts`); 0 ignorados. Desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK`; `git diff --check` sem erros.
- Processos reais (X30–X41), todos aprovados: segundo serviço recusado sem alterar a base (SHA-256) nem as sessões; arranques simultâneos (base nova, existente, migrações pendentes com `apply` e estritas) com exactamente um proprietário; SIGKILL, SIGINT e falha inesperada seguidos de recuperação íntegra; bases independentes; aliases recusados; espera limitada; sem servidores de rede ou IPC.
- Reprodução prévia da PD-43 com processos reais sobre o código de `030b101`: os dois serviços atingiam `READY` e o segundo revogava a sessão do primeiro.
- Mutações: 16/16 detectadas (MX1–MX14, MX1b e O3), depois do reforço de X08 e X17; ficheiros repostos com SHA-256 confirmado.
- Suite sem `dist` (cópia limpa, antes de qualquer build): 626/626. Instalação limpa com `--frozen-lockfile` num directório externo: 390 pacotes reutilizados do *store*, 0 descarregados; `pnpm check` 626/626 e 12/12.
- `pnpm audit`: 1 moderado (PD-19); `--prod`: 0. Sem dependências novas.
- Não executado: Ctrl+C real de consola (PD-54); unidades de rede mapeadas e sistemas além de NTFS (PD-52); suspensão real (PD-50).

Detalhe completo em [tasks/E1.07-X.md](tasks/E1.07-X.md).

### E1.07-C-R2 (revisão independente final das sessões), 2026-11-16

Executado nesta revisão, com Node.js 24.22.3 e pnpm 9.15.9, sobre `d5f077e` (local = remoto):

- `pnpm.cmd lint`, `typecheck`, `test` (**597/597**, 14 ficheiros), `build` (12/12) e `check` (597/597, 12/12): aprovados. Os 578 testes de `0eb1e75` estão todos presentes, com as mesmas contagens nos 13 ficheiros anteriores; 19 novos; 0 ignorados; sem `.only`/`.skip`/`.todo`.
- 597/597 com os 13 directórios de build retirados. Desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK`; `git diff --check` sem erros.
- Relógio sobre o código compilado: 26/26 (salto de 30 dias e correcção, comprovativo 60/61 s, inactividade, expiração absoluta, actividade depois da expiração, saltos repetidos, leituras de alta frequência, reinício e novo serviço iniciado adiantado).
- Triggers sobre o código compilado: 79/79; 60 escritas directas recusadas sem efeitos (15 ataques × 4 combinações de `foreign_keys`/`recursive_triggers`); caminhos legítimos e *rollback* confirmados.
- Retenção: 7/7. Migração real com código compilado de `ab22404` e `0eb1e75`, verificada com o da cabeça: 30/30 (1–3 → 5) e 33/33 (1–4 → 5).
- Mutações repetidas: 22, das quais 21 detectadas (R4, R5, R6, R9, nove regressões de E1.07-C-R1, M1, M2a, M3a, M4a e cinco próprias); não detectada: a própria O3 (PD-51). Todos os ficheiros repostos (blobs iguais a `HEAD`).
- `pnpm audit`: 1 moderado (PD-19); `--prod`: 0.
- Não executado: suspensão real (PD-50); dois processos (PD-43).

Detalhe completo em [tasks/E1.07-C-R2.md](tasks/E1.07-C-R2.md).

### E1.07-C-R1 (correcções das sessões), 2026-11-16

Node.js 24.22.3 e pnpm 9.15.9, na branch `feat/e107-c-secure-sessions`, sobre `e19ef76`:

- `pnpm.cmd lint`, `typecheck`, `test` (**597/597**, 14 ficheiros), `build` (12/12) e `check`: aprovados. Os 578 testes anteriores mantêm-se (13 ficheiros com as mesmas contagens; todos os nomes presentes); 19 novos; ajustes fundamentados em K01, S49, S52 e S53.
- 597/597 também com os 13 directórios de build retirados. Desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK`; `git diff --check` sem erros.
- Instalação limpa num directório externo (`--frozen-lockfile`, pacotes reutilizados do *store*): `pnpm check` 597/597, 12/12.
- Mutações: **31/31 detectadas** (9 da implementação, 9 da revisão, incluindo R4, R5, R6 e R9, e 13 regressões de E1.07-C-R1), todas repostas com SHA-256 confirmado.
- Migração real a partir de bases criadas pelo código compilado de `ab22404` (E1.07-B) e de `0eb1e75` (E1.07-C), verificada com o código compilado desta tarefa: **65/65**.
- Reprodução RV-01 da revisão sobre o código compilado: **8/8** (antes 5/8).
- `pnpm audit`: 1 moderado (PD-19); `--prod`: 0. Nenhuma dependência alterada.
- Não executado: suspensão real do computador (PD-50); ensaio com dois processos (PD-43, E1.07-X).

Detalhe completo em [tasks/E1.07-C-R1.md](tasks/E1.07-C-R1.md).

### E1.07-C-M (revisão independente das sessões), 2026-11-16

Node.js 24.22.3 e pnpm 9.15.9, sobre a cabeça `0eb1e75` (local = remoto), contra `main` = `ab22404`:

- `pnpm.cmd lint`, `typecheck`, `test` (**578/578**, 14 ficheiros), `build` (12/12) e `check`: aprovados. Os 13 ficheiros anteriores mantêm as contagens da base (516/516 executados no código de `ab22404`); 62 novos; sem `skip`/`todo`.
- 578/578 também com os 13 directórios de build retirados. Desktop 6/6; smoke `KIL_ELECTRON_SMOKE_OK`; `git diff --check` sem erros.
- Mutações: as 9 variantes declaradas detectadas pelos mesmos testes; 9 mutações próprias, 5 detectadas (R4, R5, R6 e R9 não; RV-05, PD-48). Todos os ficheiros repostos (blobs iguais a `HEAD`).
- **Migração real** independente de uma base criada pelo código compilado de `ab22404`: **25/25**.
- Triggers: 37/38 verificações; `INSERT OR REPLACE` repõe a versão da credencial (RV-03, PD-46).
- Ensaio com dois processos sobre a mesma base temporária: 19/19 observações; ambos atingem `READY` e revogam as sessões um do outro (RV-02, PD-43).
- **Defeito Alto reproduzido** (RV-01, PD-45): relógio efectivo congelado após avanço e retrocesso do relógio de parede; uma sessão sem actividade há 22 dias reais continua válida.
- `pnpm audit`: 1 moderado (PD-19); `--prod`: 0. Nenhuma dependência alterada.

Detalhe completo em [tasks/E1.07-C-M.md](tasks/E1.07-C-M.md).

### E1.07-C (sessões locais), 2026-11-16

Node.js 24.22.3, pnpm 9.15.9, Electron 45.3.2, Vitest 5.1.0 e `better-sqlite3` 12.11.1 (SQLite 3.53.2), na branch `feat/e107-c-secure-sessions`:

- `pnpm.cmd lint`, `typecheck`, `build` (12/12) e `check`: aprovados.
- `pnpm.cmd test`: 14 ficheiros, **578/578**, sem testes ignorados nem `todo`.
  - Os 516 anteriores mantêm as contagens por ficheiro. Um teste de `local-authentication` passou a migrar explicitamente até ao esquema E1.07-B.
  - Novos: `local-sessions` 62 (S01–S58, P01–P03, K01), com a correspondência aos 58 testes obrigatórios em [tasks/E1.07-C.md](tasks/E1.07-C.md#correspondência-com-os-testes-obrigatórios).
- Os 578 testes passam também com os 13 directórios de build retirados.
- Testes do desktop: 6/6. Smoke Electron: `KIL_ELECTRON_SMOKE_OK`. `git diff --check`: sem erros.
- Mutações (seis defeitos exigidos, nove variantes): todas detectadas individualmente e repostas com SHA-256 idêntico.
- **Migração real** de uma base E1.07-B criada pelo código compilado de `ab22404`, verificada com o código compilado desta branch (25/25):
  - recusa estrita sem alterar o ficheiro;
  - aplicação só da migração 4;
  - dados, credenciais e checksums 1–3 preservados;
  - autenticação, recálculo de parâmetros com nova versão da credencial, sessões, revogação e reinício.
- Sem portas de rede (S58). Nenhuma dependência alterada. `pnpm audit`: 1 moderado (PD-19); `--prod`: 0.

Detalhe completo em [tasks/E1.07-C.md](tasks/E1.07-C.md).

### E1.07-B-M (revisão de segurança), 2026-11-16

Node.js 24.22.3, pnpm 9.15.9, Electron 45.3.2, Vitest 5.1.0 e `better-sqlite3` 12.11.1. A revisão de produção foi feita sobre `main` = `8e77091` (árvore igual a `f443057`); a integração dos testes foi revalidada sobre `main` = `581699a`:

- `pnpm.cmd lint`, `typecheck`, `test`, `build` (12/12) e `check`: aprovados, com **514/514**, também sem os 13 directórios de build.
- Testes do desktop: 6/6. Smoke Electron: `KIL_ELECTRON_SMOKE_OK`. `git diff --check`: sem erros. Sem `.only`, `.skip` nem `.todo`.
- Argon2id: o vector de teste do RFC 9106 §5.3 foi confirmado no runtime. A API é estável na v24.22.3 (era *release candidate* na v24.7.0).
- **Mutações:** retirar a revalidação do estado (M1) ou do *hash* da credencial (M2) na confirmação deixava os 514 testes verdes (RV-01, PD-37).
  - Corrigido em `0b6587e` com dois testes de regressão: 516/516 e cada mutação detectada; integrado pelo PR #5 no merge `581699a`. PD-37 encerrada.
- **Negação de serviço reproduzida:** 100 falhas com usernames arbitrários suspendem as autenticações de toda a instalação até 5 min, de forma renovável (PD-35).
- **Migração real independente** de uma base criada pelo código compilado de `a44c494`:
  - recusa estrita sem alterar a base;
  - aplicação só da migração 3;
  - 20/20 verificações (dados, checksums, esquema, FK, autenticação, inicialização sem promoção, registos sem segredos).
- Nenhuma dependência alterada. `pnpm audit`: 1 moderado (PD-19); `--prod`: 0.

Detalhe completo em [tasks/E1.07-B-M.md](tasks/E1.07-B-M.md).

### E1.07-B (autenticação local), 2026-11-16

Node.js 24.22.3, pnpm 9.15.9, Electron 45.3.2, Vitest 5.1.0 e `better-sqlite3` 12.11.1, na branch `feat/e107-b-local-authentication`:

- `pnpm.cmd lint`, `typecheck`, `build` (12/12) e `check`: aprovados.
- `pnpm.cmd test`: 13 ficheiros, **514/514**, sem testes ignorados nem `todo`.
  - Os 439 anteriores mantêm as contagens por ficheiro. Quatro testes de `identity-persistence` passaram a derivar as versões de `MIGRATIONS`.
  - Novos: `password-policy` 19, `password-hashing` 15 e `local-authentication` 41.
- Os 514 testes passam também com os 12 `dist/` retirados.
- Testes do desktop: 6/6. Smoke Electron real: `KIL_ELECTRON_SMOKE_OK`.
- Cinco mutações detectadas e repostas com SHA-256 idêntico:
  - palavra-passe errada aceite;
  - identidade suspensa elegível;
  - inicialização repetível (duas variantes);
  - limitação desactivada.
- **Desempenho** (i7-10510U, Argon2id m = 64 MiB, t = 3, p = 4): ~330 ms por verificação, e 16 verificações em simultâneo em ~3,8 s, com um pico de ~130 MiB graças ao limite de 2 derivações.
- **Migração real** de uma base E1.07-A criada pelo código compilado de `a44c494`:
  - recusa com política estrita;
  - aplicação só da migração 3;
  - checksums 1 e 2 e todas as linhas preservados;
  - credencial, autenticação e inicialização com o código compilado desta branch.
- Nenhuma dependência alterada. `pnpm audit`: 1 moderado (PD-19); `--prod`: 0.

Detalhe completo em [tasks/E1.07-B.md](tasks/E1.07-B.md).

### E1.07-A (identidade e associações), 2026-11-15

Node.js 24.22.3, pnpm 9.15.9, Electron 45.3.2, Vitest 5.1.0 e `better-sqlite3` 12.11.1, na branch `feat/e107-a-user-identity`:

- `pnpm.cmd lint`, `typecheck`, `build` (12/12) e `check`: aprovados.
- `pnpm.cmd test`: 10 ficheiros, **439/439**, sem testes ignorados nem `todo`.
  - Os 281 anteriores mantêm as contagens por ficheiro. Oito foram ajustados para derivar as versões de `MIGRATIONS`, sem reduzir as asserções (lista em [tasks/E1.07-A.md](tasks/E1.07-A.md#testes-anteriores-281)).
  - Novos: `identity-contracts` 73, `identity-isolation` 60 (SQLite e serviço) e `identity-persistence` 25.
- Os 439 testes passam também com os 12 `dist/` retirados.
- Testes do desktop: 6/6. Smoke Electron real: `KIL_ELECTRON_SMOKE_OK`.
- Mutações controladas, todas detectadas e repostas com SHA-256 idêntico:
  - filtro de tenant nas associações;
  - estabelecimento de outro tenant (no repositório e na FK);
  - associação empresarial e local `INACTIVE` ignoradas.
- **Migração real** de uma base E1.04 criada pelo código compilado da `main` anterior, com dados fictícios:
  - o serviço desta branch recusou com política estrita;
  - aplicou só a migração 2 com `apply`, e a reexecução não aplicou nada;
  - checksum da migração 1 e linhas de empresas e estabelecimentos idênticos;
  - identidade e associação provisionadas sobre a empresa antiga.
- Nenhuma dependência alterada (`package.json` e `pnpm-lock.yaml` intactos).

Detalhe completo em [tasks/E1.07-A.md](tasks/E1.07-A.md).

### E1.06-S2 (Vitest 5.1.0), 2026-11-15

Node.js 24.22.3, pnpm 9.15.9, Vitest 5.1.0 e Vite 6.4.6, na branch `chore/e106-s2-vitest-security`:

- `pnpm.cmd lint`, `typecheck`, `build` (12/12) e `check`: aprovados.
- `pnpm.cmd test`: 7 ficheiros, **281/281**, com a mesma distribuição por ficheiro indicada abaixo. Sem testes ignorados nem `todo`.
- Os 281 testes passam também com os `dist/` dos pacotes retirados (D-078).
- Testes do desktop: 6/6 via `--filter`, `test:desktop` e dentro de `apps/desktop`. `pnpm test tenant domain-contracts sqlite`: 222/222. `pnpm test local-service`: 52/52.
- Smoke Electron real: `KIL_ELECTRON_RUNTIME electron=45.3.2 chromium=156.0.8078.100 node=24.22.2` e `KIL_ELECTRON_SMOKE_OK`.
- Quatro mutações controladas, todas detectadas e revertidas: filtro de tenant, duas violações do ciclo de vida e `sandbox: false`.
- Instalação limpa externa:
  - `pnpm install --frozen-lockfile` com *store*, cache npm e cache Electron novos: 390 pacotes descarregados, 0 reutilizados;
  - `better-sqlite3` com binário pré-compilado (ABI 137), sem `node-gyp`;
  - testes antes de qualquer build (281/281), `typecheck`, `build`, `check`, desktop 6/6 e smoke aprovados.
- **Auditoria** (`pnpm audit`):
  - desenvolvimento: 16 → **1** (0 críticos, 0 altos, 1 moderado, 0 baixos);
  - Vitest, Vite interno, `esbuild` e `tinypool`: 15 → 0;
  - restante: `minimatch` via typescript-eslint (PD-19);
  - produção: 0.

Detalhe completo em [tasks/E1.06-S2.md](tasks/E1.06-S2.md).

### E1.06-S1 (Vitest 2.1.9)

Executada inicialmente em 2026-11-14, repetida durante a revisão e novamente após o merge em 2026-11-15, com Node.js 24.22.3 e pnpm 9.15.9:

- `pnpm.cmd lint` e `pnpm.cmd typecheck`: sem erros.
- `pnpm.cmd test`: 7 ficheiros, **281 testes aprovados**:
  - `foundation` 1, `desktop-security` 4, `desktop-ui` 2;
  - `domain-contracts` 56;
  - `tenant-isolation` 132;
  - `sqlite-persistence` 34;
  - `local-service` 52.
- `pnpm.cmd build`: 12 de 12 projectos.
- `pnpm.cmd check`: código de saída 0.
- `pnpm.cmd --filter @kil-business/desktop test`: 6/6 aprovados.
- `pnpm.cmd --filter @kil-business/desktop smoke`: código 0, `KIL_ELECTRON_RUNTIME electron=45.3.2 chromium=156.0.8078.100 node=24.22.2` e `KIL_ELECTRON_SMOKE_OK`. O teste percorreu as oito áreas e verificou preload, API mínima e isolamento do renderer.
- Sete arranques/encerramentos do Electron terminaram com código 0, incluindo a cópia limpa; a mensagem GPU da PD-13 não ocorreu.
- **Instalação limpa** numa cópia temporária externa, a partir dos ficheiros versionáveis e não ignorados:
  - `pnpm install --frozen-lockfile` com *store*, cache npm e cache Electron novos: 407 pacotes descarregados, 0 reutilizados;
  - `better-sqlite3` usou o binário pré-compilado, sem `node-gyp`;
  - `pnpm check` (281 testes, 12/12), testes do desktop (6/6) e smoke Electron real aprovados.
- **SQLite real e código compilado** (Node puro):
  - o serviço `dist/main.js --check` criou a base, aplicou a migração 1 e voltou a abri-la com a política estrita;
  - o pacote `database` compilado executou migrações e uma transacção com ABI 137.
- **Ctrl+C numa consola real**: um `CTRL_C_EVENT` enviado por `GenerateConsoleCtrlEvent` produziu `SIGINT`, `READY→STOPPING→STOPPED`, código 0 e nenhum `-wal` residual (detalhe e ressalva em [tasks/E1.06.md](tasks/E1.06.md)).
- **Auditoria** (`pnpm audit`):
  - produção: 0 alertas;
  - desenvolvimento: 16 alertas (3 críticos, 1 alto, 11 moderados, 1 baixo), apenas via Vitest 2 e typescript-eslint (PD-18, PD-19);
  - Electron: 46 → 0; `extract-zip` antigo: 2 altos → 0.
- **Não verificado**: `pnpm --filter @kil-business/desktop dev` (processo interactivo de longa duração).

## Comandos

Requisitos: Node.js 24.22.3 (`.node-version`) e pnpm 9.15.9. Em PowerShell, usar `pnpm.cmd` se a política de execução bloquear `pnpm.ps1`.

| Objectivo | Comando | Origem |
| --- | --- | --- |
| Instalar dependências (reprodutível) | `pnpm install --frozen-lockfile` | raiz |
| Validação completa | `pnpm check` (lint → typecheck → test → build) | `package.json` |
| Lint | `pnpm lint` | `package.json` |
| Typecheck global | `pnpm typecheck` | `package.json` |
| Testes | `pnpm test` | `package.json` |
| Testes do desktop | `pnpm test:desktop` ou `pnpm --filter @kil-business/desktop test` | `package.json`, `apps/desktop/package.json` |
| Testes multiempresa e SQLite | `pnpm test tenant domain-contracts sqlite` | `package.json` (filtro do Vitest) |
| Testes do serviço local | `pnpm test local-service` | `package.json` (filtro do Vitest) |
| Testes de identidades e associações | `pnpm test identity` | `package.json` (filtro do Vitest) |
| Testes de autenticação e palavras-passe | `pnpm test authentication password` | `package.json` (filtro do Vitest) |
| Testes de sessões locais (E1.07-C) | `pnpm test local-sessions` | `package.json` (filtro do Vitest) |
| Testes da exclusividade por base, incluindo processos reais (E1.07-X) | `pnpm test database-exclusivity` | `package.json` (filtro do Vitest) |
| Testes dos contratos e regras puras de autorização (E1.07-D1) | `pnpm test authorization` | `package.json` (filtro do Vitest) |
| Testes da imutabilidade dos contratos de domínio (E1.07-D1-H) | `pnpm test domain-immutability` | `package.json` (filtro do Vitest) |
| Testes do isolamento da política fiscal (E1.07-D1-H-R1) | `pnpm test tax-id-policy-isolation` | `package.json` (filtro do Vitest) |
| Testes em modo observação | `pnpm test:watch` | `package.json` |
| Auditoria de dependências | `pnpm audit` e `pnpm audit --prod` | pnpm |
| Build de todos os projectos | `pnpm build` | `package.json` |
| Build do serviço local | `pnpm --filter @kil-business/local-api build` | `services/local-api/package.json` |
| Verificar arranque do serviço | `pnpm --filter @kil-business/local-api start:check` | `services/local-api/package.json` |
| Iniciar o serviço (encerrar com Ctrl+C) | `pnpm --filter @kil-business/local-api start` | `services/local-api/package.json` |
| Desktop em desenvolvimento | `pnpm --filter @kil-business/desktop dev` | `apps/desktop/package.json` |
| Build do desktop | `pnpm --filter @kil-business/desktop build` | `apps/desktop/package.json` |
| Smoke test do Electron | `pnpm --filter @kil-business/desktop smoke` | `apps/desktop/package.json` |
| Typecheck do desktop | `pnpm --filter @kil-business/desktop typecheck` | `apps/desktop/package.json` |
| Portal administrativo | `pnpm --filter @kil-business/admin-portal dev` | `apps/admin-portal/package.json` |

O serviço local exige as variáveis `LOCAL_DATABASE_PATH` e `LOCAL_SERVICE_*` no ambiente do processo; nenhum ficheiro `.env` é carregado. A tabela de variáveis está em [architecture.md](architecture.md#serviço-local-e105) e um exemplo em PowerShell em [tasks/E1.05.md](tasks/E1.05.md#comandos-do-serviço).

Notas sobre o arranque do Electron:

- `dev` inicia o Vite em `http://127.0.0.1:5173` (porta fixa, `--strictPort`), compila o processo principal e o preload, aguarda a porta e arranca o Electron com `VITE_DEV_SERVER_URL`.
- Não existe script `start` no desktop. Fora do modo `dev`, o arranque é feito por `apps/desktop/scripts/run-electron.mjs` sobre o resultado do `build`, que é o mecanismo usado pelo `smoke`.
- O Electron usa o seu próprio runtime (Electron 45.3.2, Chromium 156.0.8078.100 e Node 24.22.2), independente do Node 24.22.3 dos serviços e ferramentas.

## Funcionalidades

### Implementadas

- Monorepositório pnpm com 12 projectos, TypeScript estrito, ESLint 10 com verificação de tipos e Vitest 5.1.0. Os pacotes do workspace resolvem a partir de `src/` em typecheck, lint e testes, e a partir de `dist/` em execução.
- Processo principal Electron suportado, com renderer isolado, CSP, permissões negadas, navegação/janelas/`webview` bloqueados e preload mínimo e imutável; modo de smoke test real ampliado.
- Navegação funcional entre 8 áreas da interface desktop (estado React em memória).
- Contratos de domínio multiempresa (`packages/shared-types`).
- Persistência SQLite local (`packages/database`).
- Serviço local Node.js (`services/local-api`), independente do Electron, sem HTTP.
- Identidades locais (`User`), associações a empresas (`CompanyMembership`) e a estabelecimentos (`BranchMembership`), migração 2 e avaliação interna de elegibilidade (E1.07-A). Disponíveis apenas na composição interna do serviço local.
- Autenticação local offline por username e palavra-passe (E1.07-B):
  - credenciais Argon2id (migração 3);
  - política NIST SP 800-63B;
  - limitação persistente de tentativas;
  - gestão interna de credenciais;
  - inicialização explícita da instalação.

  Sem permissões. Disponível apenas na composição interna do serviço local.
- Sessões locais revogáveis (E1.07-C e E1.07-C-R1, integradas pelo PR #6):
  - comprovativo interno de autenticação;
  - versões de segurança (migração 4);
  - tokens opacos;
  - expiração por inactividade e absoluta, limite de 5 sessões, logout, revogação e limpeza.

  Sem permissões nem tenant. Disponível apenas na composição interna do serviço local.
- Exclusividade do serviço local por base SQLite (E1.07-X, integrada pelo PR #7, merge `1872bdf`): bloqueio exclusivo do SQLite comprovado antes de qualquer leitura ou escrita, identificação canónica da base e recusa `database-locked`.
- Contratos de autorização em `packages/shared-types` (PR #8, corrigidos por E1.07-D1-R1 no PR #9 e aprovados por E1.07-D1-R2): autoridades, `PermissionCode`, catálogo inicial de 24 permissões com proveniência, perfis, concessões, atribuições, decisões reconhecidas por registo privado e regras puras de avaliação, interfaces dos repositórios. **Não operacionais**: sem persistência, sem ligação ao serviço e sem emissão de `TenantContext`.
- Imutabilidade em execução das listas de valores, limites e regras de validação dos restantes módulos (E1.07-D1-H, D-171; correcção fiscal D-176, aprovada em D-178).
- Persistência RBAC de E1.07-D2 (integrada pelo PR #13 antes da revisão; E1.07-D2-M: GO com ressalvas): migração 6 e repositórios RBAC SQLite (perfis, concessões, atribuições), diagnóstico de concessões não reconhecidas (PD-61) e motor interno de avaliação de domínio sobre factos persistidos, só em `LocalService.internalAuthorization`. **Não operacional**: sem HTTP, IPC nem `TenantContext` autenticado. Integridade SQLite da migração 7 (E1.07-D2-R1/R3, revista em E1.07-D2-R4 com GO e integrada pelo PR #15, merge `dc5b046`): recusa de substituição por `rowid`, ligações imutáveis, associações empresariais nunca eliminadas, `rowid` não positivo recusado e `installation_bootstrap` imutável, em qualquer configuração de `foreign_keys`/`recursive_triggers`. PD-69 a PD-72 e PD-74 encerradas (D-204). Abertas: PD-73/PD-75 (Gate D3) e PD-76 (pré-verificação de `rowid` legados antes de migrar bases existentes).
- **Só na branch `feat/e107-d3-g0-installation-authority` (E1.07-D3-G0, a rever):** migração 8 (identidades e associações locais nunca eliminadas, tomada de `username` recusada, `users.created_at` imutável); âncora da instalação (`installation.verifyAnchor()`, recusa fechada); estado e credencial (criação e substituição, com ou sem credencial existente — E1.07-D3-G0-R1) do administrador inicial recusados pelo provisionamento interno; pré-verificação de `rowid` legados no arranque do serviço (`legacy-rowid-incompatible`). **Nenhuma autoridade da instalação é concedida nem avaliada** (PD-77).

### Demonstrativas, sem dados nem regras de negócio

- Dashboard com indicadores fixos, barra de contexto com textos fixos (incluindo “Sistema local disponível”), perfil, pesquisa e notificações apenas visuais.
- Páginas de módulos com estado vazio; ainda não usam os contratos, a persistência nem o serviço local.
- Portal administrativo estático.
- Duplo de teste em memória (`tests/support/in-memory-tenant-repositories.ts`): serve apenas para testes e não é persistência.

### Ainda não desenvolvidas

- Implementação das decisões de domínio D-055, D-058, D-060 e D-061 (PD-14 a PD-16).
- Autorização RBAC efectiva (administração e integração: E1.07-D3 e E1.07-D4; a persistência de E1.07-D2 está por rever), protecção avançada de contas e auditoria (E1.07-E, E1.07-F); ferramenta operacional de inicialização (PD-31); API local e integração Electron (E1.08), incluindo o transporte da sessão (PD-42).
- Serviços centrais e PostgreSQL (E1.09); instalação, serviço Windows, cópias de segurança e Gate E1 (E1.10).
- Regra de validação do NIF para qualquer jurisdição real (PD-09).
- Modos de implantação B e C, sincronização e funcionamento offline entre estabelecimentos.
- Grupos empresariais, módulos sectoriais, vendas, POS, facturação, stock, contabilidade e fiscalidade.
- Integração de licenciamento (apenas a interface `LicenseProvider`) e KIL Business Monitor.

## Pendências e divergências

| ID | Descrição | Impacto | Estado |
| --- | --- | --- | --- |
| PD-01 | `pnpm --filter @kil-business/desktop test` não encontrava testes. | — | Resolvida em E1.03 (D-022). |
| PD-02 | Os quatro sectores não estavam identificados. | — | Resolvida em E1.03 (D-018). |
| PD-03 | Variáveis de `.env.example` sem leitura no código. As do serviço local são lidas desde E1.05; `LOCAL_API_*`, `CENTRAL_*`, `SYNC_*`, `KIL_LICENSE_*` e `NODE_ENV` continuam sem uso. | Apenas documental. | Parcialmente resolvida. |
| PD-04 | A interface mostra “Sistema local disponível” sem verificação real. | Pode induzir em erro fora do contexto demonstrativo. | Mantida até à integração Electron/serviço (E1.08). |
| PD-05 | O directório `.git` pertence ao utilizador `CodexSandboxOffline`. Outros utilizadores Windows recebem *dubious ownership*. | Bloqueia comandos Git noutros agentes. | Mantida. Contornada com `git -c safe.directory=C:/KIL-BUSINESS`, sem alterar permissões globais. |
| PD-06 | O plano de etapas posteriores não constava do repositório. | — | **Resolvida em E1.06** para a fase E1 (E1.07–E1.10 planeadas). O planeamento após o Gate E1 está por definir. |
| PD-07 | Escolhas de concretização de E1.03. | — | Resolvida em E1.04. |
| PD-08 | Consumo de pacotes do workspace através de `dist/`. | — | Resolvida em E1.04 (D-037). |
| PD-09 | Validação fiscal angolana por consolidar: nenhuma regra de NIF está configurada para uma jurisdição real. Com a política fail-closed (D-030), nenhuma empresa fica `ACTIVE` fora dos testes. | Bloqueia empresas activas reais. | **Aberta.** Requer fonte normativa, versão e vigência. |
| PD-10 | Compilação nativa do driver SQLite. | — | **Resolvida em E1.06** para Windows x64 com Node 24: binário pré-compilado `node-v137-win32-x64` obtido numa instalação limpa (caches vazias), sem compilação local (D-070). Outras plataformas ou versões de Node exigem nova verificação. |
| PD-11 | Decisões de domínio por confirmar. | — | **Encerrada em E1.06** (D-052 a D-061). A implementação em falta está em PD-14 a PD-16. |
| PD-12 | Node 20 fora de suporte desde 2026-04-30. | — | **Resolvida em E1.06** (D-069): migração efectiva para o Node 24.22.3 e validação completa executada nesta versão. |
| PD-13 | Mensagens GPU ocasionais no encerramento do Electron 33 (`GPU state invalid after WaitForGetOffsetInRange`). | Ruído de log do Chromium; não afectou o código de saída. | Em observação: não ocorreu em sete execuções do Electron 45.3.2, incluindo uma instalação/cache limpa. Por ser ocasional, não se declara eliminada definitivamente. |
| PD-14 | Implementar D-055: preservar o NIF em `SUSPENDED`/`INACTIVE` nas empresas anteriormente activadas. Hoje o NIF só é exigido em `ACTIVE` (contrato e `CHECK` SQLite). | Uma empresa activada pode perder o NIF ao mudar de estado. | Aberta; exige registo da activação ou regras de transição (PD-16). |
| PD-15 | Implementar D-058: unicidade do NIF por jurisdição e entidade jurídica após normalização. | NIF duplicados possíveis. | Aberta; depende da normalização fiscal (PD-09). |
| PD-16 | Implementar D-060 e D-061: histórico de alterações e tabela explícita de transições de estado das empresas. | Transições livres; sem histórico. | Aberta. |
| PD-17 | Electron 33.4.11 fora de suporte e 48 alertas na cadeia do runtime. | Segurança do desktop distribuído. | **Resolvida em E1.06-S1** (D-075, D-076): Electron 45.3.2 suportado; 0 alertas do Electron/`extract-zip`; smoke e instalação limpa aprovados. |
| PD-18 | Vitest 2.1.9 (só desenvolvimento): 3 alertas críticos (servidor UI do Vitest e `tinypool`) e outros via Vite 5 interno e `@vitest/mocker`. Não eram exploráveis no uso actual (sem servidor UI, sem entradas não confiáveis). | — | **Resolvida em E1.06-S2** (D-077, D-078): Vitest 5.1.0; os 15 alertas do Vitest, do Vite 5.4.21 interno, do `esbuild` 0.21.5 e do `tinypool` foram eliminados (15 → 0), com 281/281 testes e instalação limpa aprovados. **Encerrada** após a confirmação da integração em `main` (PR #2, `d29a629`) e a revalidação em E1.06-S2-M. |
| PD-19 | `minimatch` 10.2.6 (moderado, ReDoS, `GHSA-g3hv-75wg-m249`; corrigido em ≥ 11.0.1) via typescript-eslint 8.72.2. | Só desenvolvimento (lint). | Aberta. Reverificada em E1.06-S2: a 8.72.2 continua a ser a `latest` e declara `minimatch ^10.2.2`. Aguarda correcção a montante; sem *override*. Por D-079 (decisão do responsável em E1.06-S2-M), não bloqueia por si só a E1.07, desde que a avaliação de risco se mantenha documentada: só lint de desenvolvimento, padrões definidos pelo projecto, fora do runtime distribuído, `audit --prod` com 0. |
| PD-20 | pnpm 9.15.9 é uma linha antiga (última 12.18.0). O pnpm 10 ou superior bloqueia *build scripts* por omissão (`better-sqlite3`, `electron`, `esbuild`). | Manutenção do gestor de pacotes. | Aberta; avaliação própria. |
| PD-21 | O Node 24 está em *Maintenance* LTS (fim a 2028-04-30); o Node 26 é a *Active LTS* desde 2026-10-28. O `better-sqlite3` 12.11.1 não publica binário Windows para o Node 26. | Planeamento futuro. | Aberta; planear a migração antes do fim de suporte. |
| PD-22 | Um processo lançado por outro que ignore Ctrl+C (`SetConsoleCtrlHandler(NULL, TRUE)` herdado) não recebe `SIGINT`. Observado em E1.06 a partir de uma shell não interactiva. | Encerramento por Ctrl+C depende de quem lança o serviço. | Informativo; em instalação, o encerramento será feito pelo gestor de serviços Windows (E1.10). |
| PD-23 | Outras dependências com versões principais novas, sem alertas de segurança: React 19, Vite 8, TypeScript 7, jsdom 31, `@vitejs/plugin-react` 6, `lucide-react` 1.x, entre outras. Não foram actualizadas, por instrução. | Dívida técnica. | Informativo; lista em [tasks/E1.06.md](tasks/E1.06.md). O Vitest foi actualizado em E1.06-S2 (D-077). |
| PD-24 | O intervalo declarado do Vite (`^6.0.3` na raiz e no catálogo) admite versões abaixo do mínimo exigido pelo Vitest 5 (`>=6.4.0`). O lockfile fixa a 6.4.6, que cumpre o requisito. | Uma resolução nova fora do lockfile poderia escolher um Vite incompatível. | Aberta, de baixo impacto. Por decisão do responsável (E1.06-S2-M), a correcção do intervalo mínimo é feita numa tarefa controlada própria, e não nesta revisão. |
| PD-25 | O pnpm reporta as subdependências descontinuadas `prebuild-install` 7.1.3 (via `better-sqlite3`) e `whatwg-encoding` 3.1.1 (via jsdom 25). Já existiam no lockfile da `main` antes de E1.06-S2. | Nenhum alerta de segurança associado. | Informativo; reavaliar com futuras versões de `better-sqlite3` e jsdom (PD-23). |
| PD-26 | O provisionamento de identidades e as alterações de associações não registam o actor nem o histórico de alterações; só existem os registos com `updatedAt`. O `UserDirectory` não recebe contexto de actor. Desde E1.07-B, também não são auditados as autenticações, os bloqueios, a criação e substituição de credenciais e a inicialização da instalação, que de propósito não são escritos nos registos. Desde E1.07-C, também não são auditados a criação, expiração, revogação e encerramento de sessões (os registos do serviço só têm contagens no arranque). | Rastreabilidade administrativa e de segurança incompleta. | Aberta. Por D-098, a auditoria de autenticação, credenciais, sessões e provisionamento entra em E1.07-E. A retenção técnica das sessões (30 dias, D-115) é provisória. Por D-123, a auditoria inclui criação, expiração, revogação e encerramento de sessões. |
| PD-27 | O `TenantContext` continua a ser construído pelo chamador e não deriva de identidade autenticada (`AGENTS.md`). Os repositórios isolam correctamente, mas a origem do contexto não é verificada. | Nenhuma operação deve ser exposta antes da correcção. | Aberta; **avanço parcial em E1.07-C**: existe uma sessão confiável que comprova a identidade autenticada (D-107 a D-116), mas o `TenantContext` ainda não é derivado dela. E1.07-D1, agora integrada, só acrescenta contratos e regras puras; nenhum contexto é emitido nem derivado. Encerramento em E1.07-D4 (D-146), depois de resolver PD-62/PD-63. E1.07-D2 (integrada) e E1.07-D2-M: os repositórios RBAC e o motor interno continuam a receber ou construir o contexto sem sessão (actor `unauthenticated:internal-rbac-domain-evaluation`); nada é exposto. |
| PD-28 | Criar uma associação com um `userId` inexistente devolve `RecordNotFoundError('User')`, o que permite a um chamador interno com contexto empresarial saber se uma identidade existe na instalação. | Aceitável enquanto o provisionamento for interno. | Aberta; rever antes de qualquer exposição (E1.08, E1.07-F). **E1.07-D1** preparou a recusa por omissão, os motivos internos tipados e a resposta externa genérica sem identificadores (D-154); a resolução efectiva é de E1.07-D3/D4. Inalterada em E1.07-D2-M. |
| PD-29 | A eliminação física de um estabelecimento ou de uma empresa com associações é recusada pela base (`PersistenceError('constraint')`), não por um erro de domínio específico. Os dados ficam preservados. | Mensagem menos explícita para o chamador. | Aberta. Por D-099, é resolvida antes da exposição da API empresarial. |
| PD-30 | A identidade só admite alteração de estado; nome de apresentação, email e telefone não podem ser alterados nesta etapa, por decisão de âmbito (sem alteração arbitrária de identidades partilhadas). | Correcções de dados pessoais exigem tarefa própria. | Aberta; definir o processo autorizado e auditado (E1.07-E). |
| PD-31 | Não existe ferramenta operacional para a inicialização da instalação (D-096). A operação só existe na composição interna do serviço. Quando existir, a ferramenta tem de usar entrada interactiva protegida, sem palavras-passe em argumentos nem em ficheiros de configuração. | Instalações reais não podem ser inicializadas por um operador. Hoje a única fronteira de confiança é o acesso ao processo do serviço e as permissões do ficheiro SQLite; até à inicialização, a primeira chamada vence. | Aberta. Por D-100, implementada em E1.07-E, antes de disponibilizar login operacional. |
| PD-32 | Sem *pepper*: a NIST SP 800-63B recomenda uma derivação com chave secreta guardada separadamente da base, que não foi implementada por falta de armazenamento de segredos protegido pelo sistema operativo (por exemplo, DPAPI). | Quem obtiver a base pode tentar ataques offline, abrandados apenas pelo Argon2id. | Aberta. Por D-101, *pepper*, armazenamento externo protegido, rotação e recuperação são avaliados em E1.07-E e E1.10. |
| PD-33 | A lista local de palavras-passe comuns ou comprometidas está vazia por omissão (`EMPTY_COMMON_PASSWORD_LIST`). O mecanismo existe e é configurável (`commonPasswords`). | Palavras-passe comuns de 15 ou mais caracteres não são recusadas. | Aberta. Por D-102, uma lista local efectiva é implementada em E1.07-E (fonte, licença e actualização a definir). |
| PD-34 | Canais temporais: as recusas `throttled` e as entradas com formato inválido respondem sem derivação; credenciais com parâmetros antigos têm custo diferente até serem recalculadas; o percurso não é de tempo constante de ponta a ponta. Não revela directamente a existência de utilizadores, mas não está demonstrado por medição. | Risco residual de enumeração por tempo. | Aberta. Por D-103, avaliada no Gate E1.07-F. |
| PD-35 | Desvio da NIST na limitação: não há desactivação após 100 falhas consecutivas, porque bloqueios permanentes estão proibidos. Depois da escalada, uma conta admite até 4 tentativas por hora (bloqueio máximo de 15 min). O limite da instância (100 falhas em 5 min) pode ser usado para negação de serviço local durante até 5 min. | Equilíbrio entre força bruta e disponibilidade por decidir. Reproduzido em E1.07-B-M: 100 falhas com usernames arbitrários suspendem toda a instalação até 5 min, de forma renovável; 1 tentativa a cada 15 min mantém uma conta bloqueada. | Aberta. Por D-104, em E1.07-E: limite de falhas consecutivas e recuperação controlada da credencial. Distinguir bloqueio temporário, desactivação da credencial e da identidade, sem bloqueio irreversível. Medidas propostas em [E1.07-B-M](tasks/E1.07-B-M.md#protecção-contra-abuso-e-negação-de-serviço). Nenhum controlo é retirado. |
| PD-36 | As chaves de limitação são `user:` + SHA-256 sem chave. Como os usernames são ASCII de baixa entropia, quem tiver a base pode recuperá-los por dicionário. | Exposição de usernames (incluindo tentados e inexistentes) a quem obtiver a base. | Aberta. Por D-105, avaliar HMAC com chave externa protegida; planeado para E1.07-E. |
| PD-37 | As revalidações do estado e do *hash* da credencial na confirmação da autenticação não estavam cobertas por testes. Retirar qualquer delas deixava os 514 testes verdes (RV-01). | Uma regressão permitiria autenticar uma identidade suspensa ou uma palavra-passe antiga durante uma corrida. | **Encerrada.** Corrigida em `0b6587e`: dois testes, 516/516, cada mutação detectada; integrada em `main` pelo PR #5, merge `581699a`. |
| PD-38 | Os limites superiores dos parâmetros Argon2id são largos (m ≤ 1 GiB, t ≤ 16, p ≤ 16), em código e em `CHECK` (RV-04). | Uma credencial adulterada pode custar ~1 GiB por verificação (2 GiB em paralelo). Exige acesso de escrita à base. | Aberta; proposta: limitar, por exemplo, a 4× os parâmetros de produção, com nova migração. Etapa por decidir (proposta: E1.07-E). |
| PD-39 | Uma recusa `busy` (fila de derivações cheia) lança `PasswordHashingError` depois de a falha já ter sido contada (RV-03). | Sob carga ou ataque, um utilizador legítimo acumula falhas e recebe uma excepção em vez de um resultado. | Aberta; proposta: devolver a falha antecipada e um resultado tipado. Antes de E1.08 (proposta: E1.07-E). |
| PD-40 | Uma `AuthenticatedIdentity` continua reconhecida por `isAuthenticatedIdentity` durante toda a vida do processo, após suspensão, substituição da credencial ou reinício do serviço (RV-05). | Sem consumidores hoje. Uma sessão que a aceite sem revalidar sobreviveria à perda de elegibilidade. | **Resolvida em E1.07-C** (branch por integrar): a criação de sessões exige um comprovativo interno de 60 s, de utilização única e atómica, ligado ao arranque e às versões de segurança, com revalidação na criação e em cada utilização (D-108, D-110, D-114). Testes S01–S12, S41–S44; mutações M1, M2a, M3a e M4a detectadas. Encerramento formal após revisão e integração (D-118). A revisão E1.07-C-M confirmou o comprovativo, mas suspendeu o merge por RV-01 (PD-45). **Confirmada em E1.07-C-R2** por execução (M1, M2a, M3a e M4a detectadas; comprovativo de utilização única de 60 s) e integrada pelo PR #6: **encerrada**. |
| PD-41 | Qualquer reinício do serviço (actualização, falha, reinício do posto) termina todas as sessões (D-114). | Intencional e conservador, mas obriga a novo login em todos os postos após cada reinício. | Aberta. Por D-119, mantém-se na arquitectura actual, sem recuperação automática de sessões; disponibilidade a avaliar com os postos POS e a instalação (E1.08, E1.10). |
| PD-42 | O transporte e a guarda do token de sessão até à interface (loopback, memória do renderer, registos do Electron) não estão definidos. O token é um segredo ao portador. | Uma exposição errada permitiria usar a sessão a partir de outro processo local. | Aberta; requisito de E1.08. Por D-120, o token nunca é guardado em `localStorage`. |
| PD-43 | Assume-se um único serviço local por base, mas a premissa não é imposta. Reproduzido em E1.07-C-M (RV-02): dois processos atingem `READY` sobre a mesma base; cada arranque revoga as sessões do outro (`service-restarted`); o limite de 5 sessões passa a valer por processo; a limitação de tentativas é partilhada. | Revogações inesperadas, limite de sessões contornável e semântica do reinício perdida. | Aberta; **bloqueante para E1.08** (D-121). Proposta em [E1.07-C-M](tasks/E1.07-C-M.md#ciclo-de-vida-e-pd-43-secção-9): bloqueio exclusivo do SQLite (`locking_mode = EXCLUSIVE`) adquirido antes de `READY`, recusa `database-locked` e recuperação automática pelo sistema operativo após terminação inesperada (prova de conceito executada). Tarefa específica antes de E1.08. Em E1.07-C-R1: premissa de instância única documentada (D-127) e tarefa [E1.07-X](tasks/E1.07-X.md) especificada, não implementada. **Resolvida na branch `feat/e107-x-database-exclusivity` (E1.07-X, D-130 a D-134):** bloqueio exclusivo do SQLite adquirido e comprovado na abertura, antes de qualquer leitura do esquema, migração, revogação ou escrita; segunda instância recusada com `database-locked`; identificação canónica da base. Comprovado com processos reais (X30 a X41). Encerramento formal após revisão independente e integração; até lá, E1.08 continua bloqueada. **Revista em E1.07-X-M** (GO com ressalvas): confirmada com processos reais e harness próprio (20 rondas concorrentes, nunca dois `READY`); mantém-se por encerrar até à integração. **Encerrada** (D-140): integrada em `main` pelo PR #7 (merge `1872bdf`, árvore igual ao checkpoint revisto `92b2cce`) e revalidada na `main` (626/626, 12/12). |
| PD-44 | Divergência de planeamento: a especificação preliminar de E1.07-C previa revogar sessões na desactivação de associações ou estabelecimentos. A autorização de E1.07-C não o inclui, porque a sessão não tem empresa. | A perda de elegibilidade empresarial não termina a sessão; tem de ser reavaliada em cada operação. | Aberta; a cumprir pela autorização em E1.07-D. Por D-122, a sessão global não é necessariamente revogada, mas o acesso à empresa afectada cessa imediatamente e a autorização é revalidada em cada operação protegida. **E1.07-D1:** revalidação formalizada (D-157): identidade, associação empresarial, associação local e estabelecimento em cada avaliação, só com os factos do tenant pedido; a perda de uma associação não afecta as outras empresas. Cumprimento efectivo em E1.07-D4. E1.07-D2-M: o motor interno relê identidade, associações, estabelecimentos, perfis e atribuições em cada avaliação, sem *cache* (incluindo desactivações por SQL directo); não há operação que dependa dele. Cumprimento em D4. |
| PD-45 | RV-01 (E1.07-C-M): `createSessionClock` congela o instante efectivo depois de um avanço seguido de retrocesso do relógio de parede. Sessões criadas no intervalo não expiram por inactividade nem de forma absoluta, e os comprovativos não expiram, até o tempo real alcançar o instante adiantado ou o serviço reiniciar. O teste K01 afirma o congelamento. | Prolongamento indevido de sessões, de dimensão igual ao salto do relógio. | **Resolvida na branch** (E1.07-C-R1, D-124): `efectivo = max(parede, anterior + Δmonotónico)`; K01 ajustado; K02–K05, S47b–S47d; mutação X01 detectada; reprodução da revisão 8/8. **Resolvida e encerrada**: confirmada em E1.07-C-R2 (26/26 verificações temporais sobre o código compilado; X01, X02, O1 e O2 detectadas) e integrada (PR #6). A suspensão real continua na PD-50. |
| PD-46 | RV-03 (E1.07-C-M): `INSERT OR REPLACE` sobre `password_credentials` repõe `credential_version` a 1 sem revogar sessões, porque a eliminação implícita não activa `password_credentials_never_deleted`. Nenhum caminho do código o usa. | Defesa em profundidade incompleta; exige escrita SQL directa na base. | **Resolvida na branch** (E1.07-C-R1, D-126): migração 5 com triggers `BEFORE INSERT`, alargada a `REPLACE INTO users` (com `foreign_keys` desligado) e a `REPLACE INTO local_sessions`, que anulava revogações; S63–S65; fronteira de confiança documentada. **Resolvida e encerrada**: confirmada em E1.07-C-R2 (60 escritas directas recusadas nas 4 configurações; caminhos legítimos e *rollback* confirmados) e integrada (PR #6). Lacuna de cobertura residual na PD-51. |
| PD-47 | RV-04 (E1.07-C-M): a limpeza no arranque calcula a retenção só com o relógio de parede; com a parede adiantada 1 ano, todos os registos terminados foram eliminados. | Perda de registos técnicos de sessões por erro de relógio. | **Mitigada** (E1.07-C-R1, D-125): o arranque não elimina registos; `cleanupSessions()` corta pelo instante mais antigo plausível; S48b, S48c. Aberta para a retenção definitiva e a referência temporal confiável em E1.07-E (um processo iniciado com o relógio adiantado não é detectado). Confirmado em E1.07-C-R2: nenhum arranque elimina registos, mesmo com a parede +1 ano; expiração e limite inalterados; `cleanupSessions()` chamada num serviço iniciado adiantado elimina um registo terminado há menos de 30 dias reais (limitação reproduzida). A eliminação não é exposta a consumidores da API (D-129). |
| PD-48 | RV-05 (E1.07-C-M): mutações não detectadas pela suite: R4 (versões do comprovativo lidas antes do recálculo de parâmetros), R5 (tecto da política), R6 (registos no futuro) e R9 (idade negativa do comprovativo). | Uma regressão em R4 recusaria a primeira sessão após recálculo sem falhar testes. | **Resolvida na branch** (E1.07-C-R1): S59 (R4), S60 (R5), S61 (R6), S62 (R9); as quatro detectadas individualmente. **Resolvida e encerrada**: R4, R5, R6 e R9 repetidas em E1.07-C-R2 e detectadas por comportamento (S59 a S62); integrada (PR #6). |
| PD-49 | Sem eliminação automática no arranque (D-125), os registos de sessões terminadas crescem sem limite até existir a retenção definitiva. | Crescimento da base (ordem de grandeza não medida: centenas de MB por ano com milhares de sessões por dia). | Aberta; aceite até E1.07-E, que define retenção, referência temporal e limite ou alerta de volume. Mantida aberta em E1.07-C-R2 (D-129). |
| PD-50 | O ensaio de suspensão e retoma real do computador não foi executado em E1.07-C-R1 (sem ambiente seguro dedicado). A lógica está coberta com relógios injectados. | Comportamento real de `performance.now()` durante a suspensão não observado. | Aberta; requisito do Gate E1.07-F. Alargada em E1.07-C-R2 (RV-02): ensaiar também a suspensão depois de um avanço do relógio de parede já corrigido no mesmo arranque. Com relógios injectados e o monotónico parado, uma sessão sem actividade há 8 h continuou válida, porque o instante efectivo estava à frente da parede (prolongamento limitado ao menor entre a suspensão e o avanço por alcançar). Em Windows, o `QueryPerformanceCounter` inclui reportadamente o tempo de suspensão (não verificado nesta máquina); em Linux, `performance.now()` pára. |
| PD-51 | Lacuna de cobertura da migração 5 (E1.07-C-R2, RV-03): retirar `OR token_digest = NEW.token_digest` de `local_sessions_insert_requires_new_session` não faz falhar nenhum teste (597/597). Com essa regressão, `REPLACE INTO local_sessions` com `id` novo e o digest de uma sessão revogada anula a revogação (reproduzido em memória). O código actual recusa-o nas 4 configurações. | Uma regressão futura reabriria a anulação de revogações sem falhar testes. | **Resolvida na branch** de E1.07-X (commit `test: cover session replacement with a new identifier`): variante do S64 com `id` novo e digest existente; O3 detectada isoladamente e na suite completa; código de produção inalterado. Encerramento formal após a integração. Confirmada de forma independente em E1.07-X-M (`76c7709` só altera o teste; O3 repetida e detectada pelo S64). **Encerrada** (D-140): integrada em `main` pelo PR #7 (merge `1872bdf`). |
| PD-52 | E1.07-X não verificou a exclusividade sobre unidades de rede mapeadas (letra associada a uma partilha SMB) nem sobre sistemas de ficheiros locais além de NTFS (ReFS, FAT/exFAT). Os caminhos UNC são recusados; uma unidade mapeada deveria resolver para UNC pelo `realpath` e ser recusada, mas não foi ensaiado (exigiria alterar a configuração da máquina). | Uma base numa unidade de rede violaria a política de armazenamento local (o SQLite desaconselha WAL e bloqueios em rede). | Aberta; política: só disco local NTFS (D-131). Proposta: ensaiar e documentar na instalação (E1.10). Por D-136 (E1.07-X-M), NTFS local é a plataforma inicialmente homologada, validada em E1.10, sem suporte declarado a unidades de rede, pastas sincronizadas ou sistemas não ensaiados. Verificado em E1.07-X-M: uma ligação simbólica de directório para `\\localhost\C$` é recusada (`location-network-path`); unidades mapeadas continuam por ensaiar (só proibição administrativa). Por D-141: NTFS local homologado; validação operacional em E1.10. |
| PD-53 | Com a exclusividade, nenhuma ferramenta externa lê a base com o serviço activo, e a cópia simples do ficheiro activo é inconsistente (não inclui o WAL). Um gestor de serviços que reinicie o serviço enquanto a instância anterior ainda liberta a base recebe `database-locked`. | Cópias de segurança e reinícios automáticos têm de passar pela instância proprietária ou tolerar a recusa. | Aberta; D-133. Proposta: E1.10 implementa cópias pela instância (Backup API ou `VACUUM INTO`, ensaiadas em X16) e uma política de nova tentativa limitada para `database-locked`. E1.07-X-M: gravidade média para a operação, sem efeito na exclusividade. A cópia simples não é necessariamente inconsistente: depende do estado do WAL (D-138). Libertação após terminação forçada de 13–45 ms típica, com valores até 1061 ms; reinício imediato com 2000 ms sempre `READY` (8/8); recusa efectiva com 2000 ms ≈ 3,2 s. Cópias protegidas (D-138). Por D-142: tempos de aquisição e recuperação e novas tentativas limitadas em E1.10. |
| PD-54 | O Ctrl+C real numa consola interactiva não foi ensaiado em E1.07-X: em Windows, o Node não envia sinais a processos filho, e o ensaio automático (X36) entrega `SIGINT` pelo `process.emit` aos ouvintes reais do ponto de entrada. A terminação forçada e a falha inesperada foram ensaiadas com processos reais. | Diferença residual entre o sinal da consola e o sinal entregue no processo (ver também PD-22). | Aberta, de baixo impacto. Proposta: verificação manual no Gate E1.07-F. Por D-139 (E1.07-X-M): Ctrl+C real de consola sobre o ponto de entrada com a base detida e confirmação da libertação, em ambiente isolado, no Gate E1.07-F; paragem pelo gestor de serviços Windows na validação operacional de E1.10. Confirmado por D-143: Ctrl+C real em E1.07-F; gestor de serviços em E1.10. |
| PD-55 | E1.07-X-M (RM-04): um ficheiro aberto por outro programa sem partilha (`FileShare.None`) é classificado como `database-access-denied`, pela heurística `SQLITE_CANTOPEN` com o ficheiro presente (D-132). | Falha fechada; só o diagnóstico é enganador (o operador pode procurar um problema de permissões quando o ficheiro está em uso). | Aberta, baixa. Proposta: documentar nas instruções operacionais de E1.10 ou distinguir a causa numa tarefa autorizada; sem alteração de código nesta revisão. Por D-144: tratada em E1.10. |
| PD-56 | E1.07-X-M (RM-06, RM-07): `inspectDatabase` anula qualquer transacção aberta na ligação do serviço, mesmo que não tenha sido aberta pelo `work`, o que poderia esconder uma transacção deixada aberta pelo serviço. As execuções com mutações que deixam ligações abertas deixam pastas de teste em `TEMP` (o `afterEach` falha com `EBUSY`). | Só testes e ensaios; nenhuma garantia de produção afectada. | Aberta, baixa. Propostas, por aprovar: (a) `inspectDatabase` só anula transacções abertas pelo próprio `work` e falha se encontrar uma já aberta; (b) os executores de mutações correm com `TEMP`/`TMP` numa pasta própria da execução, removida pelo caminho literal no fim (procedimento usado em E1.07-X-M, sem alterar testes). Por D-145: corrigida em E1.07-F. |
| PD-57 | Encerramento de E1.07-X-M: na validação de `main` após o merge `1872bdf`, o `afterEach` de `tests/database-exclusivity.test.ts` falhou uma vez no X31 com `ENOTEMPTY` em `rmSync` sobre a pasta temporária do teste. As afirmações do teste passaram; a pasta ficou vazia momentos depois. Causa provável (não verificada): o Windows ainda tinha a eliminação de um ficheiro pendente logo após a saída dos processos filho. Ocorreu em 1 de 9 execuções do X31 (4 `pnpm check` e 5 execuções do ficheiro); não foi observada nas execuções registadas em E1.07-X nem nas de E1.07-X-M. | Falsos negativos intermitentes em `pnpm check`; nenhuma garantia de produção afectada. | Aberta, baixa. Proposta, por aprovar: tratar com a limpeza dos ensaios da PD-56 em E1.07-F (D-145), por exemplo com `rmSync` usando `maxRetries` e `retryDelay` no `afterEach` dos ensaios com processos. Testes não alterados. **Aprovado** (D-158): tratamento em E1.07-F com a PD-56, com novas tentativas limitadas e intervalos curtos, depois de confirmar o encerramento dos processos e ligações, sem esconder fugas de recursos e com a falha visível se as tentativas se esgotarem. Não ocorreu nas execuções de E1.07-D1. |
| PD-58 | E1.07-D1: as regras puras só bloqueiam permissões `OPERATION` em empresas não `ACTIVE`; as permissões `ADMINISTRATION` mantêm-se aplicáveis em `DRAFT`, `SUSPENDED` e `INACTIVE`. | Sem implementação, uma empresa suspensa ou inactiva poderia continuar a ser administrada sem restrição funcional. | Política decidida em D-159. **E1.07-D2-M (D-186):** em `DRAFT`, `ACTIVE`, `SUSPENDED` e `INACTIVE`, D2 persiste perfis, concessões e atribuições e o motor interno concede as permissões `ADMINISTRATION` (o catálogo v1 não tem `OPERATION`); nenhuma operação é executável (sem consumidor nem exposição). Aplicação de D-159 às operações administrativas RBAC em E1.07-D3 e à autorização operacional em E1.07-D4. |
| PD-59 | A autoridade sobre sessões e `cleanupSessions()` não tem permissão no catálogo inicial. | Administração de sessões continua interna e sem autorização própria. | Política decidida em D-160: separar logout próprio, gestão própria, revogação administrativa da instalação e revogação empresarial; esta última não termina sessões usadas noutras empresas. Implementação pendente em D3/D4/E. |
| PD-60 | O catálogo inicial é técnico e conservador; sem perfis predefinidos, catálogo por sector ou segregação de funções normativa. | Operações futuras podem ficar sem correspondência explícita ou com permissões inadequadas. | Princípio decidido em D-161: toda operação protegida corresponde explicitamente a uma permissão; ocultar UI não autoriza. Validação funcional e normativa permanece pendente em D3 e módulos sectoriais. |
| PD-61 | Uma concessão persistida pode referir código removido ou `WITHDRAWN`; persistência e versão do catálogo ainda não existem. | Concessões órfãs sem tratamento poderiam ser convertidas, eliminadas ou reutilizadas indevidamente. | Política decidida em D-162. **Tratamento inicial implementado em E1.07-D2 (D-181) e confirmado em E1.07-D2-M:** `catalog_version` por concessão; classificação `UNREGISTERED`/`WITHDRAWN`/`AUTHORITY_INCOMPATIBLE`/`NEWER_CATALOG`; nunca concedem (RE08); identificáveis por `diagnostics.listUnrecognized`; sem conversão nem eliminação automática; só `remove` explícito. Validação integrada em D4; apresentação administrativa em PD-68. A mudança de significado de um código entre versões do catálogo não é detectável pelos dados (controlo de processo D-162); proposta para a PD-68: registo, por versão, dos códigos redefinidos ou retirados, verificado por teste. |
| PD-62 | E1.07-D1-M (RV-D1-M-01): decisões `GRANTED` eram estruturalmente forjáveis. | Uma futura fronteira poderia aceitar uma decisão construída pelo consumidor. | **Encerrada em E1.07-D1-R2 (D-168)**; encerramento formalizado após a integração do registo no PR #10 (D-170). R1 usa identidade e resultado registados num `WeakMap`; a revisão repetiu fabricação, clones, resposta externa e mutações. D4 continua proibida de aceitar decisões do transporte. Garantias confirmadas de novo em E1.07-D1-H (R1-M01, R1-M05). |
| PD-63 | E1.07-D1-M (RV-D1-M-02/03): catálogo sem proveniência e definições superficialmente congeladas. | Um motor futuro poderia receber catálogo não confiável; definições públicas eram alteráveis. | **Encerrada em E1.07-D1-R2 (D-168)**; encerramento formalizado após a integração do registo no PR #10 (D-170). Proveniência `OFFICIAL`/`EXPERIMENTAL`/`UNKNOWN`, definições e listas congeladas, sem fornecedor injectável; duas instâncias falham fechadas. D2 continua obrigado a usar uma única instância e só o catálogo oficial (D-167). Garantias confirmadas de novo em E1.07-D1-H (R1-M08, R1-M09, R1-CAT). |
| PD-64 | Imutabilidade transversal dos contratos, incluindo isolamento de `TaxIdPolicy` do objecto original. | O defeito histórico permitia alterar uma política criada por estado lido através de `this`. | **Encerrada em E1.07-D1-H-R2 (D-178).** D1-H protege listas/limites/transições; H-R1 corrigiu RV-D1-H-M-01; H-R2 confirmou HR01–HR15 e 7/7 mutações críticas. |
| PD-65 | *Timeouts* de 5 s em Argon2id/SQLite/sessões e falhas de arranque de workers. A revisão reproduziu-os também em `0539b15`; grupos isolados variaram e H01–H20 não deixaram resíduos. | Falsos negativos intermitentes; causalidade com D1-H não demonstrada. | **Aberta** (D-174, D-177). 2026-11-22 (encerramento de E1.07-D3-G0): 2 de 5 execuções completas de `pnpm check` com *timeouts* de 5 s em testes diferentes (`[RM04]`, `[G18]`, `[S11]`), sem alteração de código; ficheiro isolado e repetição aprovados. Tratar em E1.07-F com PD-56/PD-57, medindo recursos e concorrência antes de alterar configuração. Em H-R1 nenhuma suite completa teve *timeouts* (755/755, com e sem `dist`). E1.07-D2-M: nenhum *timeout* em 3 suites completas (834, 834 sem `dist`, 755 na base) e 23 execuções dirigidas. |
| PD-66 | Aviso `GHSA-fc5q-39xc-vjpf` sobre `picomatch` 4.0.7, só na cadeia de desenvolvimento. | O GitHub retirou o aviso em 2026-11-18; o audit actual já não o reporta e produção permanece limpa. | **Encerrada** em E1.07-D1-H-M (D-175), sem alterações de dependências. Reabrir se o aviso for republicado. Confirmada em H-R1 (`audit` sem `picomatch`). |
| PD-67 | `eslint .` analisa, com tipos, qualquer worktree ou cópia colocada dentro da raiz (as exclusões só cobrem `dist`, `dist-electron`, `node_modules`, `coverage`). Um worktree leva o pico a ~3,9 GiB; dois excedem o limite de *heap* por omissão (4288 MiB) e dão exit 134, como na H-M. | `pnpm check`/`pnpm lint` falham por falta de memória durante ensaios com worktrees; sem relação com o código (D-177). | **Aberta** (D-177). Proposta para E1.07-F, por aprovar: worktrees de ensaio fora da raiz e/ou exclusão explícita no ESLint. Sem aumento de *heap* nem alteração de configuração. E1.07-D2-M: lint sem OOM (57,4 s), sem worktrees na raiz; as cópias de ensaio ficaram fora da raiz. |
| PD-68 | E1.07-D2: as concessões persistidas fora do catálogo vigente são detectáveis (`diagnostics.listUnrecognized`), mas só por chamada interna; não há apresentação administrativa, alerta nem limpeza auditada. | Concessões obsoletas não concedem nada, mas podem acumular-se sem visibilidade para o administrador da empresa. | **Aberta.** Apresentação e limpeza autorizadas e auditadas em E1.07-D3 (autoridade do actor) e E1.07-E (auditoria). |
| PD-69 | E1.07-D2-M (RV-D2-M-01, Médio): com `recursive_triggers` desligado (valor por omissão e da ligação do serviço), `REPLACE`/`UPDATE OR REPLACE` com conflito de `rowid` elimina linhas de `roles` e `role_assignments` sem activar os triggers “nunca eliminados” e permite reinserir o mesmo `id` com outra ligação. Com `foreign_keys` ligado: atribuições e perfis sem filhos; desligado: também perfis com filhos, cujos órfãos voltam a ligar-se na reinserção. | Histórico RBAC eliminável ou reescrevível por SQL directo; D-180 afirmava o contrário. Não cria autoridade além do SQL directo. | **Encerrada no encerramento de E1.07-D2** (D-203, D-204): corrigida na migração 7 e testes integrados em `main` pelo PR #15 (merge `dc5b046`) e confirmada por revisão independente (E1.07-D2-R2, D-190; E1.07-D2-R4, D-200). |
| PD-70 | E1.07-D2-M (RV-D2-M-03, Baixo): as ligações de `company_memberships`, `branch_memberships`, `branches` e `companies` (migrações 1–2) não são imutáveis na base. Com `foreign_keys` ligado, `UPDATE company_memberships SET user_id = …` transfere as atribuições RBAC para outra identidade (reproduzido: `no-membership` → `GRANTED`). | Desde D2, uma alteração directa de uma tabela-pai transfere autoridade. Os repositórios não o permitem. | **Encerrada no encerramento de E1.07-D2** (D-203, D-204): corrigida na migração 7 e testes integrados em `main` pelo PR #15 (merge `dc5b046`) e confirmada por revisão independente (E1.07-D2-R4: 0/208 escritas aceites, nenhuma transferência nas 4 configurações, D-200). A transferência de titularidade auditada é de E1.07-D3. |
| PD-71 | E1.07-D2-M (RV-D2-M-04, Baixo): lacunas de cobertura. Sem teste da guarda `READY` de `internalAuthorization` (mutação O1 só detectada pelo revisor); a verificação de factos contraditórios (M10) só é detectada pela suite pura D47, embora seja atingível em SQLite real com `foreign_keys` desligado; a leitura única do pedido pelo motor (O2) não é testada. | Regressões nestes pontos passariam nas suites oficiais. | **Encerrada no encerramento de E1.07-D2** (D-203, D-204): corrigida na migração 7 e testes integrados em `main` pelo PR #15 (merge `dc5b046`) e confirmada por revisão independente (E1.07-D2-R2, D-190; mutações O1/RE12/RE13/D46 repetidas em E1.07-D2-R4). |
| PD-72 | E1.07-D2-R2 (RV-D2-R2-02, Baixo): as guardas `BEFORE INSERT … WHERE rowid = NEW.rowid` da migração 7 dependem de `NEW.rowid`, indefinido segundo o SQLite quando o `rowid` não é explícito (−1 na 3.53.2). Uma linha inserida com `rowid` −1 faz recusar todas as inserções normais da tabela (verificado em `users`, `local_sessions`, `companies`, `roles`). | Negação de serviço persistente (sem novas identidades, sessões, empresas ou perfis) por uma única escrita SQL directa. | **Encerrada no encerramento de E1.07-D2** (D-203, D-204): corrigida na migração 7 e testes integrados em `main` pelo PR #15 (merge `dc5b046`) e confirmada por revisão independente (E1.07-D2-R4, D-200). A ressalva sobre `rowid` legados não positivos continua registada na PD-76. |
| PD-73 | E1.07-D2-R2 (RV-D2-R2-06, Informativo): `installation_bootstrap` aceita `REPLACE` e `UPDATE` de `initial_administrator_id` em todas as configurações, antes e depois da migração 7. | Sem efeito hoje; E1.07-D3 prevê dar ao administrador inicial a autoridade da instalação, que ficaria dependente de uma linha mutável. | **Encerrada** (D-232): correcção em `main` desde o PR #17; ressalvas mantidas — `intact` é só consistência estrutural (D-218) e a fronteira D-209 (controlo do esquema) continua. Histórico: **Confirmada em E1.07-D3-G0-M** (D-214): registo imutável, âncora com recusa fechada e identidade referida nunca eliminada; encerra com o merge autorizado. **Corrigida na branch de E1.07-D3-G0** (D-206, D-207, D-213): registo imutável + âncora com recusa fechada + identidade referida nunca eliminada; encerramento após E1.07-D3-G0-M e merge autorizado. Histórico: **Aberta (protecção integrada)** (D-197, D-200, D-204): `installation_bootstrap` gravado uma vez, imutável e não eliminável, em `main` desde o merge `dc5b046` e confirmado em E1.07-D2-R4. Fecha-se com a PD-75 no Gate de E1.07-D3; não pode ser ignorada nesse Gate. |
| PD-74 | E1.07-D2-R2 (RV-D2-R2-03, Baixo): RI05b usa valores que já colidem com `UNIQUE` (associação local já existente; tenant de outra empresa) e o `REPLACE` por `rowid` de `company_memberships` reutiliza o mesmo `id`. Remover a imutabilidade de `branch_memberships.branch_id`, de `companies.tenant_id` ou a guarda de `rowid` das associações não é detectado (mutações R10, R12, R13). | Regressões nessas guardas passariam na suite oficial. | **Encerrada no encerramento de E1.07-D2** (D-203, D-204): corrigida na migração 7 e testes integrados em `main` pelo PR #15 (merge `dc5b046`) e confirmada por revisão independente (E1.07-D2-R4: M-R10, M-R12 e M-R13 detectadas por RI05g, D-200). |
| PD-75 | E1.07-D2-R3 (PD-73): com `foreign_keys` desligado, a linha `users` do administrador inicial (ou de qualquer identidade) pode ser eliminada e reinserida com o mesmo `id` e outro nome (migração 5, D-126: revoga sessões, não reutiliza versões). A referência e a credencial continuam no mesmo `id`; equivale à edição directa da linha, que é manutenção aceite. | Antes de E1.07-D3 dar autoridade ao administrador inicial, a identidade que a recebe não tem histórico imutável na base e a sua edição não exige autoridade. | **Encerrada** (D-232): condições 1–4 de D-201 em `main` (PR #17; recriação da identidade fechada pelo PR #18); ressalvas mantidas — fronteira D-209 e RV-R4-05; **não autoriza a activação** (PD-77). Histórico: **Confirmada em E1.07-D3-G0-M** (D-214): 0/112 tentativas aceites nas 4 configurações, sem alteração do estado nem das decisões do motor; condições 1, 2 e 4 de D-201 completas; a condição 3 fica completa com a PD-80. Encerra com o merge autorizado. **Corrigida na branch de E1.07-D3-G0** (D-206 a D-209, D-213): condições 1–4 de D-201 implementadas (migração 8; âncora `verifyAnchor`; recusa do estado e da credencial do administrador inicial; fronteira explícita testada). Encerramento após E1.07-D3-G0-M e merge autorizado. A activação continua bloqueada pela PD-77. Histórico: **Aberta — condição obrigatória antes da activação operacional de E1.07-D3** (D-197, D-199, D-201, D-204). Avaliada em E1.07-D2-R4 como Baixa para D2 (o merge do PR #15 foi feito com ela aberta): não bloqueia o merge nem o arranque da D3; **bloqueia a activação operacional** de autoridade baseada em `installation_bootstrap`. Âmbito alargado: qualquer identidade; `branch_memberships` elimináveis com reutilização do `id` (RV-D2-R4-03); com FK OFF, a eliminação sem reinserção deixa a referência pendente; um escritor SQL pode substituir credenciais em qualquer configuração. Decidir no Gate de E1.07-D3: identidades e associações locais “desactivadas, nunca eliminadas” na base, por migração nova; recusa fechada com referência pendente; autoridade exigida para editar a identidade e a credencial do administrador inicial. |
| PD-76 | E1.07-D2-R4 (RV-D2-R4-02, Baixo): depois da migração 7, uma tabela guardada que só tenha `rowid` não positivos (escritos por SQL directo antes da 7, nunca pela aplicação) deixa de aceitar inserções: o SQLite escolhe `max(rowid) + 1` ≤ 0 e o AFTER INSERT recusa-o. Pode também acontecer numa tabela eliminável se todas as linhas positivas forem apagadas ao lado de uma legada não positiva. | Indisponibilidade permanente da tabela (sem novas identidades, sessões, perfis…) numa base existente adulterada antes da actualização. Hoje não existem bases persistentes de clientes. | **Encerrada** (D-232): pré-verificação no serviço local em `main` desde o PR #17; ressalvas mantidas — `runMigrations` sem ela (PD-79, aberta) e ressalva WAL de D-218. Histórico: **Confirmada em E1.07-D3-G0-M** (D-214): 40/40 bases legadas recusadas sem alterar dados nem esquema; ressalva WAL em D-218. Encerra com o merge autorizado. **Corrigida na branch de E1.07-D3-G0** (D-211, D-213): o serviço local recusa migrar (`legacy-rowid-incompatible`) uma base com `rowid <= 0` nas 10 tabelas guardadas, sem renumerar nem alterar o ficheiro; encerramento após E1.07-D3-G0-M e merge. Obrigação do futuro instalador/actualizador na PD-79. Histórico: **Aberta** (D-196, D-202, D-204). |
| PD-77 | E1.07-D3-G0 (D-210): não existe processo aprovado de recuperação ou substituição do administrador inicial. | Sem ele, uma autoridade da instalação baseada em `installation_bootstrap` ficaria irrecuperável ou exigiria um *bypass*. | **Mantida aberta e bloqueante depois do PR #18** (D-231). **Aberta — bloqueia a activação** (D-223, E1.07-D3-G0-R1: a R1 tem de ser implementada e revista antes de activar qualquer autoridade administrativa baseada no registo; caminho reservado, nada implementado). Direcção decidida pelo responsável: R1 (código de recuperação de utilização única), R2 adiada (D-215); especificação mínima e decisões pendentes em [tasks/E1.07-D3-G0-M.md](tasks/E1.07-D3-G0-M.md#8-pd-77--recuperação-administrativa); pré-requisitos PD-80 e PD-81. **Aberta — bloqueia a activação** de qualquer concessão ou avaliação de autoridade da instalação. Proposta R1/R2 em [tasks/E1.07-D3-G0.md](tasks/E1.07-D3-G0.md#7-recuperação-e-substituição-autorizada--proposta-não-implementada-d-210); exige aprovação específica do responsável, implementação e revisão independente. |
| PD-78 | E1.07-D3-G0: empresas e estabelecimentos continuam elimináveis (repositórios `delete`, com FK `RESTRICT` se ligado); com `foreign_keys` desligado, SQL directo elimina mesmo com linhas filhas e a reinserção com o mesmo `id` é aceite (migração 7 só recusa `id` existente). | Mudança silenciosa de `created_at` e de atributos por eliminação e reinserção; referências pendentes com FK desligado. | **Política decidida pelo responsável (D-222, E1.07-D3-G0-R1):** empresas e estabelecimentos com identidade histórica e relações de autoridade são desactivados, não eliminados nem substituídos silenciosamente; implementação numa tarefa própria, antes de activar operações empresariais. Não implementada. **Avaliada em E1.07-D3-G0-M (Médio, D-216):** sem transferência entre identidades ou tenants, mas continuidade de autoridade sobre entidade recriada e perda de histórico com FK desligado. Bloqueia a activação de provisionamento/administração de empresas e estabelecimentos. Tratamento a decidir antes ou no início da D3-A. Aberta; política “desactivar, nunca eliminar” para empresas e estabelecimentos a decidir em E1.07-D3 (relaciona-se com a política de eliminação de dados, D-027). |
| PD-79 | E1.07-D3-G0 (D-211): a pré-verificação PD-76 está no serviço local; `runMigrations` continua sem ela. | Um instalador ou actualizador que migre directamente contornaria a recusa. | **Aberta; requisitos especificados em D-217.** Aberta; antes da primeira distribuição (E1.10): migrar só através do serviço local ou chamar `assertNoNonPositiveRowids`. |
| PD-80 | E1.07-D3-G0-M (RV-D3-G0-M-01, Médio): `identityProvisioning.credentials.create` não recusa o administrador inicial. Com a credencial dele em falta (base adulterada antes da migração 4 ou com controlo do esquema) e sem histórico de sessões, a criação é aceite, a âncora passa de `broken` a `intact` e a palavra-passe escolhida autentica o administrador. | Uma operação interna sem autoridade da instalação fecha uma âncora que devia ficar fechada e define a credencial inicial; seria um *bypass* da recuperação (PD-77) se fosse exposta. | **Encerrada** (D-232): em `main` desde o PR #17; ressalvas mantidas — repor a credencial é exclusivo da futura R1 (PD-77, D-223); normalização de `id` por fazer (RV-R4-03). Histórico: **Corrigida na branch em E1.07-D3-G0-R1** (D-220): reproduzida no código compilado de `a1f7293`; `create`/`replace` recusam o administrador inicial antes de qualquer outra validação, com ou sem credencial e sessões; testes `[G08b]`, `[G16]`–`[G21]`. **Demonstrada em E1.07-D3-G0-R2** (D-225, D-226): reproduzida em `a1f7293` e recusada em `7a82026` em todos os cenários; encerra com o merge autorizado. A recriação da identidade **ausente** por `users.create` fica na PD-82. Histórico: encerramento após E1.07-D3-G0-R2 e merge autorizado; Aberta; **condição antes da D3-A e de qualquer activação**. Correcção proposta: `assertNotInitialAdministrator` em `create` (antes do *hash* e na transacção) e teste dedicado (D-218, D-219). |
| PD-81 | E1.07-D3-G0-M (RV-D3-G0-M-03/04, Baixo): sobrevivem as mutações K06 (`verifyAnchor()` do serviço a devolver `intact` a partir do registo descritivo), P02 (tomada do `username` de uma identidade desactivada), P03 (eliminação de identidades `INACTIVE`) e P04 (eliminação de associações locais `INACTIVE`) — o código está correcto, falta cobertura; o evento `service.migration_preflight_refused` regista `[REDACTED]` em vez da contagem de `password_credentials` (chave filtrada pelo *logger*), e G13 só cobre duas tabelas. | Regressões nesses pontos passariam na suite; diagnóstico incompleto de uma recusa. | **Mantida depois do PR #18** (D-231): mutações cobertas na `main`; registo `[REDACTED]` **aberto, Baixo, não bloqueante**. **E1.07-D3-G0-R2** (D-226): mutações demonstradas (K06, P02, P03 e P04 sobrevivem à suite antiga e são detectadas pela nova); registo **aberto, Baixo, não bloqueante** (RV-R2-02: falso positivo do filtro por nome de chave, sem informação sensível; recomendadas chaves neutras e teste). **Mutações cobertas na branch em E1.07-D3-G0-R1** (D-221): `[G08b]` (K06) e `[G01b]` ×4 (P02, P03, P04), as quatro agora detectadas. **Aberta** quanto ao registo (RV-D3-G0-M-04), fora do âmbito autorizado de R1. Histórico: Aberta; antes da D3-A, com a PD-80. |
| PD-82 | E1.07-D3-G0-R2 (RV-R2-01, Médio): `identityProvisioning.users.create` não recusa o administrador inicial. Com a identidade dele ausente (base adulterada antes da migração 8 com FK desligado, ou controlo do esquema) e sem sessões, a recriação com o mesmo `id` e `created_at = completed_at` é aceite, a âncora passa de `broken` a `intact` e a identidade recriada (outro `username`) autentica-se com a credencial órfã original. Anterior à R1 (desde `83480da`). | Uma operação interna sem autoridade da instalação “repara” a âncora e transfere o administrador inicial para outra identidade; contraria D-201, D-208 e D-220; abriria a R1 (D-215) e a primeira concessão (D-212) a uma identidade recriada. Sem superfície externa; nenhuma autoridade concedida hoje. | **Encerrada** (D-231): correcção `7742950` integrada na `main` pelo PR #18 (merge `49581ad`, autorizado pelo responsável) e validada na `main` (930/930, 12/12). Histórico: **Corrigida na branch em E1.07-D3-G0-R3** (D-227): reproduzida no código compilado de `df416c1`; `users.create` recusa o identificador do registo antes da validação, dos conflitos e da escrita e de novo na transacção do directório, com a identidade presente, desactivada ou ausente e com ou sem credencial e sessões; testes G22–G27; mutações R00/M1–M7 detectadas. **Confirmada em E1.07-D3-G0-R4** (D-229): reproduzida em `eb5350b` e recusada em `c21aa1b` em 116 cenários, sem escrita e com a âncora `broken`; 16 de 17 mutações detectadas (R4e equivalente na segurança, RV-R4-01). Encerra **só depois** do merge autorizado da correcção na `main` (ver PD-83). Histórico: **Aberta — condição antes da D3-A, da R1 e de qualquer activação** (D-225, D-226). Correcção proposta: `assertNotInitialAdministrator` em `users.create` (fora e dentro da transacção do directório) e teste com base legada, administrador ausente e sem sessões; precisar D-220. Exige tarefa autorizada. Decisão do responsável: GO condicionado com esta pendência ou correcção antes do merge — decidida a correcção (E1.07-D3-G0-R3). |
| PD-83 | E1.07-D3-G0-R3: o PR #17 (`feat/e107-d3-g0-installation-authority`) foi integrado em `main` (`eb5350b`, 2026-11-22, árvore igual a `df416c1`) antes da correcção da PD-82, apesar do NO-GO de E1.07-D3-G0-R2. | A `main` contém a PD-82 (sem superfície externa; nenhuma autoridade concedida). Os documentos da `main` ainda dizem “sem merge”. | **Encerrada** (D-231): a `main` contém `7742950` desde o merge `49581ad` (PR #18, pais `eb5350b` e `9cf48a8`, árvore igual ao checkpoint aprovado `9cf48a8`). Ressalva de processo: o PR #18 foi integrado com o título predefinido e sem a descrição da R4 §13. Histórico: **Aberta; desvio confirmado em E1.07-D3-G0-R4** (D-230): árvore de `eb5350b` = árvore de `df416c1`; `origin/main...HEAD` contém só `7742950` (código e testes) e `c21aa1b` (documentação); `merge-tree` sem conflitos, exige commit de merge. Encerra quando a `main` contiver `7742950`. Histórico: **Aberta** (D-228). A correcção (R3) segue nesta branch para um PR novo depois de E1.07-D3-G0-R4; a forma de integração é do responsável. Nenhum agente reverte nem altera a `main`. Até lá, não activar autoridade da instalação nem iniciar a D3-A a partir da `main`. |

As decisões arquitecturais ainda em aberto estão em [architecture.md](architecture.md#decisões-pendentes).

## Como retomar numa sessão nova

1. Ler [AGENTS.md](../AGENTS.md), este documento, [architecture.md](architecture.md), [decisions.md](decisions.md) e [implementation-plan.md](implementation-plan.md).
2. Activar o Node 24.22.3 (ver “Ambiente de referência”) e confirmar com `node -v`.
3. Confirmar o estado real, local e remoto (`AGENTS.md`, “Git e GitHub”):
   ```sh
   git -c safe.directory=C:/KIL-BUSINESS remote -v          # origin → github.com/SilveiraGomes/kilsystem-business
   git -c safe.directory=C:/KIL-BUSINESS fetch origin
   git -c safe.directory=C:/KIL-BUSINESS status -sb         # sem "ahead"/"behind" inesperados
   git -c safe.directory=C:/KIL-BUSINESS log --oneline -n 10
   ```
   O último `origin/main` observado é `49581ade56fbd0dd453bbabbe02263fd0167ff83`, merge do PR #18 (correcção da PD-82 com R3 e R4, pais `eb5350b` e `9cf48a8`). O anterior era `eb5350b17475c7ece6f9c2062ef2de9c997ba52a`, merge do PR #17 (E1.07-D3-G0 com R1 e R2, pais `5e60b7f` e `df416c1`), e antes dele `5e60b7f`, merge do PR #16 (encerramento documental de E1.07-D2). Todo o trabalho de E1.07-D3-G0 (G0, R1, R2, R3, R4) está em `main`; PD-82 e PD-83 encerradas (D-231). O registo deste encerramento está na branch `docs/e107-d3-g0-closure` até ser integrado. O directório canónico é `C:\xampp\htdocs\gestao_hoteleira\kilsystem-business`; `C:\KIL-BUSINESS` é outro clone e não deve ser usado. Confirmar novamente por `fetch` antes de retomar; nunca forçar. Worktrees de ensaio ficam fora da raiz do repositório (PD-67).
4. Executar `pnpm.cmd install --frozen-lockfile` (se `node_modules` não existir ou se a versão do Node mudou) e `pnpm.cmd check` para obter a linha de base. Registar qualquer falha antes de alterar código.
5. Identificar a tarefa activa em `docs/tasks/`.
   - E1.06-S2 está integrada em `main` através do PR #2 (`d29a629`).
   - E1.07-A está integrada em `main` através do PR #3 (`4d0302b`).
   - E1.07-B está integrada em `main` através do PR #4 (`8e77091`) e revista em E1.07-B-M.
   - Os testes de regressão de E1.07-B-M estão integrados em `main` (PR #5, merge `581699a`).
   - E1.07-C (com E1.07-C-R1) está integrada em `main` através do PR #6 (`136a442`) e revista em E1.07-C-M e E1.07-C-R2.
   - E1.07-X (exclusividade por base) está integrada em `main` através do PR #7 (`1872bdf`) e revista em E1.07-X-M; PD-43 e PD-51 estão encerradas (D-140). E1.08 continua bloqueada por PD-27 e PD-28.
   - E1.07-D1-M concluída com NO-GO; registo integrado em `main` (`f225366`). O PR #8 já estava integrado pelo responsável. O RBAC não está operacional.
   - E1.07-D1-R2 concluiu a revisão com GO para R1 e encerrou PD-62/PD-63; o registo foi integrado pelo responsável no PR #10 (`0539b15`, D-170).
   - E1.07-D1-H-R2 aprovou a correcção integrada no PR #12 e encerrou PD-64 (D-178); o registo documental foi integrado em `main` (`5bf2e00`, D-179).
   - E1.07-D2 está integrada em `main` (PR #13, `2c2b823`, antes da revisão) e foi revista em E1.07-D2-M (GO com ressalvas, D-184). A correcção E1.07-D2-R1 (PR #15) foi revista em E1.07-D2-R2: NO-GO (D-190). E1.07-D2-R3 corrigiu a própria migração 7 (D-194): PD-70, PD-72 e PD-74 corrigidas e PD-73 protegida na branch (D-195 a D-198). E1.07-D2-R4 recomendou GO (D-200); o PR #15 foi integrado (`dc5b046`) e E1.07-D2 está encerrada (D-203, D-204). Antes de qualquer activação operacional de E1.07-D3 baseada em `installation_bootstrap`, decidir no Gate D3 e implementar a política da PD-75 (D-201). Antes de aplicar migrações a uma base existente que não tenha sido criada e mantida só pela aplicação, fazer a pré-verificação de `rowid` não positivo (PD-76). Qualquer base de ensaio com a migração 7 antiga (`704ece44…caedd`) é recusada (`migration-checksum-mismatch`) e tem de ser recriada.
   - E1.07-D3-G0 (branch `feat/e107-d3-g0-installation-authority`, a rever em E1.07-D3-G0-M): migração 8 e protecções da PD-75 (D-206 a D-209), pré-verificação PD-76 (D-211). Regras a manter: nunca eliminar `users`, `branch_memberships` nem associações empresariais (desactivar); nunca usar `installation.status()` como prova de identidade (só `verifyAnchor()`, D-207); nunca alterar o estado ou a credencial do administrador inicial sem a autoridade da instalação (D-208); migrar bases existentes só pelo serviço local (PD-79). **Não activar nenhuma autoridade da instalação** antes da recuperação aprovada (PD-77, D-210). O restante de E1.07-D3 não está autorizado.
   - E1.07-D3-G0-R1 (mesma branch) corrigiu a PD-80 (D-220) e cobriu as mutações da PD-81 (D-221); aguarda E1.07-D3-G0-R2. Regra: nenhuma operação comum de credencial (`create`, `replace`) actua sobre o administrador inicial, mesmo sem credencial; repor a credencial é exclusivo da futura R1 (D-223). PD-78: desactivar, nunca eliminar empresas/estabelecimentos (D-222), numa tarefa própria.
   - E1.07-D3-G0-R3 (mesma branch) corrigiu a PD-82 (D-227); aguarda E1.07-D3-G0-R4. Regra: `users.create` nunca aceita o identificador do administrador inicial, exista ou não a linha; a verificação vem antes de tudo e repete-se na transacção. **A `main` (`eb5350b`, PR #17) foi integrada antes desta correcção (PD-83)**: a correcção entra por um PR novo.
   - **Encerramento de E1.07-D3-G0-R4 (D-231):** a correcção da PD-82 está na `main` (PR #18, `49581ad`); PD-82 e PD-83 encerradas. Antes de qualquer activação: R1 implementada e revista (PD-77). Melhorias de baixa gravidade por agendar: RV-R4-01 e RV-R4-03. PD-73, PD-75, PD-76 e PD-80 encerradas com ressalvas (D-232). D3-A não autorizada.
   - E1.07-D3-G0-R4 (mesma branch, `c21aa1b`) recomendou GO para a correcção da PD-82 (D-229), condicionado à aprovação do responsável e a um PR novo (PD-83, D-230). Antes de encerrar PD-82 e PD-83: merge autorizado, confirmar que a `main` contém `7742950` e correr `pnpm check`. Propostas não bloqueantes: reforço de G24 (RV-R4-01), normalização de `id` em `changeStatus`/`credentials` (RV-R4-03).
   - E1.07-D3-G0-R2 (mesma branch, `7a82026`) recomendou NO-GO segundo os critérios da missão (D-225): PD-80 demonstrada e mutações da PD-81 demonstradas, mas nova PD-82 — `users.create` recria o administrador inicial ausente e repara a âncora. Regra: nenhuma operação comum de identidade (`users.create`, `changeStatus`) nem de credencial actua sobre o administrador inicial; até à correcção, uma âncora `intact` não exclui a PD-82. Aguarda decisão do responsável (GO condicionado ou correcção antes do merge).
   - E1.07-D3-G0-M concluiu com GO (D-214), sujeito à aprovação do responsável; o merge não está feito. Antes da D3-A: PD-80 e PD-81. Recuperação: R1 aprovada como direcção, R2 adiada (D-215); nada implementado. Nunca tratar `intact` como prova de origem nem de estado (D-218); empresas e estabelecimentos continuam elimináveis até à decisão da PD-78 (D-216).
   - Regras ou validadores recebidos de consumidores (D-176): funções puras, invocadas sem o objecto do consumidor como receptor; propriedades lidas uma vez; estado de fechos fica fora da garantia. E1.07-D3/D4, E1.07-E/F e E1.08–E1.10 continuam planeadas mas não autorizadas.
   - Imutabilidade (D-171): novas listas de valores, limites ou definições exportadas usadas em validações são congeladas em execução (cada nível, se aninhadas) e testadas por comportamento; regras recebidas de consumidores são copiadas e congeladas na criação, sem congelar o objecto do consumidor.
   - Contratos de autorização (D-163 a D-167): decisões só se reconhecem com `inspectDomainDecision`; nunca usar `outcome` estrutural. O caminho operacional usa só `OFFICIAL_PERMISSION_CATALOG` (ou `requireOfficialPermissionCatalog`); catálogos experimentais são só para testes.
   - E1.06-S1 está integrada em `main` através do PR #1.
6. Trabalhar apenas no âmbito da tarefa. Regras a manter:
   - qualquer implementação nova de repositório tem de passar `tests/support/tenant-repository-contract.ts` (D-021);
   - qualquer implementação de identidades ou associações tem de passar `tests/support/membership-repository-contract.ts` (D-089);
   - qualquer implementação de perfis, concessões ou atribuições tem de passar `tests/support/authorization-repository-contract.ts` (D-183); a persistência e a avaliação RBAC usam só `OFFICIAL_PERMISSION_CATALOG` e nunca recebem catálogos, concessões ou decisões do consumidor (D-181, D-182); uma decisão de domínio nunca é autorização operacional (D4); nenhum caminho de escrita usa `REPLACE` nem `rowid` explícito nas tabelas RBAC e de identidades, nem elimina associações empresariais nem altera `installation_bootstrap` (a migração 7 corrigida recusa-o; D-195 a D-197);
   - o directório de identidades (`UserDirectory`) é provisionamento interno: nunca o expor a um tenant, por HTTP ou por IPC (D-087);
   - autenticação, credenciais e inicialização são internas (D-093 a D-096). Uma `AuthenticatedIdentity` só é válida se `isAuthenticatedIdentity` a reconhecer, e nunca é uma autorização empresarial;
   - sessões só se criam com o comprovativo interno (D-108). Tokens nunca em registos, erros, base ou documentação (D-113). Qualquer novo caminho de escrita sobre o estado da identidade ou a credencial tem de respeitar os triggers de versão da migração 4 (D-110, D-111). A administração de sessões é interna (D-116);
   - parâmetros de derivação nunca abaixo do mínimo OWASP (D-090); palavras-passe, *hashes* e sais nunca em registos;
   - o acesso à base passa pelo serviço local em `READY` (D-047). Com E1.07-X, o serviço detém a base em exclusivo: ferramentas externas não a abrem com o serviço activo, e as cópias consistentes passam pela instância proprietária (D-133).

   Registar divergências na tabela de pendências e decisões novas aprovadas em `decisions.md`.
7. Ao concluir:
   1. Executar `pnpm.cmd check` (e `smoke` se o desktop for alterado).
   2. Actualizar o ficheiro da tarefa e este documento.
   3. Criar um único commit com a mensagem indicada na tarefa e confirmar que a árvore de trabalho está limpa.
   4. Publicar a branch da tarefa com `git push origin <branch>`, sem *force*. A integração em `main` só acontece após revisão independente e aprovação do responsável (D-117).
   5. Confirmar que `git rev-parse HEAD` é igual a `git ls-remote origin refs/heads/<branch>`.

   A tarefa só conta como publicada depois desta confirmação. Se a autenticação falhar, comunicar o bloqueio. A ferramenta `gh` não está instalada nesta máquina; o `push` usa o gestor de credenciais do Git.
