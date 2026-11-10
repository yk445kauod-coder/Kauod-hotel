import type { CalcResult } from './types.js';

// ---- UUID v4 (crypto.getRandomValues; available in Workers and browsers) ----
export function uuidv4(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

export interface EtaAddress {
  country: string; governate: string; regionCity: string; street: string; buildingNumber: string;
}
export interface EtaParty {
  type: 'B' | 'P' | 'F';
  id: string;          // tax registration number
  name: string;
  address: EtaAddress;
}
export interface EtaTaxableItem { taxType: string; amount: string; rate: string; }
export interface EtaLine {
  description: string;
  itemType: 'EGS' | 'GS1';
  itemCode: string;
  unitType: string;          // 'EA'
  quantity: number;
  unitValue: { currencySold: string; amountEGP: string };
  salesTotal: string;
  discount: { rate: string; amount: string };
  netTotal: string;
  total: string;
  taxableItems: EtaTaxableItem[];
}
export interface EtaDocument {
  issuer: EtaParty;
  receiver: EtaParty;
  documentType: 'I' | 'C' | 'D';   // invoice / credit note / debit note
  documentTypeVersion: '1.0';
  dateTimeIssued: string;
  taxpayerActivityCode: string;
  internalID: string;
  invoiceLines: EtaLine[];
  totalDiscountAmount: string;
  totalSalesAmount: string;
  netAmount: string;
  taxTotals: EtaTaxableItem[];
  totalAmount: string;
  extraDiscountAmount: string;
  totalItemsDiscountAmount: string;
}

export interface EtaIssuerConfig {
  taxRegistrationNumber: string;
  name: string;
  address: EtaAddress;
  activityCode: string;
}

export interface BuildEtaArgs {
  serial: number;
  issuedAt: string;      // ISO
  receiverName: string;
  receiverTaxId?: string;
  calc: CalcResult;
  issuer: EtaIssuerConfig;
  taxType?: string;      // default 'T1' = general VAT
}

export function buildEtaDocument(a: BuildEtaArgs): EtaDocument {
  const taxType = a.taxType ?? 'T1';
  const rate = String(a.calc.vatRate);
  const docType: EtaDocument['documentType'] = 'I';

  const lines: EtaLine[] = a.calc.lines.map((l) => {
    const unit = a.calc.vatRate > 0 ? l.gross : l.net;
    const netTotal = l.net;
    const discountAmount = '0.00';
    const taxableAmount = (Number(l.tax)).toFixed(2);
    return {
      description: l.description,
      itemType: 'EGS',
      itemCode: `KH-${l.description.slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'ITEM'}`,
      unitType: 'EA',
      quantity: l.qty,
      unitValue: { currencySold: 'EGP', amountEGP: (l.qty ? Number(unit) / l.qty : 0).toFixed(2) },
      salesTotal: Number(l.gross).toFixed(2),
      discount: { rate: '0', amount: discountAmount },
      netTotal,
      total: l.gross,
      taxableItems: [{ taxType, amount: taxableAmount, rate }],
    };
  });

  const totalDiscount = a.calc.discount;
  return {
    issuer: {
      type: 'B',
      id: a.issuer.taxRegistrationNumber,
      name: a.issuer.name,
      address: a.issuer.address,
    },
    receiver: {
      type: a.receiverTaxId ? 'B' : 'P',
      id: a.receiverTaxId || '000000000',
      name: a.receiverName,
      address: { country: 'EG', governate: 'Alexandria', regionCity: 'Alexandria', street: '-', buildingNumber: '-' },
    },
    documentType: docType,
    documentTypeVersion: '1.0',
    dateTimeIssued: a.issuedAt,
    taxpayerActivityCode: a.issuer.activityCode,
    internalID: String(a.serial),
    invoiceLines: lines,
    totalDiscountAmount: Number(totalDiscount).toFixed(2),
    totalSalesAmount: a.calc.subtotalGross,
    netAmount: a.calc.subtotalNet,
    taxTotals: [{ taxType, amount: a.calc.taxTotal, rate }],
    totalAmount: a.calc.total,
    extraDiscountAmount: '0.00',
    totalItemsDiscountAmount: '0.00',
  };
}

export interface EtaSubmission {
  documents: EtaDocument[];
  signatures: Array<{ signatureType: 'I'; value: string }>;
}

export interface EtaSigner {
  sign(payload: string): Promise<string>;
}

export async function buildEtaSubmission(doc: EtaDocument, signer?: EtaSigner): Promise<EtaSubmission> {
  if (!signer) return { documents: [doc], signatures: [] };
  const value = await signer.sign(JSON.stringify(doc));
  return { documents: [doc], signatures: [{ signatureType: 'I', value }] };
}

// ---- QR: ETA simplified-receipt TLV (base64 of tag/length/value bytes) ----
export function qrTlv(fields: Record<number, string>): string {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const [tagStr, value] of Object.entries(fields)) {
    const tag = Number(tagStr);
    const v = enc.encode(value);
    if (v.length > 255) continue;
    chunks.push(new Uint8Array([tag, v.length]), v);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  let bin = '';
  for (const byte of out) bin += String.fromCharCode(byte);
  return btoa(bin);
}

export interface QrFields {
  sellerName: string; vatNumber: string; issuedAt: string; total: string; vatTotal: string; uuid: string;
}
export function etaQrPayload(f: QrFields): string {
  return qrTlv({
    1: f.sellerName,
    2: f.vatNumber,
    3: f.issuedAt,
    4: f.total,
    5: f.vatTotal,
    6: f.uuid,
  });
}

// ---- Validation: block submission of a document the ETA would reject ----
export interface EtaIssue { path: string; message: string; }
export function validateEtaDocument(doc: EtaDocument): EtaIssue[] {
  const issues: EtaIssue[] = [];
  const req = (cond: boolean, path: string, message: string) => { if (!cond) issues.push({ path, message }); };
  req(/^\d{9}$/.test(doc.issuer.id), 'issuer.id', 'issuer tax registration number must be 9 digits');
  req(doc.issuer.name.length > 0, 'issuer.name', 'issuer name is required');
  req(/^\d{4}$/.test(doc.taxpayerActivityCode), 'taxpayerActivityCode', 'activity code must be 4 digits');
  req(doc.invoiceLines.length > 0, 'invoiceLines', 'at least one line is required');
  req(!Number.isNaN(Date.parse(doc.dateTimeIssued)), 'dateTimeIssued', 'issued datetime must be valid');

  const net = Number(doc.netAmount);
  const tax = doc.taxTotals.reduce((s, t) => s + Number(t.amount), 0);
  const disc = Number(doc.totalDiscountAmount);
  const expected = net + tax - disc;
  req(Math.abs(expected - Number(doc.totalAmount)) < 0.01, 'totalAmount',
    `totalAmount (${doc.totalAmount}) must equal netAmount + tax - discount (${expected.toFixed(2)})`);
  req(Math.abs(tax - Number(doc.taxTotals[0]?.amount ?? 0)) < 0.01, 'taxTotals', 'tax totals must be consistent');
  return issues;
}
