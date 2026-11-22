import { fileURLToPath } from 'node:url';

import { runLocalServiceCli } from './cli.js';
import { resolveProtectedDirectories } from './protected-directories.js';
import { createProcessTerminal } from './terminal.js';

// Ponto de entrada do serviço local. Lê a configuração de `process.env` (nenhum `.env` é carregado)
// e não abre portas de rede.
const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] =
  process.platform === 'win32' ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM'];

const waitForShutdownSignal = (): Promise<string> =>
  new Promise((resolve) => {
    // Os ouvintes de sinais não mantêm o processo vivo; este temporizador mantém-no até ao encerramento.
    const keepAlive = setInterval(() => undefined, 60_000);
    const onSignal = (signal: NodeJS.Signals): void => {
      clearInterval(keepAlive);
      for (const name of SHUTDOWN_SIGNALS) process.off(name, onSignal);
      resolve(signal);
    };
    for (const name of SHUTDOWN_SIGNALS) process.once(name, onSignal);
  });

process.exitCode = await runLocalServiceCli(
  process.argv.slice(2),
  process.env,
  { sink: (line) => process.stdout.write(`${line}\n`), terminal: createProcessTerminal(), waitForShutdownSignal },
  { protectedDirectories: resolveProtectedDirectories(fileURLToPath(new URL('.', import.meta.url))) },
);
