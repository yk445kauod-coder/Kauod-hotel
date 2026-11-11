import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, ReceiptText, ChartColumn, Hotel, BedDouble, Hash, Users, UserSearch,
  Settings, ScrollText, LogOut, Menu, Wifi, WifiOff, CircleHelp, Sun, Moon, Save, RefreshCw,
  Plus, X, ChevronDown, ChevronRight, ChevronLeft, Printer, Download, ArrowLeft, Lock, Star,
  Rocket, Keyboard, Circle, CircleAlert, Building2, FileText, Search, KeyRound, Trash2, Ban,
  Pencil, CheckCircle2, AlertTriangle, Info,
} from 'lucide-react';

// Semantic name → icon. Keeps call sites free of glyphs and centralises the
// icon set so the bundle only pulls what is referenced here.
const ICONS = {
  dashboard: LayoutDashboard,
  invoice: ReceiptText,
  reports: ChartColumn,
  hotel: Hotel,
  bed: BedDouble,
  hash: Hash,
  users: Users,
  monitor: UserSearch,
  settings: Settings,
  audit: ScrollText,
  logout: LogOut,
  menu: Menu,
  wifi: Wifi,
  wifiOff: WifiOff,
  help: CircleHelp,
  sun: Sun,
  moon: Moon,
  save: Save,
  sync: RefreshCw,
  plus: Plus,
  close: X,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronLeft: ChevronLeft,
  printer: Printer,
  download: Download,
  back: ArrowLeft,
  lock: Lock,
  star: Star,
  rocket: Rocket,
  keyboard: Keyboard,
  circle: Circle,
  statusOk: Circle,
  statusWarn: Circle,
  statusOff: Circle,
  warning: CircleAlert,
  building: Building2,
  file: FileText,
  search: Search,
  key: KeyRound,
  trash: Trash2,
  ban: Ban,
  edit: Pencil,
  success: CheckCircle2,
  alert: AlertTriangle,
  info: Info,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, strokeWidth = 2, className, style }: {
  name: IconName; size?: number; strokeWidth?: number; className?: string; style?: CSSProperties;
}) {
  const Cmp = ICONS[name];
  return <Cmp size={size} strokeWidth={strokeWidth} className={className} style={style} aria-hidden="true" />;
}
