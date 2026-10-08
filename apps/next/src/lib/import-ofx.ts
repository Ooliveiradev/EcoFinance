import { IMPORT_LIMITS, civilDateSchema, type ParsedImportRow } from '@ecofinance/shared';
import { parseError } from './import-errors';
import { exactMoney, type ValueResult } from './import-values';

/** OFX 1.x (SGML, open leaf tags), OFX 2.x (XML) and Quicken QFX share one reader. */
const FORMAT = 'OFX/QFX';
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const decodeEntities = (value: string) => value.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (match, name: string) => {
  if (name[0] === '#') { const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1)); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match; }
  return entities[name.toLowerCase()] ?? match;
});
const escape = (name: string) => name.replace(/\./g, '\\.');
/** Leaf value of the first `<NAME>` in a block, with or without the XML closing tag. */
export function ofxValue(text: string, name: string) {
  return decodeEntities(new RegExp(`<${escape(name)}>\\s*([^<\\r\\n]*)`, 'i').exec(text)?.[1]?.trim() ?? '');
}
const blocks = (text: string, name: string) => [...text.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'gi'))];

export function detectOfx(text: string) {
  return /^\s*(?:OFXHEADER\s*:|<[?!]|<OFX>)/i.test(text) && /<OFX>/i.test(text);
}
/** Civil date from DTPOSTED/DTUSER: YYYYMMDD[HHMMSS[.XXX]][[±H:TZ]]; never shifted by time zone. */
export function ofxDate(raw: string): ValueResult {
  const match = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(?:(\d{2})(?:\.\d{1,3})?)?)?\s*(?:\[\s*[+-]?\d{1,2}(?:[.:]\d{1,2})?(?::[A-Za-z]{1,8})?\s*\])?$/.exec(raw);
  if (!raw) return { value: null, warning: 'Data ausente (DTPOSTED).' };
  if (!match || Number(match[4] ?? 0) > 23 || Number(match[5] ?? 0) > 59 || Number(match[6] ?? 0) > 59) return { value: null, warning: `Data OFX "${raw.slice(0, 40)}" inválida.` };
  const value = `${match[1]}-${match[2]}-${match[3]}`;
  return civilDateSchema.safeParse(value).success ? { value } : { value: null, warning: `Data OFX "${raw.slice(0, 40)}" inexistente no calendário.` };
}
/** TRNAMT uses `.` by specification; some Brazilian banks emit `,`. No thousands separators. */
export function ofxAmount(raw: string): ValueResult {
  const match = /^([+-]?)(\d{1,13})(?:[.,](\d+))?$/.exec(raw);
  if (!raw) return { value: null, warning: 'Valor ausente (TRNAMT).' };
  if (!match) return { value: null, warning: `Valor OFX "${raw.slice(0, 40)}" inválido.` };
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  if (fraction.length > 2) return { value: null, warning: `Valor OFX "${raw}" tem mais de duas casas decimais.` };
  return exactMoney(match[1] === '-', match[2]!, fraction);
}
const debitTypes = new Set(['DEBIT', 'PAYMENT', 'FEE', 'SRVCHG', 'CHECK', 'ATM', 'POS', 'DIRECTDEBIT', 'REPEATPMT', 'CASH']);
const creditTypes = new Set(['CREDIT', 'DEP', 'INT', 'DIV', 'DIRECTDEP']);
const knownTypes = new Set([...debitTypes, ...creditTypes, 'XFER', 'OTHER', 'HOLD']);

