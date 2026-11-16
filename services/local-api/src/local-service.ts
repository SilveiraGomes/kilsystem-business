import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  createSqliteAuthenticationStore,
  createSqliteMembershipPersistence,
  createSqliteTenantPersistence,
  createSqliteUserDirectory,
  inspectMigrations,
  openSqliteDatabase,
  PersistenceError,
  resolveDatabaseLocation,
  runMigrations,
  type OpenSqliteOptions,
  type SqliteAuthenticationStore,
  type SqliteDatabase,
  type SqliteMembershipPersistence,
  type SqliteTenantPersistence,
  type TenantStores,
} from '@kil-business/database';
import {
  EMPTY_COMMON_PASSWORD_LIST,
  type BranchMembershipRepository,
  type BranchRepository,
  type CommonPasswordList,
  type CompanyMembershipRepository,
  type CompanyRepository,
  type MembershipScopeReader,
  type UserDirectory,
} from '@kil-business/shared-types';

import type { AuthenticationBackend } from './authentication/authentication-backend.js';
import { createCredentialManager, type CredentialManager } from './authentication/credential-manager.js';
import { createInstallationBootstrap, type InstallationBootstrap } from './authentication/installation-bootstrap.js';
import { createLocalAuthenticator, type LocalAuthenticator } from './authentication/local-authenticator.js';
import { createPasswordHasher, type PasswordHasherOptions } from './authentication/password-hashing.js';
import type { LocalServiceConfig } from './config.js';
import type { LogFields, Logger } from './logger.js';

export const LOCAL_SERVICE_STATES = ['STOPPED', 'STARTING', 'READY', 'STOPPING', 'FAILED'] as const;

export type LocalServiceState = (typeof LOCAL_SERVICE_STATES)[number];

/** Transições permitidas; qualquer outra é recusada com `LocalServiceStateError`. */
export const LOCAL_SERVICE_TRANSITIONS: Readonly<Record<LocalServiceState, readonly LocalServiceState[]>> =
  Object.freeze({
    STOPPED: ['STARTING'],
    STARTING: ['READY', 'FAILED'],
    READY: ['STOPPING'],
    STOPPING: ['STOPPED', 'FAILED'],
    FAILED: ['STARTING', 'STOPPED'],
  });

export type LocalServiceStateErrorReason = 'invalid-transition' | 'not-ready';

export class LocalServiceStateError extends Error {
  override readonly name = 'LocalServiceStateError';

  constructor(
    readonly reason: LocalServiceStateErrorReason,
    readonly state: LocalServiceState,
  ) {
    super(`Operação recusada no estado ${state}: ${reason}.`);
  }
}

export type StartupFailureReason =
  | 'database-missing'
  | 'database-open-failed'
  | 'invalid-location'
  | 'migration-failed'
  | 'migration-integrity'
  | 'pending-migrations'
  | 'unexpected';

export class LocalServiceStartupError extends Error {
  override readonly name = 'LocalServiceStartupError';

  constructor(
    readonly reason: StartupFailureReason,
    options?: { readonly cause?: unknown },
  ) {
    super(`Falha no arranque do serviço local: ${reason}.`, options);
  }
}

export interface StartupReport {
  readonly createdDatabase: boolean;
  readonly appliedMigrations: readonly number[];
  readonly schemaVersion: number;
}

export interface LocalServiceDependencies {
  readonly logger: Logger;
  /** Directórios onde a base nunca pode ficar (ver `resolveProtectedDirectories`). */
  readonly protectedDirectories: readonly string[];
  /** Abertura da ligação; substituível em testes. Por omissão, `openSqliteDatabase`. */
  readonly openDatabase?: (options: OpenSqliteOptions) => SqliteDatabase | Promise<SqliteDatabase>;
  /** Relógio das operações de autenticação; substituível em testes. Por omissão, a hora do sistema. */
  readonly clock?: () => Date;
  /**
   * Derivação de palavras-passe. Por omissão, os parâmetros de produção (D-090); parâmetros
   * abaixo do mínimo OWASP são recusados.
   */
  readonly passwordHashing?: PasswordHasherOptions;
  /** Lista local de palavras-passe comuns ou comprometidas (PD-33). */
  readonly commonPasswords?: CommonPasswordList;
}

