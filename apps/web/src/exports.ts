// Client-side export helpers: CSV, Excel (via an HTML table that Excel opens
// natively), JSON download, and JSON file reading. Everything runs in the
// browser — no server round-trip and no external library.

export interface ExcelOptions { title: string; headers: string[]; rows: (string | number)[][]; filename: string; }

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  download(new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' }), filename);
}

export function exportExcel({ title, headers, rows, filename }: ExcelOptions) {
  const esc = (v: string | number) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const head = `<tr><th colspan="${headers.length}" style="background:#0f2340;color:#fff;font-size:15px;padding:10px">${esc(title)}</th></tr>`
    + `<tr>${headers.map((h) => `<th style="background:#0f2340;color:#fff;padding:7px;border:1px solid #999">${esc(h)}</th>`).join('')}</tr>`;
  const body = rows.map((r) => `<tr>${r.map((v) => `<td style="padding:5px 7px;border:1px solid #ccc;text-align:center;mso-number-format:'\\@'">${esc(v)}</td>`).join('')}</tr>`).join('');
  const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">'
    + '<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>'
    + '<x:Name>Sheet1</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>'
    + '</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>'
    + `<body dir="rtl"><table border="1" style="font-family:Calibri;font-size:13px;border-collapse:collapse">${head}${body}</table>`
    + '<div style="text-align:center;color:#9ca3af;font-size:12px;padding:14px">فندق قاعود سبورتنج — نظام فواتير احترافي</div></body></html>';
  download(new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' }), filename);
}

export function downloadJson(filename: string, data: unknown) {
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }), filename);
}

// Free-form Excel export: the caller supplies the full cell matrix, so layouts
// with a title block, a line-item table and a totals block can be produced.
export function exportExcelMatrix(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = rows.map((r) => `<tr>${r.map((v) => `<td style="padding:5px 7px;border:1px solid #ccc;text-align:center;mso-number-format:'\\@'">${esc(v)}</td>`).join('')}</tr>`).join('');
  const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">'
    + '<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>'
    + '<x:Name>Sheet1</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>'
    + '</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>'
    + `<body dir="rtl"><table border="1" style="font-family:Calibri;font-size:13px;border-collapse:collapse">${body}</table></body></html>`;
  download(new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' }), filename);
}

export function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { try { resolve(JSON.parse(String(r.result))); } catch (e) { reject(e); } };
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

// Open a standalone printable document (used for the date-range statement).
export function openPrintWindow(html: string): boolean {
  const w = window.open('', '_blank', 'width=960,height=760');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
  return true;
}
