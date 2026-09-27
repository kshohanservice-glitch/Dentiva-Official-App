import { useCallback, useEffect, useState } from 'react';
import { api, type AppUser, type Role } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Badge, Button, EmptyState, ErrorState, Field, Input, LoadingRows, Modal, Textarea, useToast } from '../components/ui';
import { IconPlus, IconKey, IconShield } from '../components/Icons';

export function UsersPage({ ctx }: { ctx: NavCtx }) {
  const [tab, setTab] = useState<'users' | 'roles' | 'logins'>('users');
  void ctx;
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="crumb">Administration</div>
          <h1>Staff & Users</h1>
          <div className="dp-sub" style={{ marginTop: 2 }}>User accounts, roles and granular permissions</div>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>User accounts</button>
        <button className={`tab ${tab === 'roles' ? 'active' : ''}`} onClick={() => setTab('roles')}>Roles & permissions</button>
        <button className={`tab ${tab === 'logins' ? 'active' : ''}`} onClick={() => setTab('logins')}>Login history</button>
      </div>
      <div style={{ marginTop: 16 }}>
        {tab === 'users' && <UsersTab />}
        {tab === 'roles' && <RolesTab />}
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
