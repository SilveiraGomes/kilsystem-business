import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  createSqliteAuthenticationStore,
  createSqliteAuthorizationPersistence,
  createSqliteMembershipPersistence,
  createSqliteSessionStore,
  createSqliteTenantPersistence,
  createSqliteUserDirectory,
  DEFAULT_DATABASE_LOCK_TIMEOUT_MS,
  inspectMigrations,
  isSqliteBusy,
  MAX_DATABASE_LOCK_TIMEOUT_MS,
  openSqliteDatabase,
  PersistenceError,
  resolveDatabaseIdentity,
  resolveDatabaseLocation,
  runMigrations,
  sqliteErrorCode,
  verifyExclusiveOwnership,
  type OpenSqliteOptions,
  type RolePermissionDiagnostics,
  type SqliteAuthenticationStore,
  type SqliteAuthorizationPersistence,
  type SqliteDatabase,
  type SqliteMembershipPersistence,
  type SqliteSessionStore,
  type SqliteTenantPersistence,
  type TenantStores,
} from '@kil-business/database';
import {
  EMPTY_COMMON_PASSWORD_LIST,
  OFFICIAL_PERMISSION_CATALOG,
  parseSessionPolicy,
  type BranchMembershipRepository,
  type BranchRepository,
  type CommonPasswordList,
  type CompanyMembershipRepository,
  type CompanyRepository,
  type MembershipScopeReader,
  type RoleAssignmentRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type SessionPolicy,
  type UserDirectory,
} from '@kil-business/shared-types';

import type { AuthenticationBackend } from './authentication/authentication-backend.js';
import { createCredentialManager, type CredentialManager } from './authentication/credential-manager.js';
import {
  createInternalDomainAuthorizationEvaluator,
  type InternalDomainAuthorizationEvaluator,
} from './authorization/domain-authorization-engine.js';
import { createInstallationBootstrap, type InstallationBootstrap } from './authentication/installation-bootstrap.js';
import { createLocalAuthenticator, type LocalAuthenticator } from './authentication/local-authenticator.js';
import { createPasswordHasher, type PasswordHasherOptions } from './authentication/password-hashing.js';
import type { LocalServiceConfig } from './config.js';
import type { LogFields, Logger } from './logger.js';
import { createAuthenticationProofRegistry } from './sessions/authentication-proof.js';
import {
  createLocalSessions,
  createSessionAdministration,
  resetSessionsForRun,
  type LocalSessions,
  type SessionAdministration,
  type SessionBackend,
} from './sessions/local-sessions.js';
import {
  createServiceRunId,
  createSessionClock,
  systemMonotonicClock,
  type MonotonicClock,
} from './sessions/session-clock.js';

export const LOCAL_SERVICE_STATES = ['STOPPED', 'STARTING', 'READY', 'STOPPING', 'FAILED'] as const;

export type LocalServiceState = (typeof LOCAL_SERVICE_STATES)[number];

/**
 * Transições permitidas; qualquer outra é recusada com `LocalServiceStateError`. Cada lista é
 * congelada, além do objecto (E1.07-D1-H): congelar só o exterior deixava acrescentar ou retirar
 * transições através dos arrays internos.
 */
