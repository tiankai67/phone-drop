# Phone Drop

用手机扫二维码，把照片或文件传到运行本服务的电脑 / 服务器。

- 桌面浏览器打开后会显示一个二维码，二维码指向 `/upload` 上传页；
- 手机（同设备浏览器或扫码）打开后选择文件即可上传；
- 收到的文件保存到 `received-files/` 目录。

## 本地使用

```bash
npm install
node server.js
# 默认监听 http://localhost:3456
```

双击 `start-phone-drop.bat` 亦可（Windows）。

## 公网部署（Render 示例）

本项目是一个 Node.js 服务，**无法用 GitHub Pages 托管**，需要能运行 Node 的平台。以 [Render](https://render.com) 为例：

1. 把本仓库推到 GitHub；
2. 在 Render 新建 **Web Service**，关联该 GitHub 仓库；
3. Render 会自动用 `npm install` 安装依赖、`node server.js` 启动；
4. 在 Render 的环境变量里设置 `PASSWORD`（可选但强烈建议，见下）。

其他平台（Railway、Fly.io、Koyeb 等）同理：`npm install` + `node server.js`，平台会注入 `PORT`。

## 访问口令（强烈建议公网开启）

上传接口默认没有任何认证。公网部署时，**任何人都能往你的服务器传文件**，存在安全风险。

设置环境变量 `PASSWORD` 后：

- 桌面页与手机页需要带正确口令才能使用（地址后加 `?pw=你的口令`，或由页面输入）；
- 二维码本身会编码口令，手机扫码即可直接上传；
- 不设 `PASSWORD` 时行为与原版完全一致（适合纯局域网使用）。

```bash
PASSWORD=你的强口令 node server.js
```

## 环境变量

| 变量       | 默认值 | 说明                                   |
| ---------- | ------ | -------------------------------------- |
| `PORT`     | `3456` | 监听端口（部署平台通常自动注入）       |
| `PASSWORD` | 空     | 访问口令；设置后启用认证               |

## 说明

- 单文件最大 1GB；
- 文件名会自动清理非法字符，重名文件自动加序号；
- `public/Aws.exe` 为原作者机器上的无关文件，仓库中已排除。
