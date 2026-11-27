import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, type FilterState, type HistoryEntry, type UserSettings } from '../shared/types';

export interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

interface FilterStoreData {
  keywords: string[];
  blockedAuthors: string[];
  seenKeys: string[];
}

const MAX_HISTORY = 500;
const MAX_SEEN = 3000;

export function getDataDir(): string {
  const override = process.env.ZHIHU_DESKTOP_DATA_DIR?.trim();
  const dir = override || path.join(os.homedir(), '.zhihu-desktop-v2');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp-${process.pid}`;
  const text = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    fs.writeFileSync(filePath, text, 'utf8');
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

export class LocalStorage {
  private readonly dir = getDataDir();
  private readonly settingsPath = path.join(this.dir, 'settings.json');
  private readonly boundsPath = path.join(this.dir, 'window-bounds.json');
  private readonly historyPath = path.join(this.dir, 'history.json');
  private readonly filterPath = path.join(this.dir, 'filters.json');

  private settings: UserSettings;
  private history: HistoryEntry[];
  private filters: FilterStoreData;

  constructor() {
    const rawSettings = readJson<Record<string, unknown>>(this.settingsPath, {});
    if (rawSettings.fontPreset === 'system') {
      rawSettings.fontPreset = 'sans';
    }
    this.settings = { ...DEFAULT_SETTINGS, ...(rawSettings as Partial<UserSettings>) };
    this.history = readJson<HistoryEntry[]>(this.historyPath, []);
    this.filters = {
      keywords: [],
      blockedAuthors: [],
      seenKeys: [],
      ...readJson<Partial<FilterStoreData>>(this.filterPath, {}),
    };
  }

  getSettings(): UserSettings {
    return { ...this.settings };
  }

  updateSettings(patch: Partial<UserSettings>): UserSettings {
    this.settings = { ...this.settings, ...patch };
    writeJsonAtomic(this.settingsPath, this.settings);
    return this.getSettings();
  }

  resetSettings(): UserSettings {
    this.settings = { ...DEFAULT_SETTINGS };
    writeJsonAtomic(this.settingsPath, this.settings);
    return this.getSettings();
  }

  getWindowBounds(): WindowBounds {
    const raw = readJson<Partial<WindowBounds>>(this.boundsPath, {});
    return {
      width: Math.max(840, Number(raw.width) || 1280),
      height: Math.max(580, Number(raw.height) || 820),
      x: typeof raw.x === 'number' && Number.isFinite(raw.x) ? raw.x : undefined,
      y: typeof raw.y === 'number' && Number.isFinite(raw.y) ? raw.y : undefined,
      maximized: Boolean(raw.maximized),
    };
  }

  saveWindowBounds(bounds: WindowBounds): void {
    writeJsonAtomic(this.boundsPath, bounds);
  }

  getHistory(): HistoryEntry[] {
    return this.history;
  }

  recordHistory(entry: Omit<HistoryEntry, 'visitedAt'>): void {
    const next: HistoryEntry = { ...entry, visitedAt: Date.now() };
    this.history = [next, ...this.history.filter((item) => item.key !== entry.key)].slice(0, MAX_HISTORY);
    writeJsonAtomic(this.historyPath, this.history);
  }

  clearHistory(): void {
    this.history = [];
    writeJsonAtomic(this.historyPath, this.history);
  }

  getFilterState(): FilterState {
    return {
      keywords: [...this.filters.keywords],
      blockedAuthors: [...this.filters.blockedAuthors],
      seenCount: this.filters.seenKeys.length,
    };
  }

  addKeyword(keyword: string): FilterState {
    const clean = keyword.trim();
    if (clean && !this.filters.keywords.includes(clean)) {
      this.filters.keywords.push(clean);
      writeJsonAtomic(this.filterPath, this.filters);
    }
    return this.getFilterState();
  }

  removeKeyword(keyword: string): FilterState {
    this.filters.keywords = this.filters.keywords.filter((k) => k !== keyword);
    writeJsonAtomic(this.filterPath, this.filters);
    return this.getFilterState();
  }

  addBlockedAuthor(author: string): FilterState {
    const clean = author.trim();
    if (clean && !this.filters.blockedAuthors.includes(clean)) {
      this.filters.blockedAuthors.push(clean);
      writeJsonAtomic(this.filterPath, this.filters);
    }
    return this.getFilterState();
  }

  removeBlockedAuthor(author: string): FilterState {
    this.filters.blockedAuthors = this.filters.blockedAuthors.filter((a) => a !== author);
    writeJsonAtomic(this.filterPath, this.filters);
    return this.getFilterState();
  }

  markSeen(keys: string[]): void {
    if (!keys.length) return;
    const set = new Set(this.filters.seenKeys);
    let changed = false;
    for (const k of keys) {
      if (!set.has(k)) {
        set.add(k);
        changed = true;
      }
    }
    if (changed) {
      this.filters.seenKeys = Array.from(set).slice(-MAX_SEEN);
      writeJsonAtomic(this.filterPath, this.filters);
    }
  }

  clearSeen(): FilterState {
    this.filters.seenKeys = [];
    writeJsonAtomic(this.filterPath, this.filters);
    return this.getFilterState();
  }

  shouldFilter(item: {
    title: string;
    summary: string;
    authorName: string;
    voteupCount: number;
    isVideo?: boolean;
    isPaid?: boolean;
  }): boolean {
    if (!this.settings.filterEnabled) return false;
    if (this.settings.filterHideVideo && item.isVideo) {
      return true;
    }
    if (this.settings.filterHidePaid && item.isPaid) {
      return true;
    }
    if (this.settings.filterMinVotes > 0 && item.voteupCount < this.settings.filterMinVotes) {
      return true;
    }
    if (this.filters.blockedAuthors.includes(item.authorName)) {
      return true;
    }
    const haystack = `${item.title} ${item.summary}`.toLowerCase();
    return this.filters.keywords.some((kw) => haystack.includes(kw.toLowerCase()));
  }
}
