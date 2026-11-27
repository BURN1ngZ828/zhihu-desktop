import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  shell,
  Tray,
} from 'electron';
import type { ContentKind, SystemFontItem, UserContentTab, UserSettings } from '../shared/types';
import { getDataDir, LocalStorage } from './storage';
import { ZhihuClient } from './zhihu-api';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let cachedFontsPromise: Promise<SystemFontItem[]> | null = null;

function queryInstalledSystemFonts(): Promise<SystemFontItem[]> {
  if (cachedFontsPromise) return cachedFontsPromise;
  if (process.platform !== 'win32') return Promise.resolve([]);
  const psScript = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Drawing',
    '$col = New-Object System.Drawing.Text.InstalledFontCollection',
    '$list = $col.Families | Where-Object { $_.Name -and $_.Name -notmatch "^@" } | ForEach-Object { [PSCustomObject]@{ family = $_.Name; label = $_.Name } }',
    'ConvertTo-Json -InputObject @($list) -Compress',
  ].join('; ');
  cachedFontsPromise = new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 8000 },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          cachedFontsPromise = null;
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as SystemFontItem[];
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch {
          cachedFontsPromise = null;
          resolve([]);
        }
      }
    );
  });
  return cachedFontsPromise;
}

const storage = new LocalStorage();
const zhihu = new ZhihuClient(storage);

function syncLaunchOnStartup(enabled: boolean): void {
  if (!app.isPackaged || process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  } catch {
    // ignore OS policy restrictions
  }
}

function resolveAssetPath(filename: string): string | undefined {
  const candidates = [
    path.join(__dirname, '..', 'assets', filename),
    path.join(process.resourcesPath, 'assets', filename),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function getInitialBg(): string {
  const settings = storage.getSettings();
  const isDark =
    settings.themeMode === 'dark' || (settings.themeMode === 'system' && nativeTheme.shouldUseDarkColors);
  if (isDark) return settings.paperTone === 'warm' ? '#151311' : '#0f1014';
  if (settings.paperTone === 'gray') return '#e9ecf0';
  return settings.paperTone === 'warm' ? '#efece4' : '#eef1f5';
}

function showOrFocusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function ensureTray(): void {
  if (tray) return;
  const iconPath = resolveAssetPath('tray-icon.png') || resolveAssetPath('icon.png');
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('知乎 Desktop');

  const showMenu = () => {
    const visible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
    const menu = Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => showOrFocusMainWindow() },
      { label: '隐藏到托盘', enabled: visible, click: () => mainWindow?.hide() },
      { type: 'separator' },
      {
        label: '退出知乎 Desktop',
        click: () => {
          isQuitting = true;
          tray?.destroy();
          tray = null;
          app.quit();
        },
      },
    ]);
    tray?.popUpContextMenu(menu);
  };

  tray.on('click', () => showOrFocusMainWindow());
  tray.on('right-click', showMenu);
}

