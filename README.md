# KIL Business

Fundação tecnológica do ERP multiempresa, multissectorial, híbrido e modular da KIL System Services, Lda.

## Pré-requisitos

- Node.js 20.16 ou superior (LTS recomendado; inferior a 23)
- pnpm 9.15.x
- Git 2.x

No Windows, se a política de execução bloquear `pnpm.ps1`, use `pnpm.cmd` sem alterar a política global.

## Começar

```sh
pnpm install
pnpm check
```

Para iniciar a aplicação Electron em desenvolvimento:

```sh
pnpm --filter @kil-business/desktop dev
```

Para validar o arranque do Electron após a compilação:

```sh
pnpm --filter @kil-business/desktop smoke
```

Copie `.env.example` para `.env` apenas no ambiente local e substitua os marcadores. Nunca versione credenciais.

## Estrutura

- `apps/desktop`: aplicação Electron + React + Vite.
- `apps/admin-portal`: portal administrativo React + Vite.
- `apps/mobile-monitor`: espaço reservado para o futuro KIL Business Monitor em React Native.
- `services/local-api`: API Fastify para operações locais.
- `services/central-api`: API Fastify para serviços centrais.
- `services/sync-service`: futuro serviço de sincronização.
- `packages/*`: contratos e capacidades partilhadas, ainda sem regras de negócio.
- `tests`: verificações transversais iniciais.
- `docs`: decisões de arquitectura.

Consulte [docs/architecture.md](docs/architecture.md) e [AGENTS.md](AGENTS.md) antes de contribuir. Para retomar o trabalho noutra sessão ou com outro agente, comece por [docs/project-status.md](docs/project-status.md).
