import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Link2,
  List,
  Loader2,
  LogIn,
  Maximize2,
  MessageCircle,
  MessageSquare,
  Minimize2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Send,
  Share2,
  Smile,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Type,
  UserX,
  X,
} from 'lucide-react';
import type {
  AccountInfo,
  ArticleDetail,
  CommentItem,
  CommentsPage,
  ContentKind,
  FeedItem,
  FontPreset,
  QuestionAnswerSummary,
  UserContentTab,
  UserSettings,
} from '@shared/types';
import { PICKER_EMOTICON_KEYS, ZHIHU_EMOTICONS } from '@/utils/emojis';
import {
  articleToMarkdown,
  formatCount,
  formatErrorMessage,
  formatShortTime,
  formatTime,
  parseZhihuLink,
  resolveCommentFontStack,
  resolveFontStack,
  sanitizeZhihuHtml,
} from '@/utils/format';
import { prefersReducedMotion, usePresence } from '@/utils/usePresence';
import { ConfirmDialog } from './ConfirmDialog';
import { WindowControls } from './WindowControls';

// Session-scoped caches: preserve unsent comment drafts, reading scroll positions & loaded question answers
const commentDraftStore = new Map<string, string>();
const readingScrollStore = new Map<string, number>();
const questionAnswersStore = new Map<
  string,
  { items: QuestionAnswerSummary[]; total: number; hasMore: boolean; nextOffset: number }
>();
const userContentStore = new Map<
  string,
  { items: FeedItem[]; hasMore: boolean; nextOffset: number }
>();
const userActiveTabStore = new Map<string, UserContentTab>();

interface ExpandedChildState {
  items: CommentItem[];
  nextUrl: string | null;
  hasMore: boolean;
}

interface Props {
  detail: ArticleDetail | null;
  pendingTarget?: { kind: ContentKind; id: string; title?: string; url?: string } | null;
  loading: boolean;
  error: string | null;
  settings: UserSettings;
  account: AccountInfo;
  isDarkResolved: boolean;
  isMaximized: boolean;
  zenMode: boolean;
  isAuthorBlocked?: boolean;
  visitedKeys?: Set<string>;
  commentJumpSignal: number;
  findInPageSignal: number;
  onToggleZen: () => void;
  onBack?: () => void;
  onRetry?: () => void;
  onUpdateSettings: (patch: Partial<UserSettings>) => void;
  onOpenDetail: (kind: ContentKind, id: string, meta?: { title?: string; url?: string }) => void;
  onLogin: () => void;
  onToast: (msg: string, actionLabel?: string, onAction?: () => void) => void;
  onVote: (action: 'up' | 'down' | 'neutral') => Promise<void>;
  onCommentCountDelta?: (delta: number) => void;
  onBlockAuthor: (author: string) => void;
  onUnblockAuthor?: (author: string) => void;
}

function clearFindMarks(container: HTMLElement): void {
  const marks = container.querySelectorAll('mark.zhihu-find-hit');
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
      parent.normalize();
    }
  });
}

function applyFindMarks(container: HTMLElement, keyword: string): HTMLElement[] {
  clearFindMarks(container);
  const q = keyword.trim().toLowerCase();
  if (!q) return [];

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (
      parent &&
      parent.tagName !== 'SCRIPT' &&
      parent.tagName !== 'STYLE' &&
      !parent.closest('.katex') &&
      !parent.closest('.zhihu-copy-code-btn') &&
      (node.nodeValue || '').toLowerCase().includes(q)
    ) {
      textNodes.push(node as Text);
    }
    node = walker.nextNode();
  }

  const hits: HTMLElement[] = [];
  for (const tNode of textNodes) {
    const raw = tNode.nodeValue || '';
    const lower = raw.toLowerCase();
    const frag = document.createDocumentFragment();
    let last = 0;
    let idx = lower.indexOf(q, last);
    while (idx !== -1) {
      if (idx > last) frag.appendChild(document.createTextNode(raw.slice(last, idx)));
      const mark = document.createElement('mark');
      mark.className = 'zhihu-find-hit';
      mark.textContent = raw.slice(idx, idx + q.length);
      frag.appendChild(mark);
      hits.push(mark);
      last = idx + q.length;
      idx = lower.indexOf(q, last);
    }
    if (last < raw.length) frag.appendChild(document.createTextNode(raw.slice(last)));
    tNode.parentNode?.replaceChild(frag, tNode);
  }
  return hits;
}

