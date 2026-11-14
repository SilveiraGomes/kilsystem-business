# KIL Business — entrada para o Claude Code

Este ficheiro é apenas um ponto de entrada. As regras do projecto estão em `AGENTS.md`, partilhado por todos os agentes, e aplicam-se integralmente ao Claude Code:

@AGENTS.md

## Leitura obrigatória antes de alterar

1. [docs/project-status.md](docs/project-status.md) — estado verificado, comandos, pendências e protocolo de retoma.
2. [docs/architecture.md](docs/architecture.md) — arquitectura técnica e de negócio.
3. [docs/decisions.md](docs/decisions.md) — decisões em vigor.
4. [docs/implementation-plan.md](docs/implementation-plan.md) e o ficheiro da tarefa activa em [docs/tasks/](docs/tasks/).

## Notas deste ambiente (Windows)

- Node.js 24.22.3 isolado em `%LOCALAPPDATA%\KIL-Tools\node\node-v24.22.3-win-x64`; o Node do sistema (20.16.0) não é suportado pelo projecto. Em cada comando PowerShell, antes de `pnpm.cmd`: `$env:Path = "$env:LOCALAPPDATA\KIL-Tools\node\node-v24.22.3-win-x64;" + $env:Path`. Nunca alterar o PATH global.
- Usar `pnpm.cmd` em PowerShell; validação final: `pnpm.cmd check`.
- Se o Git indicar *dubious ownership*, usar `git -c safe.directory=C:/KIL-BUSINESS <comando>` em cada invocação, sem alterar a configuração global.
