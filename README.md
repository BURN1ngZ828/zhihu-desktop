# Zhihu Desktop

轻量、清爽、无广告的第三方知乎桌面客户端，基于 **Electron + React 19 + TypeScript + Tailwind CSS v4** 纯原生构建，零 JVM 与外部后端依赖。

## 下载与安装

前往 [Releases 页面](https://github.com/BURN1ngZ828/zhihu-desktop/releases/latest) 下载最新的 Windows x64 安装包 `Zhihu-Desktop-x.x.x-Setup.exe`（支持 Windows 10 / 11 64 位）。

每个正式版本均附带 `SHA256SUMS.txt` 校验文件，安装前可在 PowerShell 中核对哈希值：

```powershell
Get-FileHash .\Zhihu-Desktop-1.1.0-Setup.exe -Algorithm SHA256
```

### Windows SmartScreen 提示说明

本项目未购买商业代码签名证书。首次下载运行安装包时，Windows Defender SmartScreen 可能弹出「Windows 已保护你的电脑」拦截提示，点击 **更多信息** → **仍要运行** 即可继续安装；如需完全自行验证，也可在下方克隆源码本地构建。

### 数据存储

账号会话、阅读设置、历史记录与过滤规则仅保存在本机用户目录 `~/.zhihu-desktop-v2` 中，不经过任何第三方服务器。

## 核心特性

- **一体三栏壳层与暖纸质感**：极窄导航侧栏直通顶部、内嵌暖纸阅读工作区（`inset-workspace-sheet`）、中右分栏可拖拽调节栏宽，支持护眼暖纸 / 清爽白 / 柔和灰 / 深色夜间与多款衬线（思源宋体、霞鹜楷体）及本机系统字体选择。
- **沉浸阅读与高频速调**：顶栏 `T Aa` 浮层即时调节正文字号、列表字号、纸张色与字体；底部 `.tactile-pill` 毛玻璃悬浮胶囊支持赞同、跳转评论、同问题多回答切换与阅读进度回顶；内置 KaTeX 公式、代码块一键复制、页内高亮查找（`Ctrl+F`）、图片灯箱旋转缩放与复制 Markdown。
- **完整评论互动**：支持评论作者头像、知乎内置 `[微笑]` / `[捂脸]` / `[酷]` / `[doge]` 表情渲染与选择器、精选/最新切换、子回复展开、评论点赞及直接发表回复。
- **高效桌面体验**：系统托盘常驻秒唤起、鼠标侧键返回（优先关闭浮层/大图）、`Ctrl+滚轮` 缩放、`Ctrl+K` 搜索或粘贴知乎链接直达、`J/K/F/C` 单键阅读快捷键，以及本地关键词/作者/低赞过滤与已读去重。

## 快捷键速查

| 功能 | 快捷键 |
| :--- | :--- |
| 全局搜索 / 粘贴知乎链接 | `Ctrl+K` |
| 正文页内查找 | `Ctrl+F` |
| 打开偏好设置 | `Ctrl+,` |
| 刷新当前列表 | `Ctrl+R` |
| 界面缩放 / 复位 | `Ctrl+滚轮` / `Ctrl+0` |
| 下一条 / 上一条内容 | `J` / `K` |
| 专注阅读 / 跳转评论 | `F` / `C` |
| 专注模式切换同问题回答 | `←` / `→` |
| 视图后退 / 关闭浮层 | `Alt+←` / 鼠标侧键 |

## 本地开发与打包

```bash
npm ci
npm run build      # 类型检查 + 编译 Electron 主进程与前端 + 工程守卫检查
npm run start      # 本地运行桌面端
npm run dist:win   # 生成 Windows NSIS 安装包 (release/Zhihu-Desktop-x.x.x-Setup.exe)
```

## 免责声明

本项目为第三方开源桌面客户端，与知乎官方无任何关联或合作关系。所有接口请求均直接发往知乎官方站点，请遵守知乎平台相关服务协议并合理使用。

## License

[MIT](./LICENSE)
