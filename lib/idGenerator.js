// lib/idGenerator.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// نفس أسلوب توليد المعرِّفات المعتمد بموقع الموظفين بالضبط: مزيج أحرف
// وأرقام عشوائي، بلا أحرف/أرقام متشابهة بصرياً (0/O, 1/I/L).
// =====================================================================

const SAFE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomAlphanumeric(length) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];
  }
  return result;
}

/**
 * يولّد معرِّف موظف مالية فريداً — مثال: EMP-7K9X2M
 * ⚠️ يتحقق من نفس جدول employees المركزي المشترك مع موقع الموظفين —
 * لا تعارض ممكن حتى لو الموقعان يولِّدان معرِّفات بنفس اللحظة، لأن كل
 * محاولة تتحقق من التفرّد بقاعدة البيانات المركزية نفسها مباشرة.
 */
export async function generateEmployeeId(supabaseAdmin) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = 'EMP-' + randomAlphanumeric(6);
    const { data } = await supabaseAdmin.from('employees').select('id').eq('id', candidate).maybeSingle();
    if (!data) return candidate;
  }
  throw new Error('تعذّر توليد معرِّف فريد، حاول مرة أخرى');
}

/** يولّد رقم فاتورة فريداً — مثال: INV-7K9X2M */
export async function generateInvoiceNumber(supabaseAdmin) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = 'INV-' + randomAlphanumeric(6);
    const { data } = await supabaseAdmin.from('fin_invoices').select('id').eq('invoice_number', candidate).maybeSingle();
    if (!data) return candidate;
  }
  throw new Error('تعذّر توليد رقم فاتورة فريد، حاول مرة أخرى');
}

/** يولّد رقم دفعة فريداً — مثال: PMT-7K9X2M */
export async function generatePaymentNumber(supabaseAdmin) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = 'PMT-' + randomAlphanumeric(6);
    const { data } = await supabaseAdmin.from('fin_payments').select('id').eq('payment_number', candidate).maybeSingle();
    if (!data) return candidate;
  }
  throw new Error('تعذّر توليد رقم دفعة فريد، حاول مرة أخرى');
}
