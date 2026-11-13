# Padrões de desenvolvimento do KIL Business

## Âmbito

Estas regras aplicam-se a todo o monorepositório. Alterações devem ser pequenas, auditáveis e restritas ao requisito em execução. Não antecipar funcionalidades de negócio.

## Código e arquitectura

- Usar TypeScript em modo `strict`; evitar `any`, coerções inseguras e efeitos laterais implícitos.
- Separar UI, transporte, aplicação, domínio e persistência. Pacotes partilhados não dependem de aplicações.
- Preferir contratos explícitos, funções pequenas, nomes claros e dependências injectadas.
- Manter APIs locais e centrais independentes. Não acoplar o cliente directamente à base central.
- Registar decisões arquitecturais relevantes em `docs/`.

## Isolamento multiempresa

- Todo dado empresarial deve possuir um identificador de tenant/empresa inequívoco.
- O tenant deve vir de contexto autenticado e validado; nunca confiar num identificador fornecido apenas pelo cliente.
- Todas as consultas, comandos, caches, eventos, ficheiros e logs com dados empresariais devem ser filtrados e segregados por tenant.
- Proibir acessos sem escopo e relações entre tenants, excepto processos administrativos explicitamente autorizados e auditados.
- Testar casos de acesso cruzado entre empresas sempre que persistência ou autorização forem introduzidas.

## Contabilidade, fiscalidade e auditoria

- Valores monetários futuros devem usar representação decimal segura, nunca ponto flutuante binário.
- Lançamentos contabilísticos e documentos fiscais devem ser imutáveis ou corrigidos por operações auditáveis, conforme os requisitos aplicáveis.
- Não implementar regras legais por suposição; documentar fonte, versão e vigência antes da codificação.

## Segurança e privacidade

- Nunca versionar segredos, tokens, dados pessoais reais, bases de produção ou certificados privados.
- Validar entradas nas fronteiras, aplicar menor privilégio e evitar dados sensíveis em logs e mensagens de erro.
- Dependências novas exigem justificação, versão compatível e verificação de manutenção/licença.
- O servidor de licenciamento KIL permanece um sistema independente. Não inventar endpoints nem contratos; usar futuramente um adaptador configurável.

## Testes e qualidade

- Executar `pnpm check` antes de concluir uma alteração.
- Toda regra de negócio futura exige testes unitários; integrações exigem testes de contrato/integração apropriados.
- Testes multiempresa devem incluir isolamento positivo e negativo.
- Não ignorar, desactivar ou declarar aprovado um teste que não foi executado. Falhas devem ser reportadas.

## Convenções de trabalho

- Usar Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).
- Não alterar ficheiros fora do âmbito nem apagar trabalho alheio.
- Manter `.env.example` sem valores secretos e actualizar documentação quando a configuração mudar.
- Não criar bases de produção em tarefas de desenvolvimento.

## Continuidade entre agentes

Estas regras complementam as anteriores e aplicam-se a qualquer agente (Codex, Claude Code ou outro), incluindo sessões iniciadas sem contexto prévio.

- Ao iniciar, ler `AGENTS.md`, `docs/project-status.md`, `docs/architecture.md`, `docs/decisions.md` e o ficheiro da tarefa activa em `docs/tasks/`; confirmar o estado real com `git log --oneline` e `git status` antes de agir.
- Trabalhar apenas no âmbito do ficheiro da tarefa activa. Uma tarefa com estado “proposta” não pode ser implementada sem aprovação explícita do responsável do projecto.
- Registar como facto apenas o que foi verificado no repositório ou executado na própria sessão (commits, testes, builds, smoke tests). O que não foi executado é registado como “não verificado”.
- Divergências entre planeamento e implementação são registadas como pendências em `docs/project-status.md`; decisões arquitecturais não são tomadas por iniciativa própria.
- Decisões aprovadas são acrescentadas a `docs/decisions.md`; uma decisão substituída recebe nova entrada que a referencia, sem reescrever o histórico.
- Ao concluir, executar `pnpm check`, actualizar o ficheiro da tarefa e `docs/project-status.md`, criar o commit indicado na tarefa e confirmar que a árvore de trabalho ficou limpa.
- Não alterar configuração global da máquina (política de execução do PowerShell, `git config --global`) para contornar bloqueios; usar as alternativas locais descritas em `docs/project-status.md`.
