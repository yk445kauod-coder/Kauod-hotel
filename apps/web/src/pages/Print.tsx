import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, ApiError } from '../api';
import type { InvoiceFull, InvoiceLine, Settings, CalcResult, Payment } from '../types';
import { egpEn, d, PAY_LABEL } from '../format';

interface Issuer { name: string; taxId: string; address: string; city: string; }
interface PrintData {
  invoice: InvoiceFull; lines: InvoiceLine[]; calc: CalcResult; settings: Settings;
  paid: string; qr: string; etaIssues: string[]; etaConfigured: boolean; issuer: Issuer;
}

function sig(label: string): [string, string] {
  const [ar, en] = (label || '').split('|');
  return [ar ?? '', en ?? ''];
}

export function PrintView({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const [data, setData] = useState<PrintData | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [err, setErr] = useState('');
  const qrRef = useRef<HTMLCanvasElement>(null);
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<PrintData>(`/api/invoices/${invoiceId}/print`);
        setData(r);
        const p = await api.get<{ payments: Payment[] }>(`/api/invoices/${invoiceId}/payments`);
        setPayments(p.payments);
      } catch (e) {
        const ae = e as ApiError;
        setErr(ae.code === 'not_printable' ? 'يجب قفل الفاتورة قبل الطباعة' : `تعذّر تحميل الفاتورة (${ae.code})`);
      }
    })();
  }, [invoiceId]);

  useEffect(() => {
    if (!data) return;
    // ETA QR payload is base64-encoded TLV; encode it as a QR image.
    QRCode.toDataURL(data.qr, { errorCorrectionLevel: 'M', margin: 1, width: 220 })
      .then(setQrUrl).catch(() => setQrUrl(''));
  }, [data]);

  if (err) return (
    <div className="content">
      <div className="alert err">{err}</div>
      <button className="btn" onClick={onClose}>رجوع</button>
    </div>
  );
  if (!data) return <div className="content muted">جارٍ التحميل…</div>;

  const { invoice, lines, calc, settings, paid, issuer } = data;
  const remaining = (Number(calc.total) - Number(paid)).toFixed(2);
  const [sigLar, sigLen] = sig(settings.signature_left);
  const [sigRar, sigRen] = sig(settings.signature_right);
  const cancelled = invoice.status === 'cancelled';

  return (
    <div>
      <div className="no-print content" style={{ maxWidth: 900 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn" onClick={onClose}>← رجوع</button>
          <div className="row">
            {data.etaIssues.length > 0
              ? <span className="alert warn" style={{ margin: 0 }}>تنبيهات الضرائب: {data.etaIssues.length}</span>
              : <span className="alert ok" style={{ margin: 0 }}>بيانات الفاتورة متوافقة مع مصلحة الضرائب</span>}
            <button className="btn primary" onClick={() => window.print()}>🖨 طباعة / PDF</button>
          </div>
        </div>
        {data.etaIssues.length > 0 && (
          <div className="alert warn" style={{ marginTop: 12 }}>
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>{data.etaIssues.map((i, k) => <li key={k}>{i}</li>)}</ul>
          </div>
        )}
      </div>

      <div className="print-area">
        <div className="inv">
          <div className="inv-bar" />
          {cancelled && (
            <>
              <div className="inv-cancel">✕ فاتورة ملغية — CANCELLED ✕</div>
              <div className="inv-cancel-note">هذه الفاتورة ملغية ولا يعتد بها — لا تستخدمها كفاتورة سليمة</div>
            </>
          )}

          <div className="inv-head">
            <div className="inv-seller">
              <div>ب. ض : {issuer.taxId}</div>
              {settings.commercial_register && <div>سجل تجاري : {settings.commercial_register}</div>}
              <div className="inv-city">{issuer.city} | {settings.city}</div>
            </div>
            <div className="inv-brand">
              {settings.logo_data && <img src={settings.logo_data} alt="logo" />}
              <div className="inv-name">{settings.hotel_name}</div>
              {settings.hotel_name_en && <div className="inv-name-en">{settings.hotel_name_en}</div>}
            </div>
            <div className="inv-meta">
              <div className="inv-invoice-box">
                <div className="inv-invoice-label">فاتورة INVOICE</div>
                <div className="inv-invoice-no">No. {invoice.serial}</div>
              </div>
              <div className="inv-date">{d(invoice.issued_at)}</div>
            </div>
          </div>

          <div className="inv-rule" />

          <div className="inv-cards">
            <div className="inv-billto">
              <div className="inv-billto-label">إلى — BILL TO</div>
              <div className="inv-billto-name">{invoice.guest_name}</div>
              <div className="inv-billto-sub">
                {invoice.room_number ? <>غرفة Room {invoice.room_number} • </> : null}
                {d(invoice.check_in)} → {d(invoice.check_out)} • {calc.nights} ليالي
              </div>
              {invoice.receiver_tax_id && <div className="inv-billto-sub">الرقم الضريبي: {invoice.receiver_tax_id}</div>}
            </div>
            <div className="inv-total-box">
              <div className="inv-total-label">التاريخ DATE</div>
              <div className="inv-total-date">{d(invoice.issued_at)}</div>
              <div className="inv-total-label" style={{ marginTop: 10 }}>المبلغ المطلوب TOTAL DUE</div>
              <div className="inv-total-amount">{egpEn(calc.total)}</div>
            </div>
          </div>

          <table className="inv-lines">
            <thead>
              <tr>
                <th className="c-desc">البيان DESCRIPTION</th>
                <th className="c-num">مبلغ جزئي<br />SUBTOTAL</th>
                <th className="c-num">مبلغ كلي<br />TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id}>
                  <td className="c-desc">
                    <div className="inv-line-desc">{l.description}</div>
                    <div className="inv-line-sub">الكمية {l.qty} • سعر الوحدة {egpEn(l.unit_price)}</div>
                  </td>
                  <td className="c-num">{egpEn(l.net)}</td>
                  <td className="c-num">{egpEn(l.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="inv-summary-wrap">
            <div className="inv-summary">
              <div><span>الإجمالي قبل الضريبة</span><b>{egpEn(calc.subtotalGross)}</b></div>
              <div><span>الصافي</span><b>{egpEn(calc.subtotalNet)}</b></div>
              <div><span>ضريبة القيمة المضافة {calc.vatRate}%</span><b>{egpEn(calc.taxTotal)}</b></div>
              <div><span>خصم {calc.discountRate}%</span><b>{egpEn(calc.discount)}</b></div>
              <div className="inv-grand"><span>المبلغ المطلوب دفعه</span><b>{egpEn(calc.total)}</b></div>
              {Number(paid) > 0 && <div><span>المدفوع</span><b>{egpEn(paid)}</b></div>}
              {Number(paid) > 0 && <div><span>المتبقي</span><b>{egpEn(remaining)}</b></div>}
            </div>
          </div>

          {payments.length > 0 && (
            <table className="inv-lines" style={{ marginTop: 12 }}>
              <thead><tr><th className="c-desc">المدفوعات</th><th className="c-num">الطريقة</th><th className="c-num">التاريخ</th><th className="c-num">المبلغ</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}><td className="c-desc">{PAY_LABEL[p.method] ?? p.method}</td><td className="c-num">{p.reference || '—'}</td><td className="c-num">{d(p.paid_at)}</td><td className="c-num">{egpEn(p.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="inv-signs">
            <div className="inv-sign">
              <div className="inv-sign-line" />
              <div className="inv-sign-ar">{sigLar}</div>
              {sigLen && <div className="inv-sign-en">{sigLen}</div>}
            </div>
            <div className="inv-sign">
              <div className="inv-sign-line" />
              <div className="inv-sign-ar">{sigRar}</div>
              {sigRen && <div className="inv-sign-en">{sigRen}</div>}
            </div>
          </div>

          <div className="inv-foot">
            <div className="qr">
              {qrUrl && <img src={qrUrl} alt="ETA QR" />}
              <div className="inv-qr-note">رمز الاستجابة السريعة لمصلحة الضرائب المصرية</div>
            </div>
            <div className="inv-foot-text">
              {settings.footer_note}
              <div className="inv-foot-uuid">UUID: <span className="mono">{invoice.uuid}</span></div>
            </div>
          </div>
        </div>
      </div>
      <canvas ref={qrRef} style={{ display: 'none' }} />
    </div>
  );
}
