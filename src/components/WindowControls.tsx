import React from 'react';
import { Minus, Square, X } from 'lucide-react';

interface WindowControlsProps {
  isMaximized: boolean;
  showDivider?: boolean;
  className?: string;
}

export const WindowControls: React.FC<WindowControlsProps> = ({
  isMaximized,
  showDivider = true,
  className = '',
}) => {
  return (
    <div className={`app-no-drag flex shrink-0 items-center gap-0.5 select-none ${className}`}>
      {showDivider && (
        <div className="ml-1.5 mr-1 h-3.5 w-px" style={{ background: 'var(--border-color)' }} />
      )}
      <button
        type="button"
        title="最小化"
        onClick={() => void window.zhihuApi.minimizeWindow()}
        className="flex h-7 w-8 items-center justify-center rounded-md hover:bg-[var(--bg-hover)]"
        style={{ color: 'var(--text-muted)' }}
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        title={isMaximized ? '向下还原' : '最大化'}
        onClick={() => void window.zhihuApi.toggleMaximizeWindow()}
        className="flex h-7 w-8 items-center justify-center rounded-md hover:bg-[var(--bg-hover)]"
        style={{ color: 'var(--text-muted)' }}
      >
        {isMaximized ? (
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="3" y="5" width="8" height="8" rx="1" />
            <path d="M5.5 5V3.8A.8.8 0 0 1 6.3 3h5.9a.8.8 0 0 1 .8.8v5.9a.8.8 0 0 1-.8.8H11" />
          </svg>
        ) : (
          <Square className="h-3 w-3" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        title="关闭"
        onClick={() => void window.zhihuApi.closeWindow()}
        className="flex h-7 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-red-500 hover:text-white"
      >
        <X className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  );
};
