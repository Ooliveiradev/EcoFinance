import postgres from 'postgres';
export function e2eDatabase() {
  const value = process.env.TEST_E2E_DATABASE_URL;
  if (!value) throw new Error('TEST_E2E_DATABASE_URL must identify a disposable fixture database.');
  const url = new URL(value);
  if (!['localhost','127.0.0.1'].includes(url.hostname) ||
      !/^\/(?:ecofinance_ci|ecofinance_e2e_[a-z0-9_]+)$/.test(url.pathname)) throw new Error('Refusing to modify a non-fixture database.');
  return postgres(value,{max:1,prepare:false,onnotice:()=>{}});
}