function createMainWindow(): BrowserWindow {
  const saved = storage.getWindowBounds();
  let safeX = saved.x;
  let safeY = saved.y;
  if (safeX !== undefined && safeY !== undefined) {
    const visible = screen.getAllDisplays().some((d) => {
      const wa = d.workArea;
      return safeX! + saved.width > wa.x + 80 && safeX! < wa.x + wa.width - 80 && safeY! + 50 > wa.y && safeY! < wa.y + wa.height - 50;
    });
    if (!visible) {
      safeX = undefined;
      safeY = undefined;
    }
  }

  const iconPath = resolveAssetPath('icon.ico') || resolveAssetPath('icon.png');
  const win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: safeX,
    y: safeY,
    minWidth: 840,
    minHeight: 580,
    frame: false,
    show: false,
    backgroundColor: getInitialBg(),
    title: '知乎 Desktop',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  let shown = false;
  const showSafely = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    if (saved.maximized) win.maximize();
    win.show();
    win.focus();
  };
  win.once('ready-to-show', showSafely);
  setTimeout(showSafely, 800);

  let saveTimer: NodeJS.Timeout | null = null;
  const persistBounds = () => {
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const b = maximized ? win.getNormalBounds() : win.getBounds();
    storage.saveWindowBounds({
      width: Math.max(840, b.width),
      height: Math.max(580, b.height),
      x: b.x,
      y: b.y,
      maximized,
    });
  };
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistBounds, 300);
  };
  const emitState = () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window:state', { isMaximized: win.isMaximized() });
    }
  };

  win.on('maximize', () => {
    emitState();
    scheduleSave();
  });
  win.on('unmaximize', () => {
    emitState();
    scheduleSave();
  });
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);

  win.on('close', (event) => {
    persistBounds();
    if (!isQuitting && storage.getSettings().minimizeToTray && tray) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward' && !win.isDestroyed()) {
      win.webContents.send('app:mouseBack');
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (!(input.control || input.meta) || input.alt) return;
    const key = input.key.toLowerCase();
    if (key === '0') {
      event.preventDefault();
      win.webContents.send('app:shortcut', 'zoom-reset');
    } else if (key === '=' || key === '+') {
      event.preventDefault();
      win.webContents.send('app:shortcut', 'zoom-in');
    } else if (key === '-' || key === '_') {
      event.preventDefault();
      win.webContents.send('app:shortcut', 'zoom-out');
    } else if (key === ',') {
      event.preventDefault();
      win.webContents.send('app:shortcut', 'open-settings');
    } else if (key === 'k') {
      event.preventDefault();
      win.webContents.send('app:shortcut', 'open-search');
    } else if (key === 'f') {
      event.preventDefault();
      win.webContents.send('app:shortcut', 'find-in-page');
    } else if (key === 'r') {
      event.preventDefault();
      win.webContents.send('app:shortcut', 'refresh');
    }
  });

  win.webContents.on('context-menu', (_event, params) => {
    if (win.isDestroyed()) return;
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      items.push(
        { label: '剪切', role: 'cut', enabled: params.editFlags.canCut },
        { label: '复制', role: 'copy', enabled: params.editFlags.canCopy },
        { label: '粘贴', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: '全选', role: 'selectAll', enabled: params.editFlags.canSelectAll }
      );
    } else {
      if (params.selectionText.trim()) {
        items.push({ label: '复制', role: 'copy' }, { label: '全选', role: 'selectAll' });
      }
      if (params.mediaType === 'image') {
        if (items.length) items.push({ type: 'separator' });
        items.push({
          label: '复制图片',
          click: () => win.webContents.copyImageAt(params.x, params.y),
        });
        if (params.srcURL && /^https?:\/\//i.test(params.srcURL)) {
          items.push(
            { label: '复制图片地址', click: () => clipboard.writeText(params.srcURL) },
            { label: '在浏览器中打开原图', click: () => void shell.openExternal(params.srcURL) }
          );
        }
      }
      if (params.linkURL && /^https?:\/\//i.test(params.linkURL)) {
        if (items.length) items.push({ type: 'separator' });
        const label = (params.selectionText || params.linkText || params.linkURL).trim().replace(/\s+/g, ' ');
        items.push(
          { label: '复制链接地址', click: () => clipboard.writeText(params.linkURL) },
          { label: '复制为 Markdown 链接', click: () => clipboard.writeText(`[${label}](${params.linkURL})`) },
          { label: '在浏览器中打开', click: () => void shell.openExternal(params.linkURL) }
        );
      }
    }
    if (items.length) {
      Menu.buildFromTemplate(items).popup({ window: win });
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL?.trim();
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow = win;
  return win;
}

function registerIpcHandlers(): void {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
  ipcMain.on('app:wheelZoom', (event, action: string) => {
    if (action === 'zoom-in' || action === 'zoom-out') {
      event.sender.send('app:shortcut', action);
    }
  });

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url);
    }
  });
  ipcMain.handle('clipboard:writeText', (_e, text: string) => {
    clipboard.writeText(String(text ?? ''));
  });

  ipcMain.handle('zhihu:getAccount', () => zhihu.getAccount());
  ipcMain.handle('zhihu:openWebLogin', () => zhihu.openWebLogin(mainWindow));
  ipcMain.handle('zhihu:logout', () => zhihu.logout());
  ipcMain.handle('zhihu:fetchHomeFeed', (_e, nextUrl?: string) => zhihu.fetchHomeFeed(nextUrl));
  ipcMain.handle('zhihu:fetchFollowFeed', (_e, nextUrl?: string) => zhihu.fetchFollowFeed(nextUrl));
  ipcMain.handle('zhihu:fetchHotList', () => zhihu.fetchHotList());
  ipcMain.handle('zhihu:fetchArticleDetail', (_e, kind: ContentKind, id: string) => zhihu.fetchArticleDetail(kind, id));
  ipcMain.handle(
    'zhihu:fetchQuestionAnswers',
    (_e, questionId: string, offset?: number, sortBy?: 'default' | 'updated') =>
      zhihu.fetchQuestionAnswers(questionId, offset, sortBy)
  );
  ipcMain.handle(
    'zhihu:fetchUserContent',
    (_e, urlToken: string, tab?: UserContentTab, offset?: number) =>
      zhihu.fetchUserContent(urlToken, tab, offset)
  );
  ipcMain.handle(
    'zhihu:fetchComments',
    (_e, kind: ContentKind, id: string, nextUrl?: string, order?: 'normal' | 'reverse') =>
      zhihu.fetchComments(kind, id, nextUrl, order)
  );
  ipcMain.handle('zhihu:fetchChildComments', (_e, commentId: string, nextUrl?: string) =>
    zhihu.fetchChildComments(commentId, nextUrl)
  );
  ipcMain.handle('zhihu:likeComment', (_e, commentId: string, like: boolean) => zhihu.likeComment(commentId, like));
  ipcMain.handle(
    'zhihu:submitComment',
    (_e, kind: ContentKind, id: string, content: string, replyToCommentId?: string) =>
      zhihu.submitComment(kind, id, content, replyToCommentId)
  );
  ipcMain.handle('zhihu:deleteComment', (_e, commentId: string) => zhihu.deleteComment(commentId));
  ipcMain.handle('zhihu:voteContent', (_e, kind: ContentKind, id: string, action: 'up' | 'down' | 'neutral') =>
    zhihu.voteContent(kind, id, action)
  );
  ipcMain.handle('zhihu:search', (_e, query: string, offset?: number) => zhihu.search(query, offset));
  ipcMain.handle('zhihu:fetchCollections', () => zhihu.fetchCollections());
  ipcMain.handle('zhihu:fetchCollectionItems', (_e, id: string, offset?: number) => zhihu.fetchCollectionItems(id, offset));
  ipcMain.handle('system:listFonts', () => queryInstalledSystemFonts());
  ipcMain.handle('system:openDataDir', async () => {
    await shell.openPath(getDataDir());
  });

  ipcMain.handle('storage:getSettings', () => storage.getSettings());
  ipcMain.handle('storage:updateSettings', (_e, patch: Partial<UserSettings>) => {
    const next = storage.updateSettings(patch);
    if ('launchOnStartup' in patch) {
      syncLaunchOnStartup(next.launchOnStartup);
    }
    return next;
  });
  ipcMain.handle('storage:resetSettings', () => {
    const next = storage.resetSettings();
    syncLaunchOnStartup(next.launchOnStartup);
    return next;
  });
  ipcMain.handle('storage:getHistory', () => storage.getHistory());
  ipcMain.handle('storage:clearHistory', () => storage.clearHistory());
  ipcMain.handle('storage:getFilterState', () => storage.getFilterState());
  ipcMain.handle('storage:addFilterKeyword', (_e, kw: string) => storage.addKeyword(kw));
  ipcMain.handle('storage:removeFilterKeyword', (_e, kw: string) => storage.removeKeyword(kw));
  ipcMain.handle('storage:addBlockedAuthor', (_e, author: string) => storage.addBlockedAuthor(author));
  ipcMain.handle('storage:removeBlockedAuthor', (_e, author: string) => storage.removeBlockedAuthor(author));
  ipcMain.handle('storage:clearSeen', () => storage.clearSeen());
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showOrFocusMainWindow());
  app.whenReady().then(() => {
    app.setAppUserModelId('com.burn1ngz.zhihu-desktop');
    syncLaunchOnStartup(storage.getSettings().launchOnStartup);
    registerIpcHandlers();
    ensureTray();
    createMainWindow();
  });
  app.on('window-all-closed', () => {
    if (!isQuitting && storage.getSettings().minimizeToTray && tray) return;
    app.quit();
  });
  app.on('before-quit', () => {
    isQuitting = true;
    tray?.destroy();
    tray = null;
  });
}
