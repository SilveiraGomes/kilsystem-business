/*
 * E1.07-PD87-C2 (RV-C1M-01) — testes que podem ser ignorados em execução (`context.skip()`). Um
 * teste ignorado em execução correu os *hooks* (a guarda começou-o e terminou-o), mas o Vitest marca-o
 * `skip` e descarta os erros dos seus `afterEach`. Por isso o `afterAll` de `tests/setup.ts` aceita
 * esse estado só para os testes desta lista, e comunica os problemas da guarda que o Vitest descartou.
 * Nenhuma sentinela de Argon2id real pode constar desta lista ([C2-S01]).
 */

/** Marcas dos testes que podem chamar `context.skip()` por uma limitação conhecida do ambiente. */
export const RUNTIME_SKIP_ALLOWED: readonly string[] = Object.freeze([
  // Ligações simbólicas de ficheiro exigem privilégio em Windows (`EPERM` sem o modo de programador).
  '[X02]',
]);

/**
 * Só para os ensaios em processo filho ([C2-P02]): com o valor `1`, o `[X02]` comporta-se como num
 * Windows sem privilégio para ligações simbólicas de ficheiro (a criação falha com `EPERM`).
 */
export const SIMULATE_FILE_SYMLINK_EPERM_ENV = 'KIL_TEST_SIMULATE_FILE_SYMLINK_EPERM';
