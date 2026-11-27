import { BrowserWindow, session, type Session } from 'electron';
import type {
  AccountInfo,
  ArticleDetail,
  CollectionItem,
  CommentItem,
  CommentsPage,
  ContentKind,
  FeedItem,
  FeedPage,
  QuestionAnswerSummary,
  QuestionAnswersPage,
  UserContentTab,
  UserProfile,
} from '../shared/types';
import type { LocalStorage } from './storage';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

export const ZHIHU_PARTITION = 'persist:zhihu-web';

function stripHtml(raw: string): string {
  return raw
    .replace(/<\/?(?:p|div|br|li|blockquote|h[1-6])\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizePinTitle(raw: string, fallback = '知乎想法'): string {
  if (!raw) return fallback;
  let text = raw;
  const pipeHtml = text.search(/\s*\|\s*<[a-z][^>]*>/i);
  if (pipeHtml > 0) text = text.slice(0, pipeHtml);
  text = stripHtml(text);
  if (!text) return fallback;
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function normalizeImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

function normalizeUrlToken(raw?: unknown): string | undefined {
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (!token || token === '0' || token === 'anonymous') return undefined;
  return token;
}

/**
 * Zhihu uses 64-bit Snowflake IDs (~1.9e18 - 2.2e18) that exceed Number.MAX_SAFE_INTEGER.
 * Quote unsafe integer literals before JSON.parse so question/answer/comment IDs never lose low digits.
 */
function parseJsonSafe<T>(raw: string): T {
  const protectedJson = raw.replace(
    /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (token) => {
      if (token.charCodeAt(0) === 34) return token;
      if (/^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token))) {
        return `"${token}"`;
      }
      return token;
    }
  );
  return JSON.parse(protectedJson) as T;
}

function contentPlural(kind: ContentKind): string {
  switch (kind) {
    case 'answer':
      return 'answers';
    case 'article':
      return 'articles';
    case 'pin':
      return 'pins';
    case 'question':
      return 'questions';
    case 'user':
      return 'members';
  }
}

function mapRawComment(c: any): CommentItem {
  const rawIp = String(c.address_text || '').trim();
  const ipLocation = rawIp ? rawIp.replace(/^IP\s*属地\s*/i, '').trim() : undefined;
  return {
    id: String(c.id || ''),
    contentHtml: String(c.content || ''),
    authorName: String(c.author?.member?.name || c.author?.name || '知乎用户'),
    authorUrlToken: normalizeUrlToken(c.author?.member?.url_token || c.author?.url_token),
    authorAvatar: normalizeImageUrl(c.author?.member?.avatar_url || c.author?.avatar_url),
    replyToAuthor: c.reply_to_author?.member?.name || c.reply_to_author?.name,
    replyToAuthorUrlToken: normalizeUrlToken(c.reply_to_author?.member?.url_token || c.reply_to_author?.url_token),
    ipLocation: ipLocation || undefined,
    isAuthor: Boolean(c.is_author || c.author?.role === 'author'),
    likeCount: Number(c.vote_count ?? c.like_count ?? 0),
    liked: Boolean(c.voting || c.liked),
    createdTime: Number(c.created_time || 0) || undefined,
    childCount: Number(c.child_comment_count || 0),
    childComments: Array.isArray(c.child_comments) ? c.child_comments.map(mapRawComment) : [],
    isOwn: Boolean(c.can_delete || c.is_delete),
  };
}

interface CachedQuestionMeta {
  title?: string;
  detailHtml?: string;
  followerCount?: number;
  visitCount?: number;
  answerCount?: number;
  commentCount?: number;
  topics?: string[];
}

export class ZhihuClient {
  private loginWindow: BrowserWindow | null = null;
  private readonly feedDetailCache = new Map<string, ArticleDetail>();
  private readonly questionMetaCache = new Map<string, CachedQuestionMeta>();

  constructor(private readonly storage: LocalStorage) {}

  private cacheQuestionMeta(questionId: string, meta: CachedQuestionMeta): void {
    const prev = this.questionMetaCache.get(questionId) || {};
    const merged: CachedQuestionMeta = {
      title: meta.title || prev.title,
      detailHtml: meta.detailHtml || prev.detailHtml,
      followerCount: meta.followerCount ?? prev.followerCount,
      visitCount: meta.visitCount ?? prev.visitCount,
      answerCount: meta.answerCount ?? prev.answerCount,
      commentCount: meta.commentCount ?? prev.commentCount,
      topics: meta.topics?.length ? meta.topics : prev.topics,
    };
    this.questionMetaCache.set(questionId, merged);
    if (this.questionMetaCache.size > 120) {
      const oldest = this.questionMetaCache.keys().next().value;
      if (oldest) this.questionMetaCache.delete(oldest);
    }
  }

  private cacheFeedDetail(detail: ArticleDetail): void {
    const key = `${detail.kind}:${detail.id}`;
    if (this.feedDetailCache.has(key)) this.feedDetailCache.delete(key);
    this.feedDetailCache.set(key, detail);
    if (this.feedDetailCache.size > 200) {
      const oldest = this.feedDetailCache.keys().next().value;
      if (oldest) this.feedDetailCache.delete(oldest);
    }
  }

  getSession(): Session {
    const sess = session.fromPartition(ZHIHU_PARTITION);
    sess.setUserAgent(CHROME_UA);
    return sess;
  }

  private async requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    const sess = this.getSession();
    const headers = new Headers(init?.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json, text/plain, */*');
    if (!headers.has('Referer')) headers.set('Referer', 'https://www.zhihu.com/');
    if (!headers.has('User-Agent')) headers.set('User-Agent', CHROME_UA);
    headers.set('x-requested-with', 'fetch');

    const method = (init?.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      const xsrfCookies = await sess.cookies.get({ domain: 'zhihu.com', name: '_xsrf' });
      const xsrf = xsrfCookies[0]?.value?.trim();
      if (xsrf && !headers.has('x-xsrftoken')) {
        headers.set('x-xsrftoken', xsrf);
      }
    }

    const resp = await sess.fetch(url, {
      ...init,
      headers,
    });
    if (!resp.ok) {
      if (resp.status === 404) {
        throw new Error('该内容已被删除或暂不可见。');
      }
      let serverMsg = '';
      let errCode = 0;
      let needLogin = false;
      const errText = await resp.text();
      if (errText) {
        try {
          const parsed = parseJsonSafe<{ error?: { message?: string; code?: number | string; need_login?: boolean } }>(
            errText
          );
          serverMsg = parsed.error?.message || '';
          errCode = Number(parsed.error?.code || 0);
          needLogin = Boolean(parsed.error?.need_login);
        } catch {
          // ignore non-json error body
        }
      }
      if (resp.status === 401 || needLogin || errCode === 40352 || errCode === 40353) {
        throw new Error('登录已过期或需要安全验证，重新登录后即可继续。');
      }
      if (resp.status === 403) {
        if (errCode === 10003 || errCode === 40362) {
          throw new Error('知乎暂限制客户端直接读取该内容，可在浏览器中查看原文。');
        }
        throw new Error(serverMsg || '当前暂无权限查看该内容，请重试或在浏览器中打开原文。');
      }
      throw new Error(serverMsg || `知乎服务响应异常（状态码 ${resp.status}），请稍后重试。`);
    }
    const text = await resp.text();
    if (!text.trim()) return {} as T;
    return parseJsonSafe<T>(text);
  }

  private async fetchArticleFromHtml(id: string): Promise<ArticleDetail | null> {
    const sess = this.getSession();
    const url = `https://zhuanlan.zhihu.com/p/${id}`;
    const resp = await sess.fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Referer: 'https://www.zhihu.com/',
        'User-Agent': CHROME_UA,
      },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const match = html.match(/<script[^>]*id=["']js-initialData["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match?.[1]) return null;
    try {
      const initData = parseJsonSafe<any>(match[1]);
      const articles = initData?.initialState?.entities?.articles;
      if (!articles || typeof articles !== 'object') return null;
      const art = articles[id] || Object.values(articles).find((v: any) => v && typeof v.content === 'string');
      if (!art || typeof art.content !== 'string' || !art.content.trim()) return null;
      const author = art.author || {};
      return {
        kind: 'article',
        id: String(art.id || id),
        title: stripHtml(String(art.title || '知乎专栏文章')),
        contentHtml: String(art.content || ''),
        authorName: String(author.name || '匿名作者'),
        authorUrlToken: normalizeUrlToken(author.urlToken || author.url_token),
        authorAvatar: normalizeImageUrl(author.avatarUrl || author.avatar_url),
        authorHeadline: stripHtml(String(author.headline || '')),
        voteupCount: Number(art.voteupCount ?? art.voteup_count ?? 0),
        commentCount: Number(art.commentCount ?? art.comment_count ?? 0),
        voting: Number(art.voting ?? 0),
        isFavorited: Boolean(art.isFavorited ?? art.is_favorited),
        createdTime: Number(art.created || 0) || undefined,
        updatedTime: Number(art.updated || 0) || undefined,
        url,
      };
    } catch {
      return null;
    }
  }

  private async fetchInitialDataFromPage(url: string): Promise<any | null> {
    try {
      const sess = this.getSession();
      const resp = await sess.fetch(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Referer: 'https://www.zhihu.com/',
          'User-Agent': CHROME_UA,
        },
      });
      if (!resp.ok) return null;
      const html = await resp.text();
      const match = html.match(/<script[^>]*id=["']js-initialData["'][^>]*>([\s\S]*?)<\/script>/i);
      if (!match?.[1]) return null;
      return parseJsonSafe<any>(match[1]);
    } catch {
      return null;
    }
  }

  private async fetchQuestionMetaFromHtml(id: string): Promise<CachedQuestionMeta | null> {
    const initData = await this.fetchInitialDataFromPage(`https://www.zhihu.com/question/${id}`);
    const questions = initData?.initialState?.entities?.questions;
    if (!questions || typeof questions !== 'object') return null;
    const q = questions[id] || Object.values(questions).find((v: any) => v && typeof v === 'object');
    if (!q) return null;
    const detailHtml =
      typeof q.detail === 'string' && q.detail.trim()
        ? q.detail
        : typeof q.excerpt === 'string' && q.excerpt.trim()
          ? `<p>${q.excerpt}</p>`
          : undefined;
    const topics: string[] = Array.isArray(q.topics)
      ? q.topics.map((t: any) => String(t?.name || '')).filter(Boolean).slice(0, 6)
      : [];
    return {
      title: q.title ? stripHtml(String(q.title)) : undefined,
      detailHtml,
      followerCount: Number(q.followerCount ?? q.follower_count ?? 0) || undefined,
      visitCount: Number(q.visitCount ?? q.visit_count ?? 0) || undefined,
      answerCount: Number(q.answerCount ?? q.answer_count ?? 0) || undefined,
      commentCount: Number(q.commentCount ?? q.comment_count ?? 0) || undefined,
      topics: topics.length ? topics : undefined,
    };
  }

  private mapRawUserProfile(raw: any, fallbackToken: string): UserProfile {
    const rawIp = String(raw?.ip_info || raw?.ipInfo || '').trim();
    const ipLocation = rawIp ? rawIp.replace(/^IP\s*属地\s*/i, '').trim() : undefined;
    const badges: string[] = [];
    if (Array.isArray(raw?.badge)) {
      for (const b of raw.badge) {
        if (typeof b?.description === 'string' && b.description.trim()) {
          badges.push(stripHtml(b.description));
        }
      }
    }
    return {
      urlToken: normalizeUrlToken(raw?.url_token || raw?.urlToken) || fallbackToken,
      name: String(raw?.name || '知乎用户'),
      avatarUrl: normalizeImageUrl(raw?.avatar_url_template?.replace('{size}', 'xl') || raw?.avatar_url || raw?.avatarUrl),
      headline: stripHtml(String(raw?.headline || '')),
      description: stripHtml(String(raw?.description || '')),
      ipLocation: ipLocation || undefined,
      followerCount: Number(raw?.follower_count ?? raw?.followerCount ?? 0),
      followingCount: Number(raw?.following_count ?? raw?.followingCount ?? 0),
      answerCount: Number(raw?.answer_count ?? raw?.answerCount ?? 0),
      articlesCount: Number(raw?.articles_count ?? raw?.articlesCount ?? 0),
      pinsCount: Number(raw?.pins_count ?? raw?.pinsCount ?? 0),
      voteupCount: Number(raw?.voteup_count ?? raw?.voteupCount ?? 0),
      thankedCount: Number(raw?.thanked_count ?? raw?.thankedCount ?? 0),
      badges: badges.length ? badges.slice(0, 3) : undefined,
    };
  }

  async getAccount(): Promise<AccountInfo> {
    try {
      const me = await this.requestJson<{
        id?: string;
        url_token?: string;
        name?: string;
        avatar_url?: string;
        headline?: string;
      }>('https://www.zhihu.com/api/v4/me');
      if (me && me.id) {
        return {
          loggedIn: true,
          id: me.id,
          urlToken: normalizeUrlToken(me.url_token),
          name: me.name || '知乎用户',
          avatarUrl: normalizeImageUrl(me.avatar_url),
          headline: me.headline || '',
        };
      }
      return { loggedIn: false };
    } catch {
      return { loggedIn: false };
    }
  }

  async openWebLogin(parent: BrowserWindow | null): Promise<{ ok: boolean; account?: AccountInfo; cancelled?: boolean }> {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.focus();
      return { ok: false, cancelled: true };
    }

    const sess = this.getSession();
    return new Promise((resolve) => {
      let finished = false;
      const done = async (result: { ok: boolean; account?: AccountInfo; cancelled?: boolean }) => {
        if (finished) return;
        finished = true;
        sess.cookies.removeListener('changed', onCookieChanged);
        if (this.loginWindow && !this.loginWindow.isDestroyed()) {
          this.loginWindow.close();
        }
        this.loginWindow = null;
        resolve(result);
      };

      const checkLogin = async () => {
        if (finished) return;
        const cookies = await sess.cookies.get({ domain: 'zhihu.com' });
        const hasZc0 = cookies.some((c) => c.name === 'z_c0' && c.value.trim().length > 0);
        if (!hasZc0) return;
        const account = await this.getAccount();
        if (account.loggedIn) {
          await done({ ok: true, account });
        }
      };

      const onCookieChanged = (_e: Electron.Event, cookie: Electron.Cookie, _cause: string, removed: boolean) => {
        if (!removed && cookie.name === 'z_c0' && cookie.value) {
          void checkLogin();
        }
      };

      sess.cookies.on('changed', onCookieChanged);

      const win = new BrowserWindow({
        width: 980,
        height: 700,
        parent: parent ?? undefined,
        autoHideMenuBar: true,
        title: '登录知乎账号',
        backgroundColor: '#FFFFFF',
        webPreferences: {
          partition: ZHIHU_PARTITION,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      this.loginWindow = win;
      win.webContents.setUserAgent(CHROME_UA);
      win.webContents.on('did-navigate', () => {
        void checkLogin();
      });
      win.on('closed', () => {
        this.loginWindow = null;
        void done({ ok: false, cancelled: true });
      });
      void win.loadURL('https://www.zhihu.com/signin?next=%2F');
    });
  }

  async logout(): Promise<AccountInfo> {
    const sess = this.getSession();
    await sess.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb'] });
    return { loggedIn: false };
  }

  private parseTargetToFeedItem(target: Record<string, any>, fallbackMetrics?: string): FeedItem | null {
    if (!target || typeof target !== 'object') return null;
    const rawType = String(target.type || '').toLowerCase();
    let kind: ContentKind;
    const id = String(target.id || '');
    let questionId: string | undefined;
    let title = '';
    let summary = '';
    let url = '';

    if (rawType === 'answer') {
      kind = 'answer';
      questionId = target.question?.id ? String(target.question.id) : undefined;
      title = stripHtml(String(target.question?.title || target.title || '无标题回答'));
      summary = stripHtml(String(target.excerpt || target.excerpt_new || target.content || ''));
      url = questionId
        ? `https://www.zhihu.com/question/${questionId}/answer/${id}`
        : `https://www.zhihu.com/answer/${id}`;
    } else if (rawType === 'article') {
      kind = 'article';
      title = stripHtml(String(target.title || '无标题文章'));
      summary = stripHtml(String(target.excerpt || target.excerpt_title || target.content || ''));
      url = `https://zhuanlan.zhihu.com/p/${id}`;
    } else if (rawType === 'pin') {
      kind = 'pin';
      title = sanitizePinTitle(String(target.excerpt_title || target.title || target.content_html || ''));
      summary = stripHtml(String(target.excerpt_title || target.content_html || ''));
      url = `https://www.zhihu.com/pin/${id}`;
    } else if (rawType === 'question') {
      kind = 'question';
      questionId = id;
      title = stripHtml(String(target.title || '无标题问题'));
      summary = stripHtml(String(target.excerpt || target.detail || ''));
      url = `https://www.zhihu.com/question/${id}`;
    } else {
      return null;
    }

    if (!id) return null;
    const author = target.author || {};
    const thumb =
      target.thumbnail ||
      target.thumbnail_extra_info?.url ||
      target.image_url ||
      target.children?.[0]?.thumbnail;

    const isVideo = Boolean(
      target.attachment?.type === 'video' ||
        target.thumbnail_extra_info?.type === 'video' ||
        target.video_info ||
        (typeof target.content === 'string' && /video-box|zvideo/i.test(target.content)) ||
        /^\[视频\]/.test(summary.trim())
    );
    const labelText = String(target.label_info?.text || target.content_mark || '');
    const isPaid = Boolean(
      target.is_paid ||
        target.paid_info ||
        target.relationship?.is_paid ||
        target.label_info?.type === 'paid' ||
        /盐选|付费专栏|会员专享/.test(labelText) ||
        /zhihu\.com\/(market|xen\/market)/i.test(url) ||
        /盐选专栏|解锁完整内容/.test(summary)
    );

    const authorName = String(author.name || (kind === 'question' ? '知乎问题' : '匿名用户'));
    const authorUrlToken = normalizeUrlToken(author.url_token);
    const authorAvatar = normalizeImageUrl(author.avatar_url);
    const authorHeadline = stripHtml(String(author.headline || ''));
    const voteupCount = Number(target.voteup_count ?? target.like_count ?? target.answer_count ?? 0);
    const commentCount = Number(target.comment_count ?? 0);
    const createdTime = Number(target.created_time || target.created || 0) || undefined;

    // Cache full HTML detail when Zhihu's feed payload already includes it (resilient fallback against API 403/10003)
    const rawContentHtml =
      kind === 'pin'
        ? typeof target.content_html === 'string'
          ? target.content_html.trim()
          : ''
        : typeof target.content === 'string'
          ? target.content.trim()
          : '';
    if ((kind === 'article' || kind === 'answer' || kind === 'pin') && rawContentHtml.length > 20) {
      this.cacheFeedDetail({
        kind,
        id,
        questionId,
        questionAnswerCount: Number(target.question?.answer_count || 0) || undefined,
        questionDetailHtml:
          typeof target.question?.detail === 'string' && target.question.detail.trim()
            ? target.question.detail
            : undefined,
        title,
        contentHtml: rawContentHtml,
        authorName,
        authorUrlToken,
        authorAvatar,
        authorHeadline,
        voteupCount,
        commentCount,
        voting: Number(target.relationship?.voting ?? target.voting ?? (target.is_liked ? 1 : 0)),
        isFavorited: Boolean(target.is_favorited),
        createdTime,
        updatedTime: Number(target.updated_time || target.updated || 0) || undefined,
        url,
      });
    }

    return {
      key: `${kind}:${id}`,
      kind,
      id,
      questionId,
      title,
      summary: summary.slice(0, 220),
      authorName,
      authorUrlToken,
      authorAvatar,
      authorHeadline,
      thumbnailUrl: normalizeImageUrl(typeof thumb === 'string' ? thumb : undefined),
      voteupCount,
      commentCount,
      createdTime,
      hotMetrics: fallbackMetrics,
      isVideo,
      isPaid,
      url,
    };
  }

  async fetchHomeFeed(nextUrl?: string): Promise<FeedPage> {
    const endpoint =
      nextUrl ||
      'https://www.zhihu.com/api/v3/feed/topstory/recommend?action=down&ad_interval=-10&after_id=0&desktop=true&page_number=1&limit=15';
    const data = await this.requestJson<{ data?: any[]; paging?: { next?: string; is_end?: boolean } }>(endpoint);
    const rawList = Array.isArray(data.data) ? data.data : [];
    const items: FeedItem[] = [];
    for (const row of rawList) {
      if (row?.type === 'feed_advert' || row?.ad_info) continue;
      const item = this.parseTargetToFeedItem(row?.target || row);
      if (item && !this.storage.shouldFilter(item)) {
        items.push(item);
      }
    }
    this.storage.markSeen(items.map((i) => i.key));
    return {
      items,
      nextUrl: data.paging?.next || null,
      hasMore: !data.paging?.is_end && Boolean(data.paging?.next),
    };
  }

  async fetchFollowFeed(nextUrl?: string): Promise<FeedPage> {
    const endpoint = nextUrl || 'https://www.zhihu.com/api/v3/moments?limit=15&desktop=true';
    const data = await this.requestJson<{ data?: any[]; paging?: { next?: string; is_end?: boolean } }>(endpoint);
    const items: FeedItem[] = [];
    for (const row of data.data || []) {
      const item = this.parseTargetToFeedItem(row?.target || row);
      if (item) items.push(item);
    }
    return {
      items,
      nextUrl: data.paging?.next || null,
      hasMore: !data.paging?.is_end && Boolean(data.paging?.next),
    };
  }

  async fetchHotList(): Promise<FeedPage> {
    const data = await this.requestJson<{ data?: any[] }>(
      'https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50&desktop=true'
    );
    const items: FeedItem[] = [];
    for (const row of data.data || []) {
      const metrics = typeof row?.detail_text === 'string' ? row.detail_text : undefined;
      const item = this.parseTargetToFeedItem(row?.target, metrics);
      if (item) {
        if (!item.thumbnailUrl && row?.children?.[0]?.thumbnail) {
          item.thumbnailUrl = normalizeImageUrl(row.children[0].thumbnail);
        }
        items.push(item);
      }
    }
    return { items, hasMore: false, nextUrl: null };
  }

  async fetchUserContent(urlToken: string, tab: UserContentTab = 'answers', offset = 0): Promise<FeedPage> {
    const limit = 15;
    const enc = encodeURIComponent(urlToken);
    const endpoint =
      tab === 'answers'
        ? `https://www.zhihu.com/api/v4/members/${enc}/answers?include=data[*].excerpt,content,voteup_count,comment_count,created_time,updated_time,question.title,question.id,author.headline&offset=${offset}&limit=${limit}&sort_by=created`
        : tab === 'articles'
          ? `https://www.zhihu.com/api/v4/members/${enc}/articles?include=data[*].excerpt,content,voteup_count,comment_count,created,updated,author.headline&offset=${offset}&limit=${limit}&sort_by=created`
          : `https://www.zhihu.com/api/v4/members/${enc}/pins?offset=${offset}&limit=${limit}`;

    const data = await this.requestJson<{ data?: any[]; paging?: { is_end?: boolean; next?: string } }>(endpoint);
    const rows = Array.isArray(data.data) ? data.data : [];
    const items: FeedItem[] = [];
    for (const row of rows) {
      const normalized =
        row && !row.type
          ? { ...row, type: tab === 'answers' ? 'answer' : tab === 'articles' ? 'article' : 'pin' }
          : row;
      const item = this.parseTargetToFeedItem(normalized);
      if (item) items.push(item);
    }
    return {
      items,
      nextUrl: data.paging?.next || null,
      hasMore: !data.paging?.is_end && rows.length >= limit,
    };
  }

  async fetchArticleDetail(kind: ContentKind, id: string): Promise<ArticleDetail> {
    if (kind === 'user') {
      const token = id.trim();
      let profile: UserProfile | null = null;
      let profileErr: unknown = null;
      try {
        const raw = await this.requestJson<any>(
          `https://www.zhihu.com/api/v4/members/${encodeURIComponent(token)}?include=headline,description,gender,follower_count,following_count,answer_count,articles_count,pins_count,voteup_count,thanked_count,badge[?(type=best_answerer)].topics,ip_info`
        );
        if (raw && (raw.name || raw.url_token)) {
          profile = this.mapRawUserProfile(raw, token);
        }
      } catch (err) {
        profileErr = err;
      }

      if (!profile) {
        const initData = await this.fetchInitialDataFromPage(`https://www.zhihu.com/people/${encodeURIComponent(token)}`);
        const users = initData?.initialState?.entities?.users;
        const u = users?.[token] || (users ? Object.values(users).find((v: any) => v && v.urlToken === token) : null);
        if (u) {
          profile = this.mapRawUserProfile(u, token);
        }
      }

      if (!profile) {
        throw profileErr instanceof Error ? profileErr : new Error('暂时无法打开该用户主页，请确认登录后重试。');
      }

      const initialTab: UserContentTab =
        profile.answerCount > 0 ? 'answers' : profile.articlesCount > 0 ? 'articles' : profile.pinsCount > 0 ? 'pins' : 'answers';
      let initialPage: FeedPage = { items: [], hasMore: false, nextUrl: null };
      try {
        initialPage = await this.fetchUserContent(profile.urlToken, initialTab, 0);
      } catch {
        // profile itself still renders cleanly even if content list fails
      }

      const detail: ArticleDetail = {
        kind: 'user',
        id: profile.urlToken,
        userProfile: profile,
        userInitialTab: initialTab,
        userInitialPage: initialPage,
        title: profile.name,
        contentHtml: profile.description || profile.headline || '',
        authorName: profile.name,
        authorUrlToken: profile.urlToken,
        authorAvatar: profile.avatarUrl,
        authorHeadline: profile.headline,
        voteupCount: profile.voteupCount,
        commentCount: 0,
        voting: 0,
        isFavorited: false,
        url: `https://www.zhihu.com/people/${profile.urlToken}`,
      };
      this.recordDetailHistory(detail);
      return detail;
    }

    if (kind === 'question') {
      const limit = 15;
      const [answersResult, htmlMeta] = await Promise.all([
        this.requestJson<{ data?: any[]; paging?: { totals?: number; is_end?: boolean } }>(
          `https://www.zhihu.com/api/v4/questions/${id}/answers?include=data[*].excerpt,content,voteup_count,comment_count,created_time,updated_time,relationship.voting,is_favorited,question.title,question.detail,question.answer_count,author.headline&limit=${limit}&offset=0&sort_by=default`
        ).catch((err) => ({ __error: err as unknown })),
        this.fetchQuestionMetaFromHtml(id),
      ]);

      let rows: any[] = [];
      let totals = 0;
      let isEnd = true;
      if ('__error' in answersResult) {
        const msg = answersResult.__error instanceof Error ? answersResult.__error.message : '';
        if (!htmlMeta && (msg.includes('删除') || msg.includes('登录'))) {
          throw answersResult.__error;
        }
      } else {
        rows = Array.isArray(answersResult.data) ? answersResult.data : [];
        totals = Number(rows[0]?.question?.answer_count ?? answersResult.paging?.totals ?? rows.length);
        isEnd = Boolean(answersResult.paging?.is_end);
      }

      const cachedMeta = this.questionMetaCache.get(String(id));
      let qTitle =
        htmlMeta?.title ||
        (rows[0]?.question?.title ? stripHtml(String(rows[0].question.title)) : '') ||
        cachedMeta?.title ||
        '';
      let qDetailHtml =
        htmlMeta?.detailHtml ||
        (typeof rows[0]?.question?.detail === 'string' && rows[0].question.detail.trim() ? rows[0].question.detail : '') ||
        cachedMeta?.detailHtml ||
        '';
      let qFollowerCount = htmlMeta?.followerCount ?? cachedMeta?.followerCount;
      let qVisitCount = htmlMeta?.visitCount ?? cachedMeta?.visitCount;
      let qTopics = htmlMeta?.topics ?? cachedMeta?.topics;
      let qComments = htmlMeta?.commentCount ?? cachedMeta?.commentCount ?? 0;

      // Crucial fallback: Zhihu's /questions/{id}/answers often omits question.detail, while /answers/{firstId}?include=question.detail succeeds!
      if (!qDetailHtml && rows[0]?.id) {
        try {
          const firstAns = await this.requestJson<any>(
            `https://www.zhihu.com/api/v4/answers/${rows[0].id}?include=question.title,question.detail,question.excerpt,question.follower_count,question.visit_count,question.comment_count,question.answer_count,question.topics`
          );
          const q = firstAns?.question;
          if (q) {
            if (!qTitle && q.title) qTitle = stripHtml(String(q.title));
            if (typeof q.detail === 'string' && q.detail.trim()) qDetailHtml = q.detail;
            else if (typeof q.excerpt === 'string' && q.excerpt.trim()) qDetailHtml = `<p>${q.excerpt}</p>`;
            if (!qFollowerCount && q.follower_count) qFollowerCount = Number(q.follower_count);
            if (!qVisitCount && q.visit_count) qVisitCount = Number(q.visit_count);
            if (!totals && q.answer_count) totals = Number(q.answer_count);
            if (!qComments && q.comment_count) qComments = Number(q.comment_count);
            if (!qTopics?.length && Array.isArray(q.topics)) {
              const tList = q.topics.map((t: any) => String(t?.name || '')).filter(Boolean).slice(0, 6);
              if (tList.length) qTopics = tList;
            }
          }
        } catch {
          // ignore if unavailable
        }
      }

      if (!qTitle || (!qDetailHtml && rows.length === 0)) {
        try {
          const qMeta = await this.requestJson<any>(
            `https://www.zhihu.com/api/v4/questions/${id}?include=detail,excerpt,comment_count,answer_count,follower_count,visit_count,topics`
          );
          if (!qTitle && qMeta?.title) qTitle = stripHtml(String(qMeta.title));
          if (!qDetailHtml && (qMeta?.detail || qMeta?.excerpt)) qDetailHtml = String(qMeta.detail || qMeta.excerpt);
          if (!totals && qMeta?.answer_count) totals = Number(qMeta.answer_count);
          if (!qFollowerCount && qMeta?.follower_count) qFollowerCount = Number(qMeta.follower_count);
          if (!qVisitCount && qMeta?.visit_count) qVisitCount = Number(qMeta.visit_count);
          qComments = Number(qMeta?.comment_count || qComments);
        } catch {
          // fallback to caller-supplied title in renderer if question metadata endpoint is restricted
        }
      }

      this.cacheQuestionMeta(String(id), {
        title: qTitle || undefined,
        detailHtml: qDetailHtml || undefined,
        followerCount: qFollowerCount,
        visitCount: qVisitCount,
        answerCount: totals || undefined,
        commentCount: qComments || undefined,
        topics: qTopics,
      });

      const answerItems: QuestionAnswerSummary[] = rows
        .filter((r) => r && r.id)
        .map((r) => {
          if (typeof r.content === 'string' && r.content.trim().length > 20) {
            this.cacheFeedDetail(
              this.buildAnswerDetail(r, qTitle || undefined, String(id), totals || undefined, qDetailHtml || undefined)
            );
          }
          return {
            id: String(r.id),
            questionId: String(r.question?.id || id),
            authorName: String(r.author?.name || '匿名用户'),
            authorUrlToken: normalizeUrlToken(r.author?.url_token),
            authorAvatar: normalizeImageUrl(r.author?.avatar_url),
            authorHeadline: stripHtml(String(r.author?.headline || '')),
            excerpt: stripHtml(String(r.excerpt || r.content || '')).slice(0, 260),
            voteupCount: Number(r.voteup_count || 0),
            commentCount: Number(r.comment_count || 0),
            createdTime: Number(r.created_time || 0) || undefined,
            updatedTime: Number(r.updated_time || 0) || undefined,
          };
        });

      const detail: ArticleDetail = {
        kind: 'question',
        id: String(id),
        questionId: String(id),
        questionAnswerCount: totals || htmlMeta?.answerCount || answerItems.length,
        questionFollowerCount: qFollowerCount,
        questionVisitCount: qVisitCount,
        questionTopics: qTopics,
        questionDetailHtml: qDetailHtml || undefined,
        questionAnswersPage: {
          items: answerItems,
          total: totals || htmlMeta?.answerCount || answerItems.length,
          hasMore: !isEnd && answerItems.length > 0,
          nextOffset: rows.length,
        },
        title: qTitle || '知乎问题',
        contentHtml: qDetailHtml,
        authorName: '知乎问题',
        voteupCount: 0,
        commentCount: qComments,
        voting: 0,
        isFavorited: false,
        url: `https://www.zhihu.com/question/${id}`,
      };
      this.recordDetailHistory(detail);
      return detail;
    }

    if (kind === 'answer') {
      try {
        const data = await this.requestJson<any>(
          `https://www.zhihu.com/api/v4/answers/${id}?include=content,voteup_count,comment_count,created_time,updated_time,relationship.voting,is_favorited,question.title,question.answer_count,question.detail,author.headline`
        );
        const detail = this.buildAnswerDetail(data);
        this.recordDetailHistory(detail);
        return detail;
      } catch (err) {
        const cached = this.feedDetailCache.get(`answer:${id}`);
        if (cached) {
          this.recordDetailHistory(cached);
          return cached;
        }
        throw err;
      }
    }

    if (kind === 'article') {
      let fromHtml: ArticleDetail | null = null;
      try {
        fromHtml = await this.fetchArticleFromHtml(id);
      } catch {
        fromHtml = null;
      }
      if (fromHtml) {
        this.recordDetailHistory(fromHtml);
        return fromHtml;
      }
      try {
        const data = await this.requestJson<any>(
          `https://www.zhihu.com/api/v4/articles/${id}?include=content,voteup_count,comment_count,created,updated,voting,is_favorited,author.headline`,
          { headers: { Referer: `https://zhuanlan.zhihu.com/p/${id}` } }
        );
        const detail: ArticleDetail = {
          kind: 'article',
          id: String(data.id || id),
          title: stripHtml(String(data.title || '知乎专栏文章')),
          contentHtml: String(data.content || ''),
          authorName: String(data.author?.name || '匿名作者'),
          authorUrlToken: normalizeUrlToken(data.author?.url_token),
          authorAvatar: normalizeImageUrl(data.author?.avatar_url),
          authorHeadline: stripHtml(String(data.author?.headline || '')),
          voteupCount: Number(data.voteup_count || 0),
          commentCount: Number(data.comment_count || 0),
          voting: Number(data.voting ?? 0),
          isFavorited: Boolean(data.is_favorited),
          createdTime: Number(data.created || 0) || undefined,
          updatedTime: Number(data.updated || 0) || undefined,
          url: `https://zhuanlan.zhihu.com/p/${id}`,
        };
        this.recordDetailHistory(detail);
        return detail;
      } catch (err) {
        const cached = this.feedDetailCache.get(`article:${id}`);
        if (cached) {
          this.recordDetailHistory(cached);
          return cached;
        }
        throw err;
      }
    }

    try {
      const data = await this.requestJson<any>(`https://www.zhihu.com/api/v4/pins/${id}`);
      const contentBlocks: string[] = [];
      if (typeof data.content_html === 'string' && data.content_html.trim()) {
        contentBlocks.push(data.content_html);
      } else if (Array.isArray(data.content)) {
        for (const blk of data.content) {
          if (blk?.type === 'text' && blk.content) contentBlocks.push(`<p>${blk.content}</p>`);
          if (blk?.type === 'image' && blk.url) contentBlocks.push(`<p><img src="${blk.url}" /></p>`);
        }
      }
      const detail: ArticleDetail = {
        kind: 'pin',
        id: String(data.id || id),
        title: sanitizePinTitle(String(data.excerpt_title || data.content_html || '')),
        contentHtml: contentBlocks.join('\n') || '<p>暂无正文内容</p>',
        authorName: String(data.author?.name || '匿名用户'),
        authorUrlToken: normalizeUrlToken(data.author?.url_token),
        authorAvatar: normalizeImageUrl(data.author?.avatar_url),
        authorHeadline: stripHtml(String(data.author?.headline || '')),
        voteupCount: Number(data.like_count ?? data.reaction_count ?? 0),
        commentCount: Number(data.comment_count ?? 0),
        voting: data.is_liked ? 1 : 0,
        isFavorited: Boolean(data.is_favorited),
        createdTime: Number(data.created || 0) || undefined,
        url: `https://www.zhihu.com/pin/${id}`,
      };
      this.recordDetailHistory(detail);
      return detail;
    } catch (err) {
      const cached = this.feedDetailCache.get(`pin:${id}`);
      if (cached) {
        this.recordDetailHistory(cached);
        return cached;
      }
      throw err;
    }
  }

  private buildAnswerDetail(
    data: any,
    fallbackTitle?: string,
    fallbackQuestionId?: string,
    fallbackAnsCount?: number,
    fallbackQuestionDetail?: string
  ): ArticleDetail {
    const qId = data.question?.id ? String(data.question.id) : fallbackQuestionId;
    const ansId = String(data.id || '');
    const qAnsCount = Number(data.question?.answer_count ?? fallbackAnsCount ?? 0) || undefined;
    const qDetail =
      typeof data.question?.detail === 'string' && data.question.detail.trim()
        ? data.question.detail
        : fallbackQuestionDetail;
    if (qId && (qDetail || data.question?.title)) {
      this.cacheQuestionMeta(qId, {
        title: data.question?.title ? stripHtml(String(data.question.title)) : fallbackTitle,
        detailHtml: qDetail,
        answerCount: qAnsCount,
      });
    }
    return {
      kind: 'answer',
      id: ansId,
      questionId: qId,
      questionAnswerCount: qAnsCount,
      questionDetailHtml: qDetail,
      title: stripHtml(String(data.question?.title || fallbackTitle || '知乎回答')),
      contentHtml: String(data.content || ''),
      authorName: String(data.author?.name || '匿名用户'),
      authorUrlToken: normalizeUrlToken(data.author?.url_token),
      authorAvatar: normalizeImageUrl(data.author?.avatar_url),
      authorHeadline: stripHtml(String(data.author?.headline || '')),
      voteupCount: Number(data.voteup_count || 0),
      commentCount: Number(data.comment_count || 0),
      voting: Number(data.relationship?.voting ?? 0),
      isFavorited: Boolean(data.is_favorited),
      createdTime: Number(data.created_time || 0) || undefined,
      updatedTime: Number(data.updated_time || 0) || undefined,
      url: qId ? `https://www.zhihu.com/question/${qId}/answer/${ansId}` : `https://www.zhihu.com/answer/${ansId}`,
    };
  }

  async fetchQuestionAnswers(
    questionId: string,
    offset = 0,
    sortBy: 'default' | 'updated' = 'default'
  ): Promise<QuestionAnswersPage> {
    const limit = 15;
    const data = await this.requestJson<{
      data?: any[];
      paging?: { is_end?: boolean; totals?: number };
    }>(
      `https://www.zhihu.com/api/v4/questions/${questionId}/answers?include=data[*].excerpt,content,voteup_count,comment_count,created_time,updated_time,relationship.voting,is_favorited,question.title,question.detail,question.answer_count,author.headline&limit=${limit}&offset=${offset}&sort_by=${sortBy}`
    );
    const rows = Array.isArray(data.data) ? data.data : [];
    const total = Number(rows[0]?.question?.answer_count ?? data.paging?.totals ?? rows.length);
    const items: QuestionAnswerSummary[] = rows
      .filter((r) => r && r.id)
      .map((r) => {
        if (typeof r.content === 'string' && r.content.trim().length > 20) {
          this.cacheFeedDetail(this.buildAnswerDetail(r, undefined, String(questionId), total || undefined));
        }
        return {
          id: String(r.id),
          questionId: String(r.question?.id || questionId),
          authorName: String(r.author?.name || '匿名用户'),
          authorUrlToken: normalizeUrlToken(r.author?.url_token),
          authorAvatar: normalizeImageUrl(r.author?.avatar_url),
          authorHeadline: stripHtml(String(r.author?.headline || '')),
          excerpt: stripHtml(String(r.excerpt || r.content || '')).slice(0, 260),
          voteupCount: Number(r.voteup_count || 0),
          commentCount: Number(r.comment_count || 0),
          createdTime: Number(r.created_time || 0) || undefined,
          updatedTime: Number(r.updated_time || 0) || undefined,
        };
      });
    return {
      items,
      total: Number(data.paging?.totals ?? total ?? items.length),
      hasMore: !data.paging?.is_end && items.length > 0,
      nextOffset: offset + rows.length,
    };
  }

  private recordDetailHistory(detail: ArticleDetail): void {
    const fallbackExcerpt =
      detail.kind === 'question'
        ? detail.questionDetailHtml || detail.questionAnswersPage?.items?.[0]?.excerpt || ''
        : detail.contentHtml;
    this.storage.recordHistory({
      key: `${detail.kind}:${detail.id}`,
      kind: detail.kind,
      id: detail.id,
      questionId: detail.questionId,
      title: detail.title,
      summary: stripHtml(fallbackExcerpt).slice(0, 140),
      authorName: detail.authorName,
      url: detail.url,
    });
  }

  async fetchComments(
    kind: ContentKind,
    id: string,
    nextUrl?: string,
    order: 'normal' | 'reverse' = 'normal'
  ): Promise<CommentsPage> {
    const plural = contentPlural(kind);
    const endpoint =
      nextUrl ||
      `https://www.zhihu.com/api/v4/${plural}/${id}/root_comments?order=${order}&limit=20&offset=0&status=open`;
    const data = await this.requestJson<{
      data?: any[];
      common_counts?: number;
      paging?: { next?: string; is_end?: boolean; totals?: number };
    }>(endpoint);

    return {
      items: (data.data || []).map(mapRawComment),
      total: Number(data.common_counts ?? data.paging?.totals ?? (data.data || []).length),
      nextUrl: data.paging?.next || null,
      hasMore: !data.paging?.is_end && Boolean(data.paging?.next),
    };
  }

  async fetchChildComments(commentId: string, nextUrl?: string): Promise<CommentsPage> {
    const endpoint =
      nextUrl || `https://www.zhihu.com/api/v4/comments/${commentId}/child_comments?limit=20&offset=0`;
    const data = await this.requestJson<{
      data?: any[];
      paging?: { next?: string; is_end?: boolean; totals?: number };
    }>(endpoint);
    return {
      items: (data.data || []).map(mapRawComment),
      total: Number(data.paging?.totals ?? (data.data || []).length),
      nextUrl: data.paging?.next || null,
      hasMore: !data.paging?.is_end && Boolean(data.paging?.next),
    };
  }

  async likeComment(commentId: string, like: boolean): Promise<{ liked: boolean }> {
    await this.requestJson<Record<string, unknown>>(
      `https://www.zhihu.com/api/v4/comments/${commentId}/actions/like`,
      {
        method: like ? 'POST' : 'DELETE',
      }
    );
    return { liked: like };
  }

  async submitComment(
    kind: ContentKind,
    id: string,
    content: string,
    replyToCommentId?: string
  ): Promise<CommentItem> {
    const plural = contentPlural(kind);
    const payload: Record<string, unknown> = { content: content.trim() };
    if (replyToCommentId) {
      payload.reply_comment_id = replyToCommentId;
    }
    const resp = await this.requestJson<any>(`https://www.zhihu.com/api/v4/${plural}/${id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return mapRawComment(resp);
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.requestJson<Record<string, unknown>>(`https://www.zhihu.com/api/v4/comments/${commentId}`, {
      method: 'DELETE',
    });
  }

  async voteContent(
    kind: ContentKind,
    id: string,
    action: 'up' | 'down' | 'neutral'
  ): Promise<{ voteupCount: number; voting: number }> {
    const pathPart = kind === 'article' ? `articles/${id}/voters` : `answers/${id}/voters`;
    const body = kind === 'article' ? { voting: action === 'up' ? 1 : action === 'down' ? -1 : 0 } : { type: action };
    const resp = await this.requestJson<{ voteup_count?: number; voting?: number }>(
      `https://www.zhihu.com/api/v4/${pathPart}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    return {
      voteupCount: Number(resp.voteup_count ?? 0),
      voting: action === 'up' ? 1 : action === 'down' ? -1 : 0,
    };
  }

  async search(query: string, offset = 0): Promise<FeedPage> {
    const q = encodeURIComponent(query.trim());
    const data = await this.requestJson<{ data?: any[]; paging?: { is_end?: boolean; next?: string } }>(
      `https://www.zhihu.com/api/v4/search_v3?t=general&q=${q}&correction=1&offset=${offset}&limit=20&show_all_topics=0`
    );
    const items: FeedItem[] = [];
    for (const row of data.data || []) {
      const obj = row?.object;
      if (!obj) continue;
      const item = this.parseTargetToFeedItem(obj);
      if (item) items.push(item);
    }
    return {
      items,
      nextUrl: data.paging?.next || null,
      hasMore: !data.paging?.is_end,
    };
  }

  async fetchCollections(): Promise<CollectionItem[]> {
    const me = await this.getAccount();
    if (!me.loggedIn || !me.id) return [];
    const data = await this.requestJson<{ data?: any[] }>(
      `https://www.zhihu.com/api/v4/members/${me.id}/collections?offset=0&limit=30&include=data[*].answer_count,follower_count,is_public,description`
    );
    return (data.data || []).map((c) => ({
      id: String(c.id || ''),
      title: String(c.title || '未命名收藏夹'),
      description: String(c.description || ''),
      itemCount: Number(c.item_count ?? c.answer_count ?? 0),
      isPublic: Boolean(c.is_public),
    }));
  }

  async fetchCollectionItems(collectionId: string, offset = 0): Promise<FeedPage> {
    const data = await this.requestJson<{ data?: any[]; paging?: { is_end?: boolean; next?: string } }>(
      `https://www.zhihu.com/api/v4/collections/${collectionId}/items?offset=${offset}&limit=20`
    );
    const items: FeedItem[] = [];
    for (const row of data.data || []) {
      const item = this.parseTargetToFeedItem(row?.content || row);
      if (item) items.push(item);
    }
    return {
      items,
      nextUrl: data.paging?.next || null,
      hasMore: !data.paging?.is_end,
    };
  }
}
