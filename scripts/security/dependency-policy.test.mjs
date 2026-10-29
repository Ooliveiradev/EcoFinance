import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDependencyPolicy } from './dependency-policy.mjs';
const fixture = () => JSON.parse(readFileSync(new URL('./dependency-policy.json', import.meta.url), 'utf8'));
const now = new Date('2026-10-29T12:00:00Z');
test('only a current, justified and uniquely identified patch review can satisfy the audit', () => {
  assert.equal(validateDependencyPolicy(fixture(), now).size, 3);
  for (const mutate of [
    p => { p.patchedAdvisories[0].expiresAt = '2026-10-13'; },
    p => { p.patchedAdvisories[0].expiresAt = '2026-12-01'; },
    p => { p.patchedAdvisories[0].reviewedAt = '2026-10-30'; },
    p => { p.patchedAdvisories[0].expiresAt = '2026-02-30'; },
    p => { p.patchedAdvisories[0].reason = ''; },
    p => { p.patchedAdvisories.push(p.patchedAdvisories[0]); },
    p => { p.remediationDays.critical = 30; },
  ]) {
    const policy = fixture(); mutate(policy);
    assert.throws(() => validateDependencyPolicy(policy, now));
  }
  assert.throws(() => validateDependencyPolicy(fixture(), new Date('2026-11-12T00:00:00Z')), /expired/);
  assert.throws(() => validateDependencyPolicy(null, now), /Invalid dependency/);
});
