export type TenantId = string & { readonly __brand: 'TenantId' };

export interface TenantContext {
  readonly tenantId: TenantId;
}
