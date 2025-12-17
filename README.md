# ECH Workers Client CLI Tool

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> ⚠️ **说明 / Note**  
> 本项目是基于 [byJoey/ech-wk](https://github.com/byJoey/ech-wk) 开发的第三方管理脚本。  
> 核心代理程序文件 (`ech-workers`) 直接来源于原作者的 Release 发布页。  
> 感谢原作者 @byJoey 以及底层核心开发 [CF_NAT](https://t.me/CF_NAT)！

---

**打造家庭全天候 ECH 代理中心。**

这是一个专为 Debian / Ubuntu / Armbian / iStoreOS 等 Linux 系统设计的命令行管理工具 (CLI)。

原项目主要提供了 Windows 和 Mac 的图形化客户端，但在家庭网络环境中，利用 **低功耗 Linux 设备**（如 斐讯N1、树莓派、软路由、飞牛NAS 等）进行 7x24 小时部署才是更高效的选择。

通过本脚本，您可以将 Linux 设备瞬间变身为一台 **SOCKS5/HTTP 代理服务器**：
*   ✅ **局域网共享**：家庭中的手机、PC、电视均可通过局域网 IP 连接代理。
*   ✅ **远程访问**：配合 DDNS，在外网也能安全连接回家的代理节点。
*   ✅ **服务化管理**：告别繁琐的命令行参数和后台保活，一切自动化。

<img src="preview.png" width="450" alt="Preview" />

## ✨ 主要特性

*   **⚡️ 一键安装**: 自动检测系统架构 (amd64/arm64)，自动下载最新内核。
*   **🇨🇳 国内加速**: 智能检测网络环境，国内用户自动使用 `gh-proxy` 镜像加速下载。
*   **🔄 自动更新**: 脚本支持版本检测与一键自我更新，保持功能最新。
*   **🖥️ 交互界面**: 提供全中文的图形化菜单 (TUI)，操作简单直观。
*   **📊 连接统计**: 日志界面集成实时连接数统计与 **IP 归属地查询**功能。
*   **🤖 自动配置**: 引导式配置向导，支持快速设置优选 IP、Token、DOH 等关键参数。
*   **⚙️ 服务管理**: 自动创建 Systemd 服务，支持开机自启、后台静默运行、异常自动重启。
*   **⌨️ 快捷指令**: 自动注册 `ech` 全局命令，随时随地管理服务。

## 🚀 快速开始

在您的 Linux 终端中执行以下命令即可安装：

```bash
# 方法一：在线下载脚本
wget -O ech-cli.sh https://raw.githubusercontent.com/lzban8/ech-cli-tool/main/ech-cli.sh

# 方法二：手动上传
# 您也可以先下载 ech-cli.sh 到本地，然后上传到服务器 (如 /root 目录)

# 授信运行
chmod +x ech-cli.sh
./ech-cli.sh
```

## 🎮 使用指南

安装完成后，直接在终端输入 `ech` 即可进入管理面板：

```bash
root@armbian:~# ech
```

### 功能菜单

1.  **安装 / 更新客户端**: 保持核心代理程序 (`ech-workers`) 为最新版本。
2.  **更新脚本**: 一键检测并更新此管理脚本 (`ech-cli.sh`) 到 GitHub 最新版。
3.  **修改配置**: 调整服务端地址、分流模式、优选IP等参数。
4.  **服务管理**: 包含启动、停止、重启服务。
5.  **查看日志**: 显示在线人数、客户端 IP 归属地，并查看实时运行日志。
6.  **卸载客户端**: 彻底清理所有文件和服务。

## 📝 高级配置

配置文件位于 `/etc/ech-workers.conf`，支持手动修改：

```env
SERVER_ADDR="your-worker.workers.dev:443"  # Cloudflare Worker 地址
LISTEN_ADDR="0.0.0.0:30000"                # 本地监听地址
TOKEN="your-token"                         # 认证 Token
BEST_IP="freeyx.cloudflare88.eu.org"       # 优选 IP 或域名
DNS="dns.alidns.com/dns-query"             # DoH 服务器
ECH_DOMAIN="cloudflare-ech.com"            # ECH 配置域名
ROUTING="bypass_cn"                        # 分流模式: bypass_cn / global / none
```

## 🌐 Worker 部署（服务端）

本项目提供了增强版的 `_worker.js`，包含 **PROXYIP 支持**，解决 CF-to-CF 连接限制问题。

### 什么是 PROXYIP？

由于 Cloudflare Workers 的技术限制，无法直接连接到 Cloudflare 自有的 IP 地址段。这意味着：

- ✅ 可以正常访问非 Cloudflare CDN 的站点（如 Google、YouTube）
- ❌ 无法直接访问由 Cloudflare CDN 托管的网站（如 Twitter、ChatGPT、Discord）

**PROXYIP** 通过第三方服务器作为跳板，解决这个限制。

### 部署步骤

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 `Workers & Pages` → 创建 Worker
3. 将本项目的 `_worker.js` 内容复制到编辑器中
4. 点击 `Save and Deploy`

### PROXYIP 配置

在 `_worker.js` 顶部可以配置 PROXYIP：

```javascript
// 方式一：使用默认公共 PROXYIP（推荐）
const PROXYIP = '';  // 留空，自动使用内置的公共 PROXYIP 列表

// 方式二：自定义 PROXYIP
const PROXYIP = 'your-proxyip.com';  // 单个
const PROXYIP = 'ip1.com,ip2.com';   // 多个，用逗号分隔
```

**内置公共 PROXYIP 列表：**
- `proxyip.cmliussss.net` - cmliu 维护
- `proxyip.fxxk.dedyn.io` - fxxk 维护

### IP 归属地说明

| 访问目标 | IP 归属地决定因素 |
|---------|-----------------|
| 非 CF 站点（Google、YouTube 等） | 由「优选 IP」决定 |
| CF 站点（Twitter、ChatGPT 等） | 由「PROXYIP」决定 |

## 🤝 贡献与致谢

*   核心程序: [byJoey/ech-wk](https://github.com/byJoey/ech-wk)
*   核心原创: [CF_NAT](https://t.me/CF_NAT)
*   PROXYIP 参考: [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel)
*   脚本维护: lzban8

欢迎提交 Issue 或 Pull Request 来改进此脚本！
 
