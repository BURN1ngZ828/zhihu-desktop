import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Clock, Link2, Search, Trash2, X } from 'lucide-react';
import type { ContentKind, NavSection } from '@shared/types';
import { parseZhihuLink } from '@/utils/format';
import { usePresence } from '@/utils/usePresence';

const RECENT_SEARCH_KEY = 'zhihu_desktop_recent_searches_v2';

function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string' && s.trim()) : [];
  } catch {
    return [];
  }
}

function saveRecentSearches(items: string[]): void {
  try {
    localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(items.slice(0, 8)));
  } catch {
    // ignore storage quota errors
  }
}

interface SearchModalProps {
  open: boolean;
  initialQuery?: string;
  onClose: () => void;
  onSearch: (query: string) => void;
  onOpenDirect: (kind: ContentKind, id: string) => void;
  onJumpSection: (section: NavSection) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  open,
  initialQuery = '',
  onClose,
  onSearch,
  onOpenDirect,
  onJumpSection,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [recent, setRecent] = useState<string[]>(() => loadRecentSearches());
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const { mounted, state } = usePresence(open);

  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      setQuery(initialQuery);
      setRecent(loadRecentSearches());
      setActiveIdx(0);
    } else if (prevFocusRef.current) {
      const el = prevFocusRef.current;
      prevFocusRef.current = null;
      if (el.isConnected) el.focus();
    }
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open || !mounted) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, mounted]);

  const directMatch = useMemo(() => parseZhihuLink(query), [query]);

  if (!mounted) return null;

  const commitQuery = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const link = parseZhihuLink(trimmed);
    if (link) {
      onClose();
      onOpenDirect(link.kind, link.id);
      return;
    }
    const nextRecent = [trimmed, ...recent.filter((r) => r !== trimmed)].slice(0, 8);
    setRecent(nextRecent);
    saveRecentSearches(nextRecent);
    onClose();
    onSearch(trimmed);
  };

  const kindLabel: Record<ContentKind, string> = {
    answer: '知乎回答',
    article: '专栏文章',
    pin: '知乎想法',
    question: '知乎问题',
    user: '知乎用户主页',
  };

  return (
    <div
      role={open ? 'dialog' : undefined}
      aria-modal={open ? 'true' : undefined}
      aria-hidden={!open || undefined}
      inert={!open || undefined}
      data-motion={state}
      className="motion-backdrop fixed inset-0 z-50 flex items-start justify-center bg-black/28 px-4 pt-[12vh] backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-motion={state}
        className="motion-dialog tactile-pill w-full max-w-[520px] overflow-hidden rounded-2xl"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) {
              commitQuery(query);
            } else if (recent[activeIdx]) {
              commitQuery(recent[activeIdx]);
            }
          }}
          className="flex h-12 items-center gap-2.5 border-b px-4"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} strokeWidth={2} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              } else if (!query.trim() && recent.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveIdx((i) => (i + 1) % recent.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveIdx((i) => (i - 1 + recent.length) % recent.length);
                }
              }
            }}
            placeholder="搜索知乎内容，或粘贴问题 / 回答 / 专栏 / 想法 / 用户主页链接直达..."
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--text-main)' }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="rounded p-1 opacity-60 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            title="关闭搜索弹层 (Esc)"
            onClick={onClose}
            className="rounded border px-1.5 py-0.5 font-mono text-[11px] hover:bg-[var(--bg-hover)]"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}
          >
            Esc
          </button>
        </form>

        <div className="p-2.5 text-xs">
          {directMatch ? (
            <button
              type="button"
              onClick={() => commitQuery(query)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <span className="flex items-center gap-2 font-medium">
                <Link2 className="h-4 w-4 shrink-0" />
                已识别{kindLabel[directMatch.kind]}链接，回车直接打开阅读
              </span>
              <ArrowRight className="h-4 w-4 shrink-0" />
            </button>
          ) : query.trim() ? (
            <button
              type="button"
              onClick={() => commitQuery(query)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-[var(--bg-hover)]"
            >
              <span className="truncate">
                搜索「<strong className="font-semibold">{query.trim()}</strong>」
              </span>
              <span className="flex shrink-0 items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                回车搜索 <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </button>
          ) : (
            <div className="space-y-2.5">
              {recent.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between px-2" style={{ color: 'var(--text-muted)' }}>
                    <span>近期搜索</span>
                    <button
                      type="button"
                      onClick={() => {
                        setRecent([]);
                        saveRecentSearches([]);
                      }}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)]"
                    >
                      <Trash2 className="h-3 w-3" />
                      清空
                    </button>
                  </div>
                  <div className="space-y-0.5">
                    {recent.map((item, idx) => (
                      <div
                        key={item}
                        onMouseEnter={() => setActiveIdx(idx)}
                        className="flex items-center justify-between rounded-lg px-2.5 py-1.5"
                        style={{
                          background: idx === activeIdx ? 'var(--bg-hover)' : 'transparent',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => commitQuery(item)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                          <span className="truncate">{item}</span>
                        </button>
                        <button
                          type="button"
                          title="移除该记录"
                          onClick={() => {
                            const next = recent.filter((r) => r !== item);
                            setRecent(next);
                            saveRecentSearches(next);
                          }}
                          className="rounded p-0.5 opacity-50 hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t pt-2" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="mb-1.5 px-2" style={{ color: 'var(--text-muted)' }}>
                  快速切换栏目
                </div>
                <div className="flex flex-wrap gap-1.5 px-1.5">
                  {(
                    [
                      { id: 'home', label: '推荐' },
                      { id: 'follow', label: '关注' },
                      { id: 'hot', label: '热榜' },
                      { id: 'collections', label: '收藏' },
                      { id: 'history', label: '足迹' },
                    ] as const
                  ).map((sec) => (
                    <button
                      key={sec.id}
                      type="button"
                      onClick={() => {
                        onClose();
                        onJumpSection(sec.id);
                      }}
                      className="rounded-lg border px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      {sec.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
