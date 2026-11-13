import { describe, expect, it } from 'vitest';

import { accountingModuleStatus } from '../packages/accounting/src/index';
import { fiscalModuleStatus } from '../packages/fiscal/src/index';

describe('E1.01 foundation', () => {
  it('does not implement accounting or fiscal business logic', () => {
    expect(accountingModuleStatus).toBe('not-implemented');
    expect(fiscalModuleStatus).toBe('not-implemented');
  });
});
