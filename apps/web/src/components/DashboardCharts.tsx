import { RevenueTrend, PaidDonut, TopRoomsBars } from './charts';

// Lazy-loaded wrapper so recharts lands in its own chunk and never ships with
// the login/invoice screens (the dashboard is where the charts actually render).
export function DashboardCharts({ paid, outstanding, trend, topRooms }: {
  paid: string;
  outstanding: string;
  trend: { day: string; total: string; count: number }[];
  topRooms: { room: string; total: string; count: number }[];
}) {
  return (
    <div className="dash-charts">
      <div className="card chart-wide">
        <h3>الإيرادات — آخر 14 يومًا</h3>
        <RevenueTrend data={trend} />
      </div>
      <div className="card">
        <h3>التحصيل</h3>
        <PaidDonut paid={paid} outstanding={outstanding} />
      </div>
      <div className="card">
        <h3>أعلى الغرف إيرادًا</h3>
        <TopRoomsBars data={topRooms} />
      </div>
    </div>
  );
}
