import {
  buildEtaDocument, buildEtaSubmission, validateEtaDocument, etaQrPayload,
  type CalcResult, type EtaDocument, type EtaIssuerConfig,
} from '@kaoud/core';
import type { Env } from './db.js';
import { hmacHex } from './crypto.js';

export interface EtaInvoiceContext {
  serial: number;
  issuedAt: string;        // local ETA datetime string
  receiverName: string;
  receiverTaxId?: string;
  calc: CalcResult;
  issuer: EtaIssuerConfig;
}

export interface EtaBuildResult {
  document: EtaDocument;
  qr: string;
  issues: string[];
}

export function buildInvoiceEta(ctx: EtaInvoiceContext): EtaBuildResult {
  const document = buildEtaDocument({
    serial: ctx.serial,
    issuedAt: ctx.issuedAt,
    receiverName: ctx.receiverName,
    receiverTaxId: ctx.receiverTaxId,
    calc: ctx.calc,
    issuer: ctx.issuer,
  });
  const qr = etaQrPayload({
    sellerName: ctx.issuer.name,
    vatNumber: ctx.issuer.taxRegistrationNumber,
    issuedAt: ctx.issuedAt,
    total: document.totalAmount,
    vatTotal: ctx.calc.taxTotal,
    uuid: document.internalID,
  });
  return { document, qr, issues: validateEtaDocument(document).map((i) => `${i.path}: ${i.message}`) };
}

export function etaConfigured(env: Env): boolean {
  return Boolean(env.ETA_CLIENT_ID && env.ETA_CLIENT_SECRET);
}

// The real ETA SDK signs with an RSA key; that is deployed as a Worker secret.
// Until it is provisioned we attach an HMAC "signature" so the payload shape is
// complete, and eta_status stays 'queued' rather than pretending it was accepted.
async function localSignature(env: Env, payload: string): Promise<string | undefined> {
  if (!env.ETA_PRIVATE_KEY) return undefined;
  return hmacHex(env.ETA_PRIVATE_KEY, payload);
}

export async function buildEtaPayload(env: Env, ctx: EtaInvoiceContext): Promise<{ submission: unknown; qr: string; issues: string[] }> {
  const built = buildInvoiceEta(ctx);
  const signature = await localSignature(env, JSON.stringify(built.document));
  const submission = await buildEtaSubmission(built.document, signature ? { sign: async () => signature } : undefined);
  return { submission, qr: built.qr, issues: built.issues };
}
