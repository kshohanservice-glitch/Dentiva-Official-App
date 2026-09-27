import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState } from '../lib/api';
import { api } from '../lib/api';
import { ConfirmDialog } from '../components/ui';
import {
  IconDashboard, IconUsers, IconCalendar, IconQueue, IconStethoscope, IconPill,
  IconInvoice, IconPayments, IconBox, IconChart, IconShield, IconDatabase,
  IconSettings, IconInfo, IconBell, IconLock, IconLogout, IconSearch, IconSidebar,
  IconChevronDown, IconUser, IconTooth,
} from '../components/Icons';
import { DashboardPage } from '../pages/DashboardPage';
import { PatientsPage } from '../pages/PatientsPage';
import { PatientDetailPage } from '../pages/PatientDetailPage';
import { SettingsPage } from '../pages/SettingsPage';
import { AboutPage } from '../pages/AboutPage';
import { UsersPage } from '../pages/UsersPage';
import { AppointmentsPage } from '../pages/AppointmentsPage';
import { QueuePage } from '../pages/QueuePage';
import { TreatmentsPage } from '../pages/TreatmentsPage';
import { PrescriptionsPage } from '../pages/PrescriptionsPage';
import { InvoicesPage } from '../pages/InvoicesPage';
import { PaymentsPage } from '../pages/PaymentsPage';
import { InventoryPage } from '../pages/InventoryPage';
import { AccountingPage } from '../pages/AccountingPage';
import { BackupPage } from '../pages/BackupPage';
import { GlobalSearchPalette } from '../components/GlobalSearchPalette';
import { NotificationCenter } from '../components/NotificationCenter';

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const activityTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const navigate = useCallback((r: string) => {
    const [base, p] = r.split(':');
    setRoute(base);
    setParam(p ?? null);
    setUserMenu(false);
    setSearchOpen(false);
  }, []);

  // Notification badge — refresh periodically and whenever a page renders.
  useEffect(() => {
    let live = true;
    const tick = () => {
      api.notificationsUnread().then((n) => live && setUnread(n)).catch(() => undefined);
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [route]);

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

  // Cross-component navigation (e.g. from the notification center).
  useEffect(() => {
    const onNav = (e: Event) => {
      const target = (e as CustomEvent<string>).detail;
      if (typeof target === 'string' && target) navigate(target);
    };
    window.addEventListener('dp:navigate', onNav);
    return () => window.removeEventListener('dp:navigate', onNav);
  }, [navigate]);

  // Global shortcuts: Ctrl+L locks, Ctrl+K opens the global search palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        void api.lock();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
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
          <button className="topbar-icon-btn" title="Global search (Ctrl+K)" aria-label="Global search" onClick={() => setSearchOpen(true)}>
            <IconSearch size={18} />
          </button>
          <button
            className="topbar-icon-btn"
            title="Notifications"
            aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
            onClick={() => setNotifOpen(true)}
            style={{ position: 'relative' }}
          >
            <IconBell size={18} />
            {unread > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  minWidth: 15,
                  height: 15,
                  borderRadius: 8,
                  background: 'var(--dp-error)',
                  color: '#fff',
                  fontSize: 9.5,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 3px',
                }}
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
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
          {route === 'appointments' && <AppointmentsPage ctx={ctx} />}
          {route === 'queue' && <QueuePage ctx={ctx} />}
          {route === 'treatments' && <TreatmentsPage ctx={ctx} />}
          {route === 'prescriptions' && <PrescriptionsPage ctx={ctx} />}
          {route === 'invoices' && <InvoicesPage ctx={ctx} />}
          {route === 'payments' && <PaymentsPage ctx={ctx} />}
          {route === 'inventory' && <InventoryPage ctx={ctx} />}
          {route === 'accounting' && <AccountingPage ctx={ctx} />}
          {route === 'backup' && <BackupPage ctx={ctx} />}
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

      {searchOpen && <GlobalSearchPalette navigate={navigate} onClose={() => setSearchOpen(false)} />}
      {notifOpen && <NotificationCenter onClose={() => setNotifOpen(false)} onUnreadChanged={setUnread} />}
    </div>
  );
}
