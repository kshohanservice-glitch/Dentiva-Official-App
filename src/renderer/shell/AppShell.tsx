import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState } from '../lib/api';
import { api } from '../lib/api';
import { useToast, ConfirmDialog } from '../components/ui';
import {
  IconDashboard, IconUsers, IconCalendar, IconQueue, IconStethoscope, IconPill,
  IconInvoice, IconPayments, IconBox, IconChart, IconShield, IconDatabase,
  IconSettings, IconInfo, IconBell, IconLock, IconLogout, IconSearch, IconSidebar,
  IconChevronDown, IconUser, IconKey, IconTooth,
} from '../components/Icons';
import { DashboardPage } from '../pages/DashboardPage';
import { PatientsPage } from '../pages/PatientsPage';
import { PatientDetailPage } from '../pages/PatientDetailPage';
import { SettingsPage } from '../pages/SettingsPage';
import { AboutPage } from '../pages/AboutPage';
import { UsersPage } from '../pages/UsersPage';

export interface NavCtx {
  navigate: (route: string) => void;
  route: string;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: 'Practice',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: IconDashboard },
      { id: 'patients', label: 'Patients', icon: IconUsers },
      { id: 'appointments', label: 'Appointments', icon: IconCalendar },
      { id: 'queue', label: 'Queue', icon: IconQueue },
    ],
  },
  {
    label: 'Clinical',
    items: [
      { id: 'treatments', label: 'Treatments', icon: IconStethoscope },
      { id: 'prescriptions', label: 'Prescriptions', icon: IconPill },
    ],
  },
  {
    label: 'Billing',
    items: [
      { id: 'invoices', label: 'Invoice', icon: IconInvoice },
      { id: 'payments', label: 'Payments', icon: IconPayments },
      { id: 'inventory', label: 'Inventory', icon: IconBox },
      { id: 'accounting', label: 'Accounting', icon: IconChart },
    ],
  },
  {
    label: 'Administration',
    items: [
      { id: 'staff-users', label: 'Staff & Users', icon: IconShield },
      { id: 'backup', label: 'Backup & Restore', icon: IconDatabase },
      { id: 'settings', label: 'Settings', icon: IconSettings },
      { id: 'about', label: 'About', icon: IconInfo },
    ],
  },
];

