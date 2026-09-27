import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { NavCtx } from '../shell/AppShell';
import { Badge } from '../components/ui';
import { IconTooth } from '../components/Icons';

export function AboutPage({ ctx }: { ctx: NavCtx }) {
  const [version, setVersion] = useState<{ version: string; build: string } | null>(null);
  const [activation, setActivation] = useState<{ activated: boolean; activatedAt: string | null } | null>(null);
  void ctx;

  useEffect(() => {
    void api.version().then(setVersion).catch(() => undefined);
    void api.activationStatus().then(setActivation).catch(() => undefined);
  }, []);

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-header">
        <div>
          <div className="crumb">Administration</div>
          <h1>About</h1>
        </div>
      </div>

      <div className="card card-pad" style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 16 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg, var(--dp-primary-600), var(--dp-primary-800))', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <IconTooth size={34} strokeWidth={1.5} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="dp-h1" style={{ fontSize: 22 }}>Dentiva Pro</div>
          <div className="dp-sub">Premium offline-first Dental Practice Management System for Bangladesh</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <Badge tone="primary">Version {version?.version ?? '1.0.0'}</Badge>
            <Badge tone="neutral">Build {version?.build ?? 'dev'}</Badge>
            {activation && (activation.activated ? <Badge tone="success">Activated</Badge> : <Badge tone="warning">Not activated</Badge>)}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card card-pad">
          <span className="card-title" style={{ marginBottom: 10 }}>Product</span>
          <KV k="Developer" v="Shohan Khan" />
          <KV k="Email" v="helloiamshohan@gmail.com" />
          <KV k="Release" v="Final production release" />
          <KV k="License" v="Commercial — single-clinica installation license" />
          <KV k="Copyright" v="© 2026 Shohan Khan. All rights reserved." />
          {activation?.activatedAt && <KV k="Activated on" v={new Date(activation.activatedAt).toLocaleString('en-GB')} />}
        </div>
        <div className="card card-pad">
          <span className="card-title" style={{ marginBottom: 10 }}>Runtime</span>
          <KV k="Electron" v={window.dentiva.versions.electron || '—'} />
          <KV k="Chromium" v={window.dentiva.versions.chrome || '—'} />
          <KV k="Node.js" v={window.dentiva.versions.node || '—'} />
          <KV k="Database" v="SQLite (embedded, local)" />
          <KV k="Network requirement" v="None — fully offline" />
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <span className="card-title" style={{ marginBottom: 10 }}>Third-party notices</span>
        <div className="dp-sub" style={{ lineHeight: 1.9 }}>
          <p>
            Dentiva Pro is built with open-source technology. The full license audit ships with the product
            (docs/DEPENDENCY-LICENSE-AUDIT.md). Summary:
          </p>
          <ul style={{ paddingLeft: 18, marginTop: 6 }}>
            <li>Electron — MIT License (© Electron contributors)</li>
            <li>Chromium — BSD-style license (© Chromium authors)</li>
            <li>Node.js — MIT License (© Node.js contributors)</li>
            <li>SQLite — Public Domain</li>
            <li>better-sqlite3 — MIT License</li>
            <li>React & React DOM — MIT License (© Meta Platforms, Inc.)</li>
            <li>Noto Sans / Noto Sans Bengali fonts — SIL Open Font License 1.1 (© Google)</li>
            <li>yazl / yauzl — MIT License</li>
          </ul>
          <p style={{ marginTop: 6 }}>
            Bengali text is rendered with the bundled Noto Sans Bengali typeface under the SIL Open Font License; no
            internet connection is ever required.
          </p>
        </div>
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '3px 0' }}>
      <span className="dp-sub" style={{ width: 150, flex: 'none' }}>{k}</span>
      <span style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{v}</span>
    </div>
  );
}
