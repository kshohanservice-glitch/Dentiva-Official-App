import { useCallback, useEffect, useState } from 'react';
import { api, type AppUser, type Role, type StaffRow } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, Select, Textarea, useToast } from '../components/ui';
import { IconPlus, IconKey, IconShield, IconEdit, IconTrash } from '../components/Icons';
import { formatBDT, parseAmountToPaisa } from '../../shared/money';

export function UsersPage({ ctx }: { ctx: NavCtx }) {
  const [tab, setTab] = useState<'users' | 'roles' | 'staff' | 'logins'>('users');
  void ctx;
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumb">Administration</div>
          <h1>Staff & Users</h1>
          <div className="dp-sub" style={{ marginTop: 2 }}>User accounts, roles, permissions and clinic staff records</div>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>User accounts</button>
        <button className={`tab ${tab === 'roles' ? 'active' : ''}`} onClick={() => setTab('roles')}>Roles & permissions</button>
        <button className={`tab ${tab === 'staff' ? 'active' : ''}`} onClick={() => setTab('staff')}>Staff records</button>
        <button className={`tab ${tab === 'logins' ? 'active' : ''}`} onClick={() => setTab('logins')}>Login history</button>
      </div>
      <div style={{ marginTop: 16 }}>
        {tab === 'users' && <UsersTab />}
        {tab === 'roles' && <RolesTab />}
        {tab === 'staff' && <StaffTab />}
        {tab === 'logins' && <LoginHistoryTab />}
      </div>
    </div>
  );
}

// ============================ Users ============================

function UsersTab() {
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [pwUser, setPwUser] = useState<AppUser | null>(null);
  const [rolesUser, setRolesUser] = useState<AppUser | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([api.usersList(), api.rolesList()]);
      setUsers(u);
      setRoles(r);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>;
  if (!users) return <div className="card"><LoadingRows /></div>;

  return (
    <>
      <div className="toolbar">
        <div className="grow" />
        <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setCreating(true)}>New user</Button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Username</th><th>Display name</th><th>Roles</th><th>Status</th><th>Last login</th><th style={{ width: 280 }}>Actions</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="dp-mono cell-main">{u.username}</td>
                <td>{u.display_name}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {u.roles.map((r) => <Badge key={r} tone="primary">{r}</Badge>)}
                  </div>
                </td>
                <td>
                  {!u.is_active ? <Badge tone="neutral">Disabled</Badge> : u.is_locked ? <Badge tone="error">Locked</Badge> : <Badge tone="success">Active</Badge>}
                </td>
                <td className="cell-sub">{u.last_login_at ? new Date(u.last_login_at).toLocaleString('en-GB') : 'Never'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button size="sm" variant="secondary" icon={<IconShield size={13} />} onClick={() => setRolesUser(u)}>Roles</Button>
                    <Button size="sm" variant="secondary" icon={<IconKey size={13} />} onClick={() => setPwUser(u)}>Reset password</Button>
                    <Button size="sm" variant={u.is_locked ? 'secondary' : 'danger-outline'} onClick={() => void api.userSetLocked(u.id, !u.is_locked).then(() => { toast('success', u.is_locked ? 'User unlocked' : 'User locked'); void load(); })}>
                      {u.is_locked ? 'Unlock' : 'Lock'}
                    </Button>
                    <Button size="sm" variant={u.is_active ? 'danger-outline' : 'secondary'} onClick={() => void api.userSetActive(u.id, !u.is_active).then(() => { toast('success', u.is_active ? 'User disabled' : 'User enabled'); void load(); }).catch((e) => toast('error', 'Failed', e.message))}>
                      {u.is_active ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && <CreateUserModal roles={roles} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} />}
      {pwUser && <ResetPasswordModal user={pwUser} onClose={() => setPwUser(null)} onDone={() => { setPwUser(null); toast('success', 'Password reset', `A new password was set for ${pwUser.username}.`); }} />}
      {rolesUser && <AssignRolesModal user={rolesUser} roles={roles} onClose={() => setRolesUser(null)} onSaved={() => { setRolesUser(null); void load(); }} />}
    </>
  );
}

