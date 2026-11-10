import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, ApiError } from '../api';
import type { InvoiceFull, InvoiceLine, Settings, CalcResult, Payment } from '../types';
import { egpEn, d, dt, STATUS_LABEL, PAY_LABEL } from '../format';

interface PrintData {
  invoice: InvoiceFull; lines: InvoiceLine[]; calc: CalcResult; settings: Settings;
  paid: string; qr: string; etaIssues: string[]; etaConfigured: boolean;
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

  const { invoice, lines, calc, settings, paid } = data;
  const remaining = (Number(calc.total) - Number(paid)).toFixed(2);

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
        <div className="print-head">
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{settings.hotel_name}</div>
            <div style={{ fontSize: 13 }}>{settings.hotel_name_en}</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>{settings.address} — {settings.city}</div>
            <div style={{ fontSize: 12 }}>هاتف: {settings.phone || '—'} — {settings.email || '—'}</div>
          </div>
          <div style={{ textAlign: 'left', fontSize: 12 }} dir="ltr">
            <div><strong>Tax ID:</strong> {settings.tax_registration_number}</div>
            <div><strong>CR:</strong> {settings.commercial_register || '—'}</div>
            <div><strong>Activity:</strong> {settings.activity_code}</div>
          </div>
        </div>

        <div className="print-title">فاتورة ضريبية إلكترونية</div>
        <div style={{ textAlign: 'center', fontSize: 12, marginBottom: 10 }}>
          Tax Invoice — رقم الفاتورة: <span className="mono">{invoice.serial}</span> — UUID: <span className="mono">{invoice.uuid}</span>
        </div>

        <table style={{ marginBottom: 12 }}>
          <tbody>
            <tr>
              <td><strong>النزيل:</strong> {invoice.guest_name}</td>
              <td><strong>الرقم الضريبي:</strong> {invoice.receiver_tax_id || '—'}</td>
            </tr>
            <tr>
              <td><strong>الغرفة:</strong> {invoice.room_number || '—'}</td>
              <td><strong>تاريخ الإصدار:</strong> {dt(invoice.issued_at)}</td>
            </tr>
            <tr>
              <td><strong>الدخول:</strong> {d(invoice.check_in)}</td>
              <td><strong>الخروج:</strong> {d(invoice.check_out)}</td>
            </tr>
          </tbody>
        </table>

        <table>
          <thead>
            <tr><th style={{ width: '6%' }}>#</th><th>الوصف</th><th style={{ width: '10%' }}>الكمية</th><th style={{ width: '16%' }}>سعر الوحدة</th><th style={{ width: '18%' }}>الإجمالي</th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id}>
                <td>{i + 1}</td>
                <td>{l.description}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{egpEn(l.unit_price)}</td>
                <td className="num">{egpEn(l.gross)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
          <div style={{ fontSize: 12 }}>
            {invoice.notes && <div><strong>ملاحظات:</strong> {invoice.notes}</div>}
            {payments.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <strong>المدفوعات:</strong>
                <table style={{ marginTop: 4, fontSize: 12 }}>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}><td>{PAY_LABEL[p.method] ?? p.method}</td><td>{d(p.paid_at)}</td><td className="num">{egpEn(p.amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <table style={{ width: 300 }}>
            <tbody>
              <tr><td>الإجمالي قبل الضريبة</td><td className="num">{egpEn(calc.subtotalGross)}</td></tr>
              <tr><td>الصافي</td><td className="num">{egpEn(calc.subtotalNet)}</td></tr>
              <tr><td>الخصم</td><td className="num">{egpEn(calc.discount)}</td></tr>
              <tr><td>ضريبة القيمة المضافة {settings.vat_rate}%</td><td className="num">{egpEn(calc.taxTotal)}</td></tr>
              <tr style={{ borderTop: '2px solid #000', fontWeight: 700 }}><td>الإجمالي المستحق</td><td className="num">{egpEn(calc.total)}</td></tr>
              <tr><td>المدفوع</td><td className="num">{egpEn(paid)}</td></tr>
              <tr><td>المتبقي</td><td className="num">{egpEn(remaining)}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="qr">
          {qrUrl && <img src={qrUrl} alt="ETA QR" />}
          <div style={{ fontSize: 11 }}>رمز الاستجابة السريعة لمصلحة الضرائب المصرية</div>
        </div>

        <div style={{ marginTop: 20, fontSize: 11, textAlign: 'center', color: '#444' }}>
          هذه الفاتورة صادرة إلكترونيًا وفق منظومة الفاتورة الإلكترونية لمصلحة الضرائب المصرية.
        </div>
      </div>
      <canvas ref={qrRef} style={{ display: 'none' }} />
    </div>
  );
}
