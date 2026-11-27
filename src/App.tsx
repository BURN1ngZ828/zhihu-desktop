import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Clock,
  Flame,
  Home,
  Loader2,
  LogIn,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  Sun,
  ThumbsUp,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  type AccountInfo,
  type ArticleDetail,
  type CollectionItem,
  type ContentKind,
  type FeedItem,
  type FilterState,
  type HistoryEntry,
  type NavSection,
  type UserSettings,
} from '@shared/types';
import { formatCount, formatErrorMessage } from '@/utils/format';
import { usePresence } from '@/utils/usePresence';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ReaderPane } from '@/components/ReaderPane';
import { SearchModal } from '@/components/SearchModal';
import { SettingsModal } from '@/components/SettingsModal';
import { WindowControls } from '@/components/WindowControls';

interface NavBackTarget {
  kind: ContentKind;
  id: string;
  key: string;
  title?: string;
  url?: string;
}

export interface PendingTargetMeta {
  kind: ContentKind;
  id: string;
  title?: string;
  url?: string;
}

interface ToastState {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

function buildFallbackUrl(kind: ContentKind, id: string): string {
  switch (kind) {
    case 'article':
      return `https://zhuanlan.zhihu.com/p/${id}`;
    case 'pin':
      return `https://www.zhihu.com/pin/${id}`;
    case 'question':
      return `https://www.zhihu.com/question/${id}`;
    case 'user':
      return `https://www.zhihu.com/people/${encodeURIComponent(id)}`;
    case 'answer':
    default:
      return `https://www.zhihu.com/answer/${id}`;
  }
}

export default function App() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [account, setAccount] = useState<AccountInfo>({ loggedIn: false });
  const [filterState, setFilterState] = useState<FilterState>({ keywords: [], blockedAuthors: [], seenCount: 0 });
  const [windowWidth, setWindowWidth] = useState<number>(() => window.innerWidth);