function CreateUserModal({ roles, onClose, onSaved }: { roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [roleIds, setRoleIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.userCreate({ username, displayName, password, roleIds });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New user account"
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>Create user</Button></>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div className="alert alert-error">{error}</div>}
        <Field label="Username" required><Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus /></Field>
        <Field label="Display name" required><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
        <Field label="Temporary password" required hint="Ask the user to change it after first sign-in.">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Roles" required>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {roles.map((r) => (
              <label key={r.id} className="checkbox-row">
                <input type="checkbox" checked={roleIds.includes(r.id)} onChange={(e) => setRoleIds((cur) => (e.target.checked ? [...cur, r.id] : cur.filter((x) => x !== r.id)))} />
                {r.name} {r.is_builtin ? '' : '(custom)'}
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: AppUser; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title={`Reset password — ${user.username}`}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { setBusy(true); setError(''); try { await api.userResetPassword(user.id, pw); onDone(); } catch (e) { setError(e instanceof Error ? e.message : 'Reset failed.'); setBusy(false); } }}>Reset password</Button></>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <div className="alert alert-error">{error}</div>}
        <Field label="New password" required hint="At least 6 characters.">
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

function AssignRolesModal({ user, roles, onClose, onSaved }: { user: AppUser; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const currentRoleIds = roles.filter((r) => user.roles.includes(r.name)).map((r) => r.id);
  const [sel, setSel] = useState<number[]>(currentRoleIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title={`Roles — ${user.username}`}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { setBusy(true); setError(''); try { await api.userAssignRoles(user.id, sel); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed.'); setBusy(false); } }}>Save roles</Button></>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {error && <div className="alert alert-error">{error}</div>}
        {roles.map((r) => (
          <label key={r.id} className="checkbox-row">
            <input type="checkbox" checked={sel.includes(r.id)} onChange={(e) => setSel((cur) => (e.target.checked ? [...cur, r.id] : cur.filter((x) => x !== r.id)))} />
            <span><strong>{r.name}</strong>{r.description ? <span className="dp-sub"> — {r.description}</span> : null}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

// ============================ Roles ============================

function RolesTab() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([api.rolesList(), api.permissionsCatalog()]);
      setRoles(r);
      setCatalog(c);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load roles.');
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (error) return <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>;
  if (!roles) return <div className="card"><LoadingRows /></div>;

  const PERM_GROUPS: Record<string, string[]> = {};
  for (const p of catalog) {
    const g = p.split('.')[0];
    (PERM_GROUPS[g] ??= []).push(p);
  }

  return (
    <>
      <div className="toolbar">
        <div className="grow" />
        <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setCreating(true)}>New custom role</Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
        {roles.map((r) => (
          <div key={r.id} className="card card-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div>
                <div className="dp-strong" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {r.name} {r.is_builtin ? <Badge tone="primary">Built-in</Badge> : <Badge tone="neutral">Custom</Badge>}
                </div>
                <div className="dp-sub" style={{ marginTop: 2 }}>{r.description || 'No description.'}</div>
              </div>
              {!r.is_builtin && <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>Edit permissions</Button>}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--dp-text-3)' }}>{r.permissions.length} permissions granted</div>
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {r.permissions.slice(0, 8).map((p) => <Badge key={p} tone="neutral">{p}</Badge>)}
              {r.permissions.length > 8 && <Badge tone="neutral">+{r.permissions.length - 8} more</Badge>}
            </div>
          </div>
        ))}
      </div>

      {creating && (
        <RoleEditorModal
          catalog={PERM_GROUPS}
          title="New custom role"
          onClose={() => setCreating(false)}
          onSave={async (name, description, perms) => {
            await api.roleCreate({ name, description, permissions: perms });
            setCreating(false);
            toast('success', 'Role created');
            void load();
          }}
        />
      )}
      {editing && (
        <RoleEditorModal
          catalog={PERM_GROUPS}
          title={`Edit permissions — ${editing.name}`}
          initial={editing.permissions}
          lockName={editing.name}
          onClose={() => setEditing(null)}
          onSave={async (_name, _desc, perms) => {
            await api.roleUpdatePermissions(editing.id, perms);
            setEditing(null);
            toast('success', 'Permissions updated');
            void load();
          }}
        />
      )}
    </>
  );
}

function RoleEditorModal({
  catalog, title, initial, lockName, onClose, onSave,
}: {
  catalog: Record<string, string[]>;
  title: string;
  initial?: string[];
  lockName?: string;
  onClose: () => void;
  onSave: (name: string, description: string, perms: string[]) => Promise<void>;
}) {
  const [name, setName] = useState(lockName ?? '');
  const [description, setDescription] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set(initial ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = (p: string) =>
    setSel((cur) => {
      const next = new Set(cur);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  return (
    <Modal
      title={title}
      onClose={onClose}
      size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { setBusy(true); setError(''); try { await onSave(name, description, [...sel]); } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.'); setBusy(false); } }}>Save role</Button></>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div className="alert alert-error">{error}</div>}
        {!lockName && (
          <>
            <Field label="Role name" required><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
            <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          </>
        )}
        <div className="dp-sub">{sel.size} permissions selected</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {Object.entries(catalog).map(([group, perms]) => (
            <div key={group} className="card card-pad" style={{ padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span className="dp-strong" style={{ textTransform: 'capitalize' }}>{group}</span>
                <button className="muted-link" style={{ fontSize: 11 }} onClick={() => setSel((cur) => { const next = new Set(cur); const allIn = perms.every((p) => next.has(p)); perms.forEach((p) => (allIn ? next.delete(p) : next.add(p))); return next; })}>
                  toggle all
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {perms.map((p) => (
                  <label key={p} className="checkbox-row" style={{ fontSize: 12 }}>
                    <input type="checkbox" checked={sel.has(p)} onChange={() => toggle(p)} />
                    {p}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ============================ Login history ============================

interface LoginEvent {
  id: number;
  username_attempted: string;
  success: number;
  reason: string;
  at: string;
}

function LoginHistoryTab() {
  const [events, setEvents] = useState<LoginEvent[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api.loginHistory().then((e) => setEvents(e as unknown as LoginEvent[])).catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, []);
  useEffect(load, [load]);

  if (error) return <div className="card"><ErrorState message={error} onRetry={load} /></div>;
  if (!events) return <div className="card"><LoadingRows /></div>;
  if (events.length === 0) return <div className="card"><EmptyState title="No login events yet" desc="Sign-in activity will be recorded here." /></div>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Time</th><th>Username</th><th>Result</th><th>Reason</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="cell-sub">{new Date(e.at).toLocaleString('en-GB')}</td>
              <td className="dp-mono">{e.username_attempted}</td>
              <td>{e.success ? <Badge tone="success">Success</Badge> : <Badge tone="error">Failed</Badge>}</td>
              <td className="cell-sub">{e.reason || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================ Staff ============================

function StaffTab() {
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; row: StaffRow } | null>(null);
  const [deleting, setDeleting] = useState<StaffRow | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setError('');
    try {
      setRows((await api.staffList(showInactive)) as unknown as StaffRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load staff.');
    }
  }, [showInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="card"><ErrorState message={error} onRetry={() => void load()} /></div>;
  if (!rows) return <div className="card"><LoadingRows /></div>;

  return (
    <div className="card">
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--dp-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className="card-title">Staff records ({rows.length})</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            <span>Show inactive</span>
          </label>
          <Button size="sm" variant="primary" icon={<IconPlus size={14} />} onClick={() => setEditor({ mode: 'create' })}>Add staff</Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<IconShield size={22} />} title="No staff records" desc="Add clinical and administrative staff. Sensitive fields are masked unless you hold staff.manage." />
      ) : (
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Position</th><th>Department</th><th>Phone</th><th>Joined</th><th className="num">Salary</th><th>Status</th><th style={{ width: 90 }}></th></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="cell-main">{s.name}</td>
                  <td className="cell-sub">{s.position || '—'}</td>
                  <td className="cell-sub">{s.department || '—'}</td>
                  <td className="cell-sub">{s.phone || '—'}</td>
                  <td className="cell-sub">{s.joining_date ? new Date(s.joining_date).toLocaleDateString('en-GB') : '—'}</td>
                  <td className="num">{s.salary_paisa === null ? <span className="dp-sub">hidden</span> : formatBDT(s.salary_paisa)}</td>
                  <td>{s.status === 'active' ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Button size="sm" variant="ghost" icon={<IconEdit size={14} />} onClick={() => setEditor({ mode: 'edit', row: s })} aria-label="Edit staff" />
                      <Button size="sm" variant="ghost" icon={<IconTrash size={14} />} onClick={() => setDeleting(s)} aria-label="Remove staff" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor && (
        <StaffEditor
          existing={editor.mode === 'edit' ? editor.row : null}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            toast('success', editor.mode === 'create' ? 'Staff added' : 'Staff updated');
            void load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Remove staff record?"
          danger
          requireText={deleting.name}
          confirmLabel="Remove staff"
          message={`This soft-deletes the staff record for ${deleting.name}. Linked historical records keep their references.`}
          onConfirm={async () => {
            try {
              await api.staffDelete(deleting.id);
              toast('success', 'Staff removed');
              setDeleting(null);
              void load();
            } catch (e) {
              toast('error', 'Remove failed', e instanceof Error ? e.message : undefined);
            }
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function StaffEditor({ existing, onClose, onSaved }: { existing: StaffRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [position, setPosition] = useState(existing?.position ?? '');
  const [department, setDepartment] = useState(existing?.department ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [gender, setGender] = useState(existing?.gender ?? '');
  const [bloodGroup, setBloodGroup] = useState(existing?.blood_group ?? '');
  const [nationalId, setNationalId] = useState(existing?.national_id ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  const [joiningDate, setJoiningDate] = useState(existing?.joining_date ?? '');
  const [salary, setSalary] = useState(existing?.salary_paisa ? (existing.salary_paisa / 100).toFixed(2) : '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isEdit = Boolean(existing);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (!name.trim()) throw new Error('Staff name is required.');
      const salaryPaisa = salary.trim() ? parseAmountToPaisa(salary) : 0;
      if (salaryPaisa === null || salaryPaisa < 0) throw new Error('Salary must be a valid non-negative amount.');
      const payload = {
        name: name.trim(),
        position: position.trim() || undefined,
        department: department.trim() || undefined,
        phone: phone.trim() || undefined,
        gender: gender || undefined,
        bloodGroup: bloodGroup || undefined,
        nationalId: nationalId.trim() || undefined,
        address: address.trim() || undefined,
        joiningDate: joiningDate || null,
        salaryPaisa,
        notes: notes.trim() || undefined,
      };
      if (isEdit && existing) await api.staffUpdate(existing.id, payload);
      else await api.staffCreate(payload);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save staff.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? `Edit — ${existing?.name}` : 'Add staff'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>{isEdit ? 'Save changes' : 'Add staff'}</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Full name" required className="field-full"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Position"><Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Dental Hygienist" /></Field>
        <Field label="Department"><Input value={department} onChange={(e) => setDepartment(e.target.value)} /></Field>
        <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Gender">
          <Select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">— select —</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Blood group"><Input value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)} /></Field>
        <Field label="National ID"><Input value={nationalId} onChange={(e) => setNationalId(e.target.value)} /></Field>
        <Field label="Joining date"><Input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} /></Field>
        <Field label="Monthly salary (৳)" hint="Visible only to users with staff.manage"><Input inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="0.00" /></Field>
        <Field label="Address" className="field-full"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="Notes" className="field-full"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
    </Modal>
  );
}