export interface LocalService {
  readonly state: LocalServiceState;
  /** Resultado do último arranque bem-sucedido. */
  readonly startupReport: StartupReport | undefined;
  readonly lastFailure: StartupFailureReason | undefined;
  /** Idempotente: em `READY` não faz nada; durante `STARTING` devolve o arranque em curso. */
  start(): Promise<void>;
  /** Idempotente: em `STOPPED` não faz nada; liberta sempre a ligação SQLite. */
  stop(): Promise<void>;
  /** Repositórios multiempresa; recusam operações fora de `READY` (`LocalServiceStateError`). */
  readonly companies: CompanyRepository;
  readonly branches: BranchRepository;
  transaction<T>(work: (stores: TenantStores) => T): T;
  /**
   * Provisionamento INTERNO de identidades locais (D-087): sem contexto empresarial, reservado à
   * composição interna do serviço; nunca exposto por HTTP, IPC Electron nem interface pública.
   * Recusa operações fora de `READY`.
   */
  readonly identityProvisioning: {
    readonly users: UserDirectory;
    /** Gestão interna de credenciais (D-095). */
    readonly credentials: CredentialManager;
    /** Inicialização explícita e irrepetível da instalação (D-096). */
    readonly installation: InstallationBootstrap;
  };
  /** Associações empresariais e locais; exigem `TenantContext` e recusam operações fora de `READY`. */
  readonly companyMemberships: CompanyMembershipRepository;
  readonly branchMemberships: BranchMembershipRepository;
  /** Avaliação interna de elegibilidade (D-088); não é autenticação nem autorização. */
  readonly membershipScopes: MembershipScopeReader;
  /**
   * Autenticação local offline por username e palavra-passe (D-093). O resultado não é uma
   * sessão nem uma autorização empresarial.
   */
  readonly authentication: LocalAuthenticator;
}

/** Repositórios activos enquanto a ligação está aberta; descartados no encerramento. */
interface ServiceStores {
  readonly tenant: SqliteTenantPersistence;
  readonly users: UserDirectory;
  readonly memberships: SqliteMembershipPersistence;
  readonly authentication: SqliteAuthenticationStore;
}

// Os registos identificam a causa pelo nome e motivo, nunca pela mensagem (pode conter caminhos ou SQL).
const describeCause = (cause: unknown): LogFields => ({
  causeName: cause instanceof Error ? cause.name : null,
  causeReason: cause instanceof PersistenceError ? cause.reason : null,
});

const settle = <T>(operation: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve) => {
    resolve(operation());
  });

/**
 * Serviço local Node.js, independente do Electron, que gere o ciclo de vida da persistência
 * SQLite (E1.05). Não abre portas de rede nem expõe SQL.
 */