export const ReaderPane: React.FC<Props> = ({
  detail,
  pendingTarget,
  loading,
  error,
  settings,
  account,
  isDarkResolved,
  isMaximized,
  zenMode,
  isAuthorBlocked = false,
  visitedKeys,
  commentJumpSignal,
  findInPageSignal,
  onToggleZen,
  onBack,
  onRetry,
  onUpdateSettings,
  onOpenDetail,
  onLogin,
  onToast,
  onVote,
  onCommentCountDelta,
  onBlockAuthor,
  onUnblockAuthor,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef<HTMLElement>(null);
  const commentsMoreSentinelRef = useRef<HTMLDivElement>(null);
  const answersMoreSentinelRef = useRef<HTMLDivElement>(null);
  const userMoreSentinelRef = useRef<HTMLDivElement>(null);
  const savedScrollTopRef = useRef<number | null>(null);
  const typoPopoverRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const composerBoxRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const commentsReqIdRef = useRef(0);
  const answersReqIdRef = useRef(0);
  const userReqIdRef = useRef(0);

  const [typoOpen, setTypoOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scrollPct, setScrollPct] = useState(0);
  const [isScrollable, setIsScrollable] = useState(false);
  const [commentsInView, setCommentsInView] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);

  // Question description & question answers list (used by Question Detail Page & prev/next answer stepping)
  const [questionDescOpen, setQuestionDescOpen] = useState(false);
  const [answerSort, setAnswerSort] = useState<'default' | 'updated'>('default');
  const [questionAnswers, setQuestionAnswers] = useState<QuestionAnswerSummary[]>([]);
  const [questionAnswersTotal, setQuestionAnswersTotal] = useState(0);
  const [questionAnswersHasMore, setQuestionAnswersHasMore] = useState(false);
  const [questionAnswersOffset, setQuestionAnswersOffset] = useState(0);
  const [questionAnswersLoading, setQuestionAnswersLoading] = useState(false);
  const loadedQuestionKeyRef = useRef<string | null>(null);

  // User profile content list (answers / articles / pins)
  const [userTab, setUserTab] = useState<UserContentTab>('answers');
  const [userItems, setUserItems] = useState<FeedItem[]>([]);
  const [userHasMore, setUserHasMore] = useState(false);
  const [userOffset, setUserOffset] = useState(0);
  const [userLoading, setUserLoading] = useState(false);
  const [userLoadError, setUserLoadError] = useState<string | null>(null);

  // Comments state
  const [comments, setComments] = useState<CommentsPage | null>(null);
  const [commentOrder, setCommentOrder] = useState<'normal' | 'reverse'>(() => settings.defaultCommentOrder);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoadError, setCommentsLoadError] = useState<string | null>(null);
  const [expandedChildMap, setExpandedChildMap] = useState<Record<string, ExpandedChildState>>({});
  const [loadingChildId, setLoadingChildId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [replyTarget, setReplyTarget] = useState<{ id: string; authorName: string; rootId: string } | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [pendingDeleteCommentId, setPendingDeleteCommentId] = useState<string | null>(null);

  // In-page find
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findCount, setFindCount] = useState(0);
  const [findActiveIdx, setFindActiveIdx] = useState(0);

  // Image Lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxRotate, setLightboxRotate] = useState(0);
  const [lightboxScale, setLightboxScale] = useState(1);
  const lastLightboxSrcRef = useRef<string | null>(null);
  if (lightboxSrc) lastLightboxSrcRef.current = lightboxSrc;

  // Tactile spring pop feedback on explicit user vote/like
  const [votePopTick, setVotePopTick] = useState(0);
  const [poppedCommentId, setPoppedCommentId] = useState<string | null>(null);
  const commentPopTimerRef = useRef<number | null>(null);

  const articleKey = detail ? `${detail.kind}:${detail.id}` : null;
  const isQuestionPage = detail?.kind === 'question';
  const isUserPage = detail?.kind === 'user';
  const isCollectionLikePage = isQuestionPage || isUserPage;
  const canOpenQuestionPage = Boolean(detail && detail.kind === 'answer' && detail.questionId);
  const hasMultipleAnswers =
    Boolean(detail?.questionId) && (detail?.questionAnswerCount === undefined || detail.questionAnswerCount > 1);

  const typoPresence = usePresence(typoOpen);
  const morePresence = usePresence(moreOpen);
  const findPresence = usePresence(findOpen);
  const lightboxPresence = usePresence(Boolean(lightboxSrc));
  if (!lightboxSrc && !lightboxPresence.mounted) lastLightboxSrcRef.current = null;
  const activeLightboxSrc = lightboxSrc || lastLightboxSrcRef.current;

  useEffect(() => {
    return () => {
      if (commentPopTimerRef.current) window.clearTimeout(commentPopTimerRef.current);
    };
  }, []);

  const safeHtml = useMemo(() => sanitizeZhihuHtml(detail?.contentHtml || '', 'article'), [detail?.contentHtml]);
  const safeQuestionHtml = useMemo(
    () => sanitizeZhihuHtml(detail?.questionDetailHtml || '', 'article'),
    [detail?.questionDetailHtml]
  );
  const readingFontStack = useMemo(
    () => resolveFontStack(settings.fontPreset, settings.customFontFamily),
    [settings.fontPreset, settings.customFontFamily]
  );
  const commentFontStack = useMemo(
    () => resolveCommentFontStack(settings.commentFontPreset, settings.commentCustomFontFamily, readingFontStack),
    [settings.commentFontPreset, settings.commentCustomFontFamily, readingFontStack]
  );
  const prevDefaultOrderRef = useRef(settings.defaultCommentOrder);

  const updateDraft = useCallback(
    (nextText: string) => {
      setCommentDraft(nextText);
      if (articleKey) {
        if (nextText.trim()) commentDraftStore.set(articleKey, nextText);
        else commentDraftStore.delete(articleKey);
      }
    },
    [articleKey]
  );

  // Reset / restore article-scoped states when switching content
  useEffect(() => {
    ++commentsReqIdRef.current;
    ++userReqIdRef.current;
    setComments(null);
    setCommentsLoading(false);
    setCommentsLoadError(null);
    setUserLoading(false);
    setUserLoadError(null);
    setExpandedChildMap({});
    setReplyTarget(null);
    setEmojiPickerOpen(false);
    setQuestionDescOpen(false);
    setCommentsInView(false);
    setFindOpen(false);
    setTypoOpen(false);
    setMoreOpen(false);
    setLightboxSrc(null);
    setLightboxRotate(0);
    setLightboxScale(1);
    setPendingDeleteCommentId(null);
    setVotePopTick(0);
    setPoppedCommentId(null);
    if (commentPopTimerRef.current) {
      window.clearTimeout(commentPopTimerRef.current);
      commentPopTimerRef.current = null;
    }
    savedScrollTopRef.current = null;

    let scrollRafId: number | null = null;
    if (articleKey) {
      setCommentDraft(commentDraftStore.get(articleKey) || '');
      const savedTop = readingScrollStore.get(articleKey) ?? 0;
      scrollRafId = window.requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = savedTop;
        const total = el.scrollHeight - el.clientHeight;
        setIsScrollable(total > 80);
        setScrollPct(total > 60 ? Math.min(100, Math.max(0, Math.round((savedTop / total) * 100))) : 0);
      });
    } else {
      setCommentDraft('');
      setScrollPct(0);
      setIsScrollable(false);
    }

    const qKey = detail?.questionId ? `${detail.questionId}:${answerSort}` : null;
    if (qKey) {
      const cachedPage = questionAnswersStore.get(qKey);
      if (cachedPage) {
        setQuestionAnswers(cachedPage.items);
        setQuestionAnswersTotal(cachedPage.total);
        setQuestionAnswersHasMore(cachedPage.hasMore);
        setQuestionAnswersOffset(cachedPage.nextOffset);
        loadedQuestionKeyRef.current = qKey;
      } else if (detail?.kind === 'question' && detail.questionAnswersPage && answerSort === 'default') {
        const initPage = detail.questionAnswersPage;
        questionAnswersStore.set(qKey, initPage);
        setQuestionAnswers(initPage.items);
        setQuestionAnswersTotal(initPage.total);
        setQuestionAnswersHasMore(initPage.hasMore);
        setQuestionAnswersOffset(initPage.nextOffset);
        loadedQuestionKeyRef.current = qKey;
      } else if (qKey !== loadedQuestionKeyRef.current) {
        setQuestionAnswers([]);
        setQuestionAnswersTotal(detail?.questionAnswerCount || 0);
        setQuestionAnswersHasMore(false);
        setQuestionAnswersOffset(0);
        loadedQuestionKeyRef.current = null;
      }
    } else {
      setQuestionAnswers([]);
      setQuestionAnswersTotal(0);
      setQuestionAnswersHasMore(false);
      setQuestionAnswersOffset(0);
      loadedQuestionKeyRef.current = null;
    }

    if (detail?.kind === 'user' && detail.userProfile) {
      const token = detail.userProfile.urlToken;
      const preferredTab = userActiveTabStore.get(token) || detail.userInitialTab || 'answers';
      const preferredCached = userContentStore.get(`${token}:${preferredTab}`);
      if (preferredCached) {
        setUserTab(preferredTab);
        setUserItems(preferredCached.items);
        setUserHasMore(preferredCached.hasMore);
        setUserOffset(preferredCached.nextOffset);
      } else {
        const initTab = detail.userInitialTab || 'answers';
        setUserTab(initTab);
        const initPage = detail.userInitialPage;
        if (initPage) {
          const entry = {
            items: initPage.items,
            hasMore: initPage.hasMore,
            nextOffset: initPage.items.length,
          };
          userContentStore.set(`${token}:${initTab}`, entry);
          setUserItems(entry.items);
          setUserHasMore(entry.hasMore);
          setUserOffset(entry.nextOffset);
        } else {
          setUserItems([]);
          setUserHasMore(false);
          setUserOffset(0);
        }
      }
    } else {
      setUserItems([]);
      setUserHasMore(false);
      setUserOffset(0);
    }

    return () => {
      if (scrollRafId !== null) window.cancelAnimationFrame(scrollRafId);
    };
  }, [
    articleKey,
    detail?.kind,
    detail?.questionId,
    detail?.questionAnswerCount,
    detail?.questionAnswersPage,
    detail?.userProfile,
    detail?.userInitialTab,
    detail?.userInitialPage,
    answerSort,
  ]);

  // Measure scrollability on resize or content change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !detail) return;
    const check = () => {
      const total = el.scrollHeight - el.clientHeight;
      setIsScrollable(total > 80);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (proseRef.current) ro.observe(proseRef.current);
    return () => ro.disconnect();
  }, [detail, safeHtml, comments, questionAnswers, userItems]);

  // Close popovers on outside click
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (typoOpen && typoPopoverRef.current && !typoPopoverRef.current.contains(target)) {
        setTypoOpen(false);
      }
      if (moreOpen && moreMenuRef.current && !moreMenuRef.current.contains(target)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [typoOpen, moreOpen]);

  // Open find bar on Ctrl+F signal
  const prevFindSignal = useRef(findInPageSignal);
  useEffect(() => {
    if (findInPageSignal !== prevFindSignal.current) {
      prevFindSignal.current = findInPageSignal;
      if (detail) {
        setFindOpen(true);
      }
    }
  }, [findInPageSignal, detail]);

  useEffect(() => {
    if (!findOpen || !findPresence.mounted) return;
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, [findOpen, findPresence.mounted]);

  // Apply in-page find highlights
  useEffect(() => {
    const container = proseRef.current;
    if (!container) return;
    if (!findOpen || !findQuery.trim()) {
      clearFindMarks(container);
      setFindCount(0);
      setFindActiveIdx(0);
      return;
    }
    const hits = applyFindMarks(container, findQuery);
    setFindCount(hits.length);
    setFindActiveIdx(0);
    if (hits[0]) {
      hits[0].classList.add('zhihu-find-hit-active');
      hits[0].scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    }
  }, [findOpen, findQuery, safeHtml]);

  const stepFindHit = (delta: 1 | -1) => {
    const container = proseRef.current;
    if (!container || findCount === 0) return;
    const marks = Array.from(container.querySelectorAll<HTMLElement>('mark.zhihu-find-hit'));
    if (!marks.length) return;
    marks.forEach((m) => m.classList.remove('zhihu-find-hit-active'));
    const nextIdx = (findActiveIdx + delta + marks.length) % marks.length;
    setFindActiveIdx(nextIdx);
    marks[nextIdx]?.classList.add('zhihu-find-hit-active');
    marks[nextIdx]?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  };

  // Load question answers list (used by Question Detail Page & prev/next answer stepping)
  const loadQuestionAnswers = useCallback(
    async (sort: 'default' | 'updated', append = false): Promise<QuestionAnswerSummary[]> => {
      if (!detail?.questionId) return [];
      const reqId = ++answersReqIdRef.current;
      setQuestionAnswersLoading(true);
      try {
        const offset = append ? questionAnswersOffset : 0;
        const page = await window.zhihuApi.fetchQuestionAnswers(detail.questionId, offset, sort);
        if (reqId !== answersReqIdRef.current) return questionAnswers;
        const merged = append
          ? [
              ...questionAnswers,
              ...page.items.filter((item) => !questionAnswers.some((existing) => existing.id === item.id)),
            ]
          : page.items;
        const qKey = `${detail.questionId}:${sort}`;
        questionAnswersStore.set(qKey, {
          items: merged,
          total: page.total,
          hasMore: page.hasMore,
          nextOffset: page.nextOffset,
        });
        setQuestionAnswers(merged);
        setQuestionAnswersTotal(page.total);
        setQuestionAnswersHasMore(page.hasMore);
        setQuestionAnswersOffset(page.nextOffset);
        loadedQuestionKeyRef.current = qKey;
        return merged;
      } catch (err) {
        if (reqId === answersReqIdRef.current) {
          onToast(formatErrorMessage(err, '读取同问题回答列表失败'));
        }
        return questionAnswers;
      } finally {
        if (reqId === answersReqIdRef.current) setQuestionAnswersLoading(false);
      }
    },
    [detail?.questionId, questionAnswers, questionAnswersOffset, onToast]
  );

  const openQuestionDetailPage = useCallback(() => {
    if (!detail?.questionId || detail.kind === 'question') return;
    onOpenDetail('question', detail.questionId, {
      title: detail.title,
      url: `https://www.zhihu.com/question/${detail.questionId}`,
    });
  }, [detail?.questionId, detail?.kind, detail?.title, onOpenDetail]);

  const openUserProfile = useCallback(
    (urlToken: string, name: string) => {
      const token = urlToken.trim();
      if (!token) return;
      if (detail?.kind === 'user' && detail.userProfile?.urlToken === token) return;
      onOpenDetail('user', token, {
        title: name || token,
        url: `https://www.zhihu.com/people/${encodeURIComponent(token)}`,
      });
    },
    [detail?.kind, detail?.userProfile?.urlToken, onOpenDetail]
  );

  const handleRichHtmlClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
      if (anchor && !e.ctrlKey && !e.metaKey) {
        const internal = parseZhihuLink(anchor.href);
        if (internal) {
          e.preventDefault();
          onOpenDetail(internal.kind, internal.id);
          return;
        }
      }
      if (target.tagName === 'IMG' && !target.classList.contains('zhihu-sticker')) {
        const src = (target as HTMLImageElement).src;
        if (src) {
          setLightboxSrc(src);
          setLightboxRotate(0);
          setLightboxScale(1);
        }
      }
    },
    [onOpenDetail]
  );

  const loadUserContent = useCallback(
    async (tab: UserContentTab, append = false) => {
      const token = detail?.userProfile?.urlToken;
      if (!token) return;
      const reqId = ++userReqIdRef.current;
      setUserLoading(true);
      setUserLoadError(null);
      try {
        const offset = append ? userOffset : 0;
        const page = await window.zhihuApi.fetchUserContent(token, tab, offset);
        if (reqId !== userReqIdRef.current) return;
        const merged = append
          ? [...userItems, ...page.items.filter((item) => !userItems.some((existing) => existing.key === item.key))]
          : page.items;
        const nextOffset = offset + page.items.length;
        userContentStore.set(`${token}:${tab}`, {
          items: merged,
          hasMore: page.hasMore,
          nextOffset,
        });
        setUserItems(merged);
        setUserHasMore(page.hasMore);
        setUserOffset(nextOffset);
      } catch (err) {
        if (reqId !== userReqIdRef.current) return;
        const msg = formatErrorMessage(err, '加载用户动态失败');
        setUserLoadError(msg);
        onToast(msg);
      } finally {
        if (reqId === userReqIdRef.current) setUserLoading(false);
      }
    },
    [detail?.userProfile?.urlToken, userItems, userOffset, onToast]
  );

  const stepQuestionAnswer = useCallback(
    async (delta: -1 | 1) => {
      if (!detail?.questionId || !hasMultipleAnswers) return;
      let list = questionAnswers;
      if (list.length === 0) {
        list = await loadQuestionAnswers(answerSort, false);
      }
      if (list.length === 0) return;
      const curIdx = list.findIndex((a) => a.id === detail.id);
      const nextIdx = curIdx < 0 ? 0 : curIdx + delta;
      if (nextIdx < 0) {
        onToast('已是当前排序下的第一篇回答');
        return;
      }
      if (nextIdx >= list.length) {
        if (questionAnswersHasMore) {
          const moreList = await loadQuestionAnswers(answerSort, true);
          if (moreList[nextIdx]) {
            onOpenDetail('answer', moreList[nextIdx].id, {
              title: detail.title,
              url: `https://www.zhihu.com/question/${detail.questionId}/answer/${moreList[nextIdx].id}`,
            });
            return;
          }
        }
        onToast('已是最后一篇回答');
        return;
      }
      onOpenDetail('answer', list[nextIdx].id, {
        title: detail.title,
        url: `https://www.zhihu.com/question/${detail.questionId}/answer/${list[nextIdx].id}`,
      });
    },
    [
      detail?.questionId,
      detail?.id,
      detail?.title,
      hasMultipleAnswers,
      questionAnswers,
      answerSort,
      questionAnswersHasMore,
      loadQuestionAnswers,
      onOpenDetail,
      onToast,
    ]
  );

  // Escape for overlays + ArrowLeft/ArrowRight in zenMode for stepping answers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || pendingDeleteCommentId || document.querySelector('[role="dialog"]')) {
        return;
      }
      if (e.key === 'Escape') {
        if (lightboxSrc) {
          e.preventDefault();
          e.stopPropagation();
          setLightboxSrc(null);
          return;
        }
        if (typoOpen || moreOpen || emojiPickerOpen) {
          e.preventDefault();
          e.stopPropagation();
          setTypoOpen(false);
          setMoreOpen(false);
          setEmojiPickerOpen(false);
          return;
        }
        if (findOpen) {
          e.preventDefault();
          e.stopPropagation();
          setFindOpen(false);
          return;
        }
      }
      if ((e.key === 'r' || e.key === 'R') && lightboxSrc) {
        e.preventDefault();
        setLightboxRotate((r) => (r + 90) % 360);
        return;
      }
      if (zenMode && detail?.kind === 'answer' && hasMultipleAnswers && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          void stepQuestionAnswer(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          void stepQuestionAnswer(1);
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [
    pendingDeleteCommentId,
    lightboxSrc,
    typoOpen,
    moreOpen,
    emojiPickerOpen,
    findOpen,
    zenMode,
    detail?.kind,
    hasMultipleAnswers,
    stepQuestionAnswer,
  ]);

  const loadComments = useCallback(
    async (nextUrl?: string, orderOverride?: 'normal' | 'reverse') => {
      if (!detail) return;
      if (nextUrl && commentsLoading) return;
      const reqId = ++commentsReqIdRef.current;
      const targetOrder = orderOverride ?? commentOrder;
      setCommentsLoading(true);
      setCommentsLoadError(null);
      try {
        const page = await window.zhihuApi.fetchComments(detail.kind, detail.id, nextUrl, targetOrder);
        if (reqId !== commentsReqIdRef.current) return;
        setComments((prev) => (nextUrl && prev ? { ...page, items: [...prev.items, ...page.items] } : page));
      } catch (err) {
        if (reqId !== commentsReqIdRef.current) return;
        const msg = formatErrorMessage(err, '加载评论失败');
        setCommentsLoadError(msg);
      } finally {
        if (reqId === commentsReqIdRef.current) setCommentsLoading(false);
      }
    },
    [detail, commentsLoading, commentOrder]
  );

  // Keep comment sort synced when user updates defaultCommentOrder in Settings
  useEffect(() => {
    if (prevDefaultOrderRef.current === settings.defaultCommentOrder) return;
    prevDefaultOrderRef.current = settings.defaultCommentOrder;
    setCommentOrder(settings.defaultCommentOrder);
    if (detail && comments) {
      void loadComments(undefined, settings.defaultCommentOrder);
    }
  }, [settings.defaultCommentOrder, detail, comments, loadComments]);

  // Auto-load more answers on Question Detail Page when scrolling near bottom
  useEffect(() => {
    const sentinel = answersMoreSentinelRef.current;
    const scroller = scrollRef.current;
    if (!isQuestionPage || !sentinel || !scroller || !questionAnswersHasMore || questionAnswersLoading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void loadQuestionAnswers(answerSort, true);
        }
      },
      { root: scroller, rootMargin: '0px 0px 260px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isQuestionPage, questionAnswersHasMore, questionAnswersLoading, answerSort, loadQuestionAnswers]);

  // Auto-load more content on User Profile Page when scrolling near bottom
  useEffect(() => {
    const sentinel = userMoreSentinelRef.current;
    const scroller = scrollRef.current;
    if (!isUserPage || !sentinel || !scroller || !userHasMore || userLoading || userLoadError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void loadUserContent(userTab, true);
        }
      },
      { root: scroller, rootMargin: '0px 0px 260px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isUserPage, userHasMore, userLoading, userLoadError, userTab, loadUserContent]);

  // Auto-load initial comments when scrolling near #reader-comments, AND detect comments visibility to tuck floating pill
  useEffect(() => {
    const target = commentsRef.current;
    const scroller = scrollRef.current;
    if (!target || !scroller || !detail) return;

    const preloadObserver = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((e) => e.isIntersecting) &&
          detail.commentCount > 0 &&
          !comments &&
          !commentsLoading &&
          !commentsLoadError
        ) {
          void loadComments();
        }
      },
      { root: scroller, rootMargin: '0px 0px 320px 0px' }
    );

    const footerEl = footerRef.current;
    let footerIntersecting = false;
    let commentsIntersecting = false;

    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === footerEl) footerIntersecting = entry.isIntersecting;
          if (entry.target === target) commentsIntersecting = entry.isIntersecting;
        }
        setCommentsInView(footerIntersecting || commentsIntersecting);
      },
      { root: scroller, rootMargin: '0px 0px 24px 0px', threshold: 0 }
    );

    preloadObserver.observe(target);
    if (footerEl) visibilityObserver.observe(footerEl);
    visibilityObserver.observe(target);
    return () => {
      preloadObserver.disconnect();
      visibilityObserver.disconnect();
    };
  }, [detail, comments, commentsLoading, commentsLoadError, loadComments]);

  // Auto-load next page of comments when scrolling near bottom of comment list
  useEffect(() => {
    const sentinel = commentsMoreSentinelRef.current;
    const scroller = scrollRef.current;
    if (!sentinel || !scroller || !comments?.hasMore || !comments.nextUrl || commentsLoading || commentsLoadError) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && comments.nextUrl) {
          void loadComments(comments.nextUrl);
        }
      },
      { root: scroller, rootMargin: '0px 0px 260px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [comments?.hasMore, comments?.nextUrl, commentsLoading, commentsLoadError, loadComments]);

  const toggleJumpComments = useCallback(() => {
    const scroller = scrollRef.current;
    const target = commentsRef.current;
    if (!scroller || !target) return;

    if (!comments && !commentsLoading && (detail?.commentCount ?? 0) > 0) {
      void loadComments();
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const targetOffset = target.getBoundingClientRect().top - scrollerRect.top;
    const scrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (targetOffset <= scrollerRect.height * 0.45 && savedScrollTopRef.current !== null) {
      const backTo = savedScrollTopRef.current;
      savedScrollTopRef.current = null;
      scroller.scrollTo({ top: backTo, behavior: scrollBehavior });
      return;
    }

    savedScrollTopRef.current = scroller.scrollTop;
    window.requestAnimationFrame(() => {
      if (target.isConnected) target.scrollIntoView({ behavior: scrollBehavior, block: 'start' });
    });
  }, [comments, commentsLoading, detail?.commentCount, loadComments]);

  const prevCommentSignal = useRef(commentJumpSignal);
  useEffect(() => {
    if (commentJumpSignal !== prevCommentSignal.current) {
      prevCommentSignal.current = commentJumpSignal;
      if (detail) toggleJumpComments();
    }
  }, [commentJumpSignal, detail, toggleJumpComments]);

  const handleToggleCommentLike = async (commentId: string, currentlyLiked: boolean, parentId?: string) => {
    if (!account.loggedIn) {
      onToast('请先登录知乎账号', '登录知乎账号', onLogin);
      return;
    }
    const nextLiked = !currentlyLiked;
    const delta = nextLiked ? 1 : -1;
    if (nextLiked) {
      setPoppedCommentId(commentId);
      if (commentPopTimerRef.current) window.clearTimeout(commentPopTimerRef.current);
      commentPopTimerRef.current = window.setTimeout(() => setPoppedCommentId(null), 260);
    }

    const patchItem = (item: CommentItem): CommentItem =>
      item.id === commentId
        ? { ...item, liked: nextLiked, likeCount: Math.max(0, item.likeCount + delta) }
        : { ...item, childComments: item.childComments.map(patchItem) };

    setComments((prev) => (prev ? { ...prev, items: prev.items.map(patchItem) } : prev));
    if (parentId && expandedChildMap[parentId]) {
      setExpandedChildMap((prev) => ({
        ...prev,
        [parentId]: { ...prev[parentId], items: prev[parentId].items.map(patchItem) },
      }));
    }

    try {
      await window.zhihuApi.likeComment(commentId, nextLiked);
    } catch (err) {
      const rollbackItem = (item: CommentItem): CommentItem =>
        item.id === commentId
          ? { ...item, liked: currentlyLiked, likeCount: Math.max(0, item.likeCount - delta) }
          : { ...item, childComments: item.childComments.map(rollbackItem) };
      setComments((prev) => (prev ? { ...prev, items: prev.items.map(rollbackItem) } : prev));
      if (parentId && expandedChildMap[parentId]) {
        setExpandedChildMap((prev) => ({
          ...prev,
          [parentId]: { ...prev[parentId], items: prev[parentId].items.map(rollbackItem) },
        }));
      }
      onToast(formatErrorMessage(err, '点赞评论失败，请稍后重试'));
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !commentDraft.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const created = await window.zhihuApi.submitComment(
        detail.kind,
        detail.id,
        commentDraft.trim(),
        replyTarget?.id
      );
      const enriched: CommentItem = {
        ...created,
        authorName: created.authorName || account.name || '我',
        authorAvatar: created.authorAvatar || account.avatarUrl,
        replyToAuthor: created.replyToAuthor || replyTarget?.authorName,
        createdTime: created.createdTime || Math.floor(Date.now() / 1000),
        isOwn: true,
      };
      const targetRootId = replyTarget?.rootId;
      if (targetRootId) {
        setComments((prev) =>
          prev
            ? {
                ...prev,
                total: prev.total + 1,
                items: prev.items.map((c) =>
                  c.id === targetRootId
                    ? { ...c, childCount: c.childCount + 1, childComments: [...c.childComments, enriched] }
                    : c
                ),
              }
            : prev
        );
        setExpandedChildMap((prev) =>
          prev[targetRootId]
            ? {
                ...prev,
                [targetRootId]: {
                  ...prev[targetRootId],
                  items: [...prev[targetRootId].items, enriched],
                },
              }
            : prev
        );
      } else {
        setComments((prev) =>
          prev
            ? { ...prev, total: prev.total + 1, items: [enriched, ...prev.items] }
            : { items: [enriched], total: detail.commentCount + 1, hasMore: false, nextUrl: null }
        );
      }
      onCommentCountDelta?.(1);
      updateDraft('');
      setReplyTarget(null);
      setEmojiPickerOpen(false);
      onToast('评论已发布');
    } catch (err) {
      onToast(formatErrorMessage(err, '发送评论失败，请确认登录状态正常'));
    } finally {
      setSubmittingComment(false);
    }
  };

  const confirmDeleteComment = async () => {
    const commentId = pendingDeleteCommentId;
    if (!commentId) return;
    setPendingDeleteCommentId(null);
    try {
      await window.zhihuApi.deleteComment(commentId);
      setComments((prev) => {
        if (!prev) return prev;
        const nextItems = prev.items
          .filter((c) => c.id !== commentId)
          .map((c) => {
            const hadInPreview = c.childComments.some((sub) => sub.id === commentId);
            const hadInExpanded = expandedChildMap[c.id]?.items.some((sub) => sub.id === commentId);
            return {
              ...c,
              childCount: hadInPreview || hadInExpanded ? Math.max(0, c.childCount - 1) : c.childCount,
              childComments: c.childComments.filter((sub) => sub.id !== commentId),
            };
          });
        return {
          ...prev,
          total: Math.max(0, prev.total - 1),
          items: nextItems,
        };
      });
      setExpandedChildMap((prev) => {
        const next: Record<string, ExpandedChildState> = {};
        for (const [k, val] of Object.entries(prev)) {
          if (k === commentId) continue;
          next[k] = { ...val, items: val.items.filter((sub) => sub.id !== commentId) };
        }
        return next;
      });
      onCommentCountDelta?.(-1);
      onToast('已删除评论');
    } catch (err) {
      onToast(formatErrorMessage(err, '删除评论失败'));
    }
  };

  const handleExpandChildComments = async (rootCommentId: string, nextUrl?: string) => {
    if (loadingChildId) return;
    setLoadingChildId(rootCommentId);
    try {
      const page = await window.zhihuApi.fetchChildComments(rootCommentId, nextUrl);
      setExpandedChildMap((prev) => {
        const existing = prev[rootCommentId]?.items || [];
        const merged = nextUrl
          ? [...existing, ...page.items.filter((item) => !existing.some((e) => e.id === item.id))]
          : page.items;
        return {
          ...prev,
          [rootCommentId]: {
            items: merged,
            nextUrl: page.nextUrl || null,
            hasMore: page.hasMore,
          },
        };
      });
    } catch (err) {
      onToast(formatErrorMessage(err, '展开更多回复失败'));
    } finally {
      setLoadingChildId(null);
    }
  };

  const insertEmoticonAtCursor = (name: string) => {
    const token = `[${name}]`;
    const el = composerRef.current;
    if (!el) {
      updateDraft(commentDraft + token);
      return;
    }
    const start = el.selectionStart ?? commentDraft.length;
    const end = el.selectionEnd ?? commentDraft.length;
    const next = commentDraft.slice(0, start) + token + commentDraft.slice(end);
    updateDraft(next);
    window.requestAnimationFrame(() => {
      if (!el.isConnected) return;
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleCopyMarkdown = async () => {
    if (!detail) return;
    const md = articleToMarkdown(detail, settings.markdownIncludeHeader);
    await window.zhihuApi.copyText(md);
    onToast('已复制 Markdown');
  };

  const headerTitleText = detail?.title || pendingTarget?.title || '';

  const renderTopBar = () => (
    <header
      className="app-drag flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3 text-xs"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-paper)' }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {onBack && (
          <button
            type="button"
            title="返回上一视图 (Alt+← / 鼠标侧键)"
            onClick={onBack}
            className="app-no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-muted)' }}
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
          </button>
        )}

        {headerTitleText && (
          <button
            type="button"
            data-no-press={!canOpenQuestionPage ? 'true' : undefined}
            title={canOpenQuestionPage ? '点击进入问题详情页，查看全部回答' : headerTitleText}
            onClick={() => {
              if (canOpenQuestionPage) openQuestionDetailPage();
            }}
            className={`app-no-drag min-w-0 truncate text-left text-[13px] font-medium ${
              canOpenQuestionPage ? 'hover:text-[var(--accent)]' : 'cursor-default'
            }`}
            style={{ color: detail ? 'var(--text-main)' : 'var(--text-muted)' }}
          >
            {headerTitleText}
          </button>
        )}

        {detail && isQuestionPage && (
          <span
            className="hidden h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium sm:inline-flex"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            问题
          </span>
        )}

        {detail && isUserPage && (
          <span
            className="hidden h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium sm:inline-flex"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            用户主页
          </span>
        )}

        {detail && canOpenQuestionPage && (
          <button
            type="button"
            title="进入问题详情页，查看全部回答"
            onClick={openQuestionDetailPage}
            className="app-no-drag hidden h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium hover:opacity-90 sm:inline-flex"
            style={{
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
            }}
          >
            <List className="h-3 w-3" />
            <span>
              {(detail.questionAnswerCount || questionAnswersTotal) > 1
                ? `${formatCount(detail.questionAnswerCount || questionAnswersTotal)} 回答`
                : '查看问题'}
            </span>
          </button>
        )}

        <div className="app-drag h-full min-w-[16px] flex-1" />
      </div>

      <div className="app-no-drag flex shrink-0 items-center gap-0.5">
        {detail && (
          <>
            {/* T Aa Quick Typography Popover (only shown when an article is open) */}
            <div ref={typoPopoverRef} className="relative">
              <button
                type="button"
                title="排版与字号速调"
                onClick={() => {
                  setTypoOpen((v) => !v);
                  setMoreOpen(false);
                }}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium hover:bg-[var(--bg-hover)]"
                style={{
                  background: typoOpen ? 'var(--bg-subtle)' : 'transparent',
                  color: typoOpen ? 'var(--text-main)' : 'var(--text-muted)',
                }}
              >
                <Type className="h-3.5 w-3.5" strokeWidth={1.8} />
                <span>Aa</span>
              </button>

              {typoPresence.mounted && (
                <div
                  data-overlay={typoOpen ? 'popover' : undefined}
                  data-motion={typoPresence.state}
                  aria-hidden={!typoOpen || undefined}
                  inert={!typoOpen || undefined}
                  className="motion-popover popover-surface scroll-area absolute top-full right-0 z-50 mt-1.5 max-h-[calc(100vh-64px)] w-72 space-y-3.5 rounded-xl p-3.5 text-xs"
                >
                  {/* Body font size */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span style={{ color: 'var(--text-muted)' }}>正文字号（标题等比联动）</span>
                      <div className="flex items-center gap-1">
                        <span className="font-mono font-semibold">{settings.fontSize}px</span>
                        {Math.abs(settings.fontSize - 16) > 0.05 && (
                          <button
                            type="button"
                            title="复位 16px"
                            onClick={() => onUpdateSettings({ fontSize: 16 })}
                            className="rounded p-0.5 hover:bg-[var(--bg-hover)]"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={13}
                      max={22}
                      step={0.5}
                      value={settings.fontSize}
                      onChange={(e) => onUpdateSettings({ fontSize: Number(e.target.value) })}
                      className="w-full accent-[var(--accent)]"
                    />
                    <div className="grid grid-cols-3 gap-1.5">
                      {[14, 16, 18].map((px) => {
                        const active = Math.abs(settings.fontSize - px) < 0.05;
                        return (
                          <button
                            key={px}
                            type="button"
                            onClick={() => onUpdateSettings({ fontSize: px })}
                            className="rounded-md border py-1 font-medium"
                            style={{
                              borderColor: active ? 'var(--accent)' : 'var(--border-color)',
                              background: active ? 'var(--accent-soft)' : 'transparent',
                              color: active ? 'var(--accent)' : 'var(--text-muted)',
                            }}
                          >
                            {px}px
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Feed font size */}
                  <div className="space-y-1.5 border-t pt-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="flex items-center justify-between">
                      <span style={{ color: 'var(--text-muted)' }}>信息流字号</span>
                      <div className="flex items-center gap-1">
                        <span className="font-mono font-semibold">{settings.feedFontSize}px</span>
                        {Math.abs(settings.feedFontSize - 13) > 0.05 && (
                          <button
                            type="button"
                            title="复位 13px"
                            onClick={() => onUpdateSettings({ feedFontSize: 13 })}
                            className="rounded p-0.5 hover:bg-[var(--bg-hover)]"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={12}
                      max={16}
                      step={0.5}
                      value={settings.feedFontSize}
                      onChange={(e) => onUpdateSettings({ feedFontSize: Number(e.target.value) })}
                      className="w-full accent-[var(--accent)]"
                    />
                  </div>

                  {/* Comment font size */}
                  <div className="space-y-1.5 border-t pt-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="flex items-center justify-between">
                      <span style={{ color: 'var(--text-muted)' }}>评论字号</span>
                      <div className="flex items-center gap-1">
                        <span className="font-mono font-semibold">{settings.commentFontSize}px</span>
                        {Math.abs(settings.commentFontSize - 14) > 0.05 && (
                          <button
                            type="button"
                            title="复位 14px"
                            onClick={() => onUpdateSettings({ commentFontSize: 14 })}
                            className="rounded p-0.5 hover:bg-[var(--bg-hover)]"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={12.5}
                      max={18}
                      step={0.5}
                      value={settings.commentFontSize}
                      onChange={(e) => onUpdateSettings({ commentFontSize: Number(e.target.value) })}
                      className="w-full accent-[var(--accent)]"
                    />
                    <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                      {(
                        [
                          { id: 'sans', label: '评论无衬线' },
                          { id: 'follow', label: '评论跟随正文' },
                        ] as const
                      ).map((opt) => {
                        const active = settings.commentFontPreset === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => onUpdateSettings({ commentFontPreset: opt.id })}
                            className="rounded-md border py-1 font-medium"
                            style={{
                              borderColor: active ? 'var(--accent)' : 'var(--border-color)',
                              background: active ? 'var(--accent-soft)' : 'transparent',
                              color: active ? 'var(--accent)' : 'var(--text-muted)',
                            }}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Paper & Theme unified with SettingsModal */}
                  <div className="space-y-1.5 border-t pt-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div style={{ color: 'var(--text-muted)' }}>纸张底色与深色</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          { id: 'warm', label: '护眼暖纸', swatch: '#efe9dc', dark: false },
                          { id: 'modern', label: '清爽白', swatch: '#ffffff', dark: false },
                          { id: 'gray', label: '柔和灰', swatch: '#e5e9f0', dark: false },
                          { id: 'night', label: '深色模式', swatch: '#1b1e26', dark: true },
                        ] as const
                      ).map((p) => {
                        const active = p.dark ? isDarkResolved : settings.paperTone === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              if (p.dark) {
                                onUpdateSettings({ themeMode: isDarkResolved ? 'light' : 'dark' });
                              } else {
                                onUpdateSettings({ paperTone: p.id });
                              }
                            }}
                            className="inline-flex items-center justify-center gap-1.5 rounded-md border py-1.5 font-medium"
                            style={{
                              borderColor: active ? 'var(--accent)' : 'var(--border-color)',
                              background: active ? 'var(--accent-soft)' : 'transparent',
                              color: active ? 'var(--accent)' : 'var(--text-main)',
                            }}
                          >
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full border"
                              style={{ background: p.swatch, borderColor: 'rgba(128,128,128,0.35)' }}
                            />
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Font family unified with SettingsModal */}
                  <div className="space-y-1.5 border-t pt-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div style={{ color: 'var(--text-muted)' }}>正文字体</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          { id: 'sans', label: '无衬线' },
                          { id: 'serif', label: '思源宋体' },
                          { id: 'wenkai', label: '霞鹜楷体' },
                          { id: 'yahei', label: '微软雅黑' },
                          ...(settings.customFontFamily
                            ? [{ id: 'custom' as FontPreset, label: `本机：${settings.customFontFamily}` }]
                            : []),
                        ] as { id: FontPreset; label: string }[]
                      ).map((f) => {
                        const active = settings.fontPreset === f.id;
                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => onUpdateSettings({ fontPreset: f.id })}
                            className={`truncate rounded-md border px-2 py-1.5 font-medium ${
                              f.id === 'custom' ? 'col-span-2' : ''
                            }`}
                            style={{
                              borderColor: active ? 'var(--accent)' : 'var(--border-color)',
                              background: active ? 'var(--accent-soft)' : 'transparent',
                              color: active ? 'var(--accent)' : 'var(--text-muted)',
                            }}
                          >
                            {f.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Reader column width */}
                  <div className="space-y-1.5 border-t pt-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="flex items-center justify-between">
                      <span style={{ color: 'var(--text-muted)' }}>阅读版心宽度</span>
                      <span className="font-mono font-semibold">{settings.readerWidth}px</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { label: '紧凑 660', w: 660 },
                        { label: '适中 740', w: 740 },
                        { label: '宽屏 860', w: 860 },
                      ].map((opt) => {
                        const active = Math.abs(settings.readerWidth - opt.w) <= 20;
                        return (
                          <button
                            key={opt.w}
                            type="button"
                            onClick={() => onUpdateSettings({ readerWidth: opt.w })}
                            className="rounded-md border py-1 font-medium"
                            style={{
                              borderColor: active ? 'var(--accent)' : 'var(--border-color)',
                              background: active ? 'var(--accent-soft)' : 'transparent',
                              color: active ? 'var(--accent)' : 'var(--text-muted)',
                            }}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              title={
                zenMode
                  ? '退出专注阅读 (Esc)'
                  : settings.singleKeyShortcuts
                    ? '专注阅读模式 (F)'
                    : '专注阅读模式'
              }
              onClick={onToggleZen}
              className="hidden h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--bg-hover)] sm:flex"
              style={{ color: zenMode ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              {zenMode ? (
                <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              )}
            </button>

            {!isUserPage && (
              <button
                type="button"
                title="复制为 Markdown"
                onClick={() => void handleCopyMarkdown()}
                className="hidden h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--bg-hover)] sm:flex"
                style={{ color: 'var(--text-muted)' }}
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            )}

            <div ref={moreMenuRef} className="relative">
              <button
                type="button"
                title="更多操作"
                onClick={() => {
                  setMoreOpen((v) => !v);
                  setTypoOpen(false);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--bg-hover)]"
                style={{
                  background: moreOpen ? 'var(--bg-subtle)' : 'transparent',
                  color: moreOpen ? 'var(--text-main)' : 'var(--text-muted)',
                }}
              >
                <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
              </button>

              {morePresence.mounted && (
                <div
                  role={moreOpen ? 'menu' : undefined}
                  data-overlay={moreOpen ? 'popover' : undefined}
                  data-motion={morePresence.state}
                  aria-hidden={!moreOpen || undefined}
                  inert={!moreOpen || undefined}
                  className="motion-popover popover-surface absolute top-full right-0 z-50 mt-1.5 w-48 rounded-xl p-1.5 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      setFindOpen(true);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)]"
                  >
                    <span className="flex items-center gap-2">
                      <Search className="h-3.5 w-3.5" />
                      页内查找
                    </span>
                    <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      Ctrl+F
                    </span>
                  </button>

                  {canOpenQuestionPage && (
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        openQuestionDetailPage();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)]"
                    >
                      <List className="h-3.5 w-3.5" />
                      进入问题详情页
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      onToggleZen();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] sm:hidden"
                  >
                    {zenMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                    {zenMode ? '退出专注阅读' : '专注阅读'}
                  </button>

                  {!isUserPage && (
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        void handleCopyMarkdown();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)]"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      复制为 Markdown
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={async () => {
                      setMoreOpen(false);
                      await window.zhihuApi.copyText(detail.url);
                      onToast(isUserPage ? '已复制主页链接' : '已复制原文链接');
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)]"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    {isUserPage ? '复制主页链接' : '复制原文链接'}
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      setMoreOpen(false);
                      await window.zhihuApi.copyText(`${detail.title} ${detail.url}`);
                      onToast('已复制标题与分享链接');
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)]"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    复制分享文本
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      void window.zhihuApi.openExternal(detail.url);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)]"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    在浏览器中打开
                  </button>

                  {detail.authorName &&
                    detail.authorName !== '匿名用户' &&
                    detail.authorName !== '知乎问题' &&
                    !(isUserPage && detail.userProfile?.urlToken && detail.userProfile.urlToken === account.urlToken) && (
                      <>
                        <div className="my-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                        <button
                          type="button"
                          onClick={() => {
                            setMoreOpen(false);
                            if (isAuthorBlocked) {
                              onUnblockAuthor?.(detail.authorName);
                            } else {
                              onBlockAuthor(detail.authorName);
                            }
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)]"
                          style={{ color: isAuthorBlocked ? 'var(--text-main)' : 'var(--danger)' }}
                        >
                          <UserX className="h-3.5 w-3.5" />
                          {isAuthorBlocked ? '取消屏蔽该作者' : '屏蔽作者（可撤销）'}
                        </button>
                      </>
                    )}
                </div>
              )}
            </div>
          </>
        )}

        <WindowControls isMaximized={isMaximized} showDivider={Boolean(detail)} />
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="flex h-full flex-col" style={{ background: 'var(--bg-paper)' }}>
        {renderTopBar()}
        <div className="scroll-area flex-1 px-5 pt-6 pb-16 sm:px-7 sm:pt-7" role="status" aria-label="正在加载正文">
          <div className="mx-auto space-y-5" style={{ maxWidth: `${settings.readerWidth}px` }}>
            <div className="space-y-2.5">
              <div className="skeleton-shimmer h-7 w-11/12 rounded-lg" />
              <div className="skeleton-shimmer h-7 w-3/5 rounded-lg" />
            </div>
            <div className="flex items-center gap-3 border-b pb-4" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="skeleton-shimmer h-9 w-9 shrink-0 rounded-full" />
              <div className="space-y-2">
                <div className="skeleton-shimmer h-3.5 w-28 rounded-md" />
                <div className="skeleton-shimmer h-3 w-48 rounded-md opacity-75" />
              </div>
            </div>
            <div className="space-y-3 pt-1">
              <div className="skeleton-shimmer h-4 w-full rounded-md" />
              <div className="skeleton-shimmer h-4 w-11/12 rounded-md" />
              <div className="skeleton-shimmer h-4 w-4/5 rounded-md" />
              <div className="h-2" />
              <div className="skeleton-shimmer h-4 w-full rounded-md" />
              <div className="skeleton-shimmer h-4 w-10/12 rounded-md" />
              <div className="skeleton-shimmer h-4 w-3/5 rounded-md" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    const needsAuth = !account.loggedIn || error.includes('登录');
    return (
      <div className="flex h-full flex-col" style={{ background: 'var(--bg-paper)' }}>
        {renderTopBar()}
        <div className="content-enter flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-2xl border"
            style={{
              borderColor: 'var(--border-color)',
              background: 'var(--bg-list)',
              color: 'var(--text-muted)',
            }}
          >
            <AlertCircle className="h-5 w-5" />
          </div>
          <div className="max-w-sm space-y-1.5">
            <div className="text-sm font-semibold">暂时无法加载这篇内容</div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {error}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 font-medium hover:bg-[var(--bg-hover)]"
                style={{ borderColor: 'var(--border-color)' }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </button>
            )}
            {needsAuth && (
              <button
                type="button"
                onClick={onLogin}
                className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-medium text-white"
                style={{ background: 'var(--accent)' }}
              >
                <LogIn className="h-3.5 w-3.5" />
                {account.loggedIn ? '重新登录' : '登录知乎账号'}
              </button>
            )}
            {pendingTarget?.url && (
              <button
                type="button"
                onClick={() => void window.zhihuApi.openExternal(pendingTarget.url!)}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 font-medium hover:bg-[var(--bg-hover)]"
                style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                在浏览器中打开原文
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col" style={{ background: 'var(--bg-paper)' }}>
        {renderTopBar()}
        <div className="content-enter flex flex-1 flex-col items-center justify-center px-8 text-center select-none">
          <div
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border"
            style={{
              borderColor: 'var(--border-color)',
              background: 'var(--bg-list)',
              color: 'var(--text-muted)',
            }}
          >
            <BookOpen className="h-5 w-5" strokeWidth={1.6} />
          </div>
          <div className="text-base font-semibold">选择左侧条目开始阅读</div>
          <p className="mt-1.5 max-w-xs text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            点击任意信息流卡片即刻展开正文，暖纸版心自动将行宽保持在舒适阅读比例。
          </p>
          <div
            className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-left text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            <span>搜索或粘贴链接</span>
            <span className="text-right font-mono">Ctrl+K</span>
            {settings.singleKeyShortcuts && (
              <>
                <span>下一条 / 上一条</span>
                <span className="text-right font-mono">J / K</span>
                <span>专注阅读 / 跳转评论</span>
                <span className="text-right font-mono">F / C</span>
              </>
            )}
            <span>打开偏好设置</span>
            <span className="text-right font-mono">Ctrl+,</span>
          </div>
        </div>
      </div>
    );
  }

  const canVote = detail.kind === 'answer' || detail.kind === 'article';
  const showFloatingPill = isCollectionLikePage
    ? scrollPct > 12
    : isScrollable && !commentsInView && !composerFocused;
  const composerExpanded = composerFocused || Boolean(commentDraft.trim()) || Boolean(replyTarget) || emojiPickerOpen;

  const renderCommentCard = (c: CommentItem, isChild = false, rootId?: string) => {
    const isAuthorBadge = c.isAuthor || c.authorName === detail.authorName;
    const expandedState = !isChild ? expandedChildMap[c.id] : undefined;
    const childList = expandedState ? expandedState.items : c.childComments;
    const canLoadMoreChildren = expandedState
      ? expandedState.hasMore && Boolean(expandedState.nextUrl)
      : c.childCount > childList.length;

    return (
      <div
        key={c.id}
        className={
          isChild
            ? 'comment-item border-t py-2.5 first:border-t-0'
            : 'comment-item border-b py-4 first:pt-2 last:border-b-0'
        }
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div className={`flex items-start ${isChild ? 'gap-2.5' : 'gap-3'}`}>
          {c.authorUrlToken ? (
            <button
              type="button"
              data-no-press="true"
              title={`查看 ${c.authorName} 的主页`}
              onClick={() => openUserProfile(c.authorUrlToken!, c.authorName)}
              className="mt-0.5 shrink-0 rounded-full hover:opacity-85"
            >
              {c.authorAvatar ? (
                <img
                  src={c.authorAvatar}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className={`${isChild ? 'h-[22px] w-[22px]' : 'h-8 w-8'} rounded-full object-cover`}
                  style={{ background: 'var(--bg-subtle)' }}
                />
              ) : (
                <div
                  className={`${
                    isChild ? 'h-[22px] w-[22px] text-[10px]' : 'h-8 w-8 text-xs'
                  } flex items-center justify-center rounded-full font-semibold`}
                  style={{ background: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                >
                  {c.authorName[0] || '知'}
                </div>
              )}
            </button>
          ) : c.authorAvatar ? (
            <img
              src={c.authorAvatar}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className={`${isChild ? 'mt-0.5 h-[22px] w-[22px]' : 'mt-0.5 h-8 w-8'} shrink-0 rounded-full object-cover`}
              style={{ background: 'var(--bg-subtle)' }}
            />
          ) : (
            <div
              className={`${
                isChild ? 'mt-0.5 h-[22px] w-[22px] text-[10px]' : 'mt-0.5 h-8 w-8 text-xs'
              } flex shrink-0 items-center justify-center rounded-full font-semibold`}
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-main)' }}
            >
              {c.authorName[0] || '知'}
            </div>
          )}

          <div className="min-w-0 flex-1">
            {/* Author & Reply Relationship Row */}
            <div
              className={`flex flex-wrap items-center gap-1.5 ${
                isChild ? 'comment-author-row-child' : 'comment-author-row'
              }`}
            >
              {c.authorUrlToken ? (
                <button
                  type="button"
                  data-no-press="true"
                  title={`查看 ${c.authorName} 的主页`}
                  onClick={() => openUserProfile(c.authorUrlToken!, c.authorName)}
                  className="font-semibold hover:text-[var(--accent)] hover:underline"
                  style={{ color: 'var(--text-main)' }}
                >
                  {c.authorName}
                </button>
              ) : (
                <span className="font-semibold" style={{ color: 'var(--text-main)' }}>
                  {c.authorName}
                </span>
              )}
              {isAuthorBadge && (
                <span
                  className="comment-badge rounded-full px-1.5 py-0.5 leading-none font-medium"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  作者
                </span>
              )}
              {c.replyToAuthor && (
                <span className="comment-reply-target inline-flex items-center gap-1">
                  <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>
                    ▸
                  </span>
                  {c.replyToAuthorUrlToken ? (
                    <button
                      type="button"
                      data-no-press="true"
                      title={`查看 ${c.replyToAuthor} 的主页`}
                      onClick={() => openUserProfile(c.replyToAuthorUrlToken!, c.replyToAuthor!)}
                      className="hover:text-[var(--accent)] hover:underline"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {c.replyToAuthor}
                    </button>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>{c.replyToAuthor}</span>
                  )}
                </span>
              )}
            </div>

            {/* Comment Body */}
            <div
              className={`zhihu-comment-html mt-1 ${isChild ? 'zhihu-comment-child' : ''}`}
              onClick={handleRichHtmlClick}
              dangerouslySetInnerHTML={{ __html: sanitizeZhihuHtml(c.contentHtml, 'comment') }}
            />

            {/* Unified Bottom Meta & Action Row */}
            <div
              className={`comment-meta-bar flex flex-wrap items-center justify-between gap-2 ${
                isChild ? 'comment-meta-bar-child mt-1.5' : 'mt-2'
              }`}
              style={{ color: 'var(--text-faint)' }}
            >
              <div className="flex items-center gap-1.5">
                {c.createdTime && <span>{formatShortTime(c.createdTime)}</span>}
                {c.createdTime && c.ipLocation && <span aria-hidden="true">·</span>}
                {c.ipLocation && <span>IP 属地{c.ipLocation}</span>}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  title={`回复 ${c.authorName}`}
                  onClick={() => {
                    if (!account.loggedIn) {
                      onToast('登录后即可回复评论', '登录知乎账号', onLogin);
                      return;
                    }
                    setReplyTarget({ id: c.id, authorName: c.authorName, rootId: rootId || c.id });
                    setComposerFocused(true);
                    window.requestAnimationFrame(() => {
                      composerBoxRef.current?.scrollIntoView({
                        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
                        block: 'nearest',
                      });
                      composerRef.current?.focus();
                    });
                  }}
                  className="comment-secondary-action inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <MessageCircle className="h-[1em] w-[1em]" />
                  <span>回复</span>
                </button>

                {c.isOwn && (
                  <button
                    type="button"
                    title="删除评论"
                    onClick={() => setPendingDeleteCommentId(c.id)}
                    className="comment-secondary-action inline-flex items-center rounded-md p-1 hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--danger)' }}
                  >
                    <Trash2 className="h-[1em] w-[1em]" />
                  </button>
                )}

                <button
                  type="button"
                  title={c.liked ? '取消点赞' : '赞同该评论'}
                  onClick={() => void handleToggleCommentLike(c.id, c.liked, rootId)}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-[var(--bg-hover)]"
                  style={{ color: c.liked ? 'var(--accent)' : 'var(--text-muted)' }}
                >
                  <ThumbsUp
                    className={`h-[1em] w-[1em] ${c.liked ? 'fill-current' : ''} ${
                      poppedCommentId === c.id ? 'vote-pop' : ''
                    }`}
                  />
                  {c.likeCount > 0 && <span className="tabular-nums">{formatCount(c.likeCount)}</span>}
                </button>
              </div>
            </div>

            {/* Secondary Reply Thread (soft tinted inset block) */}
            {!isChild && childList.length > 0 && (
              <div className="comment-thread-box mt-3 px-3.5 py-1">
                {childList.map((sub) => renderCommentCard(sub, true, c.id))}
                {canLoadMoreChildren && (
                  <div className="border-t pt-2 pb-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
                    <button
                      type="button"
                      disabled={loadingChildId === c.id}
                      onClick={() => void handleExpandChildComments(c.id, expandedState?.nextUrl || undefined)}
                      className="comment-expand-btn inline-flex items-center gap-1 font-medium hover:underline"
                      style={{ color: 'var(--accent)' }}
                    >
                      {loadingChildId === c.id
                        ? '正在展开回复...'
                        : expandedState
                          ? '继续展开更多回复'
                          : `展开全部 ${c.childCount} 条回复`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="relative flex h-full flex-col"
      style={
        {
          background: 'var(--bg-paper)',
          '--reading-font-family': readingFontStack,
          '--reader-font-size': `${settings.fontSize}px`,
          '--reader-line-height': String(settings.lineHeight),
          '--comment-font-family': commentFontStack,
          '--comment-font-size': `${settings.commentFontSize}px`,
        } as React.CSSProperties
      }
    >
      {renderTopBar()}

      {/* Floating In-Page Find Bar (Ctrl+F) */}
      {findPresence.mounted && (
        <div
          data-overlay={findOpen ? 'popover' : undefined}
          data-motion={findPresence.state}
          aria-hidden={!findOpen || undefined}
          inert={!findOpen || undefined}
          className="motion-dropdown tactile-pill app-no-drag absolute top-12 right-4 z-40 flex h-9 items-center gap-1.5 rounded-full px-3 text-xs"
        >
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
          <input
            ref={findInputRef}
            type="text"
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                stepFindHit(e.shiftKey ? -1 : 1);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setFindOpen(false);
              }
            }}
            placeholder="页内查找..."
            className="w-32 bg-transparent text-xs outline-none sm:w-36"
          />
          {findQuery.trim() && (
            <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {findCount > 0 ? `${findActiveIdx + 1}/${findCount}` : '0/0'}
            </span>
          )}
          <button
            type="button"
            title="上一个 (Shift+Enter)"
            onClick={() => stepFindHit(-1)}
            className="rounded-full p-1 hover:bg-[var(--bg-hover)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="下一个 (Enter)"
            onClick={() => stepFindHit(1)}
            className="rounded-full p-1 hover:bg-[var(--bg-hover)]"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="关闭查找 (Esc)"
            onClick={() => setFindOpen(false)}
            className="rounded-full p-1 hover:bg-[var(--bg-hover)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Main Scrollable Reading Sheet (Dedicated Question Detail Page OR Answer/Article/Pin Reader) */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (articleKey) readingScrollStore.set(articleKey, el.scrollTop);
          const total = el.scrollHeight - el.clientHeight;
          setIsScrollable(total > 80);
          setScrollPct(total > 60 ? Math.min(100, Math.max(0, Math.round((el.scrollTop / total) * 100))) : 0);
        }}
        className="scroll-area flex-1 px-5 pt-6 pb-16 sm:px-7 sm:pt-7"
      >
        {isQuestionPage ? (
          <div
            ref={proseRef}
            key={`${detail.kind}:${detail.id}`}
            className="article-enter mx-auto"
            style={{ maxWidth: `${settings.readerWidth}px` }}
          >
            {/* Question Topics */}
            {detail.questionTopics && detail.questionTopics.length > 0 && (
              <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                {detail.questionTopics.map((topic) => (
                  <span
                    key={topic}
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                    style={{ background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}
                  >
                    {topic}
                  </span>
                ))}
              </div>
            )}

            {/* Question Hero */}
            <h1 className="reader-question-title mb-2.5">{detail.title}</h1>

            {/* Question Stats (followers / visits / answers) */}
            {((detail.questionFollowerCount ?? 0) > 0 ||
              (detail.questionVisitCount ?? 0) > 0 ||
              (questionAnswersTotal || detail.questionAnswerCount || 0) > 0) && (
              <div
                className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums"
                style={{ color: 'var(--text-faint)' }}
              >
                {(detail.questionFollowerCount ?? 0) > 0 && (
                  <span>{formatCount(detail.questionFollowerCount!)} 关注</span>
                )}
                {(detail.questionVisitCount ?? 0) > 0 && (
                  <span>{formatCount(detail.questionVisitCount!)} 浏览</span>
                )}
                {(questionAnswersTotal || detail.questionAnswerCount || 0) > 0 && (
                  <span>{formatCount(questionAnswersTotal || detail.questionAnswerCount || 0)} 回答</span>
                )}
              </div>
            )}

            {/* Question Description (inline when short, smooth collapsible when long) */}
            {detail.questionDetailHtml && (() => {
              const plainText = detail.questionDetailHtml
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
              const hasRichMedia = /<img\b/i.test(detail.questionDetailHtml);
              if (!plainText && !hasRichMedia) return null;
              const isLongDesc = plainText.length > 360;
              return (
                <div className="mb-5">
                  {isLongDesc ? (
                    <>
                      <div
                        className="motion-collapse"
                        data-open={String(questionDescOpen)}
                        aria-hidden={!questionDescOpen || undefined}
                        inert={!questionDescOpen || undefined}
                      >
                        <div className="motion-collapse-inner">
                          <div
                            className="zhihu-prose mb-2 rounded-xl border p-4"
                            style={
                              {
                                borderColor: 'var(--border-color)',
                                background: 'var(--bg-list)',
                                '--reader-font-size': `${Math.max(13, settings.fontSize - 1)}px`,
                              } as React.CSSProperties
                            }
                            onClick={handleRichHtmlClick}
                            dangerouslySetInnerHTML={{ __html: safeQuestionHtml }}
                          />
                        </div>
                      </div>
                      {!questionDescOpen && (
                        <p
                          className="line-clamp-3 text-sm leading-relaxed"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {plainText}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => setQuestionDescOpen((v) => !v)}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-[var(--bg-hover)]"
                        style={{ color: 'var(--accent)' }}
                      >
                        <ChevronDown
                          className="motion-chevron h-3.5 w-3.5"
                          style={{ transform: questionDescOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        />
                        {questionDescOpen ? '收起问题描述' : '展开完整问题描述'}
                      </button>
                    </>
                  ) : (
                    <div
                      className="zhihu-prose rounded-xl border px-4 py-3"
                      style={
                        {
                          borderColor: 'var(--border-subtle)',
                          background: 'color-mix(in srgb, var(--bg-list) 65%, var(--bg-paper))',
                          '--reader-font-size': `${Math.max(13.5, settings.fontSize - 1)}px`,
                        } as React.CSSProperties
                      }
                      onClick={handleRichHtmlClick}
                      dangerouslySetInnerHTML={{ __html: safeQuestionHtml }}
                    />
                  )}
                </div>
              );
            })()}

            {/* Answer Stream Header */}
            <div
              className="mb-2 flex items-center justify-between gap-2 border-y py-3"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[14px] font-semibold">全部回答</span>
                <span className="font-mono text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>
                  {formatCount(questionAnswersTotal || detail.questionAnswerCount || questionAnswers.length)}
                </span>
              </div>

              <div className="inline-flex rounded-lg p-0.5 text-xs" style={{ background: 'var(--bg-subtle)' }}>
                {(
                  [
                    { id: 'default', label: '默认排序' },
                    { id: 'updated', label: '最新回答' },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      if (answerSort === s.id) return;
                      setAnswerSort(s.id);
                      const cached = detail.questionId ? questionAnswersStore.get(`${detail.questionId}:${s.id}`) : null;
                      if (cached) {
                        setQuestionAnswers(cached.items);
                        setQuestionAnswersTotal(cached.total);
                        setQuestionAnswersHasMore(cached.hasMore);
                        setQuestionAnswersOffset(cached.nextOffset);
                      } else {
                        void loadQuestionAnswers(s.id, false);
                      }
                    }}
                    className="rounded-md px-2.5 py-0.5 font-medium"
                    style={{
                      background: answerSort === s.id ? 'var(--bg-paper)' : 'transparent',
                      color: answerSort === s.id ? 'var(--text-main)' : 'var(--text-muted)',
                      boxShadow: answerSort === s.id ? '0 1px 2px rgba(15, 20, 28, 0.08)' : 'none',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Editorial Answer List on Question Detail Page */}
            <div>
              {questionAnswersLoading && questionAnswers.length === 0 ? (
                <div role="status" aria-label="正在加载问题回答">
                  {[0, 1, 2, 3].map((idx) => (
                    <div
                      key={idx}
                      className="border-b py-5 last:border-b-0"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="skeleton-shimmer h-7 w-7 shrink-0 rounded-full" />
                        <div className="space-y-1.5">
                          <div className="skeleton-shimmer h-3.5 w-24 rounded-md" />
                          <div className="skeleton-shimmer h-3 w-44 rounded-md opacity-70" />
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="skeleton-shimmer h-4 w-full rounded-md" />
                        <div className="skeleton-shimmer h-4 w-11/12 rounded-md" />
                        <div className="skeleton-shimmer h-4 w-3/4 rounded-md opacity-80" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : questionAnswers.length === 0 ? (
                <div className="py-16 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  该问题下暂时还没有回答，可稍后刷新或在浏览器中查看
                </div>
              ) : (
                questionAnswers.map((ans) => {
                  const ansKey = `answer:${ans.id}`;
                  const isVisited = Boolean(visitedKeys?.has(ansKey));
                  const openThisAnswer = () =>
                    onOpenDetail('answer', ans.id, {
                      title: detail.title,
                      url: `https://www.zhihu.com/question/${detail.id}/answer/${ans.id}`,
                    });
                  return (
                    <div
                      key={ans.id}
                      role="button"
                      tabIndex={0}
                      onClick={openThisAnswer}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openThisAnswer();
                        }
                      }}
                      className="feed-card group w-full cursor-pointer border-b px-3 py-4 text-left first:pt-3 hover:rounded-xl hover:bg-[var(--bg-hover)] last:border-b-0"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          {ans.authorUrlToken ? (
                            <button
                              type="button"
                              data-no-press="true"
                              title={`查看 ${ans.authorName} 的主页`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openUserProfile(ans.authorUrlToken!, ans.authorName);
                              }}
                              className="shrink-0 rounded-full hover:opacity-85"
                            >
                              {ans.authorAvatar ? (
                                <img
                                  src={ans.authorAvatar}
                                  alt=""
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  className="h-7 w-7 rounded-full object-cover"
                                  style={{ background: 'var(--bg-subtle)' }}
                                />
                              ) : (
                                <div
                                  className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
                                  style={{ background: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                                >
                                  {ans.authorName[0] || '知'}
                                </div>
                              )}
                            </button>
                          ) : ans.authorAvatar ? (
                            <img
                              src={ans.authorAvatar}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="h-7 w-7 shrink-0 rounded-full object-cover"
                              style={{ background: 'var(--bg-subtle)' }}
                            />
                          ) : (
                            <div
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                              style={{ background: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                            >
                              {ans.authorName[0] || '知'}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {ans.authorUrlToken ? (
                                <button
                                  type="button"
                                  data-no-press="true"
                                  title={`查看 ${ans.authorName} 的主页`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openUserProfile(ans.authorUrlToken!, ans.authorName);
                                  }}
                                  className="reader-author-name truncate font-semibold hover:text-[var(--accent)] hover:underline"
                                  style={{ color: isVisited ? 'var(--text-muted)' : 'var(--text-main)' }}
                                >
                                  {ans.authorName}
                                </button>
                              ) : (
                                <span
                                  className="reader-author-name truncate font-semibold"
                                  style={{ color: isVisited ? 'var(--text-muted)' : 'var(--text-main)' }}
                                >
                                  {ans.authorName}
                                </span>
                              )}
                              {isVisited && (
                                <span
                                  className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none"
                                  style={{ background: 'var(--bg-subtle)', color: 'var(--text-faint)' }}
                                >
                                  已读
                                </span>
                              )}
                            </div>
                            {ans.authorHeadline && (
                              <div className="reader-author-meta truncate" style={{ color: 'var(--text-faint)' }}>
                                {ans.authorHeadline}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {ans.excerpt && (
                        <div
                          className="question-answer-excerpt mt-2.5 line-clamp-4"
                          style={{ color: isVisited ? 'var(--text-muted)' : 'var(--text-main)' }}
                        >
                          {ans.excerpt}
                        </div>
                      )}

                      <div
                        className="mt-3 flex items-center justify-between gap-2 text-xs"
                        style={{ color: 'var(--text-faint)' }}
                      >
                        <div className="flex items-center gap-3.5">
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                            {formatCount(ans.voteupCount)}
                          </span>
                          {ans.commentCount > 0 && (
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
                              {formatCount(ans.commentCount)}
                            </span>
                          )}
                          {(ans.updatedTime || ans.createdTime) && (
                            <span>{formatShortTime(ans.updatedTime || ans.createdTime)}</span>
                          )}
                        </div>
                        <span
                          className="inline-flex items-center gap-0.5 font-medium opacity-60 group-hover:opacity-100"
                          style={{ color: 'var(--accent)' }}
                        >
                          阅读全文
                          <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </div>
                  );
                })
              )}

              {questionAnswersHasMore && (
                <div
                  ref={answersMoreSentinelRef}
                  className="py-5 text-center text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {questionAnswersLoading ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      正在加载更多回答...
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void loadQuestionAnswers(answerSort, true)}
                      className="rounded-lg border px-3.5 py-1.5 hover:bg-[var(--bg-hover)]"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      加载更多回答
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : isUserPage && detail.userProfile ? (
          <div
            ref={proseRef}
            key={`${detail.kind}:${detail.id}`}
            className="article-enter mx-auto"
            style={{ maxWidth: `${settings.readerWidth}px` }}
          >
            {(() => {
              const profile = detail.userProfile;
              const desc = profile.description?.trim();
              const showDesc = Boolean(desc && desc !== profile.headline?.trim());
              const tabItems: { id: UserContentTab; label: string; count: number }[] = [
                { id: 'answers', label: '回答', count: profile.answerCount },
                { id: 'articles', label: '文章', count: profile.articlesCount },
                { id: 'pins', label: '想法', count: profile.pinsCount },
              ];
              const emptyLabel =
                userTab === 'answers' ? '回答' : userTab === 'articles' ? '文章' : '想法';

              return (
                <>
                  {/* Profile Hero */}
                  <div className="mb-5 flex items-start gap-4">
                    {profile.avatarUrl ? (
                      <button
                        type="button"
                        title="查看大图头像"
                        onClick={() => {
                          setLightboxSrc(profile.avatarUrl!);
                          setLightboxRotate(0);
                          setLightboxScale(1);
                        }}
                        className="shrink-0 rounded-full hover:opacity-90"
                      >
                        <img
                          src={profile.avatarUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="h-16 w-16 rounded-full object-cover"
                          style={{ background: 'var(--bg-subtle)' }}
                        />
                      </button>
                    ) : (
                      <div
                        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold"
                        style={{ background: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                      >
                        {profile.name[0] || '知'}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h1 className="reader-question-title">{profile.name}</h1>
                        {profile.badges?.map((badge) => (
                          <span
                            key={badge}
                            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                          >
                            {badge}
                          </span>
                        ))}
                      </div>

                      {profile.headline && (
                        <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                          {profile.headline}
                        </p>
                      )}

                      {showDesc && (
                        <p
                          className="mt-2 whitespace-pre-line text-xs leading-relaxed"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {desc}
                        </p>
                      )}

                      <div
                        className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums"
                        style={{ color: 'var(--text-faint)' }}
                      >
                        <span>
                          <strong className="font-semibold" style={{ color: 'var(--text-main)' }}>
                            {formatCount(profile.followerCount)}
                          </strong>{' '}
                          关注者
                        </span>
                        <span>
                          <strong className="font-semibold" style={{ color: 'var(--text-main)' }}>
                            {formatCount(profile.followingCount)}
                          </strong>{' '}
                          关注了
                        </span>
                        {profile.voteupCount > 0 && (
                          <span>
                            <strong className="font-semibold" style={{ color: 'var(--text-main)' }}>
                              {formatCount(profile.voteupCount)}
                            </strong>{' '}
                            获赞
                          </span>
                        )}
                        {profile.ipLocation && <span>IP 属地{profile.ipLocation}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Content Tabs Header */}
                  <div
                    className="mb-2 flex items-center justify-between gap-2 border-y py-2.5"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="inline-flex rounded-lg p-0.5 text-xs" style={{ background: 'var(--bg-subtle)' }}>
                      {tabItems.map((tab) => {
                        const active = userTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => {
                              if (userTab === tab.id) return;
                              setUserTab(tab.id);
                              userActiveTabStore.set(profile.urlToken, tab.id);
                              const cached = userContentStore.get(`${profile.urlToken}:${tab.id}`);
                              if (cached) {
                                setUserItems(cached.items);
                                setUserHasMore(cached.hasMore);
                                setUserOffset(cached.nextOffset);
                                setUserLoadError(null);
                              } else {
                                setUserItems([]);
                                setUserHasMore(false);
                                setUserOffset(0);
                                void loadUserContent(tab.id, false);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium"
                            style={{
                              background: active ? 'var(--bg-paper)' : 'transparent',
                              color: active ? 'var(--text-main)' : 'var(--text-muted)',
                              boxShadow: active ? '0 1px 2px rgba(15, 20, 28, 0.08)' : 'none',
                            }}
                          >
                            <span>{tab.label}</span>
                            {tab.count > 0 && (
                              <span
                                className="font-mono text-[11px] tabular-nums"
                                style={{ color: active ? 'var(--text-muted)' : 'var(--text-faint)' }}
                              >
                                {formatCount(tab.count)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* User Content List */}
                  <div>
                    {userLoading && userItems.length === 0 ? (
                      <div role="status" aria-label={`正在加载用户的${emptyLabel}`}>
                        {[0, 1, 2, 3].map((idx) => (
                          <div
                            key={idx}
                            className="border-b py-5 last:border-b-0"
                            style={{ borderColor: 'var(--border-subtle)' }}
                          >
                            <div className="skeleton-shimmer h-4 w-3/4 rounded-md" />
                            <div className="mt-2.5 space-y-2">
                              <div className="skeleton-shimmer h-3.5 w-full rounded-md" />
                              <div className="skeleton-shimmer h-3.5 w-5/6 rounded-md opacity-80" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : userLoadError && userItems.length === 0 ? (
                      <div className="py-12 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                        <p className="mb-3">{userLoadError}</p>
                        <button
                          type="button"
                          onClick={() => void loadUserContent(userTab, false)}
                          className="rounded-lg border px-3.5 py-1.5 hover:bg-[var(--bg-hover)]"
                          style={{ borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
                        >
                          重试加载
                        </button>
                      </div>
                    ) : userItems.length === 0 ? (
                      <div className="py-16 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                        该用户暂时没有公开的{emptyLabel}
                      </div>
                    ) : (
                      userItems.map((item) => {
                        const isVisited = Boolean(visitedKeys?.has(item.key));
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() =>
                              onOpenDetail(item.kind, item.id, {
                                title: item.title,
                                url: item.url,
                              })
                            }
                            className="feed-card group w-full border-b px-3 py-4 text-left first:pt-3 hover:rounded-xl hover:bg-[var(--bg-hover)] last:border-b-0"
                            style={{ borderColor: 'var(--border-subtle)' }}
                          >
                            <div className="flex items-start gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="line-clamp-2 text-[15px] leading-snug font-semibold"
                                    style={{ color: isVisited ? 'var(--text-muted)' : 'var(--text-main)' }}
                                  >
                                    {item.title}
                                  </div>
                                  {isVisited && (
                                    <span
                                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none"
                                      style={{ background: 'var(--bg-subtle)', color: 'var(--text-faint)' }}
                                    >
                                      已读
                                    </span>
                                  )}
                                </div>

                                {item.summary && item.summary !== item.title && (
                                  <div
                                    className="question-answer-excerpt mt-2 line-clamp-3"
                                    style={{ color: 'var(--text-muted)' }}
                                  >
                                    {item.summary}
                                  </div>
                                )}

                                <div
                                  className="mt-2.5 flex items-center justify-between gap-2 text-xs"
                                  style={{ color: 'var(--text-faint)' }}
                                >
                                  <div className="flex items-center gap-3.5">
                                    {item.voteupCount > 0 && (
                                      <span className="inline-flex items-center gap-1 tabular-nums">
                                        <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                                        {formatCount(item.voteupCount)}
                                      </span>
                                    )}
                                    {item.commentCount > 0 && (
                                      <span className="inline-flex items-center gap-1 tabular-nums">
                                        <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
                                        {formatCount(item.commentCount)}
                                      </span>
                                    )}
                                    {item.createdTime && <span>{formatShortTime(item.createdTime)}</span>}
                                  </div>
                                  <span
                                    className="inline-flex items-center gap-0.5 font-medium opacity-60 group-hover:opacity-100"
                                    style={{ color: 'var(--accent)' }}
                                  >
                                    阅读全文
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  </span>
                                </div>
                              </div>

                              {settings.showThumbnails && item.thumbnailUrl && (
                                <img
                                  src={item.thumbnailUrl}
                                  alt=""
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  className="mt-0.5 h-16 w-22 shrink-0 rounded-lg object-cover"
                                  style={{ background: 'var(--bg-subtle)' }}
                                />
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}

                    {userHasMore && (
                      <div
                        ref={userMoreSentinelRef}
                        className="py-5 text-center text-xs"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {userLoading ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            正在加载更多{emptyLabel}...
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void loadUserContent(userTab, true)}
                            className="rounded-lg border px-3.5 py-1.5 hover:bg-[var(--bg-hover)]"
                            style={{ borderColor: 'var(--border-color)' }}
                          >
                            加载更多{emptyLabel}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        ) : (
        <article
          key={`${detail.kind}:${detail.id}`}
          className="article-enter mx-auto"
          style={{ maxWidth: `${settings.readerWidth}px` }}
        >
          {canOpenQuestionPage ? (
            <h1 className="reader-question-title mb-3">
              <button
                type="button"
                data-no-press="true"
                title="点击进入问题详情页，查看问题描述与全部回答"
                onClick={openQuestionDetailPage}
                className="text-left hover:text-[var(--accent)] hover:underline hover:decoration-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:underline-offset-4"
              >
                {detail.title}
              </button>
            </h1>
          ) : (
            <h1 className="reader-question-title mb-3">{detail.title}</h1>
          )}

          {/* Expandable Question Description */}
          {detail.questionDetailHtml && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setQuestionDescOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-[var(--bg-hover)]"
                style={{ color: 'var(--text-muted)' }}
              >
                <ChevronDown
                  className="motion-chevron h-3.5 w-3.5"
                  style={{ transform: questionDescOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
                {questionDescOpen ? '收起问题描述' : '展开问题描述'}
              </button>
              <div
                className="motion-collapse"
                data-open={String(questionDescOpen)}
                aria-hidden={!questionDescOpen || undefined}
                inert={!questionDescOpen || undefined}
              >
                <div className="motion-collapse-inner">
                  <div
                    className="zhihu-prose mt-2 rounded-xl border p-3.5 text-sm"
                    style={
                      {
                        borderColor: 'var(--border-color)',
                        background: 'var(--bg-list)',
                        '--reader-font-size': `${Math.max(13, settings.fontSize - 1.5)}px`,
                      } as React.CSSProperties
                    }
                    onClick={handleRichHtmlClick}
                    dangerouslySetInnerHTML={{ __html: safeQuestionHtml }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Author & Metadata Header (clickable author opens User Profile Page) */}
          <div
            className="mb-6 flex items-center justify-between gap-3 border-b pb-4"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {detail.authorUrlToken ? (
              <button
                type="button"
                data-no-press="true"
                title={`查看 ${detail.authorName} 的主页`}
                onClick={() => openUserProfile(detail.authorUrlToken!, detail.authorName)}
                className="group flex min-w-0 items-center gap-3 text-left"
              >
                {detail.authorAvatar ? (
                  <img
                    src={detail.authorAvatar}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-9 w-9 shrink-0 rounded-full object-cover group-hover:opacity-90"
                    style={{ background: 'var(--bg-subtle)' }}
                  />
                ) : (
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                    style={{ background: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                  >
                    {detail.authorName[0] || '知'}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="reader-author-name truncate font-semibold group-hover:text-[var(--accent)] group-hover:underline">
                    {detail.authorName}
                  </div>
                  <div className="reader-author-meta truncate" style={{ color: 'var(--text-muted)' }}>
                    {detail.authorHeadline || formatTime(detail.updatedTime || detail.createdTime)}
                  </div>
                </div>
              </button>
            ) : (
              <div className="flex min-w-0 items-center gap-3">
                {detail.authorAvatar ? (
                  <img
                    src={detail.authorAvatar}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-9 w-9 shrink-0 rounded-full object-cover"
                    style={{ background: 'var(--bg-subtle)' }}
                  />
                ) : (
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                    style={{ background: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                  >
                    {detail.authorName[0] || '知'}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="reader-author-name truncate font-semibold">{detail.authorName}</div>
                  <div className="reader-author-meta truncate" style={{ color: 'var(--text-muted)' }}>
                    {detail.authorHeadline || formatTime(detail.updatedTime || detail.createdTime)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Rich Prose Content */}
          <div
            ref={proseRef}
            className="zhihu-prose"
            data-limit-img={String(settings.limitImageHeight)}
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.getAttribute('data-copy-code') === '1') {
                const pre = target.parentElement?.querySelector('pre');
                if (pre?.textContent) {
                  void window.zhihuApi.copyText(pre.textContent);
                  target.dataset.copied = 'true';
                  target.textContent = '已复制 ✓';
                  const prevTimer = Number(target.dataset.copyTimer || 0);
                  if (prevTimer) window.clearTimeout(prevTimer);
                  const timerId = window.setTimeout(() => {
                    if (target.isConnected) {
                      delete target.dataset.copied;
                      target.textContent = '复制代码';
                    }
                  }, 1600);
                  target.dataset.copyTimer = String(timerId);
                  onToast('已复制代码块');
                }
                return;
              }
              const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
              if (anchor && !e.ctrlKey && !e.metaKey) {
                const internal = parseZhihuLink(anchor.href);
                if (internal) {
                  e.preventDefault();
                  onOpenDetail(internal.kind, internal.id);
                  return;
                }
              }
              if (target.tagName === 'IMG' && !target.classList.contains('zhihu-sticker')) {
                const src = (target as HTMLImageElement).src;
                if (src) {
                  setLightboxSrc(src);
                  setLightboxRotate(0);
                  setLightboxScale(1);
                }
              }
            }}
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />

          {/* Article Footer Action Summary (deduplicated: Vote + Next Answer + Timestamp) */}
          <div
            ref={footerRef}
            className="mt-9 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-xs"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
          >
            <div className="flex flex-wrap items-center gap-2">
              {canVote && (
                <div className="inline-flex overflow-hidden rounded-full">
                  <button
                    type="button"
                    onClick={() => {
                      if (detail.voting !== 1 && account.loggedIn) setVotePopTick((n) => n + 1);
                      void onVote(detail.voting === 1 ? 'neutral' : 'up');
                    }}
                    className="vote-segment-btn inline-flex h-8 min-w-[118px] items-center justify-center gap-1.5 px-3.5 font-semibold tabular-nums hover:opacity-90"
                    style={{
                      background: detail.voting === 1 ? 'var(--accent)' : 'var(--accent-soft)',
                      color: detail.voting === 1 ? '#fff' : 'var(--accent)',
                    }}
                  >
                    <ThumbsUp
                      key={votePopTick > 0 ? votePopTick : undefined}
                      className={`h-3.5 w-3.5 ${detail.voting === 1 ? 'fill-current' : ''} ${
                        votePopTick > 0 && detail.voting === 1 ? 'vote-pop' : ''
                      }`}
                    />
                    {detail.voting === 1 ? '已赞同' : '赞同'} {formatCount(detail.voteupCount)}
                  </button>
                  <button
                    type="button"
                    title={detail.voting === -1 ? '取消反对' : '反对'}
                    onClick={() => void onVote(detail.voting === -1 ? 'neutral' : 'down')}
                    className="vote-segment-btn ml-px inline-flex h-8 w-8 items-center justify-center hover:opacity-90"
                    style={{
                      background: detail.voting === -1 ? 'var(--accent)' : 'var(--accent-soft)',
                      color: detail.voting === -1 ? '#fff' : 'var(--accent)',
                    }}
                  >
                    <ThumbsDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {hasMultipleAnswers && (
                <button
                  type="button"
                  onClick={() => void stepQuestionAnswer(1)}
                  className="inline-flex h-8 items-center gap-1 rounded-full border px-3 font-medium hover:bg-[var(--bg-hover)]"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
                >
                  下一篇回答
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {(detail.updatedTime || detail.createdTime) && (
              <span>
                {detail.updatedTime && detail.createdTime && detail.updatedTime > detail.createdTime
                  ? `编辑于 ${formatTime(detail.updatedTime)}`
                  : `发布于 ${formatTime(detail.createdTime || detail.updatedTime)}`}
              </span>
            )}
          </div>

          {/* Comments Section (editorial borderless stream + soft-tinted sub-threads) */}
          <section id="reader-comments" ref={commentsRef} className="comment-section mt-8 pt-1">
            {/* Section Header: Count & Sort */}
            <div className="mb-3.5 flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <h2 className="comment-heading font-semibold tracking-tight">评论</h2>
                <span className="comment-meta-bar font-mono tabular-nums" style={{ color: 'var(--text-faint)' }}>
                  {formatCount(comments ? comments.total : detail.commentCount)}
                </span>
              </div>

              {(comments ? comments.total : detail.commentCount) > 1 && (
                <div className="inline-flex rounded-lg p-0.5 text-xs" style={{ background: 'var(--bg-subtle)' }}>
                  {(
                    [
                      { id: 'normal', label: '精选' },
                      { id: 'reverse', label: '最新' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setCommentOrder(opt.id);
                        void loadComments(undefined, opt.id);
                      }}
                      className="rounded-md px-2.5 py-0.5 font-medium"
                      style={{
                        background: commentOrder === opt.id ? 'var(--bg-paper)' : 'transparent',
                        color: commentOrder === opt.id ? 'var(--text-main)' : 'var(--text-muted)',
                        boxShadow: commentOrder === opt.id ? '0 1px 2px rgba(15, 20, 28, 0.08)' : 'none',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Compact Expandable Comment Composer */}
            <div
              ref={composerBoxRef}
              onFocus={() => setComposerFocused(true)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setComposerFocused(false);
                  setEmojiPickerOpen(false);
                }
              }}
              className="comment-composer mb-5 rounded-xl border px-3.5 py-2.5"
              style={{
                borderColor: composerExpanded ? 'color-mix(in srgb, var(--accent) 45%, var(--border-color))' : 'var(--border-color)',
                background: composerExpanded
                  ? 'var(--bg-paper)'
                  : 'color-mix(in srgb, var(--bg-list) 55%, var(--bg-paper))',
              }}
            >
              {account.loggedIn ? (
                <form onSubmit={handleSubmitComment}>
                  {replyTarget && (
                    <div
                      className="mb-2 flex items-center justify-between rounded-lg px-2.5 py-1 text-xs"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      <span>正在回复 {replyTarget.authorName}</span>
                      <button
                        type="button"
                        onClick={() => setReplyTarget(null)}
                        className="rounded p-0.5 hover:opacity-80"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}

                  <textarea
                    ref={composerRef}
                    rows={composerExpanded ? 2 : 1}
                    value={commentDraft}
                    onChange={(e) => updateDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        void handleSubmitComment(e);
                      }
                    }}
                    placeholder={
                      replyTarget
                        ? `回复 ${replyTarget.authorName}...（Ctrl+Enter 发送）`
                        : '写下你的想法...'
                    }
                    className="comment-composer-input block w-full resize-none bg-transparent outline-none"
                    style={{ color: 'var(--text-main)' }}
                  />

                  {/* Smoothly revealed action toolbar (collapses cleanly when idle) */}
                  <div
                    className="motion-collapse"
                    data-open={String(composerExpanded)}
                    aria-hidden={!composerExpanded || undefined}
                    inert={!composerExpanded || undefined}
                  >
                    <div className="motion-collapse-inner">
                      <div className="mt-2 flex items-center justify-between">
                        <button
                          type="button"
                          title={emojiPickerOpen ? '收起表情面板' : '插入知乎表情'}
                          onClick={() => setEmojiPickerOpen((v) => !v)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs hover:bg-[var(--bg-hover)]"
                          style={{
                            background: emojiPickerOpen ? 'var(--accent-soft)' : 'transparent',
                            color: emojiPickerOpen ? 'var(--accent)' : 'var(--text-muted)',
                          }}
                        >
                          <Smile className="h-3.5 w-3.5" />
                          <span>表情</span>
                        </button>

                        <div className="flex items-center gap-2.5">
                          <span className="hidden text-[11px] sm:inline" style={{ color: 'var(--text-faint)' }}>
                            Ctrl+Enter 发送
                          </span>
                          <button
                            type="submit"
                            disabled={!commentDraft.trim() || submittingComment}
                            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-medium text-white disabled:opacity-45"
                            style={{ background: 'var(--accent)' }}
                          >
                            <Send className="h-3 w-3" />
                            {submittingComment ? '发送中...' : '发布评论'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Inline downward emoji grid: smooth collapse, zero height when closed */}
                  <div
                    data-overlay={emojiPickerOpen ? 'popover' : undefined}
                    data-open={String(emojiPickerOpen)}
                    aria-hidden={!emojiPickerOpen || undefined}
                    inert={!emojiPickerOpen || undefined}
                    className="motion-collapse"
                  >
                    <div className="motion-collapse-inner">
                      <div className="mt-2.5 border-t pt-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
                        <div className="grid grid-cols-6 gap-1 sm:grid-cols-10">
                          {PICKER_EMOTICON_KEYS.map((name) => {
                            const src = ZHIHU_EMOTICONS[name];
                            if (!src) return null;
                            return (
                              <button
                                key={name}
                                type="button"
                                title={`[${name}]`}
                                onClick={() => insertEmoticonAtCursor(name)}
                                className="flex h-8 w-full items-center justify-center rounded-lg hover:bg-[var(--bg-hover)]"
                              >
                                <img
                                  src={src}
                                  alt={`[${name}]`}
                                  referrerPolicy="no-referrer"
                                  className="h-5 w-5 object-contain"
                                />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>登录知乎账号后即可发表评论与点赞互动</span>
                  <button
                    type="button"
                    onClick={onLogin}
                    className="shrink-0 rounded-full px-3 py-1 font-medium text-white"
                    style={{ background: 'var(--accent)' }}
                  >
                    登录知乎账号
                  </button>
                </div>
              )}
            </div>

            {commentsLoadError && !comments && (
              <div className="flex items-center justify-between rounded-xl border px-4 py-3 text-xs" style={{ borderColor: 'var(--border-color)' }}>
                <span style={{ color: 'var(--text-muted)' }}>{commentsLoadError}</span>
                <button
                  type="button"
                  onClick={() => void loadComments()}
                  className="rounded-lg border px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  重试加载评论
                </button>
              </div>
            )}

            {commentsLoading && !comments && (
              <div role="status" aria-label="正在加载评论">
                {[0, 1].map((idx) => (
                  <div
                    key={idx}
                    className="border-b py-4 first:pt-2 last:border-b-0"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="skeleton-shimmer mt-0.5 h-8 w-8 shrink-0 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <div className="skeleton-shimmer h-3.5 w-24 rounded-md" />
                        <div className="skeleton-shimmer h-3.5 w-11/12 rounded-md" />
                        <div className="skeleton-shimmer h-3.5 w-2/3 rounded-md opacity-80" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!comments && !commentsLoading && !commentsLoadError && detail.commentCount === 0 && (
              <div className="py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                暂无评论，写下第一条想法吧
              </div>
            )}

            {comments && (
              <div>
                {comments.items.length === 0 ? (
                  <div className="py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                    暂无评论，写下第一条想法吧
                  </div>
                ) : (
                  comments.items.map((c) => renderCommentCard(c, false))
                )}

                {comments.hasMore && comments.nextUrl && (
                  <div ref={commentsMoreSentinelRef} className="py-2 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                    {commentsLoadError ? (
                      <button
                        type="button"
                        onClick={() => void loadComments(comments.nextUrl!)}
                        className="rounded-lg border px-3 py-1 hover:bg-[var(--bg-hover)]"
                        style={{ borderColor: 'var(--border-color)' }}
                      >
                        加载更多评论失败，点击重试
                      </button>
                    ) : commentsLoading ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        正在加载更多评论...
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </section>
        </article>
        )}
      </div>

      {/* Floating Tactile Pill Action Bar (auto-hides when comments are in view or composer is focused) */}
      <div
        aria-hidden={!showFloatingPill || undefined}
        inert={!showFloatingPill || undefined}
        data-visible={String(showFloatingPill)}
        className="motion-floating-pill pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center"
      >
        <div
          className={`tactile-pill inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
            showFloatingPill ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
          style={{ color: 'var(--text-muted)' }}
        >
          {!isCollectionLikePage && canVote && (
            <button
              type="button"
              onClick={() => {
                if (detail.voting !== 1 && account.loggedIn) setVotePopTick((n) => n + 1);
                void onVote(detail.voting === 1 ? 'neutral' : 'up');
              }}
              className="inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium"
              style={{
                background: detail.voting === 1 ? 'var(--accent)' : 'var(--accent-soft)',
                color: detail.voting === 1 ? '#fff' : 'var(--accent)',
              }}
            >
              <ThumbsUp
                key={votePopTick > 0 ? votePopTick : undefined}
                className={`h-3 w-3 ${detail.voting === 1 ? 'fill-current' : ''} ${
                  votePopTick > 0 && detail.voting === 1 ? 'vote-pop' : ''
                }`}
              />
              <span className="tabular-nums">
                {detail.voteupCount > 0 ? formatCount(detail.voteupCount) : '赞同'}
              </span>
            </button>
          )}

          {!isCollectionLikePage && detail.commentCount > 0 && (
            <button
              type="button"
              title={settings.singleKeyShortcuts ? '跳至评论区 (C)' : '跳至评论区'}
              onClick={toggleJumpComments}
              className="inline-flex h-6 items-center gap-1 rounded-full px-2.5 font-medium hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            >
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="tabular-nums">{formatCount(detail.commentCount)}</span>
            </button>
          )}

          {!isCollectionLikePage && canOpenQuestionPage && (
            <>
              <span className="mx-0.5 h-3.5 w-px" style={{ background: 'var(--border-color)' }} />
              {hasMultipleAnswers && (
                <button
                  type="button"
                  title="上一篇同问题回答"
                  onClick={() => void stepQuestionAnswer(-1)}
                  className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                title="进入问题详情页，查看全部回答"
                onClick={openQuestionDetailPage}
                className="rounded-full px-1.5 font-medium hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
              >
                全部回答
              </button>
              {hasMultipleAnswers && (
                <button
                  type="button"
                  title="下一篇同问题回答"
                  onClick={() => void stepQuestionAnswer(1)}
                  className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}

          {scrollPct > 12 && (
            <>
              {!isCollectionLikePage && <span className="mx-0.5 h-3.5 w-px" style={{ background: 'var(--border-color)' }} />}
              <button
                type="button"
                title="回到顶部"
                onClick={() =>
                  scrollRef.current?.scrollTo({
                    top: 0,
                    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
                  })
                }
                className="inline-flex h-6 items-center gap-0.5 rounded-full px-2 font-mono text-[11px] tabular-nums hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
              >
                <ArrowUp className="h-3 w-3" />
                {scrollPct}%
              </button>
            </>
          )}
        </div>
      </div>

      {/* Confirm Dialog for Delete Comment */}
      <ConfirmDialog
        open={Boolean(pendingDeleteCommentId)}
        title="删除这条评论？"
        description="评论删除后无法恢复。"
        confirmLabel="删除评论"
        onConfirm={() => void confirmDeleteComment()}
        onCancel={() => setPendingDeleteCommentId(null)}
      />

      {/* Image Lightbox */}
      {lightboxPresence.mounted && activeLightboxSrc && (
        <div
          data-overlay={lightboxSrc ? 'lightbox' : undefined}
          data-motion={lightboxPresence.state}
          aria-hidden={!lightboxSrc || undefined}
          inert={!lightboxSrc || undefined}
          className="motion-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/82 p-6"
          onClick={() => setLightboxSrc(null)}
          onWheel={(e) => {
            e.stopPropagation();
            const delta = e.deltaY < 0 ? 0.15 : -0.15;
            setLightboxScale((s) => Math.min(3.5, Math.max(0.5, +(s + delta).toFixed(2))));
          }}
        >
          <div className="absolute top-5 right-5 flex items-center gap-2">
            <button
              type="button"
              title="向右旋转 90° (R)"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxRotate((r) => (r + 90) % 360);
              }}
              className="rounded-lg bg-white/15 p-2 text-white hover:bg-white/25"
            >
              <RotateCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="关闭大图 (Esc / 鼠标侧键)"
              onClick={() => setLightboxSrc(null)}
              className="rounded-lg bg-white/15 p-2 text-white hover:bg-white/25"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <img
            src={activeLightboxSrc}
            alt=""
            data-motion={lightboxPresence.state}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setLightboxScale((s) => (s > 1.05 ? 1 : 2));
            }}
            className="lightbox-img max-h-[88vh] max-w-[90vw] rounded-lg object-contain"
            style={{
              transform:
                lightboxPresence.state === 'closed'
                  ? `rotate(${lightboxRotate}deg) scale(${+(lightboxScale * 0.96).toFixed(3)})`
                  : `rotate(${lightboxRotate}deg) scale(${lightboxScale})`,
              opacity: lightboxPresence.state === 'closed' ? 0 : 1,
            }}
          />
        </div>
      )}
    </div>
  );
};
