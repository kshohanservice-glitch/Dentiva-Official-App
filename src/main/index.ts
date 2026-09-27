/**
 * Dentiva Pro — Electron main process entry.
 * Single window shell, strict security defaults, startup integrity checks,
 * auto-backup due check, and crash-safe shutdown.
 */
import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { initLogger, logger } from './util/logger';
import { initPaths, dbFile, logsDir, dataDir, attachmentsDir, brandingDir, tempDir } from './util/paths';
import { initDatabase, closeDatabase, integrityCheck } from './db/connection';
import { registerIpcHandlers } from './ipc';
import { sessionManager } from './services/session';
import { runAutoBackupIfDue } from './services/backup';
import { refreshAlertNotifications } from './services/notifications';
import { isSetupCompleted } from './services/setup';

let mainWindow: BrowserWindow | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // E2E / integration isolation: DENTIVA_USER_DATA redirects every app-managed
    // directory (DB, logs, attachments, branding) into a disposable folder so
    // tests never touch a real clinic's userData.
    const override = process.env.DENTIVA_USER_DATA?.trim();
    if (override) {
      fs.mkdirSync(override, { recursive: true });
      app.setPath('userData', override);
    }
    initPaths(app.getPath('userData'));
    initLogger(logsDir());
    for (const d of [dataDir(), attachmentsDir(), brandingDir(), tempDir()]) {
      fs.mkdirSync(d, { recursive: true });
    }

    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

    initDatabase(dbFile());
    if (!integrityCheck()) {
      logger.error('database.integrity_failed', {});
    }

    registerIpcHandlers();
    sessionManager.setListeners({
      onLock: () => mainWindow?.webContents.send('app:locked'),
      onSessionChange: () => {
        mainWindow?.webContents.send('app:session-changed');
        if (!sessionManager.isLocked() && sessionManager.hasSession() && isSetupCompleted()) {
          refreshAlertNotifications();
        }
      },
    });

    // Background housekeeping: due auto-backups + notification refresh (best-effort).
    if (isSetupCompleted()) {
      void runAutoBackupIfDue().catch((err) => logger.error('autobackup.startup_failed', { message: String(err) }));
    }

    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    try {
      closeDatabase();
    } catch (err) {
      logger.error('db.close_failed', { message: String(err) });
    }
  });

  process.on('uncaughtException', (err) => {
    logger.error('uncaught', { message: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', { message: String(reason) });
  });
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 700,
    show: false,
    title: 'Dentiva Pro',
    backgroundColor: '#F7F9FB',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('mailto:')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}
