/** Expiry is UTC and exclusive: the audit blocks at the start of expiresAt. */
export function validateDependencyPolicy(policy, now = new Date()) {
  const days = { critical: 1, high: 7, moderate: 30, low: 90 };
  if (policy?.version !== 1 || typeof policy.owner !== 'string' || !policy.owner.trim() ||
      !Number.isFinite(now.getTime()) || !Array.isArray(policy.patchedAdvisories) ||
      Object.keys(policy.remediationDays ?? {}).length !== 4 ||
      Object.entries(days).some(([severity, max]) => !Number.isInteger(policy.remediationDays[severity]) || policy.remediationDays[severity] < 1 || policy.remediationDays[severity] > max)) {
    throw new Error('Invalid dependency policy.');
  }
  const approved = new Map();
  for (const item of policy.patchedAdvisories) {
    const start = Date.parse(item?.reviewedAt), end = Date.parse(item?.expiresAt);
    if (!/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(item?.id ?? '') ||
        typeof item.package !== 'string' || !item.package || typeof item.version !== 'string' || !item.version ||
        typeof item.reason !== 'string' || item.reason.trim().length < 20 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.reviewedAt ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(item.expiresAt ?? '') ||
        !Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString().slice(0, 10) !== item.reviewedAt ||
        new Date(end).toISOString().slice(0, 10) !== item.expiresAt || start > now.getTime() || end <= now.getTime() ||
        end <= start || end - start > 30 * 86400000 || approved.has(item.id)) {
      throw new Error('Invalid or expired patched advisory review.');
    }
    approved.set(item.id, item);
  }
  return approved;
}
