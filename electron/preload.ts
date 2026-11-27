import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type {
  AccountInfo,
  ArticleDetail,
  CollectionItem,
  CommentItem,
  CommentsPage,
  ContentKind,
  FeedPage,
  FilterState,
  HistoryEntry,
  QuestionAnswersPage,
  SystemFontItem,
  UserContentTab,
  UserSettings,
} from '../shared/types';

function clampZoom(factor: number): number {
  if (!Number.isFinite(factor)) return 1;
  return Math.min(1.35, Math.max(0.8, Math.round(factor * 20) / 20));
}

export interface ZhihuDesktopApi {
  // Window
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  setZoomFactor: (factor: number) => number;
  getZoomFactor: () => number;
  onWindowStateChange: (cb: (state: { isMaximized: boolean }) => void) => () => void;
  onShortcut: (cb: (action: string) => void) => () => void;
  // Shell, clipboard & system
  openExternal: (url: string) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  listSystemFonts: () => Promise<SystemFontItem[]>;
  openDataDir: () => Promise<void>;
  // Account
  getAccount: () => Promise<AccountInfo>;
  openWebLogin: () => Promise<{ ok: boolean; account?: AccountInfo; cancelled?: boolean }>;
  logout: () => Promise<AccountInfo>;
  // Content
  fetchHomeFeed: (nextUrl?: string) => Promise<FeedPage>;
  fetchFollowFeed: (nextUrl?: string) => Promise<FeedPage>;
  fetchHotList: () => Promise<FeedPage>;
  fetchArticleDetail: (kind: ContentKind, id: string) => Promise<ArticleDetail>;
  fetchQuestionAnswers: (
    questionId: string,
    offset?: number,
    sortBy?: 'default' | 'updated'
  ) => Promise<QuestionAnswersPage>;
  fetchUserContent: (urlToken: string, tab?: UserContentTab, offset?: number) => Promise<FeedPage>;
  fetchComments: (
    kind: ContentKind,
    id: string,
    nextUrl?: string,
    order?: 'normal' | 'reverse'
  ) => Promise<CommentsPage>;
  fetchChildComments: (commentId: string, nextUrl?: string) => Promise<CommentsPage>;
  likeComment: (commentId: string, like: boolean) => Promise<{ liked: boolean }>;
  submitComment: (
    kind: ContentKind,
    id: string,
    content: string,
    replyToCommentId?: string
  ) => Promise<CommentItem>;
  deleteComment: (commentId: string) => Promise<void>;
  voteContent: (
    kind: ContentKind,
    id: string,
    action: 'up' | 'down' | 'neutral'
  ) => Promise<{ voteupCount: number; voting: number }>;
  search: (query: string, offset?: number) => Promise<FeedPage>;
  fetchCollections: () => Promise<CollectionItem[]>;
  fetchCollectionItems: (id: string, offset?: number) => Promise<FeedPage>;
  // Local storage
  getSettings: () => Promise<UserSettings>;
  updateSettings: (patch: Partial<UserSettings>) => Promise<UserSettings>;
  resetSettings: () => Promise<UserSettings>;
  getHistory: () => Promise<HistoryEntry[]>;
  clearHistory: () => Promise<void>;
  getFilterState: () => Promise<FilterState>;
  addFilterKeyword: (keyword: string) => Promise<FilterState>;
  removeFilterKeyword: (keyword: string) => Promise<FilterState>;
  addBlockedAuthor: (author: string) => Promise<FilterState>;
  removeBlockedAuthor: (author: string) => Promise<FilterState>;
  clearSeen: () => Promise<FilterState>;
}

