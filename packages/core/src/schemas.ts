import { z } from 'zod';

export const RoleSchema = z.enum(['admin', 'manager', 'reception', 'accountant']);
export const InvoiceStatusSchema = z.enum(['draft', 'open', 'locked', 'cancelled']);
export const PaymentMethodSchema = z.enum(['cash', 'card', 'instapay', 'bank_transfer', 'other']);

export const LineItemSchema = z.object({
  description: z.string().trim().min(1).max(300),
  qty: z.coerce.number().positive().max(10_000),
  unitPrice: z.coerce.number().nonnegative().max(10_000_000).transform((n) => n.toFixed(2)),
  kind: z.enum(['room', 'restaurant', 'minibar', 'laundry', 'extra']).default('extra'),
});

export const InvoiceInputSchema = z.object({
  guestName: z.string().trim().min(1).max(200),
  roomNumber: z.string().trim().max(20).optional().default(''),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lines: z.array(LineItemSchema).min(1).max(100),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  applyDiscount: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional().default(''),
  guestId: z.string().uuid().optional(),
  reservationId: z.string().uuid().optional(),
  serial: z.coerce.number().int().min(1).optional(),
  opId: z.string().trim().max(80).optional(),
  // Per-invoice tax/branding overrides. Omitted or null = inherit from settings.
  vatRate: z.coerce.number().min(0).max(100).nullable().optional(),
  discountRate: z.coerce.number().min(0).max(100).nullable().optional(),
  issuerName: z.string().trim().max(200).nullable().optional(),
  issuerTaxId: z.string().trim().regex(/^\d{9}$/, 'must be exactly 9 digits').nullable().optional(),
  issuerAddress: z.string().trim().max(300).nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.checkIn && v.checkOut && Date.parse(v.checkOut) <= Date.parse(v.checkIn)) {
    ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'checkOut must be after checkIn' });
  }
});

export const LoginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200).optional(),
});

export const CreateUserSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(10).max(200),
  role: RoleSchema,
});

export const UpdateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: RoleSchema.optional(),
  active: z.boolean().optional(),
  password: z.string().min(10).max(200).optional(),
});

export const PaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  method: PaymentMethodSchema,
  reference: z.string().trim().max(120).optional().default(''),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const RoomSchema = z.object({
  number: z.string().trim().min(1).max(20),
  type: z.string().trim().max(60).optional().default(''),
  nightlyRate: z.coerce.number().nonnegative(),
  capacity: z.coerce.number().int().min(1).max(20).optional().default(2),
  active: z.boolean().optional().default(true),
});

export const GuestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).optional().default(''),
  email: z.string().trim().max(200).optional().default(''),
  taxId: z.string().trim().regex(/^\d{0,9}$/).optional().default(''),
  address: z.string().trim().max(300).optional().default(''),
});

export const ReservationSchema = z.object({
  guestName: z.string().trim().min(1).max(200),
  guestId: z.string().uuid().optional(),
  roomNumber: z.string().trim().max(20).optional().default(''),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nightlyRate: z.coerce.number().nonnegative(),
  notes: z.string().trim().max(1000).optional().default(''),
}).refine((v) => Date.parse(v.checkOut) > Date.parse(v.checkIn), {
  path: ['checkOut'], message: 'checkOut must be after checkIn',
});

export const SettingsSchema = z.object({
  hotelName: z.string().trim().min(1).max(200),
  hotelNameEn: z.string().trim().max(200).optional().default(''),
  taxRegistrationNumber: z.string().trim().regex(/^\d{9}$/, 'must be exactly 9 digits'),
  commercialRegister: z.string().trim().max(40).optional().default(''),
  activityCode: z.string().trim().regex(/^\d{4}$/, 'must be exactly 4 digits'),
  address: z.string().trim().max(300).optional().default(''),
  city: z.string().trim().max(120).optional().default('Alexandria'),
  phone: z.string().trim().max(40).optional().default(''),
  email: z.string().trim().max(200).optional().default(''),
  vatRate: z.coerce.number().min(0).max(100),
  discountRate: z.coerce.number().min(0).max(100),
  pricesIncludeTax: z.boolean(),
  serialStart: z.coerce.number().int().min(1),
  currency: z.string().trim().length(3).default('EGP'),
  logoData: z.string().trim().max(400_000).optional().default(''),
  signatureLeft: z.string().trim().max(120).optional().default('المدير المالي|Financial Controller'),
  signatureRight: z.string().trim().max(120).optional().default('مدير الائتمان|Credit Manager'),
  footerNote: z.string().trim().max(300).optional().default('هذه الفاتورة صادرة إلكترونيًا وفق منظومة الفاتورة الإلكترونية لمصلحة الضرائب المصرية.'),
});

export const ChangeSerialSchema = z.object({
  serialStart: z.coerce.number().int().min(1).optional(),
  nextOverride: z.coerce.number().int().min(1).nullable().optional(),
});

export const SerialReserveSchema = z.object({
  deviceId: z.string().trim().min(4).max(80),
  size: z.coerce.number().int().min(1).max(500).default(100),
});

export type LineItemDto = z.infer<typeof LineItemSchema>;
export type InvoiceInputDto = z.infer<typeof InvoiceInputSchema>;
export type SettingsDto = z.infer<typeof SettingsSchema>;

export const BootstrapSchema = z.object({
  tenantName: z.string().trim().min(1).max(200),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(10).max(200),
});
