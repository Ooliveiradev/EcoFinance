// Builds the synthetic import corpus in memory. Repository policy forbids committing
// .ofx/.qfx artifacts, so every file is produced here from inline synthetic data.
// Every name, account and value is fictitious. Expected results live in corpus.ts and
// are written by hand, not derived from this builder.
import { deflateRawSync, crc32 } from 'node:zlib';
import * as XLSX from 'xlsx';

const extra1252: Record<string, number> = { '–': 0x96, '€': 0x80, '“': 0x93, '”': 0x94 };
const cp1252 = (text: string) => Buffer.from([...text].map(c => extra1252[c] ?? c.charCodeAt(0)).map(code => { if (code > 0xff) throw new Error('not 1252: ' + code); return code; }));
interface ZipEntry { name: string; data: Buffer; declared?: number }

export function buildCorpus() {
  const files = new Map<string, Uint8Array>();
  const write = (name: string, bytes: Uint8Array) => { files.set(name, new Uint8Array(bytes)); };
  // ---------------------------------------------------------------- OFX/QFX
  const sgmlHeader = 'OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\nSECURITY:NONE\r\nENCODING:USASCII\r\nCHARSET:1252\r\nCOMPRESSION:NONE\r\nOLDFILEUID:NONE\r\nNEWFILEUID:NONE\r\n\r\n';
  const trn = (type: string, date: string, amount: string, fitid: string, name: string, memo?: string) => `<STMTTRN>\r\n<TRNTYPE>${type}\r\n<DTPOSTED>${date}\r\n<TRNAMT>${amount}\r\n${fitid ? `<FITID>${fitid}\r\n` : ''}${name ? `<NAME>${name}\r\n` : ''}${memo ? `<MEMO>${memo}\r\n` : ''}</STMTTRN>\r\n`;
  const bank = (body: string, { bankId = '0341', acct = '12345-6', currency = 'BRL' } = {}) => `<OFX>\r\n<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261031120000[-3:BRT]<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>\r\n<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>\r\n<STMTRS><CURDEF>${currency}\r\n<BANKACCTFROM><BANKID>${bankId}<ACCTID>${acct}<ACCTTYPE>CHECKING</BANKACCTFROM>\r\n<BANKTRANLIST><DTSTART>20261001<DTEND>20261031\r\n${body}</BANKTRANLIST>\r\n<LEDGERBAL><BALAMT>1000.00<DTASOF>20261031</LEDGERBAL>\r\n</STMTRS></STMTTRNRS></BANKMSGSRSV1>\r\n</OFX>\r\n`;
  write('ofx-sgml-1252.ofx', cp1252(sgmlHeader + bank(
    trn('DEBIT', '20261001120000[-3:BRT]', '-45.90', 'F001', 'Padaria São João – Centro') +
    trn('CREDIT', '20261005', '1500,00', 'F002', 'Salário Empresa Fictícia') +
    trn('DEBIT', '20261031235959.000[-3:BRT]', '-12.34', 'F003', '', 'Tarifa &amp; serviços') +
    trn('POS', '20261015', '3.50', 'F004', 'Estorno Café', 'Lanchonete Modelo'))));
  const xmlTrn = (type: string, date: string, amount: string, fitid: string, name: string, extra = '') => `<STMTTRN><TRNTYPE>${type}</TRNTYPE><DTPOSTED>${date}</DTPOSTED><TRNAMT>${amount}</TRNAMT><FITID>${fitid}</FITID><NAME>${name}</NAME>${extra}</STMTTRN>\n`;
  write('ofx-xml-card.ofx', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>\n<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><DTSERVER>20261031</DTSERVER><LANGUAGE>POR</LANGUAGE></SONRS></SIGNONMSGSRSV1>\n<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>1</TRNUID><CCSTMTRS><CURDEF>BRL</CURDEF><CCACCTFROM><ACCTID>4111XXXXXXXX1111</ACCTID></CCACCTFROM>\n<BANKTRANLIST>\n${xmlTrn('DEBIT', '20261003', '-89.90', 'C1', 'Livraria Exemplo &amp; Cia')}${xmlTrn('DEBIT', '20261007', '-250.00', 'C2', 'Loja Online Fictícia', '<ORIGCURRENCY><CURRATE>5.00</CURRATE><CURSYM>USD</CURSYM></ORIGCURRENCY>')}${xmlTrn('CREDIT', '20261009', '30.00', 'C3', 'Crédito de estorno')}</BANKTRANLIST>\n</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>\n`));
  write('quicken.qfx', Buffer.from(sgmlHeader.replace('CHARSET:1252', 'CHARSET:NONE') + bank(
    trn('DEBIT', '20261002', '-10.00', 'Q1', 'Banca Fictícia') + trn('DEBIT', '20260230', '-20.00', 'Q2', 'Data inválida') + trn('DEBIT', '20261004', '-30.10', '', 'Sem identificador')).replace('<SIGNONMSGSRSV1><SONRS>', '<SIGNONMSGSRSV1><SONRS><INTU.BID>00000'), 'utf8'));
  write('ofx-hostile-entity.ofx', Buffer.from('<?xml version="1.0"?>\n<!DOCTYPE OFX [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF><BANKTRANLIST><STMTTRN><TRNAMT>-1.00</TRNAMT><NAME>&xxe;</NAME></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>\n'));
  write('ofx-usd.ofx', Buffer.from(sgmlHeader + bank(trn('DEBIT', '20261002', '-10.00', 'U1', 'Foreign'), { currency: 'USD' })));
  write('ofx-two-accounts.ofx', Buffer.from(sgmlHeader + bank(trn('DEBIT', '20261002', '-10.00', 'A1', 'Conta A')).replace('</STMTTRNRS>', '</STMTTRNRS><STMTTRNRS><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>0001<ACCTID>999</BANKACCTFROM><BANKTRANLIST>' + trn('DEBIT', '20261003', '-5.00', 'B1', 'Conta B') + '</BANKTRANLIST></STMTRS></STMTTRNRS>')));
  write('ofx-truncated.ofx', Buffer.from((sgmlHeader + bank(trn('DEBIT', '20261002', '-10.00', 'T1', 'Corte'))).slice(0, -60)));

  // ---------------------------------------------------------------- CSV/TSV
  write('csv-banco-1252.csv', cp1252([
    'Extrato de conta corrente;;;', 'Agência;0001;Conta;12345-6', '',
    'Data;Lançamento;Valor (R$);Saldo (R$)',
    '01/10/2026;SALDO ANTERIOR;;1.000,00',
    '02/10/2026;Supermercado Exemplo – Unidade 3;-1.234,56;-234,56',
    '15/10/2026;"Transferência recebida; ref. ""abc""";2.500,00;2.265,44',
    '20/10/2026;;-0,99;2.264,45',
    '31/10/2026;Café “Modelo”;-7,50;2.256,95',
  ].join('\r\n') + '\r\n'));
  write('csv-utf8-bom-comma.csv', Buffer.from('\ufeffDate,Description,Amount\n2026-10-01,"Coffee shop, downtown",-4.50\n2026-10-02,"Multi\nline note","-1,234.56"\n2026-10-03,Refund,10.5\n', 'utf8'));
  write('tsv-utf16le.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Data\tHistórico\tDébito\tCrédito\r\n03/10/2026\tAluguel Fictício\t1.800,00\t\r\n05/10/2026\tReembolso Exemplo\t\t120,35\r\n13/10/2026\tLançamento duplo\t10,00\t5,00\r\n', 'utf16le')]));
  write('csv-ambiguous-dates.csv', Buffer.from('data;descricao;valor\n01/02/2026;Mercado;-10,00\n03/04/2026;Farmácia;-20,50\n05/06/2026;Salário;3.000,00\n'));
  write('csv-ambiguous-amounts.csv', Buffer.from('data;descricao;valor\n2026-10-01;Compra parcelada;-1.234\n2026-10-02;Outra compra;-2.500\n2026-10-03;Ajuste;10\n'));
  write('csv-unknown-layout.txt', Buffer.from('2026-10-01|Corrida App Fictício|-23,45\n2026-10-02|Padaria Exemplo|-8,00\n2026-10-03|Pix recebido|150,00\n'));
  write('csv-misnamed.png', Buffer.from('data;descricao;valor\n2026-10-01;Arquivo renomeado;-1,00\n'));
  write('csv-broken-quotes.csv', Buffer.from('data;descricao;valor\n2026-10-01;"Aspas abertas;-10,00\n'));
  write('html-as-xls.xls', Buffer.from('<html><body><table><tr><td>Data</td><td>Valor</td></tr></table></body></html>'));

  // ---------------------------------------------------------------- XLS/XLSX
  const serial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
  const date = (y: number, m: number, d: number) => ({ t: 'n', v: serial(y, m, d), z: 'dd/mm/yyyy' });
  const sheet = (rows: unknown[][]) => XLSX.utils.aoa_to_sheet(rows);
  const props = { Title: 'Corpus sintético', Author: 'EcoFinance', CreatedDate: new Date(Date.UTC(2026, 0, 1)) };
  {
    const extrato = sheet([
      ['Extrato do cartão fictício'], [],
      ['Data', 'Descrição', 'Valor'],
      [date(2026, 10, 1), 'Mercado Exemplo', -45.9],
      [date(2026, 10, 2), 'Texto com valor', 'R$ -1.234,56'],
      [date(2026, 10, 3), 'Parcela calculada', { t: 'n', v: -33.33, f: 'ROUND(-99.99/3,2)' }],
      [date(2026, 10, 4), '', -5],
      ['14/10/2026', 'Data em texto', 12.5],
      [date(2026, 10, 5), 'Precisão excessiva', 0.333],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet([['Resumo do mês'], ['Total', -1305.38]]), 'Resumo');
    XLSX.utils.book_append_sheet(book, extrato, 'Extrato Out');
    XLSX.utils.book_append_sheet(book, sheet([['Data', 'Descrição', 'Valor'], [date(2026, 10, 9), 'Oculta', -1]]), 'Oculta');
    book.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }] };
    write('xlsx-multi-sheet.xlsx', XLSX.write(book, { type: 'buffer', bookType: 'xlsx', Props: props }));
    // Same workbook with a (dummy, never executed) VBA project entry.
    const zip = XLSX.CFB.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx', Props: props }), { type: 'buffer' });
    XLSX.CFB.utils.cfb_add(zip, 'xl/vbaProject.bin', Buffer.from('synthetic-not-a-macro'));
    write('xlsm-macro.xlsm', XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' }));
}
  {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet([['Data', 'Histórico', 'Valor'], [date(2026, 10, 1), 'Conta corrente', -10]]), 'Conta');
    XLSX.utils.book_append_sheet(book, sheet([['Data', 'Estabelecimento', 'Valor'], [date(2026, 10, 2), 'Compra cartão', -20.5], [date(2026, 10, 3), 'Outra compra cartão', -1]]), 'Cartão');
    write('xlsx-two-statements.xlsx', XLSX.write(book, { type: 'buffer', bookType: 'xlsx', Props: props }));
}
  {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet([['Data', 'Histórico', 'Valor'], [date(2026, 10, 6), 'Conta de luz fictícia', -150.75], [date(2026, 10, 7), 'Depósito', 2000], [date(2026, 10, 8), 'Taxa', -0.01]]), 'Extrato');
    const xls = XLSX.write(book, { type: 'buffer', bookType: 'xls', Props: props });
    write('xls-biff8.xls', xls);
    // FILEPASS (0x002F) right after the workbook BOF marks an encrypted BIFF8 stream.
    const cfb = XLSX.CFB.read(xls, { type: 'buffer' }), entry = XLSX.CFB.find(cfb, 'Workbook');
    const stream = Buffer.from(entry.content), bofLength = 4 + stream.readUInt16LE(2);
    const filepass = Buffer.from([0x2f, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
    entry.content = Buffer.concat([stream.subarray(0, bofLength), filepass, stream.subarray(bofLength)]); entry.size = entry.content.length;
    write('xls-filepass.xls', XLSX.CFB.write(cfb, { type: 'buffer' }));
}
  {
    const cfb = XLSX.CFB.utils.cfb_new();
    XLSX.CFB.utils.cfb_add(cfb, 'EncryptionInfo', Buffer.from([4, 0, 4, 0, 0x40, 0, 0, 0]));
    XLSX.CFB.utils.cfb_add(cfb, 'EncryptedPackage', Buffer.alloc(512, 7));
    write('xlsx-encrypted.xlsx', XLSX.CFB.write(cfb, { type: 'buffer' }));
}
  // Minimal ZIP writer for hostile containers SheetJS would never produce.
  function zip(entries: ZipEntry[]) {
    const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
    for (const { name, data, declared } of entries) {
      const compressed = deflateRawSync(data, { level: 9 }), nameBytes = Buffer.from(name), crc = crc32(data);
      const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(declared ?? data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
      const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(declared ?? data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
      locals.push(local, nameBytes, compressed); centrals.push(central, nameBytes); offset += 30 + nameBytes.length + compressed.length;
    }
    const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}
  const workbookXml = Buffer.from('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="A" sheetId="1"/></sheets></workbook>');
  write('xlsx-zip-bomb.xlsx', zip([{ name: '[Content_Types].xml', data: Buffer.from('<Types/>') }, { name: 'xl/workbook.xml', data: workbookXml }, { name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(64 * 1024 * 1024, 0x20) }]));
  write('xlsx-lying-size.xlsx', zip([{ name: 'xl/workbook.xml', data: workbookXml }, { name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(4 * 1024 * 1024, 0x20), declared: 1024 }]));
  return files;
}
