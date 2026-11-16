import { createInterface } from 'node:readline';

/*
 * Processo de ensaio E1.07-X: executa o ponto de entrada real do serviço local (`main.ts`).
 * Em Windows, o Node não consegue enviar SIGINT a um processo filho (termina-o à força); a linha
 * `SIGINT` em stdin entrega o sinal aos mesmos ouvintes que o Ctrl+C da consola.
 */
const commands = createInterface({ input: process.stdin });
commands.on('line', (line) => {
  if (line.trim() === 'SIGINT') process.emit('SIGINT', 'SIGINT');
});

await import('../../../services/local-api/src/main');
commands.close();
process.stdin.destroy();
