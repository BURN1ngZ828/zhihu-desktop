export type ContentKind = 'answer' | 'article' | 'pin' | 'question' | 'user';
export type UserContentTab = 'answers' | 'articles' | 'pins';

export type NavSection = 'home' | 'follow' | 'hot' | 'collections' | 'history';

export type ThemeMode = 'system' | 'light' | 'dark';
export type PaperTone = 'warm' | 'modern' | 'gray';
export type FontPreset = 'sans' | 'serif' | 'wenkai' | 'yahei' | 'custom';
export type CommentFontPreset = 'sans' | 'follow' | 'serif' | 'wenkai' | 'yahei' | 'custom';
export type StartupSection = 'home' | 'follow' | 'hot' | 'collections';
export type CommentSortOrder = 'normal' | 'reverse';

export interface UserSettings {
  themeMode: ThemeMode;
  paperTone: PaperTone;
  fontPreset: FontPreset;
  customFontFamily: string;
  commentFontPreset: CommentFontPreset;
  commentCustomFontFamily: string;
  uiScale: number;
  fontSize: number;
  commentFontSize: number;
  feedFontSize: number;
  lineHeight: number;
  readerWidth: number;
  listWidth: number;
  layoutMode: 'split' | 'single';
  sidebarCollapsed: boolean;
  defaultSection: StartupSection;
  defaultCommentOrder: CommentSortOrder;
  showThumbnails: boolean;
  limitImageHeight: boolean;
  singleKeyShortcuts: boolean;
  minimizeToTray: boolean;
  launchOnStartup: boolean;
  markdownIncludeHeader: boolean;
  filterEnabled: boolean;
  filterMinVotes: number;
  filterHideVideo: boolean;
  filterHidePaid: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  themeMode: 'system',
  paperTone: 'warm',
  fontPreset: 'sans',
  customFontFamily: '',
  commentFontPreset: 'sans',
  commentCustomFontFamily: '',
  uiScale: 1,
  fontSize: 16,
  commentFontSize: 14,
  feedFontSize: 13,
  lineHeight: 1.78,
  readerWidth: 740,
  listWidth: 336,
  layoutMode: 'split',
  sidebarCollapsed: true,
  defaultSection: 'home',
  defaultCommentOrder: 'normal',
  showThumbnails: true,
  limitImageHeight: true,
  singleKeyShortcuts: true,
  minimizeToTray: true,
  launchOnStartup: false,
  markdownIncludeHeader: true,
  filterEnabled: true,
  filterMinVotes: 0,
  filterHideVideo: false,
  filterHidePaid: false,
};

export interface SystemFontItem {
  family: string;
  label: string;
}

export interface AccountInfo {
  loggedIn: boolean;
  id?: string;
  urlToken?: string;
  name?: string;
  avatarUrl?: string;
  headline?: string;
}

export interface UserProfile {
  urlToken: string;
  name: string;
  avatarUrl?: string;
  headline?: string;
  description?: string;
  ipLocation?: string;
  followerCount: number;
  followingCount: number;
  answerCount: number;
  articlesCount: number;
  pinsCount: number;
  voteupCount: number;
  thankedCount: number;
  badges?: string[];
}

export interface FeedItem {
  key: string;
  kind: ContentKind;
  id: string;
  questionId?: string;
  title: string;
  summary: string;
  authorName: string;
  authorUrlToken?: string;
  authorAvatar?: string;
  authorHeadline?: string;
  thumbnailUrl?: string;
  voteupCount: number;
  commentCount: number;
  createdTime?: number;
  hotMetrics?: string;
  isVideo?: boolean;
  isPaid?: boolean;
  url: string;
}

export interface FeedPage {
  items: FeedItem[];
  nextUrl?: string | null;
  hasMore: boolean;
}

export interface ArticleDetail {
  kind: ContentKind;
  id: string;
  questionId?: string;
  questionAnswerCount?: number;
  questionFollowerCount?: number;
  questionVisitCount?: number;
  questionTopics?: string[];
  questionDetailHtml?: string;
  questionAnswersPage?: QuestionAnswersPage;
  userProfile?: UserProfile;
  userInitialTab?: UserContentTab;
  userInitialPage?: FeedPage;
  title: string;
  contentHtml: string;
  authorName: string;
  authorUrlToken?: string;
  authorAvatar?: string;
  authorHeadline?: string;
  voteupCount: number;
  commentCount: number;
  voting: number; // 1 up, -1 down, 0 none
  isFavorited: boolean;
  createdTime?: number;
  updatedTime?: number;
  url: string;
}

export interface QuestionAnswerSummary {
  id: string;
  questionId: string;
  authorName: string;
  authorUrlToken?: string;
  authorAvatar?: string;
  authorHeadline?: string;
  excerpt: string;
  voteupCount: number;
  commentCount: number;
  createdTime?: number;
  updatedTime?: number;
}

export interface QuestionAnswersPage {
  items: QuestionAnswerSummary[];
  total: number;
  hasMore: boolean;
  nextOffset: number;
}

export interface CommentItem {
  id: string;
  contentHtml: string;
  authorName: string;
  authorUrlToken?: string;
  authorAvatar?: string;
  replyToAuthor?: string;
  replyToAuthorUrlToken?: string;
  ipLocation?: string;
  isAuthor?: boolean;
  likeCount: number;
  liked: boolean;
  createdTime?: number;
  childCount: number;
  childComments: CommentItem[];
  isOwn?: boolean;
}

export interface CommentsPage {
  items: CommentItem[];
  total: number;
  nextUrl?: string | null;
  hasMore: boolean;
}

export interface CollectionItem {
  id: string;
  title: string;
  description: string;
  itemCount: number;
  isPublic: boolean;
}

export interface HistoryEntry {
  key: string;
  kind: ContentKind;
  id: string;
  questionId?: string;
  title: string;
  summary: string;
  authorName: string;
  url: string;
  visitedAt: number;
}

export interface FilterState {
  keywords: string[];
  blockedAuthors: string[];
  seenCount: number;
}
