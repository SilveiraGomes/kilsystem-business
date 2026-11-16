import {
  changeUserStatus,
  createUser,
  parseOneOf,
  RecordConflictError,
  RecordNotFoundError,
  USER_STATUSES,
  type User,
  type UserDirectory,
  type UserId,
} from '@kil-business/shared-types';

import type { SqliteDatabase } from './connection.js';
import { INSERT_USER_SQL, toUser, USER_COLUMNS, userParameters } from './sqlite-rows.js';
import { prepareAll, settle } from './sqlite-support.js';

// Consultas apenas por identificador ou unicidade; não existe pesquisa nem listagem (D-087).
const SQL = {
  userById: `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`,
  userIdExists: 'SELECT 1 FROM users WHERE id = ?',
  usernameTaken: 'SELECT 1 FROM users WHERE username = ?',
  insertUser: INSERT_USER_SQL,
  updateUserStatus: 'UPDATE users SET status = @status, updated_at = @updatedAt WHERE id = @id',
} as const;

/**
 * Directório SQLite das identidades locais da instalação (E1.07-A). Provisionamento INTERNO:
 * composto apenas pelo serviço local e nunca exposto por HTTP, IPC ou ao contexto de um tenant.
 */
export const createSqliteUserDirectory = (database: SqliteDatabase): UserDirectory => {
  const statements = prepareAll(database, SQL);

  const find = (id: UserId): User | undefined => {
    const row: unknown = statements.userById.get(id);
    return row === undefined ? undefined : toUser(row);
  };

  const immediate = <T>(operation: () => T): Promise<T> =>
    settle(() => database.transaction(operation).immediate());

  return {
    findById: (id) => settle(() => find(id)),
    create: (candidate) =>
      immediate(() => {
        const user = createUser(candidate);
        if (statements.userIdExists.get(user.id) !== undefined) throw new RecordConflictError('duplicate-id');
        if (statements.usernameTaken.get(user.username) !== undefined) {
          throw new RecordConflictError('duplicate-username');
        }
        statements.insertUser.run(userParameters(user));
      }),
    changeStatus: (id, status, at) =>
      immediate(() => {
        const current = find(id);
        if (current === undefined) throw new RecordNotFoundError('User');
        const next = changeUserStatus(current, parseOneOf(status, USER_STATUSES, 'status'), at);
        statements.updateUserStatus.run({ id: next.id, status: next.status, updatedAt: next.updatedAt });
        return next;
      }),
  };
};
