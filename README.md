# KIL Business

Fundação tecnológica do ERP multiempresa, multissectorial, híbrido e modular da KIL System Services, Lda.

## Pré-requisitos

- Node.js **24.22.3** (LTS “Krypton”; versão em [`.node-version`](.node-version)). O ficheiro `.npmrc` activa `engine-strict`, pelo que o `pnpm install` recusa outras versões (`engines.node`: `>=24.22.3 <25`).
- pnpm 9.15.9 (`packageManager` em `package.json`).
- Git 2.x.
- Em Windows x64 com Node 24 não são necessárias ferramentas de compilação C++: o `better-sqlite3` 12.11.1 descarrega um binário pré-compilado. Noutras plataformas sem binário, o `node-gyp` precisa de compilador C++ e Python 3.

Instale o Node 24.22.3 a partir de [nodejs.org](https://nodejs.org/dist/v24.22.3/) ou com um gestor de versões que leia `.node-version` (por exemplo, fnm). Para manter outra versão no sistema, use um Node isolado e ponha-o à frente no PATH apenas na sessão; ver [docs/project-status.md](docs/project-status.md#ambiente-de-referência).

No Windows, se a política de execução bloquear `pnpm.ps1`, use `pnpm.cmd` sem alterar a política global.

## Começar

```sh
node -v                          # v24.22.3
pnpm install --frozen-lockfile
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

O desktop usa Electron **45.3.2** (Chromium 156.0.8078.100 e Node.js 24.22.2
incorporados), independentemente do Node.js 24.22.3 usado pelos serviços e pelas
ferramentas do monorepositório. O renderer corre com isolamento de contexto,
sandbox e segurança web activos, sem integração Node.js; permissões, novas janelas,
`webview` e navegação para documentos externos são recusadas.

Os testes usam Vitest **5.1.0** com a configuração única `vitest.config.ts` da
raiz. Executam o código-fonte dos pacotes (`src/`), sem depender de `dist/`, e
podem ser lançados a partir da raiz (`pnpm test`) ou do desktop
(`pnpm --filter @kil-business/desktop test`).

Copie `.env.example` para `.env` apenas no ambiente local e substitua os marcadores. Nunca versione credenciais. O serviço local não lê ficheiros `.env`: as variáveis `LOCAL_DATABASE_PATH` e `LOCAL_SERVICE_*` têm de estar definidas no ambiente do processo.

## Estrutura

- `apps/desktop`: aplicação Electron + React + Vite.
- `apps/admin-portal`: portal administrativo React + Vite.
- `apps/mobile-monitor`: espaço reservado para o futuro KIL Business Monitor em React Native.
- `services/local-api`: serviço local Node.js que gere o ciclo de vida da base SQLite (sem HTTP nesta fase); ver [docs/tasks/E1.05.md](docs/tasks/E1.05.md).
- `services/central-api`: API Fastify para serviços centrais.
- `services/sync-service`: futuro serviço de sincronização.
- `packages/shared-types`: contratos de domínio multiempresa, identidades locais e associações a empresas e estabelecimentos.
- `packages/database`: persistência SQLite local isolada por empresa, incluindo identidades e associações (migração 2).
- Restantes `packages/*`: fronteiras partilhadas, ainda sem regras de negócio.
- `tests`: verificações transversais iniciais.
- `docs`: decisões de arquitectura.

O sistema **ainda não tem sessões nem autorização funcional**. Desde E1.07-A
existem identidades locais e associações multiempresa. Desde E1.07-B existe
autenticação local offline por username e palavra-passe:
- Argon2id nativo do Node.js;
- política NIST SP 800-63B;
- limitação persistente de tentativas;
- inicialização explícita da instalação, sem contas predefinidas.

Estas funções existem apenas na composição interna do serviço local, sem HTTP nem
IPC. O plano das subtarefas seguintes está em [docs/tasks/E1.07.md](docs/tasks/E1.07.md).

Consulte [docs/architecture.md](docs/architecture.md) e [AGENTS.md](AGENTS.md) antes de contribuir. Para retomar o trabalho noutra sessão ou com outro agente, comece por [docs/project-status.md](docs/project-status.md).
