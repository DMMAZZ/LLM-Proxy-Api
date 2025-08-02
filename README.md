# LLM API Proxy for Cloudflare Worker

一个部署在Cloudflare Worker上的LLM API代理，遵循OpenAI的API规范，可以将请求转发到指定的LLM API。

## 功能特性

- 遵循OpenAI API规范
- 支持多种API端点：
  - `/v1/chat/completions`
  - `/v1/completions`
  - `/v1/embeddings`
- 灵活的配置管理
- 支持CORS
- 完善的错误处理和日志记录
- 健康检查端点
- 管理后台界面
- 请求日志记录
- 安全性增强

## 部署到Cloudflare Worker

### 前置要求

- 一个Cloudflare账户
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/get-started/) 已安装

### 部署步骤

1. 克隆或下载此仓库

2. 安装依赖：
   ```bash
   npm install
   ```

3. 登录到Cloudflare：
   ```bash
   npx wrangler login
   ```

4. 配置环境变量：
   在`wrangler.toml`文件中修改环境变量：
   ```toml
   [vars]
   TARGET_API_URL = "https://api.openai.com"  # 目标API地址
   DEBUG = false  # 是否启用调试日志
   ADMIN_PASSWORD = "your-secure-password"  # 管理员密码
   ```

5. 部署到Cloudflare：
   ```bash
   npm run deploy
   ```

## 使用方法

### 基本用法

部署后，您可以像使用OpenAI API一样使用此代理：

```javascript
const response = await fetch('https://your-worker.your-subdomain.workers.dev/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});

const data = await response.json();
```

### 高级配置

您可以通过请求头来动态配置目标API：

- `x-target-api-url`: 指定目标API的URL
- `x-target-api-key`: 指定目标API的密钥

示例：
```javascript
const response = await fetch('https://your-worker.your-subdomain.workers.dev/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-target-api-url': 'https://api.openai.com',  # 可选：指定目标API URL
    'x-target-api-key': 'your-api-key'  # 可选：指定API密钥
  },
  body: JSON.stringify({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
```

### 管理后台

您可以访问`/admin`路径来管理代理配置和查看请求日志：

1. 打开浏览器访问 `https://your-worker.your-subdomain.workers.dev/admin`
2. 使用您在`ADMIN_PASSWORD`环境变量中设置的密码登录
3. 在管理后台中，您可以：
   - 配置目标API地址
   - 查看请求日志
   - 修改管理员密码

### 健康检查

您可以访问根路径或`/health`路径来检查代理是否正常运行：

```bash
curl https://your-worker.your-subdomain.workers.dev/
# 或
curl https://your-worker.your-subdomain.workers.dev/health
```

## 支持的API端点

- `POST /v1/chat/completions` - 聊天补全
- `POST /v1/completions` - 文本补全
- `POST /v1/embeddings` - 嵌入向量计算

## 环境变量

您可以在Cloudflare Worker的环境变量中配置以下参数：

- `TARGET_API_URL`: 默认目标API URL (默认: https://api.openai.com)
- `TARGET_API_KEY`: 目标API的密钥 (可选)
- `ADMIN_PASSWORD`: 管理后台的密码
- `DEBUG`: 是否启用调试日志 (默认: false)
- `ENVIRONMENT`: 运行环境 (development 或 production)

## 安全性

- 管理后台通过密码保护
- 在生产环境中强制使用HTTPS
- 添加了安全头以防止常见攻击
- 建议使用强密码并定期更换

## 本地开发

1. 启动本地开发服务器：
   ```bash
   npm run dev
   ```

2. 服务器将在`http://localhost:8787`上运行

## 许可证

MIT