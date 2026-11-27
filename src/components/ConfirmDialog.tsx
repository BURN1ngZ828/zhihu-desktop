import React, { useEffect, useRef } from 'react';
import { usePresence } from '@/utils/usePresence';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger = true,
  onConfirm,
  onCancel,
}) => {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const { mounted, state } = usePresence(open);

  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.isComposing || e.keyCode === 229 || e.repeat) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      };
      document.addEventListener('keydown', onKeyDown, true);
      return () => document.removeEventListener('keydown', onKeyDown, true);
    } else if (prevFocusRef.current) {
      const el = prevFocusRef.current;
      prevFocusRef.current = null;
      if (el.isConnected) el.focus();
    }
  }, [open, onCancel]);

  useEffect(() => {
    if (!open || !mounted) return;
    if (danger) cancelBtnRef.current?.focus();
    else confirmBtnRef.current?.focus();
  }, [open, mounted, danger]);

  if (!mounted) return null;

  return (
    <div
      role={open ? 'dialog' : undefined}
      aria-modal={open ? 'true' : undefined}
      aria-hidden={!open || undefined}
      inert={!open || undefined}
      data-motion={state}
      className="motion-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/38 p-4 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        data-motion={state}
        className="motion-dialog popover-surface w-full max-w-[360px] rounded-2xl p-5"
        style={{ background: 'var(--bg-paper)' }}
      >
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-2 text-xs">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            className="rounded-lg border px-3.5 py-1.5 font-medium hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className="rounded-lg px-3.5 py-1.5 font-medium text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            style={{ background: danger ? 'var(--danger)' : 'var(--accent)' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
