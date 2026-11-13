import { spawn } from 'node:child_process';

import electronPath from 'electron';

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  env: environment,
  stdio: 'inherit',
  windowsHide: false,
});

child.once('error', (error) => {
  console.error('Não foi possível iniciar o Electron.', error);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`Electron terminou com o sinal ${signal}.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