export const createLocalService = (
  config: LocalServiceConfig,
  {
    clock = () => new Date(),
    commonPasswords = EMPTY_COMMON_PASSWORD_LIST,
    logger,
    openDatabase = openSqliteDatabase,
    passwordHashing,
    protectedDirectories,
  }: LocalServiceDependencies,
): LocalService => {
  // Criado antes do arranque: parâmetros inválidos são recusados de imediato.
  const hasher = createPasswordHasher(passwordHashing);
  let state: LocalServiceState = 'STOPPED';
  let database: SqliteDatabase | undefined;
  let stores: ServiceStores | undefined;
  let starting: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  let startupReport: StartupReport | undefined;
  let lastFailure: StartupFailureReason | undefined;
  const databaseFile = path.basename(config.databasePath);

  const transition = (next: LocalServiceState): void => {
    if (!LOCAL_SERVICE_TRANSITIONS[state].includes(next)) {
      throw new LocalServiceStateError('invalid-transition', state);
    }
    logger.log('info', 'service.state_changed', { from: state, to: next });
    state = next;
  };

  const release = (): void => {
    stores = undefined;
    const connection = database;
    database = undefined;
    if (connection?.open) connection.close();
  };

  const attempt = <T>(reason: StartupFailureReason, action: () => T): T => {
    try {
      return action();
    } catch (error) {
      throw new LocalServiceStartupError(reason, { cause: error });
    }
  };

  const initialise = async (): Promise<StartupReport> => {
    const location = attempt('invalid-location', () =>
      resolveDatabaseLocation(config.databasePath, { protectedDirectories }),
    );
    const existed = existsSync(location);
    const mustExist = config.startupPolicy.onMissingDatabase === 'fail';
    if (!existed && mustExist) throw new LocalServiceStartupError('database-missing');

    try {
      database = await openDatabase({ fileMustExist: mustExist, filename: location });
    } catch (error) {
      throw new LocalServiceStartupError('database-open-failed', { cause: error });
    }
    const connection = database;
    logger.log('info', 'service.database_opened', { createdDatabase: !existed, databaseFile });

    const status = attempt('migration-integrity', () => inspectMigrations(connection));
    if (status.pendingVersions.length > 0 && config.startupPolicy.onPendingMigrations === 'fail') {
      throw new LocalServiceStartupError('pending-migrations');
    }
    const result = attempt('migration-failed', () => runMigrations(connection));
    stores = {
      authentication: createSqliteAuthenticationStore(connection),
      memberships: createSqliteMembershipPersistence(connection),
      tenant: createSqliteTenantPersistence(connection),
      users: createSqliteUserDirectory(connection),
    };
    return { appliedMigrations: result.applied, createdDatabase: !existed, schemaVersion: result.currentVersion };
  };

  const run = async (): Promise<void> => {
    logger.log('info', 'service.starting', {
      databaseFile,
      environment: config.environment,
      onMissingDatabase: config.startupPolicy.onMissingDatabase,
      onPendingMigrations: config.startupPolicy.onPendingMigrations,
    });
    try {
      startupReport = await initialise();
      lastFailure = undefined;
      transition('READY');
      logger.log('info', 'service.ready', { ...startupReport });
    } catch (error) {
      const failure =
        error instanceof LocalServiceStartupError
          ? error
          : new LocalServiceStartupError('unexpected', { cause: error });
      try {
        release();
      } catch (closeError) {
        database = undefined;
        logger.log('error', 'service.release_failed', describeCause(closeError));
      }
      lastFailure = failure.reason;
      transition('FAILED');
      logger.log('error', 'service.start_failed', { reason: failure.reason, ...describeCause(failure.cause) });
      throw failure;
    }
  };

  const start = async (): Promise<void> => {
    if (starting) return starting;
    if (stopping) {
      await stopping;
      return start();
    }
    if (state === 'READY') return;
    transition('STARTING');
    starting = run();
    try {
      await starting;
    } finally {
      starting = undefined;
    }
  };

  const shutdown = (): void => {
    try {
      release();
      transition('STOPPED');
      logger.log('info', 'service.stopped');
    } catch (error) {
      database = undefined;
      transition('FAILED');
      logger.log('error', 'service.stop_failed', describeCause(error));
      throw error;
    }
  };

  const stop = async (): Promise<void> => {
    if (stopping) return stopping;
    if (starting) {
      await starting.catch(() => undefined);
      return stop();
    }
    if (state === 'STOPPED') return;
    if (state === 'FAILED') {
      // Os recursos já foram libertados quando o arranque falhou.
      transition('STOPPED');
      return;
    }
    transition('STOPPING');
    stopping = new Promise<void>((resolve) => {
      shutdown();
      resolve();
    });
    try {
      await stopping;
    } finally {
      stopping = undefined;
    }
  };

  // Cada chamada volta a verificar o estado: referências obtidas antes do encerramento deixam de
  // funcionar, porque nunca apontam directamente para os repositórios da ligação.
  const ready = (): ServiceStores => {
    if (state !== 'READY' || stores === undefined) throw new LocalServiceStateError('not-ready', state);
    return stores;
  };

  const guarded = <T>(operation: (current: ServiceStores) => Promise<T>): Promise<T> =>
    settle(() => operation(ready()));

  const companies: CompanyRepository = {
    findById: (context, id) => guarded((current) => current.tenant.companies.findById(context, id)),
    create: (context, company) => guarded((current) => current.tenant.companies.create(context, company)),
    update: (context, company) => guarded((current) => current.tenant.companies.update(context, company)),
    delete: (context, id) => guarded((current) => current.tenant.companies.delete(context, id)),
  };

  const branches: BranchRepository = {
    findById: (context, id) => guarded((current) => current.tenant.branches.findById(context, id)),
    listByCompany: (context, companyId) =>
      guarded((current) => current.tenant.branches.listByCompany(context, companyId)),
    create: (context, branch) => guarded((current) => current.tenant.branches.create(context, branch)),
    update: (context, branch) => guarded((current) => current.tenant.branches.update(context, branch)),
    delete: (context, id) => guarded((current) => current.tenant.branches.delete(context, id)),
  };

  const users: UserDirectory = {
    findById: (id) => guarded((current) => current.users.findById(id)),
    create: (user) => guarded((current) => current.users.create(user)),
    changeStatus: (id, status, at) => guarded((current) => current.users.changeStatus(id, status, at)),
  };

  const companyMemberships: CompanyMembershipRepository = {
    findById: (context, id) => guarded((current) => current.memberships.companyMemberships.findById(context, id)),
    findByUser: (context, userId) =>
      guarded((current) => current.memberships.companyMemberships.findByUser(context, userId)),
    listByCompany: (context, companyId) =>
      guarded((current) => current.memberships.companyMemberships.listByCompany(context, companyId)),
    create: (context, membership) =>
      guarded((current) => current.memberships.companyMemberships.create(context, membership)),
    update: (context, membership) =>
      guarded((current) => current.memberships.companyMemberships.update(context, membership)),
  };

  const branchMemberships: BranchMembershipRepository = {
    findById: (context, id) => guarded((current) => current.memberships.branchMemberships.findById(context, id)),
    listByCompanyMembership: (context, companyMembershipId) =>
      guarded((current) => current.memberships.branchMemberships.listByCompanyMembership(context, companyMembershipId)),
    create: (context, membership) =>
      guarded((current) => current.memberships.branchMemberships.create(context, membership)),
    update: (context, membership) =>
      guarded((current) => current.memberships.branchMemberships.update(context, membership)),
  };

  const membershipScopes: MembershipScopeReader = {
    evaluate: (context, userId) => guarded((current) => current.memberships.scopes.evaluate(context, userId)),
  };

  // Autenticação (E1.07-B): cada operação obtém o armazenamento em `READY` e, depois de cada
  // derivação assíncrona, confirma que continua a ser o da ligação activa. Uma derivação que
  // termine após `stop()` (ou após um novo arranque) é recusada sem escrever (D-097).
  const authenticationBackend: AuthenticationBackend = Object.freeze({
    acquire: () => ready().authentication,
    assertCurrent: (store: SqliteAuthenticationStore) => {
      if (state !== 'READY' || stores?.authentication !== store) throw new LocalServiceStateError('not-ready', state);
    },
    clock,
    commonPasswords,
    hasher,
  });

  return {
    get state() {
      return state;
    },
    get startupReport() {
      return startupReport;
    },
    get lastFailure() {
      return lastFailure;
    },
    start,
    stop,
    companies,
    branches,
    transaction: (work) => ready().tenant.transaction(work),
    identityProvisioning: Object.freeze({
      credentials: createCredentialManager(authenticationBackend),
      installation: createInstallationBootstrap(authenticationBackend),
      users,
    }),
    companyMemberships,
    branchMemberships,
    membershipScopes,
    authentication: createLocalAuthenticator(authenticationBackend),
  };
};
