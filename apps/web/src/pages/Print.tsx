import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, ApiError } from '../api';
import { exportExcelMatrix } from '../exports';
import type { InvoiceFull, InvoiceLine, Settings, CalcResult, Payment } from '../types';
import { egpEn, d, PAY_LABEL, STATUS_LABEL } from '../format';

interface Issuer { name: string; taxId: string; address: string; city: string; }
interface PrintData {
  invoice: InvoiceFull; lines: InvoiceLine[]; calc: CalcResult; settings: Settings;
  paid: string; qr: string; totalInWords: string; etaIssues: string[]; etaConfigured: boolean; issuer: Issuer;
}

function sig(label: string): [string, string] {
  const [ar, en] = (label || '').split('|');
  return [ar ?? '', en ?? ''];
}

const money = (v: string | number) => egpEn(v);

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
    QRCode.toDataURL(data.qr, { errorCorrectionLevel: 'M', margin: 1, width: 240 })
      .then(setQrUrl).catch(() => setQrUrl(''));
  }, [data]);

  function exportInvoiceExcel() {
    if (!data) return;
    const { invoice, lines, calc, settings, paid } = data;
    const num = (v: string | number) => Number(v || 0).toFixed(2);
    const rows: (string | number)[][] = [
      [settings.hotel_name, `فاتورة رقم ${invoice.serial}`, settings.hotel_name_en],
      [`ب. ض: ${settings.tax_registration_number}`, '', `سجل تجاري: ${settings.commercial_register}`],
      [`إلى: ${invoice.guest_name}`, '', `غرفة ${invoice.room_number || '—'}`],
      [`التاريخ: ${invoice.issued_at.slice(0, 10)}`, '', `الحالة: ${STATUS_LABEL[invoice.status] ?? invoice.status}`],
      ['البيان', 'الكمية', 'سعر الوحدة', 'مبلغ جزئي', 'مبلغ كلي'],
      ...lines.map((l) => [l.description, l.qty, num(l.unit_price), num(l.net), num(l.gross)]),
      ['إجمالي المبلغ الجزئي', '', '', num(calc.subtotalNet), num(calc.subtotalGross)],
      [`ضريبة القيمة المضافة ${calc.vatRate}%`, '', '', '', num(calc.taxTotal)],
      [`خصم ${calc.discountRate}%`, '', '', '', num(calc.discount)],
      ...(Number(paid) > 0 ? [['المدفوع', '', '', '', num(paid)], ['المتبقي', '', '', '', num(Number(calc.total) - Number(paid))]] : []),
      ['المبلغ المطلوب دفعه', '', '', '', num(calc.total)],
      [data.totalInWords, '', '', '', ''],
      [`UUID: ${invoice.uuid}`, '', '', '', ''],
    ];
    exportExcelMatrix(`invoice-${invoice.serial}.xls`, rows);
  }

  if (err) return (
    <div className="content">
      <div className="alert err">{err}</div>
      <button className="btn" onClick={onClose}>رجوع</button>
    </div>
  );
  if (!data) return <div className="content muted">جارٍ التحميل…</div>;

  const { invoice, lines, calc, settings, paid, issuer } = data;
  const totalNum = Number(calc.total);
  const paidNum = Number(paid);
  const remainingNum = totalNum - paidNum;
  const [sigLar, sigLen] = sig(settings.signature_left);
  const [sigRar, sigRen] = sig(settings.signature_right);
  const cancelled = invoice.status === 'cancelled';

  const payState = paidNum >= totalNum - 0.005 ? 'paid' : paidNum > 0 ? 'partial' : 'unpaid';
  const payLabel = payState === 'paid' ? 'مدفوعة' : payState === 'partial' ? 'مدفوعة جزئيًا' : 'غير مدفوعة';

  return (
    <div>
      <div className="no-print content print-toolbar" style={{ maxWidth: 900 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn" onClick={onClose}>← رجوع</button>
          <div className="row">
            {data.etaIssues.length > 0
              ? <span className="alert warn" style={{ margin: 0 }}>تنبيهات الضرائب: {data.etaIssues.length}</span>
              : <span className="alert ok" style={{ margin: 0 }}>بيانات الفاتورة متوافقة مع مصلحة الضرائب</span>}
            <button className="btn" onClick={exportInvoiceExcel}>⬇ Excel</button>
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
        <article className="inv">
          <div className="inv-band" />
          {cancelled && (
            <>
              <div className="inv-cancel-watermark">ملغية · CANCELLED</div>
              <div className="inv-cancel-note">هذه الفاتورة ملغية ولا يعتد بها — لا تستخدمها كفاتورة سليمة</div>
            </>
          )}

          <header className="inv-hd">
            <div className="inv-hd-seller">
              <div className="inv-seller-row">ب. ض : <bdi>{issuer.taxId || '—'}</bdi></div>
              {settings.commercial_register && <div className="inv-seller-row">سجل تجاري : <bdi>{settings.commercial_register}</bdi></div>}
              {issuer.address && <div className="inv-seller-row">{issuer.address}</div>}
              {issuer.city && <div className="inv-seller-city">{issuer.city}</div>}
            </div>

            <div className="inv-hd-brand">
              {settings.logo_data && <img className="inv-logo" src={settings.logo_data} alt="logo" />}
              <div className="inv-name">{settings.hotel_name}</div>
              {settings.hotel_name_en && <div className="inv-name-en">{settings.hotel_name_en}</div>}
            </div>

            <div className="inv-hd-meta">
              <div className="inv-doc-box">
                <div className="inv-doc-label">فاتورة · INVOICE</div>
                <div className="inv-doc-no">No. <bdi>{invoice.serial}</bdi></div>
              </div>
              <div className="inv-doc-date">{d(invoice.issued_at)}</div>
              <div className={`inv-pay-badge is-${payState}`}>{payLabel}</div>
            </div>
          </header>

          <section className="inv-guest">
            <div className="inv-guest-cap">بيانات النزيل — GUEST DETAILS</div>
            <table className="inv-guest-grid">
              <tbody>
                <tr>
                  <td><div className="inv-k">اسم النزيل</div><div className="inv-k-en">Guest Name</div><div className="inv-v">{invoice.guest_name}</div></td>
                  <td><div className="inv-k">رقم الغرفة</div><div className="inv-k-en">Room No.</div><div className="inv-v"><bdi>{invoice.room_number || '—'}</bdi></div></td>
                  <td><div className="inv-k">تاريخ الوصول</div><div className="inv-k-en">Arrival</div><div className="inv-v"><bdi>{d(invoice.check_in)}</bdi></div></td>
                  <td><div className="inv-k">تاريخ المغادرة</div><div className="inv-k-en">Departure</div><div className="inv-v"><bdi>{d(invoice.check_out)}</bdi></div></td>
                </tr>
                <tr>
                  <td><div className="inv-k">عدد الليالي</div><div className="inv-k-en">Nights</div><div className="inv-v"><bdi>{calc.nights}</bdi> ليلة</div></td>
                  <td><div className="inv-k">تاريخ الفاتورة</div><div className="inv-k-en">Invoice Date</div><div className="inv-v"><bdi>{d(invoice.issued_at)}</bdi></div></td>
                  <td><div className="inv-k">الحالة</div><div className="inv-k-en">Status</div><div className="inv-v">{STATUS_LABEL[invoice.status] ?? invoice.status}</div></td>
                  <td className="inv-due-cell"><div className="inv-k">المبلغ المطلوب</div><div className="inv-k-en">Total Due</div><div className="inv-v inv-due-val"><bdi>{money(calc.total)}</bdi></div></td>
                </tr>
              </tbody>
            </table>
          </section>

          <table className="inv-table">
            <thead>
              <tr>
                <th className="c-idx">#</th>
                <th className="c-desc">البيان / DESCRIPTION</th>
                <th className="c-qty">الكمية<br />Qty</th>
                <th className="c-unit">سعر الوحدة<br />Unit price</th>
                <th className="c-net">مبلغ جزئي<br />Subtotal</th>
                <th className="c-gross">مبلغ كلي<br />Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id}>
                  <td className="c-idx">{i + 1}</td>
                  <td className="c-desc">{l.description}</td>
                  <td className="c-qty">{l.qty}</td>
                  <td className="c-unit">{egpEn(l.unit_price)}</td>
                  <td className="c-net">{egpEn(l.net)}</td>
                  <td className="c-gross">{egpEn(l.gross)}</td>
                </tr>
              ))}
              <tr className="inv-sub-row">
                <td className="c-desc" colSpan={4}>إجمالي المبلغ الجزئي / Subtotal</td>
                <td className="c-net">{egpEn(calc.subtotalNet)}</td>
                <td className="c-gross">{egpEn(calc.subtotalGross)}</td>
              </tr>
            </tbody>
          </table>

          <div className="inv-lower">
            <div className="inv-lower-left">
              <div className="inv-words">
                <div className="inv-words-cap">المبلغ بالحروف / Amount in words</div>
                <div className="inv-words-body">{data.totalInWords}</div>
              </div>
              {invoice.notes && (
                <div className="inv-notes">
                  <div className="inv-words-cap">ملاحظات / Notes</div>
                  <div>{invoice.notes}</div>
                </div>
              )}
            </div>

            <table className="inv-totals">
              <tbody>
                <tr><th>ضريبة القيمة المضافة {calc.vatRate}%</th><td>{money(calc.taxTotal)}</td></tr>
                <tr><th>خصم {calc.discountRate}%</th><td>{money(calc.discount)}</td></tr>
                {paidNum > 0 && <tr><th>المدفوع</th><td>{money(paid)}</td></tr>}
                {paidNum > 0 && <tr><th>المتبقي</th><td>{money(remainingNum)}</td></tr>}
                <tr className="inv-total-row"><th>المبلغ المطلوب دفعه</th><td>{money(calc.total)}</td></tr>
              </tbody>
            </table>
          </div>

          {payments.length > 0 && (
            <table className="inv-table inv-pay-table">
              <thead>
                <tr><th className="c-idx">#</th><th className="c-desc">المدفوعات / Payments</th><th className="c-unit">المرجع</th><th className="c-net">الطريقة</th><th className="c-gross">التاريخ</th><th className="c-gross">المبلغ</th></tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={p.id}>
                    <td className="c-idx">{i + 1}</td>
                    <td className="c-desc">{PAY_LABEL[p.method] ?? p.method}</td>
                    <td className="c-unit">{p.reference || '—'}</td>
                    <td className="c-net">{PAY_LABEL[p.method] ?? p.method}</td>
                    <td className="c-gross">{d(p.paid_at)}</td>
                    <td className="c-gross">{egpEn(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <section className="inv-signs">
            <div className="inv-sign">
              <div className="inv-sign-line" />
              <div className="inv-sign-ar">{sigLar || 'المدير المالي'}</div>
              {sigLen && <div className="inv-sign-en">{sigLen}</div>}
            </div>
            <div className="inv-stamp">ختم / Stamp</div>
            <div className="inv-sign">
              <div className="inv-sign-line" />
              <div className="inv-sign-ar">{sigRar || 'مدير الائتمان'}</div>
              {sigRen && <div className="inv-sign-en">{sigRen}</div>}
            </div>
          </section>

          <footer className="inv-ft">
            <div className="inv-qr">
              {qrUrl && <img src={qrUrl} alt="ETA QR" />}
              <div className="inv-qr-note">رمز الاستجابة السريعة<br />لمصلحة الضرائب المصرية</div>
            </div>
            <div className="inv-ft-body">
              {settings.footer_note && <div>{settings.footer_note}</div>}
              <div className="inv-ft-uuid">UUID: <span className="mono">{invoice.uuid}</span></div>
              <div className="inv-ft-made">هذه الفاتورة صادرة إلكترونيًا — نظام فواتير فندق قاعود</div>
            </div>
          </footer>
        </article>
      </div>
      <canvas ref={qrRef} style={{ display: 'none' }} />
    </div>
  );
}
