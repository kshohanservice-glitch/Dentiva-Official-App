-- ============================================================================
-- Dentiva Pro — SQLite schema (migration 001)
-- Money columns are INTEGER paisa (1 BDT = 100 paisa). Timestamps: ISO-8601 UTC.
-- ============================================================================
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Clinic & system
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  logo_path TEXT,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  extra_contact TEXT NOT NULL DEFAULT '',
  tagline TEXT NOT NULL DEFAULT '',
  business_hours TEXT NOT NULL DEFAULT '',          -- free text / JSON display string
  working_days TEXT NOT NULL DEFAULT 'sat,sun,mon,tue,wed,thu,fri', -- CSV of mon..sun
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY,
  holiday_date TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activation_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  activated INTEGER NOT NULL DEFAULT 0,
  verifier_hash TEXT,                  -- scrypt digest of the accepted code
  activated_at TEXT,
  machine_fingerprint TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Auth / users / RBAC
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  photo_path TEXT,
  date_of_birth TEXT,
  gender TEXT,                          -- male/female/other/''
  blood_group TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  national_id TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  joining_date TEXT,
  salary_paisa INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',  -- active/inactive
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,          -- scrypt
  salt TEXT NOT NULL,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_locked INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                  -- uuid
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS login_events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username_attempted TEXT NOT NULL,
  success INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Dentists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dentists (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',                 -- e.g. BDS, DDS
  designations TEXT NOT NULL DEFAULT '',          -- newline / comma separated
  registration_no TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  signature_path TEXT,
  photo_path TEXT,
  consultation_hours TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

-- ---------------------------------------------------------------------------
-- Patients & clinical
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY,
  patient_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  age INTEGER,
  gender TEXT NOT NULL DEFAULT '',     -- male/female/other/''
  blood_group TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  emergency_phone TEXT NOT NULL DEFAULT '',
  present_complaint TEXT NOT NULL DEFAULT '',
  past_history TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  photo_path TEXT,
  identifier TEXT NOT NULL DEFAULT '',   -- optional extra identifier (NID etc.)
  status TEXT NOT NULL DEFAULT 'active', -- active/inactive/archived
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_created ON patients(created_at);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  visit_date TEXT NOT NULL,            -- ISO datetime
  chief_complaint TEXT NOT NULL DEFAULT '',
  history TEXT NOT NULL DEFAULT '',
  examination TEXT NOT NULL DEFAULT '',
  diagnosis TEXT NOT NULL DEFAULT '',
  treatment TEXT NOT NULL DEFAULT '',
  advice TEXT NOT NULL DEFAULT '',
  follow_up TEXT NOT NULL DEFAULT '',
  clinical_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed', -- completed/in-progress/cancelled
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_date);

