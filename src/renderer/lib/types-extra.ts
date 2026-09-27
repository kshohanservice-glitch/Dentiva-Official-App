/* Extended domain types for clinical, billing, inventory and operations modules. */

export interface VisitRow {
  id: number;
  patient_id: number;
  dentist_id: number | null;
  dentist_name: string | null;
  visit_date: string;
  chief_complaint: string;
  history: string;
  examination: string;
  diagnosis: string;
  treatment: string;
  advice: string;
  follow_up: string;
  clinical_notes: string;
  status: string;
}

export interface ChartTooth {
  id: number;
  tooth_no: number;
  condition: string;
  surface: string;
  dentition: string;
  note: string;
  created_at: string;
  dentist_name: string | null;
}

export interface ChartData {
  teeth: Record<string, ChartTooth>;
  rows: ChartTooth[];
}

export interface TimelineEvent {
  at: string;
  type: string;
  title: string;
  detail: string;
  entityId: number;
  who: string | null;
}

export interface ReferralRow {
  id: number;
  referred_at: string;
  referring_dentist_id: number | null;
  referring_dentist_name: string | null;
  referred_to_doctor: string;
  referred_to_clinic: string;
  reason: string;
  notes: string;
  status: string;
  follow_up_date: string | null;
  outcome: string;
}

export interface TreatmentRow {
  id: number;
  name: string;
  code: string;
  category: string;
  description: string;
  default_price_paisa: number;
  duration_minutes: number;
  is_active: number;
  notes: string;
}

export interface TreatmentRecordRow {
  id: number;
  treatment_id: number;
  treatment_name: string;
  tooth_no: string | null;
  price_paisa: number;
  status: string;
  note: string | null;
  performed_by_name: string | null;
  created_at: string;
}

export interface AppointmentRow {
  id: number;
  appt_date: string;
  start_time: string;
  duration_minutes: number;
  appt_type: string | null;
  patient_id: number;
  patient_name: string;
  patient_phone?: string | null;
  patient_code?: string;
  dentist_id: number | null;
  dentist_name: string | null;
  status: string;
  notes: string | null;
}

export interface QueueRow {
  id: number;
  queue_date: string;
  queue_no: number;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  phone: string | null;
  dentist_id: number | null;
  dentist_name: string | null;
  appointment_id: number | null;
  status: string;
  priority: number | boolean;
  reason: string | null;
  arrived_at: string;
}

export interface PrescriptionItem {
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string | null;
}

export interface PrescriptionRow {
  id: number;
  rx_no: string;
  patient_id: number;
  patient_name: string;
  dentist_id: number | null;
  dentist_name: string | null;
  status: string;
  issue_date: string;
  items: number;
}

export interface PrescriptionFull extends PrescriptionRow {
  itemsList: PrescriptionItem[];
}

export interface InvoiceItemRow {
  id: number;
  treatment_id: number | null;
  description: string;
  quantity: number;
  unit_price_paisa: number;
  line_total_paisa: number;
}

export interface InvoiceRow {
  id: number;
  invoice_no: string;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  invoice_date: string;
  status: string;
  subtotal_paisa: number;
  discount_paisa: number;
  tax_paisa: number;
  grand_total_paisa: number;
  paid_paisa: number;
}

export interface InvoiceFull extends InvoiceRow {
  items: InvoiceItemRow[];
  payments: Array<{ id: number; receipt_no: string; amount_paisa: number; method: string; paid_at: string }>;
}

export interface PaymentListRow {
  id: number;
  receipt_no: string;
  amount_paisa: number;
  method_id: number;
  method_name: string;
  paid_at: string;
  invoice_no: string;
  patient_id: number;
  patient_name: string;
  reference: string;
}

export interface PaymentsPage {
  total: number;
  rows: PaymentListRow[];
  sums: Record<string, number>;
  outstandingPaisa: number;
}

export interface PaymentMethod {
  id: number;
  name: string;
  kind: string;
  is_active: number;
  sort_order: number;
}

export interface InventoryRow {
  id: number;
  name: string;
  sku: string;
  category: string;
  supplier_id: number | null;
  supplier_name: string | null;
  unit: string;
  purchase_cost_paisa: number;
  selling_cost_paisa: number;
  current_stock: number;
  min_stock: number;
  expiry_date: string | null;
  notes: string;
  is_active: number;
}

export interface InventoryLedgerRow {
  id: number;
  item_id: number;
  txn_type: string; // in | out | adjust
  quantity: number;
  unit_cost_paisa: number;
  reason: string;
  reference: string;
  performed_by_name: string | null;
  created_at: string;
}

export interface SupplierRow {
  id: number;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  is_active: number;
}

export interface Category {
  id: number;
  name: string;
}

export interface StaffRow {
  id: number;
  name: string;
  date_of_birth: string | null;
  gender: string | null;
  blood_group: string;
  address: string;
  phone: string;
  national_id: string | null;
  position: string;
  department: string;
  joining_date: string | null;
  salary_paisa: number | null;
  status: string;
  notes: string;
  linked_username?: string | null;
}

export interface AttachmentRow {
  id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  entity_type: string;
  entity_id: number;
  note: string | null;
  created_at: string;
}

export interface NotificationRow {
  id: number;
  kind: string; // appointment/queue/balance/stock/expiry/backup/system
  severity: string; // info/warning/critical/success
  title: string;
  body: string;
  link: string;
  is_read: number;
  created_at: string;
}

export interface SearchHit {
  kind: string; // patient | appointment | prescription | invoice | inventory | staff | treatment
  id: number;
  title: string;
  subtitle: string;
  link: string; // navigation target, e.g. "patient:12" or "page:invoices"
}

export interface BackupRow {
  id: number;
  file_path: string;
  kind: string;
  status: string;
  size_bytes: number;
  sha256: string | null;
  created_at: string;
  created_by_name: string | null;
  exists: boolean;
}

export interface AccountingReport {
  range: { from: string; to: string };
  treatmentIncomePaisa: number;
  otherIncomePaisa: number;
  totalIncomePaisa: number;
  totalExpensePaisa: number;
  netIncomePaisa: number;
  invoicedPaisa: number;
  outstandingPaisa: number;
  treatmentValuePaisa: number;
  byMethod: { cash: number; bank: number; card: number; mobileWallet: number; other: number };
  expenseByCategory: Array<{ category: string; total: number }>;
  incomeByCategory: Array<{ category: string; total: number }>;
  daily: Array<{ day: string; income_paisa: number; expense_paisa: number }>;
}

export interface AccountingEntryRow {
  id: number;
  category_id: number;
  category_name: string;
  amount_paisa: number;
  entry_date: string;
  method_name: string | null;
  party: string;
  description: string;
  reference: string;
}
