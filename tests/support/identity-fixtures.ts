import { randomUUID } from 'node:crypto';

import {
  createBranchMembership,
  createCompanyMembership,
  createUser,
  type Branch,
  type BranchMembership,
  type BranchMembershipInput,
  type Company,
  type CompanyMembership,
  type CompanyMembershipInput,
  type User,
  type UserInput,
} from '../../packages/shared-types/src/index';
import { CREATED_AT } from './fixtures';

// Identidades fictícias para testes; nenhum valor corresponde a uma pessoa real. Os domínios
// `.test` e `.example` são reservados (RFC 2606) e os números usam o prefixo fictício 000.

let sequence = 0;

/** Username único por chamada, para que os testes possam criar várias identidades. */
export const uniqueUsername = (prefix = 'utilizador'): string => {
  sequence += 1;
  return `${prefix}.${sequence}.${randomUUID().slice(0, 8)}`;
};

export const userInput = (overrides: Partial<UserInput> = {}): UserInput => ({
  id: randomUUID(),
  username: uniqueUsername(),
  displayName: 'Utilizador de Teste',
  email: 'utilizador.teste@kil-business.test',
  phone: '+000 900 000 000',
  status: 'ACTIVE',
  createdAt: CREATED_AT,
  ...overrides,
});

export const newUser = (overrides: Partial<UserInput> = {}): User => createUser(userInput(overrides));

export const companyMembershipInput = (
  user: User,
  company: Company,
  overrides: Partial<CompanyMembershipInput> = {},
): CompanyMembershipInput => ({
  id: randomUUID(),
  userId: user.id,
  tenantId: company.tenantId,
  companyId: company.id,
  scope: 'COMPANY_WIDE',
  status: 'ACTIVE',
  createdAt: CREATED_AT,
  ...overrides,
});

export const newCompanyMembership = (
  user: User,
  company: Company,
  overrides: Partial<CompanyMembershipInput> = {},
): CompanyMembership => createCompanyMembership(companyMembershipInput(user, company, overrides));

export const branchMembershipInput = (
  membership: CompanyMembership,
  branch: Branch,
  overrides: Partial<BranchMembershipInput> = {},
): BranchMembershipInput => ({
  id: randomUUID(),
  companyMembershipId: membership.id,
  tenantId: membership.tenantId,
  companyId: membership.companyId,
  branchId: branch.id,
  status: 'ACTIVE',
  createdAt: CREATED_AT,
  ...overrides,
});

export const newBranchMembership = (
  membership: CompanyMembership,
  branch: Branch,
  overrides: Partial<BranchMembershipInput> = {},
): BranchMembership => createBranchMembership(branchMembershipInput(membership, branch, overrides));