CREATE TABLE IF NOT EXISTS clinical_notes (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  note_text TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clinical_notes_patient ON clinical_notes(patient_id);

-- FDI chart entries. tooth_no: adult 11-18,21-28,31-38,41-48; pediatric 51-55,61-65,71-75,81-85.
CREATE TABLE IF NOT EXISTS chart_entries (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tooth_no INTEGER NOT NULL,
  condition TEXT NOT NULL,             -- caries/restoration/missing/extraction/rct/crown/fracture/mobility/impacted/infection/other
  surface TEXT NOT NULL DEFAULT '',    -- optional: M/O/D/B/L/Incisal/Occlusal
  dentition TEXT NOT NULL DEFAULT 'adult', -- adult/pediatric
  note TEXT NOT NULL DEFAULT '',
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  superseded_at TEXT                   -- historical: replaced by newer entry
);
CREATE INDEX IF NOT EXISTS idx_chart_patient_tooth ON chart_entries(patient_id, tooth_no);

-- ---------------------------------------------------------------------------
-- Treatment catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS treatments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  default_price_paisa INTEGER NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Billing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'other',   -- cash/bank/card/mobile_wallet/other
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  invoice_date TEXT NOT NULL,          -- ISO datetime
  due_date TEXT,
  subtotal_paisa INTEGER NOT NULL DEFAULT 0,
  discount_paisa INTEGER NOT NULL DEFAULT 0,
  discount_reason TEXT NOT NULL DEFAULT '',
  tax_paisa INTEGER NOT NULL DEFAULT 0,
  grand_total_paisa INTEGER NOT NULL DEFAULT 0,
  paid_paisa INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid',  -- paid/partial/unpaid/void
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  voided_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  treatment_id INTEGER REFERENCES treatments(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_paisa INTEGER NOT NULL DEFAULT 0,
  discount_paisa INTEGER NOT NULL DEFAULT 0,
  line_total_paisa INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  method_id INTEGER NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL,               -- ISO datetime
  received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(paid_at);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  reason TEXT NOT NULL DEFAULT '',
  refunded_at TEXT NOT NULL,
  processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Treatment records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS treatment_records (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  treatment_id INTEGER NOT NULL REFERENCES treatments(id) ON DELETE RESTRICT,
  tooth_no TEXT NOT NULL DEFAULT '',   -- free text, may list multiple e.g. "11,21"
  price_paisa INTEGER NOT NULL,        -- snapshot at time of treatment
  status TEXT NOT NULL DEFAULT 'completed', -- planned/in-progress/completed
  note TEXT NOT NULL DEFAULT '',
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  performed_by INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_treatment_records_patient ON treatment_records(patient_id);

-- ---------------------------------------------------------------------------
-- Appointments & queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  appt_date TEXT NOT NULL,             -- YYYY-MM-DD
  start_time TEXT NOT NULL,            -- HH:MM
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  appt_type TEXT NOT NULL DEFAULT 'Consultation',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled',
    -- scheduled/confirmed/arrived/in-queue/in-progress/completed/cancelled/no-show/rescheduled
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appt_date);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_dentist ON appointments(dentist_id);

CREATE TABLE IF NOT EXISTS queue_entries (
  id INTEGER PRIMARY KEY,
  queue_date TEXT NOT NULL,            -- YYYY-MM-DD
  queue_no INTEGER NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  arrived_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  priority INTEGER NOT NULL DEFAULT 0, -- 0 normal, 1 urgent
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting/in-treatment/completed/skipped/cancelled
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_date ON queue_entries(queue_date, status);

-- ---------------------------------------------------------------------------
-- Prescriptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS medicines (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  generic_name TEXT NOT NULL DEFAULT '',
  form TEXT NOT NULL DEFAULT 'Tablet',   -- Tablet/Capsule/Syrup/Cream/Gel/Drops/Injection/Other
  strength TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id INTEGER PRIMARY KEY,
  rx_no TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  chief_complaint TEXT NOT NULL DEFAULT '',   -- C/C
  on_examination TEXT NOT NULL DEFAULT '',    -- O/E
  relevant_exam TEXT NOT NULL DEFAULT '',     -- R/E
  advice TEXT NOT NULL DEFAULT '',
  additional_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions(patient_id);

CREATE TABLE IF NOT EXISTS prescription_items (
  id INTEGER PRIMARY KEY,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_name TEXT NOT NULL,          -- free text snapshot (allows one-off meds)
  medicine_id INTEGER REFERENCES medicines(id) ON DELETE SET NULL,
  form TEXT NOT NULL DEFAULT 'Tablet',
  strength TEXT NOT NULL DEFAULT '',
  dose TEXT NOT NULL DEFAULT '',
  morning INTEGER NOT NULL DEFAULT 0,
  noon INTEGER NOT NULL DEFAULT 0,
  night INTEGER NOT NULL DEFAULT 0,
  before_food INTEGER NOT NULL DEFAULT 0,
  after_food INTEGER NOT NULL DEFAULT 0,
  duration TEXT NOT NULL DEFAULT '',
  quantity TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  prn INTEGER NOT NULL DEFAULT 0,
  additional_instruction TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prescription_items_rx ON prescription_items(prescription_id);

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT '',
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  purchase_cost_paisa INTEGER NOT NULL DEFAULT 0,
  selling_cost_paisa INTEGER NOT NULL DEFAULT 0,
  current_stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 5,
  expiry_date TEXT,                    -- nearest batch expiry (denormalized for alerts)
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_name ON inventory_items(name);

CREATE TABLE IF NOT EXISTS inventory_batches (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  batch_no TEXT NOT NULL DEFAULT '',
  expiry_date TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  unit_cost_paisa INTEGER NOT NULL DEFAULT 0,
  purchase_date TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_batches_item ON inventory_batches(item_id);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  batch_id INTEGER REFERENCES inventory_batches(id) ON DELETE SET NULL,
  txn_type TEXT NOT NULL,              -- in/out/adjust
  quantity REAL NOT NULL,              -- signed delta for adjust
  unit_cost_paisa INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_txn_item ON inventory_transactions(item_id);

-- ---------------------------------------------------------------------------
-- Accounting
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS income_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS income_entries (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES income_categories(id) ON DELETE RESTRICT,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  entry_date TEXT NOT NULL,            -- YYYY-MM-DD
  method_id INTEGER REFERENCES payment_methods(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  payer TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  attachment_path TEXT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_income_date ON income_entries(entry_date);

CREATE TABLE IF NOT EXISTS expense_entries (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  entry_date TEXT NOT NULL,            -- YYYY-MM-DD
  method_id INTEGER REFERENCES payment_methods(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  vendor TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  attachment_path TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expense_date ON expense_entries(entry_date);

-- ---------------------------------------------------------------------------
-- Referrals, attachments, notifications, audit, backups, printer profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  referred_at TEXT NOT NULL,
  referring_dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
  referred_to_doctor TEXT NOT NULL DEFAULT '',
  referred_to_clinic TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'referred', -- referred/follow-up/completed/cancelled
  follow_up_date TEXT,
  outcome TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referrals_patient ON referrals(patient_id);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,           -- patient/visit/prescription/expense/income/staff
  entity_id INTEGER NOT NULL,
  stored_name TEXT NOT NULL,           -- opaque filename inside store
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,                  -- appointment/queue/balance/stock/expiry/backup/system
  severity TEXT NOT NULL DEFAULT 'info', -- info/warning/critical/success
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',       -- in-app target, e.g. "page:patients:42"
  dedupe_key TEXT UNIQUE,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'success', -- success/failure
  details TEXT NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT 'local'
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);

CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual', -- manual/auto/pre-restore
  status TEXT NOT NULL DEFAULT 'success', -- success/failed
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS printer_profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  doc_type TEXT NOT NULL,              -- prescription/invoice/receipt/report
  printer_name TEXT NOT NULL DEFAULT '', -- empty = default printer
  paper TEXT NOT NULL DEFAULT 'A4',    -- A4/A5/MINI/THERMAL80/CUSTOM
  width_mm REAL NOT NULL DEFAULT 210,
  height_mm REAL NOT NULL DEFAULT 297,
  margin_mm REAL NOT NULL DEFAULT 12,
  orientation TEXT NOT NULL DEFAULT 'portrait',
  font_scale REAL NOT NULL DEFAULT 1.0,
  copies INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