export const LOCAL_SERVICE_TRANSITIONS: Readonly<Record<LocalServiceState, readonly LocalServiceState[]>> =
  Object.freeze({
    STOPPED: Object.freeze(['STARTING'] as const),
    STARTING: Object.freeze(['READY', 'FAILED'] as const),
    READY: Object.freeze(['STOPPING'] as const),
    STOPPING: Object.freeze(['STOPPED', 'FAILED'] as const),
    FAILED: Object.freeze(['STARTING', 'STOPPED'] as const),
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
  | 'database-access-denied'
  | 'database-corrupt'
  /** O bloqueio exclusivo da base não foi obtido no tempo limite: outro processo detém-na (E1.07-X). */
  | 'database-locked'
  | 'database-missing'
  | 'database-open-failed'
  | 'invalid-location'
  | 'migration-failed'
  | 'migration-integrity'
  | 'pending-migrations'
  | 'session-reset-failed'
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
  /** Relógio monotónico das sessões, em milissegundos; substituível em testes (D-112). */
  readonly monotonicClock?: MonotonicClock;
  /** Política de sessões; valores omitidos usam `DEFAULT_SESSION_POLICY`, inválidos são recusados. */
  readonly sessionPolicy?: Partial<SessionPolicy>;
  /**
   * Espera máxima pelo bloqueio exclusivo da base, em milissegundos (E1.07-X). Por omissão,
   * `DEFAULT_DATABASE_LOCK_TIMEOUT_MS`; inteiros de 0 a `MAX_DATABASE_LOCK_TIMEOUT_MS`.
   */
  readonly databaseLockTimeoutMs?: number;
}

/**
 * RBAC INTERNO e NÃO AUTENTICADO (E1.07-D2): persistência de perfis, concessões e atribuições e
 * avaliação de domínio sobre os factos persistidos. Exigem `TenantContext` construído pelo chamador
 * (PD-27), que não prova autoridade; não verificam a autoridade do actor (E1.07-D3) e não produzem
 * autorização operacional (E1.07-D4). Nunca expostos por HTTP, IPC Electron nem interface.
 */
export interface InternalAuthorization {
  readonly roles: RoleRepository;
  readonly rolePermissions: RolePermissionRepository;
  readonly roleAssignments: RoleAssignmentRepository;
  /** Concessões persistidas fora do catálogo oficial vigente (PD-61); só leitura. */
  readonly diagnostics: RolePermissionDiagnostics;
  /** Avaliação de domínio sobre factos persistidos; a decisão não é autorização operacional. */
  readonly domainEvaluator: InternalDomainAuthorizationEvaluator;
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
    /**
     * Administração e manutenção INTERNAS de sessões (E1.07-C). Cada leitura devolve as operações
     * do arranque corrente; referências de um arranque anterior são recusadas.
     */
    readonly sessions: SessionAdministration;
  };
  /** Associações empresariais e locais; exigem `TenantContext` e recusam operações fora de `READY`. */
  readonly companyMemberships: CompanyMembershipRepository;
  readonly branchMemberships: BranchMembershipRepository;
  /** Avaliação interna de elegibilidade (D-088); não é autenticação nem autorização. */
  readonly membershipScopes: MembershipScopeReader;
  /** RBAC interno e não autenticado (E1.07-D2); recusa operações fora de `READY`. */
  readonly internalAuthorization: InternalAuthorization;
  /**
   * Autenticação local offline por username e palavra-passe (D-093). O resultado não é uma
   * sessão nem uma autorização empresarial.
   */
  readonly authentication: LocalAuthenticator;
  /**
   * Sessões locais (E1.07-C): criação a partir de uma autenticação recente, validação, actividade
   * e logout. Uma sessão comprova apenas a identidade autenticada; não é uma autorização
   * empresarial. Cada leitura devolve as operações do arranque corrente; referências de um
   * arranque anterior são recusadas (`LocalServiceStateError('not-ready')`).
   */
  readonly sessions: LocalSessions;
}

/** Repositórios activos enquanto a ligação está aberta; descartados no encerramento. */
interface ServiceStores {
  readonly tenant: SqliteTenantPersistence;
  readonly users: UserDirectory;
  readonly memberships: SqliteMembershipPersistence;
  readonly authorization: SqliteAuthorizationPersistence;
  readonly authentication: SqliteAuthenticationStore;
  readonly sessions: SqliteSessionStore;
  /** Identificador aleatório deste arranque efectivo; não é o identificador da instalação. */
  readonly serviceRunId: string;
}

// Os registos identificam a causa pelo nome e motivo, nunca pela mensagem (pode conter caminhos ou SQL).
const describeCause = (cause: unknown): LogFields => ({
  causeName: cause instanceof Error ? cause.name : null,
  causeReason: cause instanceof PersistenceError ? cause.reason : null,
});

const isCorruption = (error: unknown): boolean => {
  const code = sqliteErrorCode(error);
  return code === 'SQLITE_NOTADB' || code?.startsWith('SQLITE_CORRUPT') === true;
};

const isExistingFile = (location: string): boolean => {
  try {
    return statSync(location).isFile();
  } catch {
    return false;
  }
};

/**
 * Classifica uma falha na abertura e aquisição exclusiva. `SQLITE_BUSY` só significa "base ocupada"
 * neste passo: com o bloqueio adquirido, nenhuma outra ligação o pode provocar. A causa não
 * identifica o processo que detém a base (outra instância ou uma ferramenta externa).
 */
