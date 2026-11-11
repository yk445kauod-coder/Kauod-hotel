import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

// Locally bundled SweetAlert2, themed with the app's design tokens and
// RTL-first. Every call site goes through these helpers so confirmations and
// prompts share one look and one Arabic voice.
const base = {
  confirmButtonText: 'تأكيد',
  cancelButtonText: 'إلغاء',
  confirmButtonColor: 'var(--brand)',
  cancelButtonColor: 'var(--surface-3)',
  reverseButtons: true,
  buttonsStyling: true,
  customClass: {
    popup: 'kaoud-swal',
    confirmButton: 'kaoud-swal-confirm',
    cancelButton: 'kaoud-swal-cancel',
    input: 'kaoud-swal-input',
  },
} as const;

/** Yes/no confirmation. Resolves true only when confirmed. */
export async function confirmDialog(opts: {
  title: string;
  text?: string;
  confirmText?: string;
  danger?: boolean;
}): Promise<boolean> {
  const r = await Swal.fire({
    ...base,
    title: opts.title,
    text: opts.text,
    icon: opts.danger ? 'warning' : 'question',
    showCancelButton: true,
    confirmButtonText: opts.confirmText ?? 'تأكيد',
    ...(opts.danger ? { confirmButtonColor: 'var(--danger)' } : {}),
  });
  return r.isConfirmed;
}

/** Single-line text prompt. Resolves the value, or null when cancelled. */
export async function promptDialog(opts: {
  title: string;
  text?: string;
  placeholder?: string;
  inputType?: 'text' | 'password';
  confirmText?: string;
  minLength?: number;
}): Promise<string | null> {
  const r = await Swal.fire({
    ...base,
    title: opts.title,
    text: opts.text,
    input: opts.inputType ?? 'text',
    inputPlaceholder: opts.placeholder,
    inputAttributes: { dir: 'ltr', autocapitalize: 'off', autocorrect: 'off' },
    showCancelButton: true,
    confirmButtonText: opts.confirmText ?? 'حفظ',
    inputValidator: (v: string) => {
      if (!v) return 'القيمة مطلوبة';
      if (opts.minLength && v.length < opts.minLength) return `لا تقل عن ${opts.minLength} أحرف`;
      return null;
    },
  });
  return r.isConfirmed ? String(r.value ?? '') : null;
}

/** Small transient toast, top-end, no interaction. */
export function toast(message: string, icon: 'success' | 'error' | 'warning' | 'info' = 'success') {
  void Swal.fire({
    toast: true,
    position: 'top-start',
    icon,
    title: message,
    showConfirmButton: false,
    timer: 2600,
    timerProgressBar: true,
    customClass: { popup: 'kaoud-swal-toast' },
  });
}
