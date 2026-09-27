import React from 'react';
import { IconTooth } from '../components/Icons';

export function AuthFrame({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="auth-frame">
      <div style={{ width: '100%', maxWidth: wide ? 720 : 460, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="auth-brand" style={{ justifyContent: 'center' }}>
          <div className="logo">
            <IconTooth size={26} strokeWidth={1.6} />
          </div>
          <div>
            <h1>Dentiva Pro</h1>
            <p>Dental Practice Management System</p>
          </div>
        </div>
        <div className={`auth-card ${wide ? 'wide' : ''}`}>{children}</div>
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--dp-text-faint)' }}>
          Offline-first · Built for dental clinics in Bangladesh · v1.0.0
        </p>
      </div>
    </div>
  );
}
