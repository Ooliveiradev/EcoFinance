export const serverCredentials = [
  'DATABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PLUGGY_CLIENT_ID',
  'PLUGGY_CLIENT_SECRET', 'GEMINI_API_KEY', 'API_SECRET_KEY',
];

export function sourceFindings(path, content) {
  const findings = [];
  const publicCredential = /\b(?:NEXT_PUBLIC|EXPO_PUBLIC)_[A-Z0-9_]*(?:SECRET|PRIVATE|PASSWORD|SERVICE_ROLE|TOKEN)[A-Z0-9_]*\b/g;
  for (const name of new Set(content.match(publicCredential) ?? [])) {
    findings.push(`public credential ${name}`);
  }
  const client = path.startsWith('apps/expo/') || path.startsWith('packages/shared/') || /^\s*['"]use client['"]/m.test(content);
  if (client) {
    for (const name of serverCredentials) {
      if (new RegExp(`\\bprocess\\.env(?:\\.${name}\\b|\\[['"]${name}['"]\\])`).test(content)) {
        findings.push(`server credential ${name} read by client/shared module`);
      }
    }
  }
  return findings;
}

export function bundleFindings(content, env) {
  const findings = [];
  for (const name of [...serverCredentials, 'EXPO_PUBLIC_API_SECRET']) {
    const value = env[name];
    if (!value || value.length < 12) continue;
    const variants = [value, encodeURIComponent(value), Buffer.from(value).toString('base64')];
    if (variants.some(variant => content.includes(variant))) findings.push(`value of ${name}`);
  }
  if (/AIza[0-9A-Za-z_-]{35}/.test(content)) findings.push('Google API credential');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) findings.push('private key');
  if (/\bsb_secret_[A-Za-z0-9_-]+/.test(content)) findings.push('Supabase secret');
  for (const jwt of content.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    try {
      if (JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role === 'service_role') findings.push('Supabase service role JWT');
    } catch { /* Not a JWT payload. */ }
  }
  return [...new Set(findings)];
}

export function sarifFindings(report) {
  if (!Array.isArray(report.runs) || !report.runs.length) throw new Error('Missing SARIF runs');
  return report.runs.flatMap(run => {
    if (!run.tool?.driver?.name || !Array.isArray(run.results)) throw new Error('Incomplete SARIF scan');
    if (run.invocations?.some(invocation => invocation.executionSuccessful === false || invocation.toolExecutionNotifications?.some(note => note.level === 'error'))) throw new Error('SARIF tool failed');
    return run.results.filter(result => result.kind !== 'pass' && result.kind !== 'notApplicable');
  });
}
