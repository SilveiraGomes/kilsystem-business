import type { SqliteDatabase } from '../../packages/database/src/index';
import type { Cleanup } from './cleanup-after';
import type { TemporaryDatabase } from './sqlite-harness';

/** O que as limpezas usam de um `ServiceUnderTest`: a paragem e as ligações que o serviço abriu. */
export interface StoppableService {
  readonly service: { readonly stop: () => Promise<void> };
  readonly connections: readonly SqliteDatabase[];
}

/*
 * E1.07-PD87-C1 (RV-PD87M-03; PD-57, D-158) — limpezas, para `runThenCleanUp`, de um teste que
 * inicia serviços locais sobre uma base temporária. Pela ordem:
 *
 * 1. parar todos os serviços (a falha de um não impede a paragem dos outros);
 * 2. confirmar que todas as ligações SQLite abertas pelos serviços estão fechadas. Uma ligação
 *    ainda aberta é uma fuga e é comunicada como falha; é fechada antes de continuar, para a
 *    eliminação nunca correr com a base detida;
 * 3. só com o encerramento confirmado, apagar a base (`dispose` remove só a pasta própria do ensaio,
 *    por caminho literal). Sem confirmação, a base não é apagada e a pasta fica pendente, visível no
 *    `afterAll` de `tests/setup.ts`.
 *
 * Não é um mecanismo paralelo: a ordem, a falha principal e as secundárias continuam a ser as de
 * `runThenCleanUp`. A lista de serviços é lida quando as limpezas correm, por isso pode ser
 * preenchida pelo corpo do teste.
 */

export class ServiceConnectionLeakError extends Error {
  constructor(
    readonly leaked: number,
    readonly stillOpen: number,
    readonly closeFailures: readonly unknown[],
  ) {
    super(
      `Fuga de ligações SQLite: ${String(leaked)} ligação(ões) dos serviços abertas depois de stop()` +
        (stillOpen === 0 ? ' (fechadas antes de apagar a base).' : `; ${String(stillOpen)} continuam abertas e a base não é apagada.`),
      closeFailures.length > 0 ? { cause: closeFailures.length === 1 ? closeFailures[0] : new AggregateError(closeFailures) } : undefined,
    );
    this.name = 'ServiceConnectionLeakError';
  }
}

export const stopServicesThenDispose = (
  services: readonly StoppableService[],
  temporary: Pick<TemporaryDatabase, 'dispose'>,
): readonly Cleanup[] => {
  let released = false;
  return [
    async () => {
      const failures: unknown[] = [];
      for (const harness of services) {
        try {
          await harness.service.stop();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, 'Várias falhas ao parar os serviços (PD87-C1).');
    },
    () => {
      const connections = services.flatMap((harness) => harness.connections);
      const leaked = connections.filter((connection) => connection.open);
      const closeFailures: unknown[] = [];
      for (const connection of leaked) {
        try {
          connection.close();
        } catch (error) {
          closeFailures.push(error);
        }
      }
      const stillOpen = connections.filter((connection) => connection.open).length;
      released = stillOpen === 0;
      if (leaked.length > 0) throw new ServiceConnectionLeakError(leaked.length, stillOpen, closeFailures);
    },
    () => {
      if (!released) throw new Error('Base temporária não apagada: o encerramento das ligações SQLite não foi confirmado (PD-57).');
      temporary.dispose();
    },
  ];
};
