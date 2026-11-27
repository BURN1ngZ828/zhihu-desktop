import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, FolderOpen, LogIn, LogOut, Plus, RotateCcw, Search, User, X } from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  type AccountInfo,
  type CommentFontPreset,
  type CommentSortOrder,
  type FilterState,
  type FontPreset,
  type StartupSection,
  type SystemFontItem,
  type UserSettings,
} from '@shared/types';
import { resolveCommentFontStack, resolveFontStack } from '@/utils/format';
import { usePresence } from '@/utils/usePresence';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  open: boolean;
  onClose: () => void;
  settings: UserSettings;
  onUpdateSettings: (patch: Partial<UserSettings>) => void;
  onResetSettings: () => void;
  account: AccountInfo;
  onLogin: () => void;
  onLogout: () => void;
  filterState: FilterState;
  onAddKeyword: (kw: string) => void;
  onRemoveKeyword: (kw: string) => void;
  onRemoveAuthor: (author: string) => void;
  onClearSeen: () => void;
}

type TabId = 'reading' | 'filter' | 'general';

export const SettingsModal: React.FC<Props> = ({
  open,
  onClose,
  settings,
  onUpdateSettings,
  onResetSettings,
  account,
  onLogin,
  onLogout,
  filterState,
  onAddKeyword,
  onRemoveKeyword,
  onRemoveAuthor,
  onClearSeen,
}) => {
  const [tab, setTab] = useState<TabId>('reading');
  const [newKw, setNewKw] = useState('');
  const [systemFonts, setSystemFonts] = useState<SystemFontItem[]>([]);
  const [fontsLoading, setFontsLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const { mounted, state } = usePresence(open);

  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
    } else if (prevFocusRef.current) {
      const el = prevFocusRef.current;
      prevFocusRef.current = null;
      if (el.isConnected) el.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !mounted) return;
    closeBtnRef.current?.focus();
  }, [open, mounted]);

  useEffect(() => {
    if (!open || tab !== 'reading' || systemFonts.length > 0) return;
    setFontsLoading(true);
    window.zhihuApi
      .listSystemFonts()
      .then((list) => setSystemFonts(list))
      .finally(() => setFontsLoading(false));
  }, [open, tab, systemFonts.length]);

  if (!mounted) return null;

  return (
    <div
      role={open ? 'dialog' : undefined}
      aria-modal={open ? 'true' : undefined}
      aria-hidden={!open || undefined}
      inert={!open || undefined}
      data-motion={state}
      className="motion-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/42 p-4 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-motion={state}
        className="motion-dialog popover-surface flex h-[580px] max-h-[90vh] w-[740px] max-w-full flex-col overflow-hidden rounded-2xl sm:flex-row"
        style={{ background: 'var(--bg-paper)' }}
      >
        {/* Left tabs (top bar on narrow viewports) */}
        <div
          className="flex shrink-0 items-center gap-1 border-b p-2.5 sm:w-40 sm:flex-col sm:items-stretch sm:border-r sm:border-b-0 sm:p-3"
          style={{ background: 'var(--bg-list)', borderColor: 'var(--border-subtle)' }}
        >
          <div className="hidden px-2 pb-2 text-sm font-semibold sm:block">偏好设置</div>
          {(
            [
              { id: 'reading', label: '外观与排版' },
              { id: 'filter', label: '内容过滤' },
              { id: 'general', label: '通用与账号' },
            ] as const
          ).map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`rounded-xl px-3 py-1.5 text-left text-xs font-medium sm:mb-1 sm:py-2 ${
                  active ? 'tactile-list-active' : 'hover:bg-[var(--bg-hover)]'
                }`}
                style={{
                  color: active ? 'var(--accent)' : 'var(--text-main)',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Right body */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className="flex items-center justify-between border-b px-5 py-3"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <span className="text-sm font-semibold">
              {tab === 'reading' ? '外观与排版' : tab === 'filter' ? '内容过滤' : '通用与账号'}
            </span>
            <button
              ref={closeBtnRef}
              type="button"
              title="关闭 (Esc)"
              onClick={onClose}
              className="rounded-lg p-1.5 hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div key={tab} className="content-enter scroll-area flex-1 space-y-5 p-5 text-[13px]">
            {tab === 'reading' && (
              <>
                {/* Group 1: Appearance & Theme */}
                <SettingsGroup title="外观主题">
                  <SettingRow label="主题模式">
                    <Segmented
                      value={settings.themeMode}
                      options={[
                        { value: 'system', label: '跟随系统' },
                        { value: 'light', label: '浅色' },
                        { value: 'dark', label: '深色' },
                      ]}
                      onChange={(v) => onUpdateSettings({ themeMode: v })}
                    />
                  </SettingRow>

                  <SettingRow label="纸张底色">
                    <Segmented
                      value={settings.paperTone}
                      options={[
                        { value: 'warm', label: '护眼暖纸' },
                        { value: 'modern', label: '清爽白' },
                        { value: 'gray', label: '柔和灰' },
                      ]}
                      onChange={(v) => onUpdateSettings({ paperTone: v })}
                    />
                  </SettingRow>
                </SettingsGroup>

                {/* Group 2: Fonts & Live Dual Preview */}
                <SettingsGroup title="字体排版">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">正文字体</span>
                      <Segmented<FontPreset>
                        value={settings.fontPreset}
                        options={[
                          { value: 'sans', label: '无衬线' },
                          { value: 'serif', label: '思源宋体' },
                          { value: 'wenkai', label: '霞鹜楷体' },
                          { value: 'yahei', label: '微软雅黑' },
                          { value: 'custom', label: '本机字体' },
                        ]}
                        onChange={(v) => onUpdateSettings({ fontPreset: v })}
                      />
                    </div>

                    {settings.fontPreset === 'custom' && (
                      <SystemFontPicker
                        fonts={systemFonts}
                        loading={fontsLoading}
                        value={settings.customFontFamily}
                        onChange={(family) => onUpdateSettings({ customFontFamily: family })}
                      />
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">评论字体</span>
                      <Segmented<CommentFontPreset>
                        value={settings.commentFontPreset}
                        options={[
                          { value: 'sans', label: '清爽无衬线' },
                          { value: 'follow', label: '跟随正文' },
                          { value: 'serif', label: '思源宋体' },
                          { value: 'wenkai', label: '霞鹜楷体' },
                          { value: 'yahei', label: '微软雅黑' },
                          { value: 'custom', label: '本机字体' },
                        ]}
                        onChange={(v) => onUpdateSettings({ commentFontPreset: v })}
                      />
                    </div>

                    {settings.commentFontPreset === 'custom' && (
                      <SystemFontPicker
                        fonts={systemFonts}
                        loading={fontsLoading}
                        value={settings.commentCustomFontFamily}
                        onChange={(family) => onUpdateSettings({ commentCustomFontFamily: family })}
                      />
                    )}
                  </div>

                  {/* Dual Live Preview: Article Prose + Comment */}
                  <div
                    className="space-y-2.5 rounded-xl border px-3.5 py-3"
                    style={{
                      borderColor: 'var(--border-color)',
                      background: 'var(--bg-list)',
                    }}
                  >
                    <div>
                      <div className="mb-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                        正文预览
                      </div>
                      <div
                        style={{
                          fontFamily: resolveFontStack(settings.fontPreset, settings.customFontFamily),
                          fontSize: `${Math.min(18, settings.fontSize)}px`,
                          lineHeight: settings.lineHeight,
                        }}
                      >
                        暖纸阅读容器保持舒适的行宽与段间呼吸感（Typography 123）。
                      </div>
                    </div>

                    <div className="border-t pt-2" style={{ borderColor: 'var(--border-subtle)' }}>
                      <div className="mb-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                        评论预览（整条按比例联动）
                      </div>
                      <div
                        style={{
                          fontFamily: resolveCommentFontStack(
                            settings.commentFontPreset,
                            settings.commentCustomFontFamily,
                            resolveFontStack(settings.fontPreset, settings.customFontFamily)
                          ),
                        }}
                      >
                        <div
                          className="flex items-center gap-1.5 font-semibold"
                          style={{ fontSize: `${Math.max(12.5, +(settings.commentFontSize * 0.93).toFixed(1))}px` }}
                        >
                          <span>知乎读者</span>
                          <span
                            className="rounded-full px-1.5 py-0.5 leading-none font-medium"
                            style={{
                              fontSize: `${Math.max(10, +(settings.commentFontSize * 0.72).toFixed(1))}px`,
                              background: 'var(--accent-soft)',
                              color: 'var(--accent)',
                            }}
                          >
                            作者
                          </span>
                        </div>
                        <div
                          className="mt-1"
                          style={{
                            fontSize: `${settings.commentFontSize}px`,
                            lineHeight: 1.66,
                          }}
                        >
                          确实，正文用衬线体沉浸阅读，评论区整条按比例缩放会舒服很多。
                        </div>
                        <div
                          className="mt-1 flex items-center gap-2"
                          style={{
                            fontSize: `${Math.max(11, +(settings.commentFontSize * 0.82).toFixed(1))}px`,
                            color: 'var(--text-faint)',
                          }}
                        >
                          <span>3 分钟前 · IP 属地上海</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </SettingsGroup>

                {/* Group 3: Scale, Sizes & Column Width (all sliders with one-click reset) */}
                <SettingsGroup title="字号与版心">
                  <SliderRow
                    label="界面缩放"
                    valueText={`${Math.round(settings.uiScale * 100)}%`}
                    value={settings.uiScale}
                    defaultValue={DEFAULT_SETTINGS.uiScale}
                    min={0.8}
                    max={1.35}
                    step={0.05}
                    resetTitle="复位 100%"
                    onChange={(v) => onUpdateSettings({ uiScale: v })}
                  />

                  <SliderRow
                    label="正文字号"
                    valueText={`${settings.fontSize}px`}
                    value={settings.fontSize}
                    defaultValue={DEFAULT_SETTINGS.fontSize}
                    min={13}
                    max={22}
                    step={0.5}
                    resetTitle={`复位 ${DEFAULT_SETTINGS.fontSize}px`}
                    onChange={(v) => onUpdateSettings({ fontSize: v })}
                  />

                  <SliderRow
                    label="评论字号"
                    valueText={`${settings.commentFontSize}px`}
                    value={settings.commentFontSize}
                    defaultValue={DEFAULT_SETTINGS.commentFontSize}
                    min={12.5}
                    max={18}
                    step={0.5}
                    resetTitle={`复位 ${DEFAULT_SETTINGS.commentFontSize}px`}
                    onChange={(v) => onUpdateSettings({ commentFontSize: v })}
                  />

                  <SliderRow
                    label="信息流字号"
                    valueText={`${settings.feedFontSize}px`}
                    value={settings.feedFontSize}
                    defaultValue={DEFAULT_SETTINGS.feedFontSize}
                    min={12}
                    max={16}
                    step={0.5}
                    resetTitle={`复位 ${DEFAULT_SETTINGS.feedFontSize}px`}
                    onChange={(v) => onUpdateSettings({ feedFontSize: v })}
                  />

                  <SliderRow
                    label="正文行高"
                    valueText={settings.lineHeight.toFixed(2)}
                    value={settings.lineHeight}
                    defaultValue={DEFAULT_SETTINGS.lineHeight}
                    min={1.45}
                    max={2.1}
                    step={0.05}
                    resetTitle={`复位 ${DEFAULT_SETTINGS.lineHeight.toFixed(2)}`}
                    onChange={(v) => onUpdateSettings({ lineHeight: v })}
                  />

                  <SliderRow
                    label="阅读版心宽度"
                    valueText={`${settings.readerWidth}px`}
                    value={settings.readerWidth}
                    defaultValue={DEFAULT_SETTINGS.readerWidth}
                    min={600}
                    max={960}
                    step={20}
                    resetTitle={`复位 ${DEFAULT_SETTINGS.readerWidth}px`}
                    onChange={(v) => onUpdateSettings({ readerWidth: v })}
                  />
                </SettingsGroup>

                {/* Group 4: Layout & Media */}
                <SettingsGroup title="视图与图片">
                  <SettingRow label="视图布局">
                    <Segmented
                      value={settings.layoutMode}
                      options={[
                        { value: 'split', label: '分栏阅读' },
                        { value: 'single', label: '单栏阅读' },
                      ]}
                      onChange={(v) => onUpdateSettings({ layoutMode: v })}
                    />
                  </SettingRow>

                  <ToggleRow
                    label="显示信息流右侧缩略图"
                    checked={settings.showThumbnails}
                    onChange={(v) => onUpdateSettings({ showThumbnails: v })}
                  />

                  <ToggleRow
                    label="限制正文长图最大显示高度"
                    checked={settings.limitImageHeight}
                    onChange={(v) => onUpdateSettings({ limitImageHeight: v })}
                  />
                </SettingsGroup>
              </>
            )}

            {tab === 'filter' && (
              <>
                <SettingsGroup title="推荐流规则">
                  <ToggleRow
                    label="启用推荐流内容过滤"
                    desc="自动隐藏命中关键词、已屏蔽作者、低于赞同门槛或指定类型的推荐内容"
                    checked={settings.filterEnabled}
                    onChange={(v) => onUpdateSettings({ filterEnabled: v })}
                  />

                  <ToggleRow
                    label="隐藏视频回答与视频动态"
                    desc="在推荐流中跳过附带视频卡片的条目，聚焦图文阅读"
                    checked={settings.filterHideVideo}
                    onChange={(v) => onUpdateSettings({ filterHideVideo: v })}
                  />

                  <ToggleRow
                    label="隐藏盐选付费截断内容"
                    desc="在推荐流中跳过盐选专栏与付费会员截断回答"
                    checked={settings.filterHidePaid}
                    onChange={(v) => onUpdateSettings({ filterHidePaid: v })}
                  />

                  <SliderRow
                    label="最低赞同数门槛"
                    valueText={settings.filterMinVotes === 0 ? '不限制' : String(settings.filterMinVotes)}
                    value={settings.filterMinVotes}
                    defaultValue={0}
                    min={0}
                    max={500}
                    step={10}
                    resetTitle="复位为不限制"
                    onChange={(v) => onUpdateSettings({ filterMinVotes: v })}
                  />
                </SettingsGroup>

                <SettingsGroup title="屏蔽词库与去重">
                  <div className="space-y-2">
                    <div className="font-medium">屏蔽关键词</div>
                    <div className="flex gap-2">
                      <input
                        value={newKw}
                        onChange={(e) => setNewKw(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                          if (e.key === 'Enter' && newKw.trim()) {
                            onAddKeyword(newKw.trim());
                            setNewKw('');
                          }
                        }}
                        placeholder="输入要屏蔽的关键词并回车..."
                        className="flex-1 rounded-lg border px-3 py-1.5 text-xs outline-none"
                        style={{ background: 'var(--bg-list)', borderColor: 'var(--border-color)' }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (newKw.trim()) {
                            onAddKeyword(newKw.trim());
                            setNewKw('');
                          }
                        }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                        style={{ background: 'var(--accent)' }}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        添加
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {filterState.keywords.length === 0 ? (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          暂无屏蔽关键词
                        </span>
                      ) : (
                        filterState.keywords.map((kw) => (
                          <span
                            key={kw}
                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                            style={{ background: 'var(--bg-subtle)' }}
                          >
                            {kw}
                            <button
                              type="button"
                              title={`移除关键词「${kw}」`}
                              onClick={() => onRemoveKeyword(kw)}
                              className="rounded-full p-0.5 opacity-65 hover:bg-[var(--bg-hover)] hover:opacity-100"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  {filterState.blockedAuthors.length > 0 && (
                    <div className="space-y-2">
                      <div className="font-medium">已屏蔽作者</div>
                      <div className="flex flex-wrap gap-1.5">
                        {filterState.blockedAuthors.map((author) => (
                          <span
                            key={author}
                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                            style={{ background: 'var(--bg-subtle)' }}
                          >
                            {author}
                            <button
                              type="button"
                              title={`取消屏蔽「${author}」`}
                              onClick={() => onRemoveAuthor(author)}
                              className="rounded-full p-0.5 opacity-65 hover:bg-[var(--bg-hover)] hover:opacity-100"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <SettingRow label={`已读去重记录（${filterState.seenCount} 条）`}>
                    <button
                      type="button"
                      disabled={filterState.seenCount === 0}
                      onClick={() =>
                        setConfirmAction({
                          title: '清空已读去重记录？',
                          description: '清空后，此前在推荐流刷过的内容可能会重新出现。',
                          confirmLabel: '清空记录',
                          onConfirm: () => {
                            setConfirmAction(null);
                            onClearSeen();
                          },
                        })
                      }
                      className="shrink-0 rounded-lg border px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] disabled:opacity-45"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      清空去重记录
                    </button>
                  </SettingRow>
                </SettingsGroup>
              </>
            )}

            {tab === 'general' && (
              <>
                <div
                  className="flex items-center justify-between gap-3 rounded-xl border p-4"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-list)' }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {account.avatarUrl ? (
                      <img src={account.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                    ) : (
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                        style={{ background: 'var(--bg-subtle)', color: 'var(--text-main)' }}
                      >
                        <User className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {account.loggedIn ? account.name : '未登录知乎账号'}
                      </div>
                      <div className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                        {account.loggedIn
                          ? account.headline || '登录凭据仅加密保存在本机'
                          : '登录后可同步关注动态、收藏、评论与个性化推荐'}
                      </div>
                    </div>
                  </div>
                  {account.loggedIn ? (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmAction({
                          title: `退出账号「${account.name}」？`,
                          description: '退出后将清除本机登录会话，需要重新扫码或网页登录。',
                          confirmLabel: '退出账号',
                          onConfirm: () => {
                            setConfirmAction(null);
                            onLogout();
                          },
                        })
                      }
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs whitespace-nowrap hover:bg-[var(--bg-hover)]"
                      style={{ borderColor: 'var(--border-color)', color: 'var(--danger)' }}
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      退出账号
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onLogin}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap text-white"
                      style={{ background: 'var(--accent)' }}
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      登录知乎账号
                    </button>
                  )}
                </div>

                <SettingsGroup title="启动与阅读习惯">
                  <SettingRow label="启动默认栏目">
                    <Segmented<StartupSection>
                      value={settings.defaultSection}
                      options={[
                        { value: 'home', label: '推荐' },
                        { value: 'follow', label: '关注' },
                        { value: 'hot', label: '热榜' },
                        { value: 'collections', label: '收藏' },
                      ]}
                      onChange={(v) => onUpdateSettings({ defaultSection: v })}
                    />
                  </SettingRow>

                  <SettingRow label="评论默认排序">
                    <Segmented<CommentSortOrder>
                      value={settings.defaultCommentOrder}
                      options={[
                        { value: 'normal', label: '精选' },
                        { value: 'reverse', label: '最新' },
                      ]}
                      onChange={(v) => onUpdateSettings({ defaultCommentOrder: v })}
                    />
                  </SettingRow>

                  <ToggleRow
                    label="启用单键阅读快捷键"
                    desc="J/K 切换条目、F 专注阅读、C 跳转评论、专注模式下 ←/→ 切换同问题回答"
                    checked={settings.singleKeyShortcuts}
                    onChange={(v) => onUpdateSettings({ singleKeyShortcuts: v })}
                  />

                  <ToggleRow
                    label="复制 Markdown 时附带标题与原文链接"
                    checked={settings.markdownIncludeHeader}
                    onChange={(v) => onUpdateSettings({ markdownIncludeHeader: v })}
                  />
                </SettingsGroup>

                <SettingsGroup title="桌面与数据">
                  <ToggleRow
                    label="关闭窗口时最小化到系统托盘"
                    desc="隐藏到托盘可实现再次点击秒切回，右键托盘图标可彻底退出"
                    checked={settings.minimizeToTray}
                    onChange={(v) => onUpdateSettings({ minimizeToTray: v })}
                  />

                  <ToggleRow
                    label="开机自动启动"
                    desc="登录 Windows 时自动运行知乎桌面端"
                    checked={settings.launchOnStartup}
                    onChange={(v) => onUpdateSettings({ launchOnStartup: v })}
                  />

                  <SettingRow label="本地配置与数据目录">
                    <button
                      type="button"
                      onClick={() => void window.zhihuApi.openDataDir()}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      打开目录
                    </button>
                  </SettingRow>

                  <SettingRow label="恢复默认设置">
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmAction({
                          title: '恢复所有默认设置？',
                          description: '外观、字体、字号、版心与行为偏好将重置为初始状态（不影响账号和过滤词库）。',
                          confirmLabel: '恢复默认',
                          onConfirm: () => {
                            setConfirmAction(null);
                            onResetSettings();
                          },
                        })
                      }
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      恢复默认
                    </button>
                  </SettingRow>
                </SettingsGroup>

                <div
                  className="rounded-xl border p-3.5 text-xs"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-list)' }}
                >
                  <div className="mb-2 font-medium">快捷键速查</div>
                  <div className="grid grid-cols-2 gap-y-1.5" style={{ color: 'var(--text-muted)' }}>
                    <span>全局搜索 / 粘贴知乎链接</span>
                    <span className="text-right font-mono">Ctrl+K</span>
                    <span>正文页内查找</span>
                    <span className="text-right font-mono">Ctrl+F</span>
                    <span>打开偏好设置</span>
                    <span className="text-right font-mono">Ctrl+,</span>
                    <span>刷新当前列表</span>
                    <span className="text-right font-mono">Ctrl+R</span>
                    <span>界面缩放 / 复位</span>
                    <span className="text-right font-mono">Ctrl+滚轮 / Ctrl+0</span>
                    <span>下一条 / 上一条内容</span>
                    <span className="text-right font-mono">J / K</span>
                    <span>专注阅读 / 跳转评论</span>
                    <span className="text-right font-mono">F / C</span>
                    <span>专注模式切换同问题回答</span>
                    <span className="text-right font-mono">← / →</span>
                    <span>视图后退 / 关闭浮层</span>
                    <span className="text-right font-mono">Alt+← / 鼠标侧键</span>
                  </div>
                </div>

                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  知乎桌面端 v{__APP_VERSION__} · 开源免费
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.title || ''}
        description={confirmAction?.description || ''}
        confirmLabel={confirmAction?.confirmLabel}
        onConfirm={() => confirmAction?.onConfirm()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
};

const SettingsGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-3.5 border-b pb-4 last:border-b-0 last:pb-0" style={{ borderColor: 'var(--border-subtle)' }}>
    <h3
      className="text-[11px] font-semibold tracking-wider uppercase"
      style={{ color: 'var(--text-faint)' }}
    >
      {title}
    </h3>
    <div className="space-y-3.5">{children}</div>
  </section>
);

const SettingRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="font-medium">{label}</span>
    {children}
  </div>
);

const SliderRow: React.FC<{
  label: string;
  valueText: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  resetTitle: string;
  onChange: (v: number) => void;
}> = ({ label, valueText, value, defaultValue, min, max, step, resetTitle, onChange }) => {
  const isModified = Math.abs(value - defaultValue) > 0.005;
  return (
    <SettingRow label={`${label}（${valueText}）`}>
      <div className="flex items-center gap-2">
        {isModified && (
          <button
            type="button"
            title={resetTitle}
            onClick={() => onChange(defaultValue)}
            className="rounded p-1 hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-muted)' }}
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-40 accent-[var(--accent)]"
        />
      </div>
    </SettingRow>
  );
};

const SystemFontPicker: React.FC<{
  fonts: SystemFontItem[];
  loading: boolean;
  value: string;
  onChange: (family: string) => void;
}> = ({ fonts, loading, value, onChange }) => {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fonts;
    return fonts.filter((f) => f.label.toLowerCase().includes(q) || f.family.toLowerCase().includes(q));
  }, [fonts, query]);

  return (
    <div
      className="rounded-xl border p-2.5 text-xs"
      style={{ background: 'var(--bg-list)', borderColor: 'var(--border-color)' }}
    >
      <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{ background: 'var(--bg-paper)', borderColor: 'var(--border-color)' }}>
        <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-faint)' }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索本机字体（如 思源、霞鹜、微软雅黑、Inter）..."
          className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          style={{ color: 'var(--text-main)' }}
        />
        {query && (
          <button
            type="button"
            title="清空搜索"
            onClick={() => setQuery('')}
            className="rounded p-0.5 hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-muted)' }}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {value && (
        <div className="mt-1.5 flex items-center justify-between px-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <span className="truncate">当前已选：{value}</span>
          <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-faint)' }}>
            共 {filtered.length} 款
          </span>
        </div>
      )}

      <div className="scroll-area mt-1.5 max-h-36 space-y-0.5 pr-0.5">
        {loading ? (
          <div className="py-4 text-center" style={{ color: 'var(--text-muted)' }}>
            正在读取系统字体...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-4 text-center" style={{ color: 'var(--text-muted)' }}>
            未找到匹配的本机字体
          </div>
        ) : (
          filtered.map((f) => {
            const active = value === f.family;
            return (
              <button
                key={f.family}
                type="button"
                onClick={() => onChange(f.family)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                style={{
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-main)',
                  fontFamily: `"${f.family}", var(--font-ui)`,
                }}
              >
                <span className="truncate">{f.label}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

const ToggleRow: React.FC<{ label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }> = ({
  label,
  desc,
  checked,
  onChange,
}) => (
  <div className="flex items-center justify-between gap-4">
    <div>
      <div className="font-medium">{label}</div>
      {desc && (
        <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          {desc}
        </div>
      )}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="switch-track relative h-6 w-11 shrink-0 rounded-full p-0.5"
      style={{ background: checked ? 'var(--accent)' : 'var(--bg-subtle)' }}
    >
      <span
        className="switch-thumb block h-5 w-5 rounded-full bg-white shadow"
        style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  </div>
);

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-lg p-0.5" style={{ background: 'var(--bg-subtle)' }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
            value === opt.value ? 'shadow-xs' : 'hover:text-[var(--text-main)]'
          }`}
          style={{
            background: value === opt.value ? 'var(--bg-paper)' : 'transparent',
            color: value === opt.value ? 'var(--text-main)' : 'var(--text-muted)',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
