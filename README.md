<p align="center">
<img src="https://user-images.githubusercontent.com/2666735/30651452-58ae6c88-9deb-11e7-9e13-6beae3f6c54c.png" alt="Meting">
</p>

# Meting API · Vercel 版

[![Vercel](https://img.shields.io/badge/Vercel-Deploy-brightgreen?logo=vercel&logoColor=white)](https://vercel.com)
[![Node.js](https://img.shields.io/badge/Node.js-18+-6DAE28?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> 基于 [Meting](https://github.com/metowolf/Meting) 的多平台音乐 API，使用 Node.js 重写，一键部署到 Vercel Serverless Functions。

## ✨ 特性

- 🎵 **多平台支持**：网易云、QQ 音乐、酷狗、酷我、百度、虾米
- ⚡ **Serverless 架构**：Vercel 边缘节点全球加速，无需服务器
- 🔌 **零配置部署**：推送到 GitHub 自动部署
- 🎯 **完整 API**：song / playlist / url / lrc / pic / search / artist
- 🚫 **无持久化依赖**：移除缓存/队列等，纯 HTTP 请求代理
- 🎨 **精美的首页**：内置 API 文档与在线测试页面

## 🚀 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

## 📦 本地开发

```bash
# 克隆仓库
git clone https://github.com/your-username/meting-api.git
cd meting-api

# 安装依赖（本项目无第三方依赖，可选）
npm install

# 使用 Vercel CLI 本地调试
npm i -g vercel
vercel dev
```

然后访问：

- `http://localhost:3000/` — 首页 / API 文档
- `http://localhost:3000/docs/` — 在线播放器测试页
- `http://localhost:3000/api?server=netease&type=song&id=591321` — API 接口

## 📁 项目结构

```
meting-api/
├── api/
│   └── index.js          # Vercel Serverless Function 入口
├── lib/
│   └── meting.js         # Meting 核心库（Node.js 移植版）
├── public/
│   ├── docs/
│   │   └── index.html    # APlayer 在线测试页
│   ├── favicon.png
│   └── index.html        # 首页 + API 文档
├── package.json
├── vercel.json           # Vercel 部署配置
└── README.md
```

## 📖 API 用法

基础 URL：`https://你的域名/api`

### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `server` | string | 否 | `netease` | 平台：`netease` / `tencent` / `kugou` / `baidu` / `kuwo` / `xiami` |
| `type` | string | 是 | — | 请求类型，见下方 |
| `id` | string | 是 | — | 资源 ID 或搜索关键词 |

### 类型支持

| type | 说明 | netease | tencent | kugou | baidu | kuwo |
|------|------|:-------:|:-------:|:-----:|:-----:|:----:|
| `song` | 单曲信息 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `playlist` | 歌单 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `url` | 播放链接 (302) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `lrc` | 歌词 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `pic` | 封面图片 (302) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `search` | 搜索 | ✓ | — | — | — | — |
| `artist` | 歌手 | ✓ | — | — | — | — |

### 请求示例

```bash
# 获取歌单
curl "https://your-domain.vercel.app/api?server=netease&type=playlist&id=2619366284"

# 获取歌曲播放链接（302 重定向到 CDN）
curl -L "https://your-domain.vercel.app/api?server=netease&type=url&id=416892104"

# 获取歌词
curl "https://your-domain.vercel.app/api?server=tencent&type=lrc&id=001ZVNsj07p4QH"
```

### 响应格式

**song / playlist** → `application/json`
```json
[
  {
    "name": "起风了",
    "artist": "买辣椒也用券",
    "url": "https://your-domain.vercel.app/api?server=netease&type=url&id=xxx",
    "pic": "https://your-domain.vercel.app/api?server=netease&type=pic&id=xxx",
    "lrc": "https://your-domain.vercel.app/api?server=netease&type=lrc&id=xxx",
    "id": "416892104",
    "source": "netease"
  }
]
```

**url / pic** → `302 Redirect` 到资源 CDN 地址

**lrc** → `text/plain` 返回歌词文本

### 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 302 | 重定向到 CDN（url/pic 类型） |
| 400 | 参数不合法 |
| 500 | 服务器内部错误 |

## 🔧 技术栈

- **运行时**：Node.js ≥ 18（使用原生 `fetch` + `crypto` + `BigInt`）
- **部署平台**：Vercel Serverless Functions
- **加密实现**：Node.js `crypto` 模块（AES-128-CBC + RSA 大数运算）
- **无第三方依赖**

## ❓ 常见问题

**Q: 为什么有些歌曲返回空数据？**
A: 部分歌曲因版权问题在源平台就无法获取，属于正常现象。

**Q: Vercel 有执行时间限制吗？**
A: 免费版 10 秒，Pro 版 60 秒。单个 API 请求通常在 1-3 秒内完成。

**Q: 可以自建部署吗？**
A: 可以。修改 `vercel.json` 的 `rewrites` 或用 `api/index.js` 作为 Node HTTP server 入口即可。

## 🙏 致谢

- [APlayer](https://github.com/MoePlayer/APlayer)
- [Meting](https://github.com/metowolf/Meting)
- [MetingJS](https://github.com/metowolf/MetingJS)
- [Meting-API (Hono 版)](https://github.com/ybming/Meting-API) — 参考设计

## 📄 License

[MIT](LICENSE) © 2024
