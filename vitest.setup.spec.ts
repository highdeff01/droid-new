import { describe, expect, it } from 'vitest';

describe('vitest.setup', () => {
  it('fails a remote request as an unreachable endpoint instead of reaching the network', async () => {
    await expect(fetch('https://example.invalid/api/chat')).rejects.toThrow('Failed to fetch');
  });
});
