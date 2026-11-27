import type { ZhihuDesktopApi } from '../electron/preload';

declare global {
  const __APP_VERSION__: string;
  interface Window {
    zhihuApi: ZhihuDesktopApi;
  }
}

export {};