export function AppShell({ state, onSessionChanged }: { state: AppState; onSessionChanged: () => void }) {
  const [route, setRoute] = useState('dashboard');
  const [param, setParam] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(localStorage.getItem('dp.sidebar') === '1');
  const [userMenu, setUserMenu] = useState(false);
  const [askLogout, setAskLogout] = useState(false);
  const { toast } = useToast();
  const activityTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const navigate = useCallback((r: string) => {
    const [base, p] = r.split(':');
    setRoute(base);
    setParam(p ?? null);
    setUserMenu(false);
  }, []);

  // Activity ping for auto-lock (throttled to once per 30s of real activity)
  useEffect(() => {
    let dirty = false;
    const mark = () => {
      dirty = true;
    };
    window.addEventListener('mousedown', mark);
    window.addEventListener('keydown', mark);
    activityTimer.current = setInterval(() => {
      if (dirty) {
        dirty = false;
        void api.activity();
      }
    }, 30_000);
    return () => {
      window.removeEventListener('mousedown', mark);
      window.removeEventListener('keydown', mark);
      if (activityTimer.current) clearInterval(activityTimer.current);
    };
  }, []);

  // Ctrl+K placeholder focus: global search comes with the search module; lock shortcut Ctrl+L
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        void api.lock();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleSidebar = () => {
    setCollapsed((c) => {
      localStorage.setItem('dp.sidebar', c ? '0' : '1');
      return !c;
    });
  };

  const dateStr = useMemo(() => {
    return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }, []);

  const user = state.session?.user;

  const ctx: NavCtx = { navigate, route };

  return (
    <div className="shell">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-brand">
          <div className="logo">
            <IconTooth size={18} strokeWidth={1.7} />
          </div>
          {!collapsed && (
            <div className="name">
              Dentiva Pro
              <small>Dental Practice Suite</small>
            </div>
          )}
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {NAV.map((group) => (
            <div className="nav-group" key={group.label}>
              {!collapsed && <div className="nav-group-label">{group.label}</div>}
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = route === item.id;
                return (
                  <button key={item.id} className={`nav-item ${active ? 'active' : ''}`} onClick={() => navigate(item.id)} title={collapsed ? item.label : undefined} aria-current={active ? 'page' : undefined}>
                    <Icon size={18} />
                    {!collapsed && <span>{item.label}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="nav-item" onClick={toggleSidebar} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <IconSidebar size={18} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button className="topbar-icon-btn" onClick={toggleSidebar} title="Toggle sidebar" aria-label="Toggle sidebar">
            <IconSidebar size={18} />
          </button>
          <span className="clinic-name">{state.clinic?.name || 'Dentiva Pro'}</span>
          <span className="date-chip">{dateStr}</span>
          <div className="spacer" />
          <button className="topbar-icon-btn" title="Global search (coming to this build phase)" aria-label="Global search" onClick={() => toast('info', 'Global search', 'The global search palette ships with the Search module in this build.')}>
            <IconSearch size={18} />
          </button>
          <button className="topbar-icon-btn" title="Notifications (coming to this build phase)" aria-label="Notifications" onClick={() => toast('info', 'Notifications', 'The notification center ships with the Notifications module in this build.')}>
            <IconBell size={18} />
          </button>
          <button className="topbar-icon-btn" title="Lock application (Ctrl+L)" aria-label="Lock application" onClick={() => void api.lock()}>
            <IconLock size={18} />
          </button>

          <div className="dropdown-wrap">
            <button className="user-chip" onClick={() => setUserMenu((v) => !v)} aria-haspopup="menu" aria-expanded={userMenu}>
              <span className="avatar">{(user?.displayName ?? 'U').slice(0, 1).toUpperCase()}</span>
              <span className="meta">
                <span className="n">{user?.displayName}</span>
                <br />
                <span className="r">{user?.roles[0] ?? ''}</span>
              </span>
              <IconChevronDown size={14} />
            </button>
            {userMenu && (
              <div className="dropdown" role="menu">
                <button className="dropdown-item" onClick={() => navigate('settings:account')}>
                  <IconUser size={15} /> My account & password
                </button>
                <button className="dropdown-item" onClick={() => void api.lock()}>
                  <IconLock size={15} /> Lock application
                </button>
                <div className="dropdown-sep" />
                <button className="dropdown-item danger" onClick={() => setAskLogout(true)}>
                  <IconLogout size={15} /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="content" onClick={() => userMenu && setUserMenu(false)}>
          {route === 'dashboard' && <DashboardPage ctx={ctx} />}
          {route === 'patients' && <PatientsPage ctx={ctx} />}
          {route === 'patient' && param && <PatientDetailPage ctx={ctx} id={Number(param)} />}
          {route === 'settings' && <SettingsPage ctx={ctx} initialTab={param ?? undefined} />}
          {route === 'about' && <AboutPage ctx={ctx} />}
          {route === 'staff-users' && <UsersPage ctx={ctx} />}
          {!['dashboard', 'patients', 'patient', 'settings', 'about', 'staff-users'].includes(route) && (
            <ModuleInProgress name={routeLabel(route)} />
          )}
        </main>
      </div>

      {askLogout && (
        <ConfirmDialog
          title="Sign out?"
          message="You will be signed out of Dentiva Pro. Any unsaved changes in open dialogs will be discarded."
          confirmLabel="Sign out"
          onConfirm={async () => {
            await api.logout();
            onSessionChanged();
          }}
          onClose={() => setAskLogout(false)}
        />
      )}
    </div>
  );
}

function routeLabel(route: string): string {
  const map: Record<string, string> = {
    appointments: 'Appointments',
    queue: 'Queue',
    treatments: 'Treatments',
    prescriptions: 'Prescriptions',
    invoices: 'Invoice',
    payments: 'Payments',
    inventory: 'Inventory',
    accounting: 'Accounting',
    backup: 'Backup & Restore',
  };
  return map[route] ?? route;
}

function ModuleInProgress({ name }: { name: string }) {
  return (
    <div className="page">
      <div className="card">
        <div className="state-block">
          <div className="state-icon">
            <IconKey size={22} />
          </div>
          <div className="state-title">{name}</div>
          <div className="state-desc">
            This module is being assembled in the current Dentiva Pro build phase. It will be enabled as its services land
            in this branch — no mock data is shown anywhere in the product.
          </div>
        </div>
      </div>
    </div>
  );
}
