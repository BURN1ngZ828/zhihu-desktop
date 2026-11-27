import DOMPurify from 'dompurify';
import katex from 'katex';
import type { ArticleDetail, CommentFontPreset, ContentKind, FontPreset } from '@shared/types';
import { replaceEmoticonsInDom } from './emojis';

export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')} 万`;
  return String(n);
}

/**
 * Strip Electron IPC wrapper prefix ("Error invoking remote method '...': Error: ")
 * so renderer error banners & toasts only show clean human-readable messages.
 */
export function formatErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const cleaned = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^(?:Error|TypeError):\s*/i, '')
    .trim();
  return cleaned || fallback;
}

export function formatTime(ts?: number): string {
  if (!ts) return '';
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatShortTime(ts?: number): string {
  if (!ts) return '';
  const ms = ts > 1e12 ? ts : ts * 1000;
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} 天前`;
  const d = new Date(ms);
  const pad = (v: number) => String(v).padStart(2, '0');
  if (d.getFullYear() === new Date().getFullYear()) {
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function resolveFontStack(preset: FontPreset, customFamily?: string): string {
  switch (preset) {
    case 'serif':
      return '"Noto Serif SC", "Source Han Serif SC", "Source Han Serif CN", "Songti SC", "STSong", "SimSun", Georgia, serif';
    case 'wenkai':
      return '"LXGW WenKai", "LXGW WenKai Screen", "Kaiti SC", "STKaiti", "KaiTi", Georgia, serif';
    case 'yahei':
      return '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';
    case 'custom': {
      const clean = (customFamily || '').replace(/["';{}<>]/g, '').trim();
      return clean
        ? `"${clean}", "Segoe UI Variable Text", "PingFang SC", "Microsoft YaHei UI", sans-serif`
        : '"Segoe UI Variable Text", "Segoe UI", "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", system-ui, sans-serif';
    }
    case 'sans':
    default:
      return '"Segoe UI Variable Text", "Segoe UI", "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", system-ui, -apple-system, sans-serif';
  }
}

export function resolveCommentFontStack(
  commentPreset: CommentFontPreset,
  commentCustomFamily: string | undefined,
  readingFontStack: string
): string {
  if (commentPreset === 'follow') return readingFontStack;
  return resolveFontStack(commentPreset, commentCustomFamily);
}

export function sanitizeZhihuHtml(rawHtml: string, mode: 'article' | 'comment' = 'article'): string {
  if (!rawHtml) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // Convert Zhihu comment image/sticker anchor placeholders into real <img>
  doc.querySelectorAll('a.comment_img, a.comment_gif, a.comment_sticker').forEach((a) => {
    if (a.querySelector('img')) return;
    const rawHref =
      a.getAttribute('data-original') || a.getAttribute('data-actualsrc') || a.getAttribute('href') || '';
    const href = rawHref.startsWith('//') ? `https:${rawHref}` : rawHref;
    if (!/^https?:\/\//i.test(href)) return;
    const img = doc.createElement('img');
    const label = a.textContent?.trim() || '图片';
    img.setAttribute('src', href);
    img.setAttribute('alt', label);
    if (a.classList.contains('comment_sticker') || label === '[表情]' || label === '查看表情') {
      img.setAttribute('data-comment-sticker', '1');
    }
    a.replaceWith(img);
  });

  // Fix lazy-loaded Zhihu images & classify stickers vs content photos
  doc.querySelectorAll('img').forEach((img) => {
    const rawSrc =
      img.getAttribute('data-original') ||
      img.getAttribute('data-actualsrc') ||
      img.getAttribute('data-default-watermark-src') ||
      img.getAttribute('src') ||
      '';
    if (!rawSrc || (rawSrc.startsWith('data:image/svg+xml') && !img.getAttribute('data-actualsrc') && !img.getAttribute('data-original'))) {
      img.remove();
      return;
    }
    const normalized = rawSrc.startsWith('//') ? `https:${rawSrc}` : rawSrc;

    // Equation image fallback -> KaTeX
    if (normalized.includes('zhihu.com/equation') && img.getAttribute('alt')) {
      const tex = img.getAttribute('alt') || '';
      if (tex.trim()) {
        try {
          const span = doc.createElement('span');
          span.innerHTML = katex.renderToString(tex, {
            throwOnError: false,
            displayMode: tex.includes('\\\\'),
          });
          img.replaceWith(span);
          return;
        } catch {
          // keep image
        }
      }
    }

    img.setAttribute('src', normalized);
    img.setAttribute('referrerpolicy', 'no-referrer');

    if (
      img.classList.contains('sticker') ||
      normalized.includes('zhihu-card-emoji') ||
      normalized.includes('/emoticon/')
    ) {
      img.setAttribute('class', 'zhihu-sticker');
      return;
    }

    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    if (mode === 'comment') {
      img.setAttribute(
        'class',
        img.getAttribute('data-comment-sticker') === '1'
          ? 'zhihu-comment-img zhihu-comment-sticker'
          : 'zhihu-comment-img'
      );
    } else {
      img.setAttribute('class', 'zhihu-content-img');
    }
  });

  // Unwrap Zhihu redirect links
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    const m = /link\.zhihu\.com\/\?target=([^&]+)/i.exec(href);
    if (m) {
      try {
        a.setAttribute('href', decodeURIComponent(m[1]));
      } catch {
        // keep original
      }
    }
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  // Render Zhihu KaTeX formula spans
  doc.querySelectorAll('span.ztext-math, [data-tex]').forEach((el) => {
    const tex = el.getAttribute('data-tex') || el.textContent || '';
    if (!tex.trim()) return;
    try {
      const displayMode = tex.includes('\\\\') || el.tagName === 'DIV';
      el.innerHTML = katex.renderToString(tex, { throwOnError: false, displayMode });
    } catch {
      // keep fallback text
    }
  });

  // Replace [微笑] / [酷] / [捂脸] / [doge] text tokens with official Zhihu stickers
  replaceEmoticonsInDom(doc, doc.body);

  // Wrap article code blocks with one-click copy button
  if (mode === 'article') {
    Array.from(doc.querySelectorAll('pre')).forEach((pre) => {
      if (pre.parentElement?.classList.contains('zhihu-code-block')) return;
      const wrapper = doc.createElement('div');
      wrapper.setAttribute('class', 'zhihu-code-block');
      const btn = doc.createElement('button');
      btn.setAttribute('type', 'button');
      btn.setAttribute('class', 'zhihu-copy-code-btn');
      btn.setAttribute('data-copy-code', '1');
      btn.textContent = '复制代码';
      pre.parentNode?.insertBefore(wrapper, pre);
      wrapper.appendChild(btn);
      wrapper.appendChild(pre);
    });
  }

  return DOMPurify.sanitize(doc.body.innerHTML, {
    ADD_ATTR: ['target', 'rel', 'referrerpolicy', 'loading', 'decoding', 'data-copy-code', 'data-comment-sticker'],
  });
}

export function articleToMarkdown(detail: ArticleDetail, includeHeader: boolean): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(detail.contentHtml || '', 'text/html');
  const lines: string[] = [];

  if (includeHeader) {
    lines.push(`# ${detail.title}`, '', `> 作者：${detail.authorName}  |  原文：${detail.url}`, '');
  }

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const inner = Array.from(el.childNodes).map(walk).join('');
    switch (tag) {
      case 'h1':
      case 'h2':
        return `\n## ${inner.trim()}\n`;
      case 'h3':
        return `\n### ${inner.trim()}\n`;
      case 'p':
        return `\n${inner.trim()}\n`;
      case 'br':
        return '\n';
      case 'strong':
      case 'b':
        return `**${inner}**`;
      case 'em':
      case 'i':
        return `*${inner}*`;
      case 'blockquote':
        return `\n> ${inner.trim().replace(/\n/g, '\n> ')}\n`;
      case 'pre':
        return `\n\`\`\`\n${el.textContent?.trim() || ''}\n\`\`\`\n`;
      case 'code':
        return `\`${el.textContent || ''}\``;
      case 'a': {
        const href = el.getAttribute('href') || '';
        return href ? `[${inner || href}](${href})` : inner;
      }
      case 'img': {
        const src =
          el.getAttribute('data-original') || el.getAttribute('data-actualsrc') || el.getAttribute('src') || '';
        return src ? `\n![](${src})\n` : '';
      }
      case 'li':
        return `- ${inner.trim()}\n`;
      case 'ul':
      case 'ol':
        return `\n${inner}\n`;
      default:
        return inner;
    }
  };

  lines.push(walk(doc.body).replace(/\n{3,}/g, '\n\n').trim());
  return lines.join('\n').trim();
}

export function parseZhihuLink(input: string): { kind: ContentKind; id: string } | null {
  const s = input.trim();
  const ans = /zhihu\.com\/question\/\d+\/answer\/(\d+)/i.exec(s) || /zhihu\.com\/answer\/(\d+)/i.exec(s);
  if (ans) return { kind: 'answer', id: ans[1] };
  const art = /zhuanlan\.zhihu\.com\/p\/(\d+)/i.exec(s);
  if (art) return { kind: 'article', id: art[1] };
  const pin = /zhihu\.com\/pin\/(\d+)/i.exec(s);
  if (pin) return { kind: 'pin', id: pin[1] };
  const q = /zhihu\.com\/question\/(\d+)/i.exec(s);
  if (q) return { kind: 'question', id: q[1] };
  const user = /zhihu\.com\/(?:people|org)\/([^/?#]+)/i.exec(s);
  if (user) return { kind: 'user', id: decodeURIComponent(user[1]) };
  return null;
}