const api: ZhihuDesktopApi = {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  setZoomFactor: (factor: number) => {
    const clamped = clampZoom(factor);
    webFrame.setZoomFactor(clamped);
    return clamped;
  },
  getZoomFactor: () => webFrame.getZoomFactor(),
  onWindowStateChange: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, state: { isMaximized: boolean }) => cb(state);
    ipcRenderer.on('window:state', handler);
    return () => ipcRenderer.removeListener('window:state', handler);
  },
  onShortcut: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, action: string) => cb(action);
    ipcRenderer.on('app:shortcut', handler);
    return () => ipcRenderer.removeListener('app:shortcut', handler);
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  copyText: (text) => ipcRenderer.invoke('clipboard:writeText', text),
  listSystemFonts: () => ipcRenderer.invoke('system:listFonts'),
  openDataDir: () => ipcRenderer.invoke('system:openDataDir'),
  getAccount: () => ipcRenderer.invoke('zhihu:getAccount'),
  openWebLogin: () => ipcRenderer.invoke('zhihu:openWebLogin'),
  logout: () => ipcRenderer.invoke('zhihu:logout'),
  fetchHomeFeed: (nextUrl) => ipcRenderer.invoke('zhihu:fetchHomeFeed', nextUrl),
  fetchFollowFeed: (nextUrl) => ipcRenderer.invoke('zhihu:fetchFollowFeed', nextUrl),
  fetchHotList: () => ipcRenderer.invoke('zhihu:fetchHotList'),
  fetchArticleDetail: (kind, id) => ipcRenderer.invoke('zhihu:fetchArticleDetail', kind, id),
  fetchQuestionAnswers: (questionId, offset, sortBy) =>
    ipcRenderer.invoke('zhihu:fetchQuestionAnswers', questionId, offset, sortBy),
  fetchUserContent: (urlToken, tab, offset) =>
    ipcRenderer.invoke('zhihu:fetchUserContent', urlToken, tab, offset),
  fetchComments: (kind, id, nextUrl, order) =>
    ipcRenderer.invoke('zhihu:fetchComments', kind, id, nextUrl, order),
  fetchChildComments: (commentId, nextUrl) =>
    ipcRenderer.invoke('zhihu:fetchChildComments', commentId, nextUrl),
  likeComment: (commentId, like) => ipcRenderer.invoke('zhihu:likeComment', commentId, like),
  submitComment: (kind, id, content, replyToCommentId) =>
    ipcRenderer.invoke('zhihu:submitComment', kind, id, content, replyToCommentId),
  deleteComment: (commentId) => ipcRenderer.invoke('zhihu:deleteComment', commentId),
  voteContent: (kind, id, action) => ipcRenderer.invoke('zhihu:voteContent', kind, id, action),
  search: (query, offset) => ipcRenderer.invoke('zhihu:search', query, offset),
  fetchCollections: () => ipcRenderer.invoke('zhihu:fetchCollections'),
  fetchCollectionItems: (id, offset) => ipcRenderer.invoke('zhihu:fetchCollectionItems', id, offset),
  getSettings: () => ipcRenderer.invoke('storage:getSettings'),
  updateSettings: (patch) => ipcRenderer.invoke('storage:updateSettings', patch),
  resetSettings: () => ipcRenderer.invoke('storage:resetSettings'),
  getHistory: () => ipcRenderer.invoke('storage:getHistory'),
  clearHistory: () => ipcRenderer.invoke('storage:clearHistory'),
  getFilterState: () => ipcRenderer.invoke('storage:getFilterState'),
  addFilterKeyword: (keyword) => ipcRenderer.invoke('storage:addFilterKeyword', keyword),
  removeFilterKeyword: (keyword) => ipcRenderer.invoke('storage:removeFilterKeyword', keyword),
  addBlockedAuthor: (author) => ipcRenderer.invoke('storage:addBlockedAuthor', author),
  removeBlockedAuthor: (author) => ipcRenderer.invoke('storage:removeBlockedAuthor', author),
  clearSeen: () => ipcRenderer.invoke('storage:clearSeen'),
};

contextBridge.exposeInMainWorld('zhihuApi', api);

// Mouse back button -> close overlay first via document Escape, else Alt+ArrowLeft
let lastBackAt = 0;
function triggerAppBack(): void {
  const now = Date.now();
  if (now - lastBackAt < 140) return;
  lastBackAt = now;
  const hasOverlay = Boolean(
    document.querySelector('[role="dialog"]') ||
      document.querySelector('[data-overlay="lightbox"]') ||
      document.querySelector('[data-overlay="popover"]')
  );
  if (hasOverlay) {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
    );
    return;
  }
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
}

ipcRenderer.on('app:mouseBack', () => triggerAppBack());
window.addEventListener(
  'mouseup',
  (event) => {
    if (event.button === 3) {
      event.preventDefault();
      triggerAppBack();
    }
  },
  true
);

let lastWheelZoomAt = 0;
window.addEventListener(
  'wheel',
  (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.deltaY === 0) return;
    event.preventDefault();
    const now = Date.now();
    if (now - lastWheelZoomAt < 80) return;
    lastWheelZoomAt = now;
    ipcRenderer.send('app:wheelZoom', event.deltaY < 0 ? 'zoom-in' : 'zoom-out');
  },
  { passive: false }
);