export function parseOfx(text: string) {
  const body = text.replace(/<!--[\s\S]*?-->/g, '');
  if (/<!/.test(body)) parseError('UNSAFE_CONTENT', 'O arquivo contém declarações XML (DOCTYPE, ENTITY ou CDATA). Exporte outro OFX sem entidades externas.', FORMAT);
  if (!/<\/OFX>\s*$/i.test(body)) parseError('CORRUPT_FILE', 'OFX incompleto. Exporte novamente o extrato no banco.', FORMAT);
  const variant = /<\?xml\b|<\?OFX\b/i.test(body) ? 'XML' : 'SGML', quicken = /<INTU\.BID>/i.test(body);
  const statements = [...blocks(body, 'STMTRS'), ...blocks(body, 'CCSTMTRS')].map(match => ({ text: match[1]!, offset: match.index! + match[0].indexOf(match[1]!), card: /^<CCSTMTRS>/i.test(match[0]) }));
  // Minimal exports without a statement aggregate are read as one statement.
  if (!statements.length) statements.push({ text: body, offset: 0, card: false });
  const accounts = new Set(statements.map(statement => `${ofxValue(statement.text, 'BANKID')}:${ofxValue(statement.text, 'ACCTID')}`));
  if (accounts.size > 1) parseError('MULTIPLE_ACCOUNTS', `O arquivo contém ${accounts.size} contas ou cartões. Exporte um extrato por conta para escolher o destino correto.`, FORMAT);
  const rows: ParsedImportRow[] = [], seen = new Map<string, number>();
  const total = statements.reduce((count, statement) => count + (statement.text.match(/<STMTTRN>/gi)?.length ?? 0), 0);
  if (!total) parseError('NO_ROWS', 'O extrato não contém movimentações. Confira o período exportado.', FORMAT);
  if (total > IMPORT_LIMITS.rows) parseError('ROW_LIMIT', `Exporte até ${IMPORT_LIMITS.rows} movimentações por arquivo para confirmação atômica.`, FORMAT);
  for (const statement of statements) {
    const currency = ofxValue(statement.text, 'CURDEF').toUpperCase();
    if (currency !== 'BRL') parseError('UNSUPPORTED_CURRENCY', currency ? `Extrato em ${currency.slice(0, 10)}. Escolha um extrato com moeda BRL.` : 'Escolha um extrato com moeda BRL explícita (CURDEF).', FORMAT);
    const bank = ofxValue(statement.text, 'BANKID'), account = ofxValue(statement.text, 'ACCTID');
    if (bank.length > 100 || account.length > 200) parseError('FIELD_LIMIT', 'A identificação bancária excede o limite. Exporte novamente um extrato válido.', FORMAT);
    const starts = [...statement.text.matchAll(/<STMTTRN>/gi)];
    for (const [index, match] of starts.entries()) {
      const start = match.index!, end = statement.text.toUpperCase().indexOf('</STMTTRN>', start);
      if (end < 0 || end > (starts[index + 1]?.index ?? statement.text.length)) parseError('CORRUPT_FILE', 'OFX contém blocos de movimentação incompletos. Exporte novamente.', FORMAT);
      const block = statement.text.slice(start, end);
      const posted = ofxValue(block, 'DTPOSTED'), user = ofxValue(block, 'DTUSER');
      const date = posted ? ofxDate(posted) : user ? { ...ofxDate(user), warning: 'Sem DTPOSTED: usada a data da transação (DTUSER).' } : ofxDate('');
      const amount = ofxAmount(ofxValue(block, 'TRNAMT'));
      const name = ofxValue(block, 'NAME'), memo = ofxValue(block, 'MEMO');
      const description = (name && memo && memo !== name ? `${name} · ${memo}` : name || memo) || null;
      const fitid = ofxValue(block, 'FITID'), type = ofxValue(block, 'TRNTYPE').toUpperCase();
      if (fitid.length > 200) parseError('FIELD_LIMIT', 'Um identificador FITID excede 200 caracteres. Exporte novamente o extrato para manter a identidade auditável.', FORMAT);
      const foreign = /<CURRENCY>/i.test(block) ? ofxValue(block, 'CURSYM').toUpperCase() : '';
      const original = /<ORIGCURRENCY>/i.test(block) ? ofxValue(block.slice(block.search(/<ORIGCURRENCY>/i)), 'CURSYM').toUpperCase() : '';
      const value = foreign && foreign !== 'BRL' ? null : amount.value;
      const line = text.slice(0, statement.offset + start).split('\n').length;
      const repeated = fitid ? seen.get(fitid) : undefined; if (fitid && repeated === undefined) seen.set(fitid, line);
      rows.push({ amount: value, purchaseDate: date.value, description: description?.slice(0, 500) ?? null,
        externalId: fitid ? `${bank}:${account}:${fitid}` : null,
        provenance: { row: line, excerpt: block.slice(0, 500) },
        warnings: [amount.warning, date.warning, !description && 'Descrição ausente.',
          !fitid && 'Sem FITID: duplicidades serão revisadas por conteúdo.',
          repeated !== undefined && `FITID repetido (também na linha ${repeated}); exclua uma das linhas se for duplicata.`,
          description && description.length > 500 && 'Descrição reduzida a 500 caracteres; confira o original.',
          foreign && foreign !== 'BRL' && `Movimentação em ${foreign.slice(0, 10)}: informe o valor em BRL.`,
          original && original !== 'BRL' && `Valor convertido de ${original.slice(0, 10)} pelo banco; confira o câmbio.`,
          type && !knownTypes.has(type) && `Tipo de transação ${type.slice(0, 20)} desconhecido.`,
          value && debitTypes.has(type) && !value.startsWith('-') && `Tipo ${type} com valor positivo; confira o sinal.`,
          value && creditTypes.has(type) && value.startsWith('-') && `Tipo ${type} com valor negativo; confira o sinal.`,
        ].filter((warning): warning is string => !!warning) });
    }
  }
  const account = ofxValue(statements[0]!.text, 'ACCTID');
  return { source: 'ofx' as const, format: `${quicken ? 'QFX' : 'OFX'} ${variant}`, accountHint: account || null, rows };
}
