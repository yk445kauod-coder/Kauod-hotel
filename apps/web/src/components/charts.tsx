import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
} from 'recharts';
import { egpEn } from '../format';

// Colors come from CSS custom properties so the charts follow the app theme
// (light/dark) without re-rendering on theme change — SVG resolves var() itself.
const AXIS = 'var(--muted)';
const GRID = 'var(--border)';
const BRAND = 'var(--brand)';
const ACCENT = 'var(--accent)';
const DANGER = 'var(--danger)';
const INFO = 'var(--info)';

const money = (v: number | string) => egpEn(v);
const shortDay = (iso: string) => iso.slice(5); // MM-DD

interface TipPayload { value?: number | string; payload?: Record<string, unknown>; }

const tipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-8)', fontSize: 13 } as const;

function RevenueTip({ active, payload, label }: { active?: boolean; payload?: TipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as { total?: number; count?: number } | undefined;
  return (
    <div style={{ ...tipStyle, padding: '8px 12px' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div>الإيراد: <span className="mono">{money(Number(row?.total ?? 0))}</span></div>
      <div className="muted">عدد الفواتير: {row?.count ?? 0}</div>
    </div>
  );
}

export function RevenueTrend({ data }: { data: { day: string; total: string; count: number }[] }) {
  const rows = data.map((d) => ({ day: d.day, total: Number(d.total), count: d.count }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity={0.35} />
            <stop offset="100%" stopColor={BRAND} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="day" reversed tickFormatter={shortDay} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis orientation="right" tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={48}
          tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
        <Tooltip content={<RevenueTip />} />
        <Area type="monotone" dataKey="total" stroke={BRAND} strokeWidth={2.5} fill="url(#revFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function PaidDonut({ paid, outstanding }: { paid: string; outstanding: string }) {
  const p = Math.max(0, Number(paid));
  const o = Math.max(0, Number(outstanding));
  const empty = p + o === 0;
  const data = empty
    ? [{ name: 'لا بيانات', value: 1, color: GRID }]
    : [{ name: 'المحصّل', value: p, color: BRAND }, { name: 'المتبقي', value: o, color: ACCENT }];
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%"
          paddingAngle={empty ? 0 : 2} stroke="var(--surface)" strokeWidth={2}>
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Pie>
        {!empty && <Tooltip formatter={(v, n) => [money(v as number), String(n)]} contentStyle={tipStyle} />}
        {!empty && <Legend verticalAlign="bottom" height={28} formatter={(v) => <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{v}</span>} />}
      </PieChart>
    </ResponsiveContainer>
  );
}

export function TopRoomsBars({ data }: { data: { room: string; total: string; count: number }[] }) {
  const rows = data.map((d) => ({ room: d.room, total: Number(d.total), count: d.count }));
  if (!rows.length) return <div className="muted" style={{ padding: '40px 0', textAlign: 'center' }}>لا توجد بيانات بعد</div>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 46)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" reversed tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false}
          tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
        <YAxis type="category" dataKey="room" orientation="right" tick={{ fill: AXIS, fontSize: 12 }} tickLine={false} axisLine={false} width={52} />
        <Tooltip cursor={{ fill: 'var(--surface-3)' }}
          content={({ active, payload }: { active?: boolean; payload?: readonly { payload?: unknown }[] }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0]?.payload as { room: string; total: number; count: number };
            return (
              <div style={{ ...tipStyle, padding: '8px 12px' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>غرفة {row.room}</div>
                <div>الإيراد: <span className="mono">{money(row.total)}</span></div>
                <div className="muted">عدد الفواتير: {row.count}</div>
              </div>
            );
          }} />
        <Bar dataKey="total" fill={INFO} radius={[6, 6, 6, 6]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StatusPie({ valid, cancelled }: { valid: number; cancelled: number }) {
  const empty = valid + cancelled === 0;
  const data = empty
    ? [{ name: 'لا بيانات', value: 1, color: GRID }]
    : [{ name: 'سليمة', value: valid, color: BRAND }, { name: 'ملغاة', value: cancelled, color: DANGER }];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" outerRadius="88%" stroke="var(--surface)" strokeWidth={2}>
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Pie>
        {!empty && <Tooltip formatter={(v, n) => [String(v), String(n)]} contentStyle={tipStyle} />}
        {!empty && <Legend verticalAlign="bottom" height={26} formatter={(v) => <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{v}</span>} />}
      </PieChart>
    </ResponsiveContainer>
  );
}
