// ---------------------------------------------------------------------------
// OFX / QFX File Parser — Pure TypeScript, no external dependencies
// Handles both SGML (traditional) and XML variants of OFX
// ---------------------------------------------------------------------------

export interface ParsedOfxTransaction {
  fitId: string;
  type: string;
  datePosted: string; // ISO 8601
  amount: number;
  name: string;
  memo: string;
}

export interface ParsedOfxResult {
  bankId: string;
  accountId: string;
  accountType: string;
  currency: string;
  transactions: ParsedOfxTransaction[];
  balanceAmount: number | null;
  balanceDate: string | null;
}

/**
 * Converts OFX date format (YYYYMMDDHHMMSS[.XXX[:tz]]) to ISO 8601.
 * Examples:
 *   "20240115120000[-03:BRT]" → "2024-01-15T12:00:00-03:00"
 *   "20240115"                → "2024-01-15T00:00:00Z"
 *   "20240115120000.000"      → "2024-01-15T12:00:00Z"
 */
function parseOfxDate(raw: string): string {
  const cleaned = raw.trim();

  // Extract timezone offset if present: [-03:BRT] or [+00:UTC]
  let tzOffset = 'Z';
  const tzMatch = cleaned.match(/\[([+-]?\d{1,2})(?::.*?)?\]/);
  if (tzMatch) {
    const offsetHours = parseInt(tzMatch[1], 10);
    const sign = offsetHours >= 0 ? '+' : '-';
    const absHours = Math.abs(offsetHours).toString().padStart(2, '0');
    tzOffset = `${sign}${absHours}:00`;
  }

  // Strip everything after the digits and optional decimal
  const dateStr = cleaned.replace(/\[.*?\]/, '').replace(/\..*$/, '').trim();

  if (dateStr.length < 8) {
    return new Date().toISOString();
  }

  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  const hour = dateStr.length >= 10 ? dateStr.substring(8, 10) : '00';
  const minute = dateStr.length >= 12 ? dateStr.substring(10, 12) : '00';
  const second = dateStr.length >= 14 ? dateStr.substring(12, 14) : '00';

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${tzOffset}`;
}

/**
 * Extracts the text content of an SGML/XML tag from OFX content.
 * Handles both:
 *   <TAG>value         (SGML — no closing tag)
 *   <TAG>value</TAG>   (XML — with closing tag)
 */
function extractTagValue(content: string, tagName: string): string {
  // Try XML style first: <TAG>value</TAG>
  const xmlRegex = new RegExp(`<${tagName}>([^<]*)</${tagName}>`, 'i');
  const xmlMatch = content.match(xmlRegex);
  if (xmlMatch) {
    return xmlMatch[1].trim();
  }

  // Fall back to SGML style: <TAG>value\n
  const sgmlRegex = new RegExp(`<${tagName}>([^\\r\\n<]+)`, 'i');
  const sgmlMatch = content.match(sgmlRegex);
  if (sgmlMatch) {
    return sgmlMatch[1].trim();
  }

  return '';
}

/**
 * Extracts all blocks between opening and closing aggregate tags.
 * Example: extractBlocks(content, 'STMTTRN') extracts all <STMTTRN>...</STMTTRN> blocks.
 */
function extractBlocks(content: string, tagName: string): string[] {
  const blocks: string[] = [];

  // Try XML-style blocks first
  const xmlRegex = new RegExp(`<${tagName}>(.*?)</${tagName}>`, 'gis');
  let match: RegExpExecArray | null;
  match = xmlRegex.exec(content);
  while (match !== null) {
    blocks.push(match[1]);
    match = xmlRegex.exec(content);
  }

  if (blocks.length > 0) {
    return blocks;
  }

  // Fallback: SGML-style — blocks delimited by <TAG> ... </TAG> or next <TAG>
  const sgmlRegex = new RegExp(`<${tagName}>`, 'gi');
  const closingRegex = new RegExp(`</${tagName}>`, 'gi');
  const openPositions: number[] = [];
  const closePositions: number[] = [];

  let m = sgmlRegex.exec(content);
  while (m !== null) {
    openPositions.push(m.index + m[0].length);
    m = sgmlRegex.exec(content);
  }

  let c = closingRegex.exec(content);
  while (c !== null) {
    closePositions.push(c.index);
    c = closingRegex.exec(content);
  }

  for (let i = 0; i < openPositions.length; i++) {
    const start = openPositions[i];
    let end: number;

    if (i < closePositions.length) {
      end = closePositions[i];
    } else if (i + 1 < openPositions.length) {
      end = openPositions[i + 1];
    } else {
      end = content.length;
    }

    blocks.push(content.substring(start, end));
  }

  return blocks;
}

/**
 * Parses the full OFX/QFX file content and extracts transactions.
 */
export function parseOfxContent(rawContent: string): ParsedOfxResult {
  // Normalize line endings
  const content = rawContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Extract bank info
  const bankId = extractTagValue(content, 'BANKID');
  const accountId = extractTagValue(content, 'ACCTID');
  const accountType = extractTagValue(content, 'ACCTTYPE') || 'CHECKING';
  const currency = extractTagValue(content, 'CURDEF') || 'BRL';

  // Extract available balance
  let balanceAmount: number | null = null;
  let balanceDate: string | null = null;

  const ledgerBalBlocks = extractBlocks(content, 'LEDGERBAL');
  if (ledgerBalBlocks.length > 0) {
    const balAmtStr = extractTagValue(ledgerBalBlocks[0], 'BALAMT');
    const balDateStr = extractTagValue(ledgerBalBlocks[0], 'DTASOF');
    if (balAmtStr) {
      balanceAmount = parseFloat(balAmtStr);
    }
    if (balDateStr) {
      balanceDate = parseOfxDate(balDateStr);
    }
  }

  // Also try AVAILBAL if LEDGERBAL not found
  if (balanceAmount === null) {
    const availBalBlocks = extractBlocks(content, 'AVAILBAL');
    if (availBalBlocks.length > 0) {
      const balAmtStr = extractTagValue(availBalBlocks[0], 'BALAMT');
      const balDateStr = extractTagValue(availBalBlocks[0], 'DTASOF');
      if (balAmtStr) {
        balanceAmount = parseFloat(balAmtStr);
      }
      if (balDateStr) {
        balanceDate = parseOfxDate(balDateStr);
      }
    }
  }

  // Extract individual transactions from STMTTRN blocks
  const transactionBlocks = extractBlocks(content, 'STMTTRN');
  const transactions: ParsedOfxTransaction[] = [];

  for (const block of transactionBlocks) {
    const trnType = extractTagValue(block, 'TRNTYPE') || 'OTHER';
    const dtPosted = extractTagValue(block, 'DTPOSTED');
    const trnAmt = extractTagValue(block, 'TRNAMT');
    const fitId = extractTagValue(block, 'FITID');
    const name = extractTagValue(block, 'NAME');
    const memo = extractTagValue(block, 'MEMO');

    if (!dtPosted || !trnAmt || !fitId) {
      // Skip malformed entries
      continue;
    }

    // Parse amount: OFX uses '.' as decimal separator and may use ',' for thousands
    const cleanedAmount = trnAmt.replace(/,/g, '');
    const amount = parseFloat(cleanedAmount);

    if (isNaN(amount)) {
      continue;
    }

    transactions.push({
      fitId,
      type: trnType,
      datePosted: parseOfxDate(dtPosted),
      amount,
      name: name || memo || 'Sem descrição',
      memo: memo || '',
    });
  }

  return {
    bankId,
    accountId,
    accountType,
    currency,
    transactions,
    balanceAmount,
    balanceDate,
  };
}
