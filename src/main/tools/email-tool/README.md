# 邮件发送工具

通过 SMTP 发送邮件的内置工具，兼容所有主流邮件服务商。

## 功能特性

- ✅ 支持纯文本和 HTML 邮件
- ✅ 支持附件
- ✅ 支持抄送（CC）和密送（BCC）
- ✅ 兼容所有 SMTP 邮件服务商
- ✅ 支持 SSL/TLS 加密
- ✅ 支持取消操作（AbortSignal）
- ✅ 按需安装依赖（不增加主项目体积）

## 安装依赖

邮件工具使用 `nodemailer` 库，需要单独安装（不会打包到主项目中）。

### 自动安装脚本（推荐）

```bash
# 运行安装脚本
cd deepbot/src/main/tools/email-tool
./install.sh
```

### 手动安装

#### 方法 1：使用 pnpm（推荐）

```bash
# 创建工具目录
mkdir -p ~/.deepbot/tools/email-tool

# 进入目录
cd ~/.deepbot/tools/email-tool

# 初始化 package.json
pnpm init -y

# 安装 nodemailer
pnpm add nodemailer
```

#### 方法 2：使用 npm

```bash
# 创建工具目录
mkdir -p ~/.deepbot/tools/email-tool

# 安装到指定目录
npm install nodemailer --prefix ~/.deepbot/tools/email-tool
```

### 验证安装

首次使用时，如果依赖未安装，工具会提示安装命令。

## 配置方法

### 1. 创建配置文件

配置文件位置（按优先级）：

1. **项目级别**：`<workspace>/.deepbot/tools/email-tool/config.json`
2. **用户级别**（推荐）：`~/.deepbot/tools/email-tool/config.json`

### 2. 配置文件格式

```json
{
  "user": "your-email@example.com",
  "password": "your-password-or-auth-code",
  "smtpServer": "smtp.example.com",
  "smtpPort": 465,
  "useSsl": true,
  "fromName": "Your Name"
}
```

### 3. 常见邮件服务商配置

#### QQ 邮箱

```json
{
  "user": "your-qq-number@qq.com",
  "password": "your-authorization-code",
  "smtpServer": "smtp.qq.com",
  "smtpPort": 465,
  "useSsl": true,
  "fromName": "你的名字"
}
```

**注意**：
- 密码必须使用 QQ 邮箱的授权码，不是 QQ 密码
- 获取授权码：QQ 邮箱设置 > 账户 > POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务 > 生成授权码

#### Gmail

```json
{
  "user": "your-email@gmail.com",
  "password": "your-app-password",
  "smtpServer": "smtp.gmail.com",
  "smtpPort": 465,
  "useSsl": true,
  "fromName": "Your Name"
}
```

**注意**：
- 需要开启两步验证
- 使用应用专用密码（App Password）

#### 163 邮箱

```json
{
  "user": "your-email@163.com",
  "password": "your-authorization-code",
  "smtpServer": "smtp.163.com",
  "smtpPort": 465,
  "useSsl": true,
  "fromName": "你的名字"
}
```

#### Outlook / Hotmail

```json
{
  "user": "your-email@outlook.com",
  "password": "your-password",
  "smtpServer": "smtp-mail.outlook.com",
  "smtpPort": 587,
  "useSsl": false,
  "fromName": "Your Name"
}
```

**注意**：Outlook 使用端口 587 和 STARTTLS（useSsl: false）

## 使用方法

### 基本用法

```typescript
// 发送纯文本邮件
await agent.useTool('send_email', {
  to: 'recipient@example.com',
  subject: '测试邮件',
  body: '这是邮件正文'
});

// 发送 HTML 邮件
await agent.useTool('send_email', {
  to: 'recipient@example.com',
  subject: '测试邮件',
  body: '<h1>标题</h1><p>这是 HTML 邮件</p>',
  html: true
});
```

### 高级用法

