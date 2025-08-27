// This smoke test ensures named exports exist and are callable.
// We use the route tests to verify behavior with mocks.
jest.mock('../src/prisma', () => require('../__mocks__/prisma'));
import * as scheduler from '../src/scheduler';

describe('scheduler smoke', () => {
  it('exports initScheduler & ensureNotBusyOrThrow', () => {
    expect(typeof scheduler.initScheduler).toBe('function');
    expect(typeof scheduler.ensureNotBusyOrThrow).toBe('function');
  });
});