const classifyOpenFailure = (error: unknown, location: string): StartupFailureReason => {
  if (isSqliteBusy(error)) return 'database-locked';
  if (isCorruption(error)) return 'database-corrupt';
  const code = sqliteErrorCode(error) ?? '';
  if (code.startsWith('SQLITE_READONLY') || code === 'SQLITE_PERM' || code === 'SQLITE_AUTH') {
    return 'database-access-denied';
  }
  // Em Windows, a falta de permissão sobre o ficheiro ou sobre o directório (ficheiro WAL) surge
  // como SQLITE_CANTOPEN; com o ficheiro presente e regular, não há outra causa plausível.
  if (code.startsWith('SQLITE_CANTOPEN') && isExistingFile(location)) return 'database-access-denied';
  return 'database-open-failed';
};

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
    databaseLockTimeoutMs = DEFAULT_DATABASE_LOCK_TIMEOUT_MS,
    logger,
    monotonicClock = systemMonotonicClock,
    openDatabase = openSqliteDatabase,
    passwordHashing,
    protectedDirectories,
    sessionPolicy: sessionPolicyInput,
  }: LocalServiceDependencies,
): LocalService => {
  // Criados antes do arranque: parâmetros inválidos são recusados de imediato.
  if (
    !Number.isInteger(databaseLockTimeoutMs) ||
    databaseLockTimeoutMs < 0 ||
    databaseLockTimeoutMs > MAX_DATABASE_LOCK_TIMEOUT_MS
  ) {
    throw new RangeError(`databaseLockTimeoutMs deve ser um inteiro entre 0 e ${MAX_DATABASE_LOCK_TIMEOUT_MS}.`);
  }
  const hasher = createPasswordHasher(passwordHashing);
  const sessionPolicy = parseSessionPolicy(sessionPolicyInput ?? {});
  const sessionClock = createSessionClock(clock, monotonicClock);
  // Comprovativos de autenticação deste serviço; nunca expostos (D-108).
  const proofs = createAuthenticationProofRegistry();
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
      throw new LocalServiceStartupError(isCorruption(error) ? 'database-corrupt' : reason, { cause: error });
    }
  };

  const initialise = async (): Promise<StartupReport> => {
    // Identificação da base operacional efectiva (caminho final, sem hard links nem rede).
    let location: string;
    try {
      location = resolveDatabaseIdentity(resolveDatabaseLocation(config.databasePath, { protectedDirectories }), {
        protectedDirectories,
      });
    } catch (error) {
      const denied = error instanceof PersistenceError && error.reason === 'location-access-denied';
      throw new LocalServiceStartupError(denied ? 'database-access-denied' : 'invalid-location', { cause: error });
    }
    const existed = existsSync(location);
    const mustExist = config.startupPolicy.onMissingDatabase === 'fail';
    if (!existed && mustExist) throw new LocalServiceStartupError('database-missing');

    // Aquisição exclusiva (E1.07-X): a abertura obtém o bloqueio do ficheiro, com espera limitada,
    // e a posse é comprovada antes de qualquer leitura do esquema, migração ou escrita. Uma
    // instância recusada não chega a ler nem a escrever a base.
    try {
      database = await openDatabase({
        busyTimeoutMs: databaseLockTimeoutMs,
        exclusive: true,
        fileMustExist: mustExist,
        filename: location,
      });
    } catch (error) {
      throw new LocalServiceStartupError(classifyOpenFailure(error, location), { cause: error });
    }
    const connection = database;
    try {
      verifyExclusiveOwnership(connection, location);
    } catch (error) {
      throw new LocalServiceStartupError(classifyOpenFailure(error, location), { cause: error });
    }
    logger.log('info', 'service.database_opened', { createdDatabase: !existed, databaseFile });
    logger.log('info', 'service.database_ownership_acquired', { databaseFile, lockTimeoutMs: databaseLockTimeoutMs });

    const status = attempt('migration-integrity', () => inspectMigrations(connection));
    if (status.pendingVersions.length > 0 && config.startupPolicy.onPendingMigrations === 'fail') {
      throw new LocalServiceStartupError('pending-migrations');
    }
    const result = attempt('migration-failed', () => runMigrations(connection));
    // Cada arranque efectivo tem um identificador novo; as sessões anteriores deixam de ser
    // válidas e ficam revogadas antes de o serviço aceitar operações (D-114). A eliminação de
    // registos terminados no arranque está suspensa (D-125, PD-47).
    const serviceRunId = createServiceRunId();
    const sessionStore = attempt('session-reset-failed', () => createSqliteSessionStore(connection));
    const reset = attempt('session-reset-failed', () => resetSessionsForRun(sessionStore, serviceRunId, sessionClock()));
    logger.log('info', 'service.sessions_reset', { ...reset, startupDeletion: 'suspended' });
    stores = {
      authentication: createSqliteAuthenticationStore(connection),
      authorization: createSqliteAuthorizationPersistence(connection),
      memberships: createSqliteMembershipPersistence(connection),
      serviceRunId,
      sessions: sessionStore,
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

  // RBAC interno (E1.07-D2): cada chamada obtém a persistência da ligação activa em `READY`.
  const roles: RoleRepository = {
    findById: (context, id) => guarded((current) => current.authorization.roles.findById(context, id)),
    findByCode: (context, code) => guarded((current) => current.authorization.roles.findByCode(context, code)),
    listByCompany: (context, companyId) =>
      guarded((current) => current.authorization.roles.listByCompany(context, companyId)),
    create: (context, role) => guarded((current) => current.authorization.roles.create(context, role)),
    update: (context, role) => guarded((current) => current.authorization.roles.update(context, role)),
  };

  const rolePermissions: RolePermissionRepository = {
    listByRole: (context, roleId) => guarded((current) => current.authorization.rolePermissions.listByRole(context, roleId)),
    add: (context, grant) => guarded((current) => current.authorization.rolePermissions.add(context, grant)),
    remove: (context, roleId, permissionCode) =>
      guarded((current) => current.authorization.rolePermissions.remove(context, roleId, permissionCode)),
  };

  const roleAssignments: RoleAssignmentRepository = {
    findById: (context, id) => guarded((current) => current.authorization.roleAssignments.findById(context, id)),
    listByCompanyMembership: (context, companyMembershipId) =>
      guarded((current) => current.authorization.roleAssignments.listByCompanyMembership(context, companyMembershipId)),
    listByRole: (context, roleId) =>
      guarded((current) => current.authorization.roleAssignments.listByRole(context, roleId)),
    create: (context, assignment) =>
      guarded((current) => current.authorization.roleAssignments.create(context, assignment)),
    update: (context, assignment) =>
      guarded((current) => current.authorization.roleAssignments.update(context, assignment)),
  };

  const internalAuthorization: InternalAuthorization = Object.freeze({
    diagnostics: Object.freeze({
      catalogVersion: OFFICIAL_PERMISSION_CATALOG.version,
      listUnrecognized: (context) =>
        guarded((current) => current.authorization.diagnostics.listUnrecognized(context)),
    } satisfies RolePermissionDiagnostics),
    domainEvaluator: createInternalDomainAuthorizationEvaluator((context, userId, companyId) =>
      guarded((current) => current.authorization.readCompanyAuthorizationFacts(context, userId, companyId)),
    ),
    roleAssignments,
    rolePermissions,
    roles,
  });

  // Autenticação (E1.07-B): cada operação obtém o armazenamento em `READY` e, depois de cada
  // derivação assíncrona, confirma que continua a ser o da ligação activa. Uma derivação que
  // termine após `stop()` (ou após um novo arranque) é recusada sem escrever (D-097).
  const assertCurrent = (store: SqliteAuthenticationStore): ServiceStores => {
    if (state !== 'READY' || stores?.authentication !== store) throw new LocalServiceStateError('not-ready', state);
    return stores;
  };

  const authenticationBackend: AuthenticationBackend = Object.freeze<AuthenticationBackend>({
    acquire: () => ready().authentication,
    assertCurrent: (store: SqliteAuthenticationStore) => {
      assertCurrent(store);
    },
    clock,
    commonPasswords,
    hasher,
    registerProof: (store, identity, versions) => {
      const current = assertCurrent(store);
      proofs.register(identity, {
        credentialVersion: versions.credentialVersion,
        issuedAt: sessionClock(),
        securityVersion: versions.securityVersion,
        serviceRunId: current.serviceRunId,
        userId: identity.userId,
      });
    },
  });

  // Sessões (E1.07-C): as operações ficam ligadas ao arranque em que foram obtidas. Fora de
  // `READY`, ou depois de um novo arranque, são recusadas com `not-ready` (D-114).
  const sessionBackendFor = (serviceRunId: string | undefined): SessionBackend =>
    Object.freeze({
      acquire: () => {
        const current = ready();
        if (current.serviceRunId !== serviceRunId) throw new LocalServiceStateError('not-ready', state);
        return { serviceRunId: current.serviceRunId, store: current.sessions };
      },
      now: sessionClock,
      policy: sessionPolicy,
      proofs,
    });

  interface RunSessions {
    readonly serviceRunId: string | undefined;
    readonly sessions: LocalSessions;
    readonly administration: SessionAdministration;
  }
  const sessionsFor = (serviceRunId: string | undefined): RunSessions => {
    const backend = sessionBackendFor(serviceRunId);
    return Object.freeze({
      administration: createSessionAdministration(backend),
      serviceRunId,
      sessions: createLocalSessions(backend),
    });
  };
  // Sem arranque activo: operações que recusam sempre.
  const detachedSessions = sessionsFor(undefined);
  let runSessions = detachedSessions;
  const currentSessions = (): RunSessions => {
    const serviceRunId = state === 'READY' ? stores?.serviceRunId : undefined;
    if (serviceRunId === undefined) return detachedSessions;
    if (runSessions.serviceRunId !== serviceRunId) runSessions = sessionsFor(serviceRunId);
    return runSessions;
  };

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
      get sessions() {
        return currentSessions().administration;
      },
      users,
    }),
    companyMemberships,
    branchMemberships,
    membershipScopes,
    internalAuthorization,
    authentication: createLocalAuthenticator(authenticationBackend),
    get sessions() {
      return currentSessions().sessions;
    },
  };
};