```typescript
// 发送带附件的邮件
await agent.useTool('send_email', {
  to: 'recipient@example.com',
  subject: '带附件的邮件',
  body: '请查收附件',
  attachments: [
    '/path/to/file1.pdf',
    '/path/to/file2.jpg'
  ]
});

// 发送带抄送和密送的邮件
await agent.useTool('send_email', {
  to: 'recipient@example.com',
  cc: 'cc1@example.com,cc2@example.com',
  bcc: 'bcc@example.com',
  subject: '重要通知',
  body: '邮件内容'
});

// 从文件读取邮件正文
await agent.useTool('send_email', {
  to: 'recipient@example.com',
  subject: '邮件主题',
  bodyFile: '/path/to/email-body.html',
  html: true
});
```

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `to` | string | ✅ | 收件人邮箱（多个用逗号分隔） |
| `subject` | string | ✅ | 邮件主题 |
| `body` | string | ⚠️ | 邮件正文（与 bodyFile 二选一） |
| `bodyFile` | string | ⚠️ | 邮件正文文件路径（与 body 二选一） |
| `html` | boolean | ❌ | 是否为 HTML 邮件（默认 false） |
| `attachments` | string[] | ❌ | 附件文件路径数组 |
| `cc` | string | ❌ | 抄送邮箱（多个用逗号分隔） |
| `bcc` | string | ❌ | 密送邮箱（多个用逗号分隔） |

## 配置字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `user` | string | ✅ | 邮箱账号 |
| `password` | string | ✅ | 邮箱密码或授权码 |
| `smtpServer` | string | ✅ | SMTP 服务器地址 |
| `smtpPort` | number | ❌ | SMTP 端口（默认 465） |
| `useSsl` | boolean | ❌ | 是否使用 SSL（默认 true） |
| `fromName` | string | ❌ | 发件人名称 |

## 常见问题

### 1. 认证失败

**错误信息**：`Authentication failed`

**解决方法**：
- 检查 SMTP 服务是否已在邮箱设置中启用
- 确认密码是授权码（而非邮箱登录密码）
- 确认授权码正确且未过期

### 2. 连接超时

**错误信息**：`Connection timeout`

**解决方法**：
- 检查网络连接是否正常
- 确认 SMTP 服务器地址和端口正确
- 检查防火墙是否阻止了连接

### 3. 连接被拒绝

**错误信息**：`ECONNREFUSED`

**解决方法**：
- 确认 SMTP 服务器地址正确
- 确认 SMTP 端口正确（通常为 465 或 587）
- 某些邮件服务商可能需要使用 587 端口和 STARTTLS

## 安全建议

1. **不要在代码中硬编码密码**：使用配置文件
2. **保护配置文件**：确保配置文件权限正确（600）
3. **使用授权码**：不要使用邮箱登录密码
4. **定期更换授权码**：提高安全性

## 开发说明

### 工具架构

邮件工具是 Local Agent Terminal 的**内置工具**，代码位于 `src/main/tools/email-tool.ts`。

**关键设计**：
- ✅ 工具代码在项目中（`src/main/tools/`）
- ✅ 配置文件在用户目录（`~/.deepbot/tools/email-tool/config.json`）
- ✅ 依赖安装在用户目录（`~/.deepbot/tools/email-tool/node_modules/`）
- ✅ 运行时动态加载依赖（不打包到主项目）

### 为什么使用动态加载？

1. **减小主项目体积**：nodemailer 及其依赖约 2MB，不是所有用户都需要
2. **可选功能**：邮件发送是可选功能，按需安装
3. **灵活性**：用户可以选择安装位置（用户级别或项目级别）

### 技术实现

```typescript
// 动态加载 nodemailer（运行时）
async function loadNodemailer(): Promise<any> {
  const toolDir = join(homedir(), '.deepbot', 'tools', 'email-tool');
  
  try {
    // 从工具目录加载
    const nodemailerPath = join(toolDir, 'node_modules', 'nodemailer');
    if (existsSync(nodemailerPath)) {
      return require(nodemailerPath);
    }
    
    // 尝试从全局加载
    return require('nodemailer');
  } catch (error) {
    throw new Error('请先安装 nodemailer');
  }
}
```

### 创建类似工具

如果你想创建类似的工具（内置工具 + 外部依赖），参考以下步骤：

1. **在 `src/main/tools/` 创建工具文件**（如 `my-tool.ts`）
2. **实现 `ToolPlugin` 接口**
3. **在 `tool-loader.ts` 中导入并加载**
4. **配置文件放在 `~/.deepbot/tools/my-tool/config.json`**
5. **依赖安装在 `~/.deepbot/tools/my-tool/node_modules/`**
6. **使用动态 `require()` 加载依赖**

参考文件：
- `src/main/tools/email-tool.ts` - 工具实现
- `src/main/tools/registry/tool-loader.ts` - 工具加载
- `src/main/tools/registry/example-tool.ts` - 示例模板

## 许可证

MIT