  const [section, setSection] = useState<NavSection>('home');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collectionOffset, setCollectionOffset] = useState(0);
  const [historyList, setHistoryList] = useState<HistoryEntry[]>([]);
  const [historyFilter, setHistoryFilter] = useState('');
  const [visitedKeys, setVisitedKeys] = useState<Set<string>>(() => new Set());

  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchOffset, setSearchOffset] = useState(0);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<PendingTargetMeta | null>(null);
  const [detail, setDetail] = useState<ArticleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [backStack, setBackStack] = useState<NavBackTarget[]>([]);

  const [zenMode, setZenMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [commentJumpSignal, setCommentJumpSignal] = useState(0);
  const [findInPageSignal, setFindInPageSignal] = useState(0);

  const [dragListWidth, setDragListWidth] = useState<number | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const feedSentinelRef = useRef<HTMLDivElement>(null);
  const listReqIdRef = useRef(0);
  const detailReqIdRef = useRef(0);
  const detailCacheRef = useRef<Map<string, ArticleDetail>>(new Map());

  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<number | null>(null);
  const toastPresence = usePresence(Boolean(toast));
  const lastToastRef = useRef<ToastState | null>(null);
  if (toast) lastToastRef.current = toast;
  else if (!toastPresence.mounted) lastToastRef.current = null;
  const activeToast = toast || lastToastRef.current;

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((msg: string, actionLabel?: string, onAction?: () => void) => {
    setToast({ message: msg, actionLabel, onAction });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), actionLabel ? 4200 : 2200);
  }, []);

  // Responsive viewport listener: auto-collapse into single-column below 760px
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Apply theme, paper tone & feed font scale to document root
  const [isDarkResolved, setIsDarkResolved] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = settings.themeMode === 'dark' || (settings.themeMode === 'system' && mq.matches);
      setIsDarkResolved(dark);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.dataset.paper = settings.paperTone;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.themeMode, settings.paperTone]);

  useEffect(() => {
    document.documentElement.style.setProperty('--feed-summary-size', `${settings.feedFontSize}px`);
  }, [settings.feedFontSize]);

  useEffect(() => {
    window.zhihuApi.setZoomFactor(settings.uiScale);
  }, [settings.uiScale]);

  const pendingSettingsPatchRef = useRef<Partial<UserSettings>>({});
  const settingsFlushTimerRef = useRef<number | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const filterStateRef = useRef(filterState);
  filterStateRef.current = filterState;
  const feedContextRef = useRef({ section, isSearchMode });
  feedContextRef.current = { section, isSearchMode };

  const flushPendingSettings = useCallback(async () => {
    if (settingsFlushTimerRef.current !== null) {
      window.clearTimeout(settingsFlushTimerRef.current);
      settingsFlushTimerRef.current = null;
    }
    const patch = pendingSettingsPatchRef.current;
    if (Object.keys(patch).length === 0) return;
    pendingSettingsPatchRef.current = {};
    const next = await window.zhihuApi.updateSettings(patch);
    // Only sync back if no newer edits arrived while IPC was in flight
    if (Object.keys(pendingSettingsPatchRef.current).length === 0) {
      setSettings(next);
    }
  }, []);

  useEffect(() => {
    const onBeforeUnload = () => {
      void flushPendingSettings();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (settingsFlushTimerRef.current !== null) {
        window.clearTimeout(settingsFlushTimerRef.current);
      }
    };
  }, [flushPendingSettings]);

  const updateSettings = useCallback(
    async (patch: Partial<UserSettings>) => {
      const continuousKeys = new Set<keyof UserSettings>([
        'uiScale',
        'fontSize',
        'commentFontSize',
        'feedFontSize',
        'lineHeight',
        'readerWidth',
        'filterMinVotes',
      ]);
      const keys = Object.keys(patch) as (keyof UserSettings)[];
      const isSliderOnly = keys.length > 0 && keys.every((k) => continuousKeys.has(k));

      const merged = { ...settingsRef.current, ...patch };
      settingsRef.current = merged;
      setSettings(merged);

      // Apply stricter filter rules immediately to the currently displayed home feed
      if (
        !feedContextRef.current.isSearchMode &&
        feedContextRef.current.section === 'home' &&
        merged.filterEnabled &&
        ('filterEnabled' in patch ||
          'filterMinVotes' in patch ||
          'filterHideVideo' in patch ||
          'filterHidePaid' in patch)
      ) {
        const fs = filterStateRef.current;
        setItems((cur) =>
          cur.filter((item) => {
            if (merged.filterHideVideo && item.isVideo) return false;
            if (merged.filterHidePaid && item.isPaid) return false;
            if (merged.filterMinVotes > 0 && item.voteupCount < merged.filterMinVotes) return false;
            if (fs.blockedAuthors.includes(item.authorName)) return false;
            const hay = `${item.title} ${item.summary}`.toLowerCase();
            return !fs.keywords.some((kw) => hay.includes(kw.toLowerCase()));
          })
        );
      }

      pendingSettingsPatchRef.current = { ...pendingSettingsPatchRef.current, ...patch };
      if (isSliderOnly) {
        if (settingsFlushTimerRef.current !== null) window.clearTimeout(settingsFlushTimerRef.current);
        settingsFlushTimerRef.current = window.setTimeout(() => {
          void flushPendingSettings();
        }, 140);
      } else {
        await flushPendingSettings();
      }
    },
    [flushPendingSettings]
  );

  const loadCollectionItems = useCallback(async (colId: string, offset = 0) => {
    const reqId = ++listReqIdRef.current;
    setListError(null);
    setListLoading(true);
    if (offset === 0 && feedScrollRef.current) {
      feedScrollRef.current.scrollTop = 0;
    }
    try {
      const page = await window.zhihuApi.fetchCollectionItems(colId, offset);
      if (reqId !== listReqIdRef.current) return;
      setItems((prev) => (offset > 0 ? [...prev, ...page.items] : page.items));
      setHasMore(page.hasMore);
      setCollectionOffset(offset + 20);
      setNextUrl(page.nextUrl || null);
    } catch (err) {
      if (reqId !== listReqIdRef.current) return;
      setListError(formatErrorMessage(err, '加载收藏内容失败，请稍后重试。'));
    } finally {
      if (reqId === listReqIdRef.current) setListLoading(false);
    }
  }, []);

  const loadSection = useCallback(
    async (target: NavSection, append = false) => {
      const reqId = ++listReqIdRef.current;
      setIsSearchMode(false);
      setListError(null);
      setListLoading(true);
      if (!append && feedScrollRef.current) {
        feedScrollRef.current.scrollTop = 0;
      }
      try {
        if (target === 'history') {
          const hist = await window.zhihuApi.getHistory();
          if (reqId !== listReqIdRef.current) return;
          setHistoryList(hist);
          setVisitedKeys(new Set(hist.map((h) => h.key)));
          setHasMore(false);
          setNextUrl(null);
          return;
        }
        if (target === 'collections') {
          if (append && activeCollectionId) {
            const page = await window.zhihuApi.fetchCollectionItems(activeCollectionId, collectionOffset);
            if (reqId !== listReqIdRef.current) return;
            setItems((prev) => [...prev, ...page.items]);
            setHasMore(page.hasMore);
            setCollectionOffset((o) => o + 20);
            setNextUrl(page.nextUrl || null);
            return;
          }
          const cols = await window.zhihuApi.fetchCollections();
          if (reqId !== listReqIdRef.current) return;
          setCollections(cols);
          const colId =
            activeCollectionId && cols.some((c) => c.id === activeCollectionId)
              ? activeCollectionId
              : cols[0]?.id || null;
          setActiveCollectionId(colId);
          if (colId) {
            const page = await window.zhihuApi.fetchCollectionItems(colId, 0);
            if (reqId !== listReqIdRef.current) return;
            setItems(page.items);
            setHasMore(page.hasMore);
            setCollectionOffset(20);
            setNextUrl(page.nextUrl || null);
          } else {
            setItems([]);
            setHasMore(false);
            setCollectionOffset(0);
          }
          return;
        }

        const page =
          target === 'home'
            ? await window.zhihuApi.fetchHomeFeed(append ? nextUrl || undefined : undefined)
            : target === 'follow'
              ? await window.zhihuApi.fetchFollowFeed(append ? nextUrl || undefined : undefined)
              : await window.zhihuApi.fetchHotList();

        if (reqId !== listReqIdRef.current) return;
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setNextUrl(page.nextUrl || null);
        setHasMore(page.hasMore);
      } catch (err) {
        if (reqId !== listReqIdRef.current) return;
        setListError(formatErrorMessage(err, '加载内容失败，请稍后重试。'));
      } finally {
        if (reqId === listReqIdRef.current) setListLoading(false);
      }
    },
    [activeCollectionId, collectionOffset, nextUrl]
  );

  const runSearch = useCallback(async (query: string, appendOffset = 0) => {
    const q = query.trim();
    if (!q) return;
    const reqId = ++listReqIdRef.current;
    setActiveSearchQuery(q);
    setIsSearchMode(true);
    setListLoading(true);
    setListError(null);
    if (appendOffset === 0 && feedScrollRef.current) {
      feedScrollRef.current.scrollTop = 0;
    }
    try {
      const page = await window.zhihuApi.search(q, appendOffset);
      if (reqId !== listReqIdRef.current) return;
      setItems((prev) => (appendOffset > 0 ? [...prev, ...page.items] : page.items));
      setHasMore(page.hasMore);
      setSearchOffset(appendOffset + 20);
      setNextUrl(page.nextUrl || null);
    } catch (err) {
      if (reqId !== listReqIdRef.current) return;
      setListError(formatErrorMessage(err, '搜索失败，请稍后重试。'));
    } finally {
      if (reqId === listReqIdRef.current) setListLoading(false);
    }
  }, []);

  // Auto-load next feed/search/collection page when scrolling near bottom
  useEffect(() => {
    const sentinel = feedSentinelRef.current;
    const scroller = feedScrollRef.current;
    if (!sentinel || !scroller || !hasMore || listLoading || listError) return;
    if (!isSearchMode && section === 'history') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          if (isSearchMode && activeSearchQuery) {
            void runSearch(activeSearchQuery, searchOffset);
          } else {
            void loadSection(section, true);
          }
        }
      },
      { root: scroller, rootMargin: '0px 0px 240px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, listLoading, listError, isSearchMode, activeSearchQuery, searchOffset, section, runSearch, loadSection]);

  const cacheDetailSnapshot = useCallback((item: ArticleDetail, key?: string) => {
    const cache = detailCacheRef.current;
    const primaryKey = `${item.kind}:${item.id}`;
    if (cache.has(primaryKey)) cache.delete(primaryKey);
    cache.set(primaryKey, item);
    if (key && key !== primaryKey) {
      if (cache.has(key)) cache.delete(key);
      cache.set(key, item);
    }
    while (cache.size > 36) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
      else break;
    }
  }, []);

  const openDetail = useCallback(
    async (
      kind: ContentKind,
      id: string,
      key?: string,
      pushHistory = false,
      meta?: { title?: string; url?: string }
    ) => {
      const reqId = ++detailReqIdRef.current;
      const targetKey = key || `${kind}:${id}`;
      if (pushHistory && detail) {
        cacheDetailSnapshot(detail, activeKey || undefined);
        setBackStack((prev) => [
          ...prev.slice(-15),
          {
            kind: detail.kind,
            id: detail.id,
            key: activeKey || `${detail.kind}:${detail.id}`,
            title: detail.title,
            url: detail.url,
          },
        ]);
      } else if (!pushHistory) {
        setBackStack([]);
      }
      setActiveKey(targetKey);
      setPendingTarget({
        kind,
        id,
        title: meta?.title,
        url: meta?.url || buildFallbackUrl(kind, id),
      });
      setDetail(null);
      setVisitedKeys((prev) => {
        if (prev.has(targetKey)) return prev;
        const next = new Set(prev);
        next.add(targetKey);
        return next;
      });
      setDetailLoading(true);
      setDetailError(null);
      try {
        const res = await window.zhihuApi.fetchArticleDetail(kind, id);
        if (reqId !== detailReqIdRef.current) return;
        const enrichedRes =
          res.kind === 'question' && res.title === '知乎问题' && meta?.title
            ? { ...res, title: meta.title }
            : res;
        cacheDetailSnapshot(enrichedRes, targetKey);
        setDetail(enrichedRes);
      } catch (err) {
        if (reqId !== detailReqIdRef.current) return;
        setDetailError(formatErrorMessage(err, '加载正文失败，请稍后重试。'));
      } finally {
        if (reqId === detailReqIdRef.current) setDetailLoading(false);
      }
    },
    [detail, activeKey, cacheDetailSnapshot]
  );

  const effectiveLayoutMode = windowWidth < 760 ? 'single' : settings.layoutMode;

  useEffect(() => {
    if (effectiveLayoutMode !== 'split' && dragListWidth !== null) {
      setDragListWidth(null);
      document.body.style.cursor = '';
    }
  }, [effectiveLayoutMode, dragListWidth]);

  const handleNavigateBack = useCallback(() => {
    if (zenMode) {
      setZenMode(false);
      return;
    }
    if (backStack.length > 0) {
      const reqId = ++detailReqIdRef.current;
      const prev = backStack[backStack.length - 1];
      setBackStack((s) => s.slice(0, -1));
      setActiveKey(prev.key);
      setPendingTarget({ kind: prev.kind, id: prev.id, title: prev.title, url: prev.url });
      setDetailError(null);

      // Instant 0ms restore when returning to a recently viewed Question or Answer
      const cached =
        detailCacheRef.current.get(prev.key) || detailCacheRef.current.get(`${prev.kind}:${prev.id}`);
      if (cached) {
        setDetailLoading(false);
        setDetail(cached);
        return;
      }

      setDetail(null);
      setDetailLoading(true);
      window.zhihuApi
        .fetchArticleDetail(prev.kind, prev.id)
        .then((res) => {
          if (reqId === detailReqIdRef.current) {
            const enriched =
              res.kind === 'question' && res.title === '知乎问题' && prev.title
                ? { ...res, title: prev.title }
                : res;
            cacheDetailSnapshot(enriched, prev.key);
            setDetail(enriched);
          }
        })
        .catch((err) => {
          if (reqId === detailReqIdRef.current) {
            setDetailError(formatErrorMessage(err, '加载正文失败'));
          }
        })
        .finally(() => {
          if (reqId === detailReqIdRef.current) setDetailLoading(false);
        });
      return;
    }
    if (effectiveLayoutMode === 'single' && (detail || detailError || detailLoading)) {
      ++detailReqIdRef.current;
      setDetailLoading(false);
      setDetail(null);
      setDetailError(null);
      setPendingTarget(null);
      setActiveKey(null);
    }
  }, [zenMode, backStack, effectiveLayoutMode, detail, detailError, detailLoading, cacheDetailSnapshot]);

  // Keep fresh shortcut handlers via ref so Ctrl+R / Ctrl+F never read stale closures
  const shortcutHandlersRef = useRef({
    onFindInPage: () => {},
    onRefresh: () => {},
  });
  shortcutHandlersRef.current = {
    onFindInPage: () => {
      if (settingsOpen || searchModalOpen || clearHistoryConfirmOpen) return;
      setFindInPageSignal((n) => n + 1);
    },
    onRefresh: () => {
      const listVisible = !zenMode && (effectiveLayoutMode === 'split' || !(detail || detailLoading || detailError));
      if (!listVisible && pendingTarget) {
        void openDetail(pendingTarget.kind, pendingTarget.id, activeKey || undefined, false, pendingTarget);
        return;
      }
      if (isSearchMode && activeSearchQuery) {
        void runSearch(activeSearchQuery, 0);
      } else {
        void loadSection(section, false);
      }
    },
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, acc, fs, max, hist] = await Promise.all([
        window.zhihuApi.getSettings(),
        window.zhihuApi.getAccount(),
        window.zhihuApi.getFilterState(),
        window.zhihuApi.isWindowMaximized(),
        window.zhihuApi.getHistory(),
      ]);
      if (!alive) return;
      setSettings(s);
      setAccount(acc);
      setFilterState(fs);
      setIsMaximized(max);
      setHistoryList(hist);
      setVisitedKeys(new Set(hist.map((h) => h.key)));
      const initialSection = s.defaultSection || 'home';
      setSection(initialSection);
      void loadSection(initialSection, false);
    })();

    const offWin = window.zhihuApi.onWindowStateChange((st) => setIsMaximized(st.isMaximized));
    const offShortcut = window.zhihuApi.onShortcut((action) => {
      if (action === 'open-settings') setSettingsOpen(true);
      else if (action === 'open-search') setSearchModalOpen(true);
      else if (action === 'find-in-page') shortcutHandlersRef.current.onFindInPage();
      else if (action === 'refresh') shortcutHandlersRef.current.onRefresh();
      else if (action === 'zoom-reset') {
        void updateSettings({ uiScale: 1 });
        showToast('已重置缩放至 100%');
      } else if (action === 'zoom-in') {
        setSettings((cur) => {
          const next = Math.min(1.35, +(cur.uiScale + 0.05).toFixed(2));
          void window.zhihuApi.updateSettings({ uiScale: next });
          showToast(`界面缩放 ${Math.round(next * 100)}%`);
          return { ...cur, uiScale: next };
        });
      } else if (action === 'zoom-out') {
        setSettings((cur) => {
          const next = Math.max(0.8, +(cur.uiScale - 0.05).toFixed(2));
          void window.zhihuApi.updateSettings({ uiScale: next });
          showToast(`界面缩放 ${Math.round(next * 100)}%`);
          return { ...cur, uiScale: next };
        });
      }
    });

    return () => {
      alive = false;
      offWin();
      offShortcut();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredHistory = historyList.filter(
    (h) =>
      !historyFilter.trim() ||
      h.title.toLowerCase().includes(historyFilter.toLowerCase()) ||
      h.authorName.toLowerCase().includes(historyFilter.toLowerCase())
  );

  // Single-key shortcuts & Alt+ArrowLeft back
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        if (searchModalOpen) {
          e.preventDefault();
          setSearchModalOpen(false);
          return;
        }
        if (settingsOpen) {
          e.preventDefault();
          setSettingsOpen(false);
          return;
        }
        if (zenMode) {
          e.preventDefault();
          setZenMode(false);
          return;
        }
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        handleNavigateBack();
        return;
      }
      if (
        !settings.singleKeyShortcuts ||
        settingsOpen ||
        searchModalOpen ||
        clearHistoryConfirmOpen ||
        document.querySelector('[role="dialog"], [data-overlay="lightbox"]')
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const activeEl = document.activeElement as HTMLElement | null;
      const tag = activeEl?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || activeEl?.isContentEditable) return;

      if (e.key === 'f' || e.key === 'F') {
        if (detail) {
          e.preventDefault();
          setZenMode((z) => !z);
        }
      } else if (e.key === 'c' || e.key === 'C') {
        if (detail) {
          e.preventDefault();
          setCommentJumpSignal((n) => n + 1);
        }
      } else if (e.key === 'j' || e.key === 'J' || e.key === 'k' || e.key === 'K') {
        const activeList = !isSearchMode && section === 'history' ? filteredHistory : items;
        if (activeList.length === 0) return;
        e.preventDefault();
        const curIdx = activeList.findIndex((i) => i.key === activeKey);
        const delta = e.key === 'j' || e.key === 'J' ? 1 : -1;
        const nextIdx = Math.max(0, Math.min(activeList.length - 1, curIdx < 0 ? 0 : curIdx + delta));
        const target = activeList[nextIdx];
        if (target) {
          void openDetail(target.kind, target.id, target.key, false, { title: target.title, url: target.url });
          document.querySelector(`[data-list-key="${CSS.escape(target.key)}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    settings.singleKeyShortcuts,
    settingsOpen,
    searchModalOpen,
    clearHistoryConfirmOpen,
    zenMode,
    detail,
    isSearchMode,
    section,
    filteredHistory,
    items,
    activeKey,
    openDetail,
    handleNavigateBack,
  ]);

  const handleLogin = async () => {
    const res = await window.zhihuApi.openWebLogin();
    if (res.ok && res.account) {
      setAccount(res.account);
      showToast(`已登录：${res.account.name}`);
      if (detailError && pendingTarget) {
        void openDetail(pendingTarget.kind, pendingTarget.id, activeKey || undefined, false, pendingTarget);
      } else {
        void loadSection(section, false);
      }
    }
  };

  const handleLogout = async () => {
    const acc = await window.zhihuApi.logout();
    setAccount(acc);
    showToast('已退出知乎账号');
  };

  const handleVote = async (action: 'up' | 'down' | 'neutral') => {
    if (!detail) return;
    if (!account.loggedIn) {
      showToast('请先登录知乎账号', '登录知乎账号', () => void handleLogin());
      return;
    }
    try {
      const res = await window.zhihuApi.voteContent(detail.kind, detail.id, action);
      setDetail((prev) => (prev ? { ...prev, voteupCount: res.voteupCount, voting: res.voting } : prev));
      showToast(action === 'up' ? '已赞同' : action === 'down' ? '已标记反对' : '已取消表态');
    } catch (err) {
      showToast(formatErrorMessage(err, '操作失败，请稍后重试'));
    }
  };

  const hasActiveReaderView = Boolean(detail || detailLoading || detailError);
  const showListPane = !zenMode && (effectiveLayoutMode === 'split' || !hasActiveReaderView);
  const showReaderPane = zenMode || effectiveLayoutMode === 'split' || hasActiveReaderView;
  const canGoBack = zenMode || backStack.length > 0 || (effectiveLayoutMode === 'single' && hasActiveReaderView);

  const rawListWidth = dragListWidth ?? settings.listWidth ?? 336;
  const effectiveListWidth = windowWidth < 960 ? Math.min(rawListWidth, 280) : rawListWidth;
  const railExpanded = !settings.sidebarCollapsed && windowWidth >= 680;

  const navItems: { id: NavSection; label: string; icon: React.ReactNode }[] = [
    { id: 'home', label: '推荐', icon: <Home className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} /> },
    { id: 'follow', label: '关注', icon: <Users className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} /> },
    { id: 'hot', label: '热榜', icon: <Flame className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} /> },
    { id: 'collections', label: '收藏', icon: <Bookmark className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} /> },
    { id: 'history', label: '足迹', icon: <Clock className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} /> },
  ];

  const emptyFeedHint = isSearchMode
    ? `未找到与「${activeSearchQuery}」相关的内容，试试换个关键词`
    : !account.loggedIn && section === 'follow'
      ? '登录后即可同步你关注的答主最新动态'
      : !account.loggedIn && section === 'collections'
        ? '登录后即可查看与阅读你的知乎收藏夹'
        : section === 'collections'
          ? '该收藏夹下暂时没有内容'
          : '暂无可显示的内容';

  const anyModalOpen = settingsOpen || searchModalOpen || clearHistoryConfirmOpen;

  return (
    <div className="flex h-full overflow-hidden select-none" style={{ background: 'var(--bg-frame)' }}>
      {/* Column 1: Straight-to-top Narrow Navigation Rail (kept mounted for smooth width & zen transitions) */}
      <aside
        data-collapsed={zenMode ? 'true' : undefined}
        aria-hidden={zenMode || anyModalOpen || undefined}
        inert={zenMode || anyModalOpen || undefined}
        className="shell-pane h-full shrink-0"
        style={{
          width: railExpanded ? '152px' : '54px',
          background: 'var(--bg-frame)',
        }}
      >
        <div className="flex h-full flex-col justify-between px-2 pb-2.5 pt-1.5">
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Top Brand (always jumps back to Home top) + Drag Area */}
            <div className="app-drag mb-1.5 flex h-9 shrink-0 items-center px-0.5">
              <button
                type="button"
                title="回到推荐顶部"
                onClick={() => {
                  setSection('home');
                  void loadSection('home', false);
                }}
                className={`app-no-drag flex items-center gap-2 whitespace-nowrap rounded-lg py-1 hover:opacity-90 ${
                  railExpanded ? 'px-1' : 'mx-auto justify-center'
                }`}
              >
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-xs font-bold text-white shadow-xs"
                  style={{ background: 'var(--accent)' }}
                >
                  知
                </div>
                {railExpanded && <span className="truncate text-sm font-semibold tracking-tight">知乎</span>}
              </button>
            </div>

            {/* Search / Ctrl+K Trigger */}
            <div className="mb-2 shrink-0">
              <button
                type="button"
                title="全局搜索或粘贴知乎链接直达 (Ctrl+K)"
                onClick={() => setSearchModalOpen(true)}
                className={`app-no-drag flex h-8 w-full items-center whitespace-nowrap rounded-lg border text-xs hover:bg-[var(--bg-hover)] ${
                  railExpanded ? 'justify-between px-2.5' : 'justify-center px-0'
                }`}
                style={{
                  borderColor: 'var(--border-color)',
                  background: 'color-mix(in srgb, var(--text-main) 3%, transparent)',
                  color: 'var(--text-muted)',
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.85} />
                  {railExpanded && <span className="truncate">搜索或跳转...</span>}
                </span>
                {railExpanded && (
                  <kbd
                    className="shrink-0 rounded px-1 py-0.5 font-mono text-[10px] leading-none"
                    style={{ background: 'var(--bg-frame)', color: 'var(--text-muted)' }}
                  >
                    Ctrl+K
                  </kbd>
                )}
              </button>
            </div>

            {/* Primary Navigation */}
            <nav className="scroll-area flex-1 space-y-1">
              {navItems.map((nav) => {
                const active = !isSearchMode && section === nav.id;
                return (
                  <button
                    key={nav.id}
                    type="button"
                    title={railExpanded ? undefined : nav.label}
                    onClick={() => {
                      setSection(nav.id);
                      void loadSection(nav.id, false);
                    }}
                    className={`app-no-drag flex h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-xl text-[13px] font-medium ${
                      railExpanded ? 'px-2.5' : 'justify-center px-0'
                    } ${active ? 'tactile-list-active' : 'hover:bg-[var(--bg-hover)]'}`}
                    style={{
                      color: active ? 'var(--text-main)' : 'var(--text-muted)',
                    }}
                  >
                    <span style={{ color: active ? 'var(--accent)' : 'inherit' }}>{nav.icon}</span>
                    {railExpanded && <span className="truncate">{nav.label}</span>}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Bottom Rail Controls: Fixed-position Expand/Collapse + Theme + Settings + Account */}
          <div
            className="flex shrink-0 flex-col gap-1 border-t pt-2"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {windowWidth >= 680 && (
              <button
                type="button"
                title={railExpanded ? '收起侧栏文字标签' : '展开侧栏文字标签'}
                onClick={() => void updateSettings({ sidebarCollapsed: railExpanded })}
                className={`app-no-drag flex h-8 items-center gap-2 whitespace-nowrap rounded-lg text-xs hover:bg-[var(--bg-hover)] ${
                  railExpanded ? 'w-full px-2.5' : 'mx-auto w-8 justify-center'
                }`}
                style={{ color: 'var(--text-muted)' }}
              >
                {railExpanded ? (
                  <>
                    <PanelLeftClose className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    <span className="truncate">收起侧栏</span>
                  </>
                ) : (
                  <PanelLeftOpen className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                )}
              </button>
            )}

            <div className={`flex items-center ${railExpanded ? 'justify-between px-1' : 'flex-col gap-1'}`}>
              <button
                type="button"
                title={isDarkResolved ? '切换为浅色外观' : '切换为深色外观'}
                onClick={() => void updateSettings({ themeMode: isDarkResolved ? 'light' : 'dark' })}
                className="app-no-drag flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--bg-hover)]"
                style={{ color: 'var(--text-muted)' }}
              >
                {isDarkResolved ? (
                  <Sun className="h-4 w-4" strokeWidth={1.75} />
                ) : (
                  <Moon className="h-4 w-4" strokeWidth={1.75} />
                )}
              </button>

              <button
                type="button"
                title="偏好设置 (Ctrl+,)"
                onClick={() => setSettingsOpen(true)}
                className="app-no-drag flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--bg-hover)]"
                style={{ color: 'var(--text-muted)' }}
              >
                <Settings className="h-4 w-4" strokeWidth={1.75} />
              </button>

              {account.loggedIn ? (
                <button
                  type="button"
                  title={account.urlToken ? `${account.name} · 查看我的主页` : `${account.name} · 账号与设置`}
                  onClick={() => {
                    if (account.urlToken) {
                      void openDetail('user', account.urlToken, `user:${account.urlToken}`, Boolean(detail), {
                        title: account.name || account.urlToken,
                        url: `https://www.zhihu.com/people/${encodeURIComponent(account.urlToken)}`,
                      });
                    } else {
                      setSettingsOpen(true);
                    }
                  }}
                  className="app-no-drag flex h-8 w-8 items-center justify-center rounded-full hover:ring-2 hover:ring-[var(--accent)]"
                >
                  {account.avatarUrl ? (
                    <img
                      src={account.avatarUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-6 w-6 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className="flex h-6 w-6 items-center justify-center rounded-full"
                      style={{ background: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                    >
                      <User className="h-3.5 w-3.5" strokeWidth={1.9} />
                    </div>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  title="登录知乎账号"
                  onClick={() => void handleLogin()}
                  className="app-no-drag flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--bg-hover)]"
                  style={{ color: 'var(--accent)' }}
                >
                  <LogIn className="h-4 w-4" strokeWidth={1.8} />
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Workspace Sheet Container (Middle List + Right Reader) */}
      <div
        ref={workspaceRef}
        aria-hidden={anyModalOpen || undefined}
        inert={anyModalOpen || undefined}
        className={`workspace-sheet relative flex min-h-0 min-w-0 flex-1 overflow-hidden ${!zenMode ? 'inset-workspace-sheet' : ''}`}
        style={{ background: 'var(--bg-paper)' }}
      >
        {/* Column 2: Middle Feed / Collections / History List */}
        {(effectiveLayoutMode === 'split' || showListPane) && (
          <section
            data-collapsed={effectiveLayoutMode === 'split' && zenMode ? 'true' : undefined}
            data-dragging={dragListWidth !== null ? 'true' : undefined}
            aria-hidden={effectiveLayoutMode === 'split' && zenMode ? true : undefined}
            inert={effectiveLayoutMode === 'split' && zenMode ? true : undefined}
            className="shell-pane relative h-full shrink-0 border-r"
            style={{
              width: effectiveLayoutMode === 'split' ? `${effectiveListWidth}px` : '100%',
              background: 'var(--bg-list)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div
              className="flex h-full flex-col"
              style={{ width: effectiveLayoutMode === 'split' ? `${effectiveListWidth}px` : '100%' }}
            >
            {/* Middle Column Top Bar */}
            <header
              className="app-drag flex h-10 shrink-0 items-center justify-between border-b px-3.5"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                {isSearchMode ? (
                  <>
                    <button
                      type="button"
                      title="点击修改搜索词 (Ctrl+K)"
                      onClick={() => setSearchModalOpen(true)}
                      className="app-no-drag inline-flex max-w-[200px] items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs hover:bg-[var(--bg-hover)]"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <Search className="h-3 w-3 shrink-0" style={{ color: 'var(--accent)' }} />
                      <span className="truncate font-medium">{activeSearchQuery}</span>
                      <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                        · 改词
                      </span>
                    </button>
                    <button
                      type="button"
                      title="退出搜索返回栏目"
                      onClick={() => void loadSection(section, false)}
                      className="app-no-drag rounded-md p-1 hover:bg-[var(--bg-hover)]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <span className="text-[13px] font-semibold tracking-tight">
                    {navItems.find((n) => n.id === section)?.label || '推荐'}
                  </span>
                )}
              </div>

              <div className="app-no-drag flex shrink-0 items-center gap-0.5">
                {!isSearchMode && section === 'history' && historyList.length > 0 && (
                  <button
                    type="button"
                    title="清空本地阅读足迹"
                    onClick={() => setClearHistoryConfirmOpen(true)}
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    清空
                  </button>
                )}

                <button
                  type="button"
                  title="刷新当前列表 (Ctrl+R)"
                  onClick={() =>
                    isSearchMode && activeSearchQuery
                      ? void runSearch(activeSearchQuery, 0)
                      : void loadSection(section, false)
                  }
                  className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--bg-hover)]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${listLoading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
                </button>

                {!showReaderPane && <WindowControls isMaximized={isMaximized} showDivider />}
              </div>
            </header>

            {!isSearchMode && section === 'collections' && collections.length > 0 && (
              <div
                className="flex gap-1.5 overflow-x-auto border-b px-3 py-2 text-xs"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                {collections.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setActiveCollectionId(c.id);
                      void loadCollectionItems(c.id, 0);
                    }}
                    className="shrink-0 rounded-full px-2.5 py-1 font-medium"
                    style={{
                      background: activeCollectionId === c.id ? 'var(--accent)' : 'var(--bg-subtle)',
                      color: activeCollectionId === c.id ? '#fff' : 'var(--text-main)',
                    }}
                  >
                    {c.title} ({c.itemCount})
                  </button>
                ))}
              </div>
            )}

            {!isSearchMode && section === 'history' && historyList.length > 0 && (
              <div className="border-b px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
                <input
                  value={historyFilter}
                  onChange={(e) => setHistoryFilter(e.target.value)}
                  placeholder="筛选足迹标题或作者..."
                  className="w-full rounded-lg border px-2.5 py-1 text-xs outline-none"
                  style={{ background: 'var(--bg-paper)', borderColor: 'var(--border-color)' }}
                />
              </div>
            )}

            {/* List Body */}
            <div ref={feedScrollRef} className="scroll-area flex-1 py-1.5">
              {listError && items.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-5 py-14 text-center text-xs">
                  <div style={{ color: 'var(--text-muted)' }}>{listError}</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        isSearchMode && activeSearchQuery
                          ? void runSearch(activeSearchQuery, 0)
                          : void loadSection(section, false)
                      }
                      className="rounded-lg border px-3 py-1.5 hover:bg-[var(--bg-hover)]"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      重试
                    </button>
                    {!account.loggedIn && (
                      <button
                        type="button"
                        onClick={() => void handleLogin()}
                        className="rounded-lg px-3 py-1.5 text-white"
                        style={{ background: 'var(--accent)' }}
                      >
                        登录知乎账号
                      </button>
                    )}
                  </div>
                </div>
              ) : listLoading && items.length === 0 && (isSearchMode || section !== 'history') ? (
                <div className="space-y-1 px-2 py-1" role="status" aria-label="正在获取内容">
                  {[0, 1, 2, 3, 4].map((idx) => (
                    <div key={idx} className="rounded-xl px-3 py-3">
                      <div className="skeleton-shimmer h-3.5 w-11/12 rounded-md" />
                      <div className="skeleton-shimmer mt-2 h-3.5 w-3/4 rounded-md" />
                      <div className="skeleton-shimmer mt-2.5 h-3 w-full rounded-md opacity-75" />
                      <div className="mt-2.5 flex items-center gap-2.5">
                        <div className="skeleton-shimmer h-2.5 w-16 rounded-md opacity-70" />
                        <div className="skeleton-shimmer h-2.5 w-10 rounded-md opacity-60" />
                        <div className="skeleton-shimmer h-2.5 w-10 rounded-md opacity-60" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : !isSearchMode && section === 'history' ? (
                filteredHistory.length === 0 ? (
                  <div className="content-enter py-16 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                    {historyFilter.trim() ? '未找到匹配的阅读足迹' : '暂无阅读足迹，读过的内容会自动记录在这里'}
                  </div>
                ) : (
                  <div key="history-list" className="content-enter space-y-0.5 px-2">
                    {filteredHistory.map((h) => {
                      const selected = activeKey === h.key;
                      return (
                        <button
                          key={h.key}
                          type="button"
                          data-list-key={h.key}
                          onClick={() =>
                            void openDetail(h.kind, h.id, h.key, false, { title: h.title, url: h.url })
                          }
                          className={`feed-card w-full rounded-xl px-3 py-2.5 text-left ${
                            selected ? 'tactile-list-active' : 'hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          <div className="line-clamp-2 text-feed-title font-semibold">{h.title}</div>
                          {h.summary && (
                            <div
                              className="mt-1 line-clamp-2 text-feed-summary"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              {h.summary}
                            </div>
                          )}
                          <div className="mt-1.5 text-feed-meta" style={{ color: 'var(--text-muted)' }}>
                            {h.authorName}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )
              ) : items.length === 0 ? (
                <div
                  className="content-enter flex flex-col items-center gap-3 px-6 py-16 text-center text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <span className="leading-relaxed">{emptyFeedHint}</span>
                  {!account.loggedIn && !isSearchMode && (
                    <button
                      type="button"
                      onClick={() => void handleLogin()}
                      className="rounded-lg px-3.5 py-1.5 font-medium text-white"
                      style={{ background: 'var(--accent)' }}
                    >
                      登录知乎账号
                    </button>
                  )}
                </div>
              ) : (
                <div
                  key={isSearchMode ? `search:${activeSearchQuery}` : `${section}:${activeCollectionId || ''}`}
                  className="content-enter space-y-0.5 px-2"
                >
                  {items.map((item, idx) => {
                    const selected = activeKey === item.key;
                    const visited = !selected && visitedKeys.has(item.key);
                    const isHotRank = !isSearchMode && section === 'hot';
                    return (
                      <div
                        key={`${item.key}-${idx}`}
                        role="button"
                        tabIndex={0}
                        data-list-key={item.key}
                        onClick={() =>
                          void openDetail(item.kind, item.id, item.key, false, {
                            title: item.title,
                            url: item.url,
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            void openDetail(item.kind, item.id, item.key, false, {
                              title: item.title,
                              url: item.url,
                            });
                          }
                        }}
                        className={`feed-card w-full cursor-pointer rounded-xl px-3 py-2.5 text-left ${
                          selected ? 'tactile-list-active' : 'hover:bg-[var(--bg-hover)]'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          {isHotRank && (
                            <span
                              className="mt-0.5 w-5 shrink-0 font-mono text-feed-summary font-bold tabular-nums"
                              style={{ color: idx < 3 ? '#ea580c' : 'var(--text-faint)' }}
                            >
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <h3
                              className="line-clamp-2 text-feed-title font-semibold"
                              style={{ color: visited ? 'var(--text-muted)' : 'var(--text-main)' }}
                            >
                              {item.title}
                            </h3>
                            {item.summary && (
                              <p
                                className="mt-1 line-clamp-2 text-feed-summary"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                {item.summary}
                              </p>
                            )}
                            <div
                              className="mt-1.5 flex items-center gap-2.5 text-feed-meta"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              {item.authorUrlToken ? (
                                <button
                                  type="button"
                                  title={`查看 ${item.authorName} 的主页`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void openDetail('user', item.authorUrlToken!, `user:${item.authorUrlToken}`, true, {
                                      title: item.authorName,
                                      url: `https://www.zhihu.com/people/${encodeURIComponent(item.authorUrlToken!)}`,
                                    });
                                  }}
                                  className="max-w-[128px] truncate hover:text-[var(--accent)] hover:underline"
                                >
                                  {item.authorName}
                                </button>
                              ) : (
                                <span className="max-w-[128px] truncate">{item.authorName}</span>
                              )}
                              {item.hotMetrics ? (
                                <span className="truncate">{item.hotMetrics}</span>
                              ) : (
                                <>
                                  {item.voteupCount > 0 && (
                                    <span className="inline-flex items-center gap-0.5 tabular-nums">
                                      <ThumbsUp className="h-3 w-3" strokeWidth={1.75} />
                                      {formatCount(item.voteupCount)}
                                    </span>
                                  )}
                                  {item.commentCount > 0 && (
                                    <span className="inline-flex items-center gap-0.5 tabular-nums">
                                      <MessageSquare className="h-3 w-3" strokeWidth={1.75} />
                                      {formatCount(item.commentCount)}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          {settings.showThumbnails && item.thumbnailUrl && (
                            <img
                              src={item.thumbnailUrl}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              className="mt-0.5 h-[52px] w-[52px] shrink-0 rounded-md object-cover"
                              style={{ background: 'var(--bg-subtle)' }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {hasMore && (
                    <div ref={feedSentinelRef} className="py-2.5 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                      {listError ? (
                        <button
                          type="button"
                          onClick={() =>
                            isSearchMode && activeSearchQuery
                              ? void runSearch(activeSearchQuery, searchOffset)
                              : void loadSection(section, true)
                          }
                          className="rounded-lg border px-3 py-1 hover:bg-[var(--bg-hover)]"
                          style={{ borderColor: 'var(--border-color)' }}
                        >
                          加载失败，点击重试
                        </button>
                      ) : listLoading ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          正在加载更多...
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Vertical Drag Resize Handle (split mode only) */}
            {effectiveLayoutMode === 'split' && (
              <div
                role="separator"
                aria-orientation="vertical"
                title="左右拖拽调节列表栏宽（双击归位 336px）"
                onDoubleClick={() => {
                  setDragListWidth(null);
                  void updateSettings({ listWidth: 336 });
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  document.body.style.cursor = 'col-resize';
                  setDragListWidth(effectiveListWidth);
                }}
                onPointerMove={(e) => {
                  if (dragListWidth === null || !workspaceRef.current) return;
                  const rect = workspaceRef.current.getBoundingClientRect();
                  const maxAllowed = windowWidth < 960 ? 280 : 480;
                  const next = Math.min(maxAllowed, Math.max(260, Math.round(e.clientX - rect.left)));
                  setDragListWidth(next);
                }}
                onPointerUp={(e) => {
                  if (dragListWidth !== null) {
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                      e.currentTarget.releasePointerCapture(e.pointerId);
                    }
                    document.body.style.cursor = '';
                    const committed = dragListWidth;
                    setDragListWidth(null);
                    void updateSettings({ listWidth: committed });
                  }
                }}
                onPointerCancel={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                  document.body.style.cursor = '';
                  setDragListWidth(null);
                }}
                data-dragging={dragListWidth !== null ? 'true' : undefined}
                className="app-no-drag resize-sash"
              />
            )}
            </div>
          </section>
        )}

        {/* Column 3: Right Reader Pane */}
        {showReaderPane && (
          <main className="min-w-0 flex-1 overflow-hidden">
            <ReaderPane
              detail={detail}
              pendingTarget={pendingTarget}
              loading={detailLoading}
              error={detailError}
              settings={settings}
              account={account}
              isDarkResolved={isDarkResolved}
              isMaximized={isMaximized}
              zenMode={zenMode}
              isAuthorBlocked={Boolean(detail && filterState.blockedAuthors.includes(detail.authorName))}
              visitedKeys={visitedKeys}
              commentJumpSignal={commentJumpSignal}
              findInPageSignal={findInPageSignal}
              onToggleZen={() => setZenMode((z) => !z)}
              onBack={canGoBack ? handleNavigateBack : undefined}
              onRetry={() => {
                if (pendingTarget) {
                  void openDetail(pendingTarget.kind, pendingTarget.id, activeKey || undefined, false, pendingTarget);
                }
              }}
              onUpdateSettings={updateSettings}
              onOpenDetail={(kind, id, meta) => void openDetail(kind, id, `${kind}:${id}`, true, meta)}
              onLogin={handleLogin}
              onToast={showToast}
              onVote={handleVote}
              onCommentCountDelta={(delta) => {
                setDetail((prev) =>
                  prev ? { ...prev, commentCount: Math.max(0, prev.commentCount + delta) } : prev
                );
              }}
              onBlockAuthor={async (author) => {
                const indexedRemoved = items
                  .map((item, index) => ({ item, index }))
                  .filter((entry) => entry.item.authorName === author);
                const next = await window.zhihuApi.addBlockedAuthor(author);
                setFilterState(next);
                setItems((prev) => prev.filter((i) => i.authorName !== author));
                showToast(`已屏蔽作者「${author}」`, '撤销', async () => {
                  const restored = await window.zhihuApi.removeBlockedAuthor(author);
                  setFilterState(restored);
                  if (indexedRemoved.length > 0) {
                    setItems((prev) => {
                      const existingKeys = new Set(prev.map((x) => x.key));
                      const copy = [...prev];
                      for (const { item, index } of indexedRemoved) {
                        if (!existingKeys.has(item.key)) {
                          copy.splice(Math.min(index, copy.length), 0, item);
                          existingKeys.add(item.key);
                        }
                      }
                      return copy;
                    });
                  }
                  showToast(`已取消屏蔽「${author}」`);
                });
              }}
              onUnblockAuthor={async (author) => {
                const next = await window.zhihuApi.removeBlockedAuthor(author);
                setFilterState(next);
                showToast(`已取消屏蔽「${author}」`);
              }}
            />
          </main>
        )}
      </div>

      {/* Ctrl+K Search / Direct Link Palette */}
      <SearchModal
        open={searchModalOpen}
        initialQuery={isSearchMode ? activeSearchQuery : ''}
        onClose={() => setSearchModalOpen(false)}
        onSearch={(q) => void runSearch(q, 0)}
        onOpenDirect={(kind, id) => void openDetail(kind, id, `${kind}:${id}`, true)}
        onJumpSection={(sec) => {
          setSection(sec);
          void loadSection(sec, false);
        }}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={updateSettings}
        onResetSettings={async () => {
          const next = await window.zhihuApi.resetSettings();
          setSettings(next);
          showToast('已恢复默认设置');
        }}
        account={account}
        onLogin={handleLogin}
        onLogout={handleLogout}
        filterState={filterState}
        onAddKeyword={async (kw) => {
          setFilterState(await window.zhihuApi.addFilterKeyword(kw));
          if (settings.filterEnabled && section === 'home' && !isSearchMode) {
            const lower = kw.toLowerCase();
            setItems((prev) =>
              prev.filter((item) => !`${item.title} ${item.summary}`.toLowerCase().includes(lower))
            );
          }
          showToast(`已屏蔽关键词：${kw}`);
        }}
        onRemoveKeyword={async (kw) => {
          setFilterState(await window.zhihuApi.removeFilterKeyword(kw));
          showToast(`已移除关键词：${kw}`);
        }}
        onRemoveAuthor={async (author) => {
          setFilterState(await window.zhihuApi.removeBlockedAuthor(author));
          showToast(`已取消屏蔽：${author}`);
        }}
        onClearSeen={async () => {
          setFilterState(await window.zhihuApi.clearSeen());
          showToast('已清空去重记录');
        }}
      />

      {/* Non-blocking Confirm Dialog for Clear History */}
      <ConfirmDialog
        open={clearHistoryConfirmOpen}
        title="清空本地阅读足迹？"
        description="将清空本机保存的所有历史阅读记录，清空后无法恢复。"
        confirmLabel="清空足迹"
        onConfirm={async () => {
          setClearHistoryConfirmOpen(false);
          await window.zhihuApi.clearHistory();
          setHistoryList([]);
          setVisitedKeys(new Set());
          showToast('已清空本地阅读足迹');
        }}
        onCancel={() => setClearHistoryConfirmOpen(false)}
      />

      {/* Non-blocking Toast with optional Undo action */}
      {toastPresence.mounted && activeToast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div
            data-motion={toastPresence.state}
            aria-hidden={!toast || undefined}
            inert={!toast || undefined}
            className={`motion-toast tactile-pill flex items-center gap-2.5 rounded-full px-4 py-1.5 text-xs font-medium ${
              toast && activeToast.onAction ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
          >
            <span>{activeToast.message}</span>
            {activeToast.actionLabel && activeToast.onAction && (
              <button
                type="button"
                onClick={() => {
                  if (toastTimer.current) {
                    window.clearTimeout(toastTimer.current);
                    toastTimer.current = null;
                  }
                  const fn = activeToast.onAction;
                  setToast(null);
                  fn?.();
                }}
                className="rounded-full px-2 py-0.5 font-semibold hover:bg-[var(--bg-hover)]"
                style={{ color: 'var(--accent)' }}
              >
                {activeToast.actionLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
