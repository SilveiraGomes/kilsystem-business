import type {
  BranchMembershipId,
  CompanyId,
  CompanyMembershipId,
  UserId,
} from './identifiers.js';
import type {
  BranchMembership,
  CompanyMembership,
  MembershipScopeEvaluation,
} from './membership.js';
import type { TenantContext } from './tenant-context.js';
import type { User, UserStatus } from './user.js';

/*
 * Fronteira de identidade (D-087):
 *
 * - `UserDirectory` é o provisionamento INTERNO de identidades locais da instalação. Não recebe
 *   contexto empresarial, não é acessível a partir de operações de um tenant, não é exposto por
 *   HTTP, IPC Electron nem interface pública, e não oferece pesquisa nem listagem global.
 * - Os repositórios de associações são empresariais: exigem `TenantContext`, aplicam o isolamento
 *   de D-020 e devolvem apenas dados de associação (o `userId`), nunca dados pessoais.
 *
 * Um `TenantContext` continua a ser construído pelo chamador: não é uma credencial nem prova de
 * autenticação (E1.07-B e E1.07-C).
 */

export interface UserDirectory {
  findById(id: UserId): Promise<User | undefined>;
  /**
   * Recusa identificador repetido (`RecordConflictError('duplicate-id')`) e username normalizado
   * já usado (`RecordConflictError('duplicate-username')`).
   */
  create(user: User): Promise<void>;
  /**
   * Única alteração permitida à identidade nesta etapa; devolve a identidade actualizada.
   * Identidade inexistente: `RecordNotFoundError('User')`.
   */
  changeStatus(id: UserId, status: UserStatus, at: Date | string): Promise<User>;
}

/**
 * Semântica de isolamento igual a `CompanyRepository`/`BranchRepository` (D-020). Não há
 * eliminação: as associações são desactivadas logicamente (D-060, D-086).
 */
export interface CompanyMembershipRepository {
  findById(context: TenantContext, id: CompanyMembershipId): Promise<CompanyMembership | undefined>;
  /** Associação do utilizador no tenant do contexto (no máximo uma, D-081). */
  findByUser(context: TenantContext, userId: UserId): Promise<CompanyMembership | undefined>;
  listByCompany(context: TenantContext, companyId: CompanyId): Promise<readonly CompanyMembership[]>;
  /**
   * Exige a empresa no tenant do contexto (`RecordNotFoundError('Company')`), uma identidade
   * existente (`RecordNotFoundError('User')`) e nenhuma associação prévia do mesmo utilizador
   * ao tenant (`RecordConflictError('duplicate-company-membership')`).
   */
  create(context: TenantContext, membership: CompanyMembership): Promise<void>;
  /** Só `scope`, `status` e `updatedAt` podem mudar (`RecordConflictError('immutable-field')`). */
  update(context: TenantContext, membership: CompanyMembership): Promise<void>;
}

export interface BranchMembershipRepository {
  findById(context: TenantContext, id: BranchMembershipId): Promise<BranchMembership | undefined>;
  listByCompanyMembership(
    context: TenantContext,
    companyMembershipId: CompanyMembershipId,
  ): Promise<readonly BranchMembership[]>;
  /**
   * Exige uma associação empresarial do tenant (`RecordNotFoundError('CompanyMembership')`) com
   * âmbito `BRANCH_RESTRICTED` (`RecordConflictError('membership-not-branch-restricted')`) e um
   * estabelecimento da mesma empresa (`RecordNotFoundError('Branch')`), sem duplicação
   * (`RecordConflictError('duplicate-branch-membership')`).
   */
  create(context: TenantContext, membership: BranchMembership): Promise<void>;
  /** Só `status` e `updatedAt` podem mudar (`RecordConflictError('immutable-field')`). */
  update(context: TenantContext, membership: BranchMembership): Promise<void>;
}

/** Avaliação interna de elegibilidade (D-088); não é autorização funcional. */
export interface MembershipScopeReader {
  evaluate(context: TenantContext, userId: UserId): Promise<MembershipScopeEvaluation>;
}
