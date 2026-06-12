# 邮件工具使用示例

## 快速开始

### 1. 安装依赖

```bash
# 运行安装脚本
bash ~/.deepbot/tools/email-tool/install.sh

# 或手动安装
mkdir -p ~/.deepbot/tools/email-tool
cd ~/.deepbot/tools/email-tool
pnpm init -y
pnpm add nodemailer
```

### 2. 配置邮箱

创建配置文件 `~/.deepbot/tools/email-tool/config.json`：

```json
{
  "user": "your-email@qq.com",
  "password": "your-authorization-code",
  "smtpServer": "smtp.qq.com",
  "smtpPort": 465,
  "useSsl": true,
  "fromName": "你的名字"
}
```

### 3. 在 Local Agent Terminal 中使用

直接对 AI 说：

```
发送一封邮件给 recipient@example.com，主题是"测试邮件"，内容是"这是一封测试邮件"
```

AI 会自动调用邮件工具发送邮件。

## 使用场景

### 场景 1：发送简单文本邮件

```
发送邮件给 boss@company.com，主题"周报"，内容"本周完成了 3 个功能开发"
```

### 场景 2：发送 HTML 邮件

```
发送一封 HTML 格式的邮件给 team@company.com，主题"项目进度"，
内容包含：
<h1>项目进度报告</h1>
<ul>
  <li>功能 A：已完成</li>
  <li>功能 B：进行中</li>
</ul>
```

### 场景 3：发送带附件的邮件

```
发送邮件给 client@example.com，主题"合同文件"，
内容"请查收附件中的合同"，
附件：/Users/me/Documents/contract.pdf
```

### 场景 4：发送带抄送的邮件

```
发送邮件给 manager@company.com，
抄送给 team@company.com 和 hr@company.com，
主题"请假申请"，内容"申请明天请假一天"
```

## 常见问题

### Q1: 提示 "nodemailer 未安装"

**解决方法**：运行安装脚本或手动安装依赖

```bash
cd ~/.deepbot/tools/email-tool
pnpm add nodemailer
```

### Q2: 提示 "邮件工具未配置"

**解决方法**：创建配置文件

```bash
cp ~/.deepbot/tools/email-tool/config.example.json ~/.deepbot/tools/email-tool/config.json
vim ~/.deepbot/tools/email-tool/config.json
```

### Q3: QQ 邮箱认证失败

**原因**：密码必须使用授权码，不是 QQ 密码

**获取授权码**：
1. 登录 QQ 邮箱
2. 设置 > 账户
3. POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务
4. 开启服务并生成授权码

### Q4: Gmail 认证失败

**原因**：需要使用应用专用密码

**获取应用密码**：
1. 开启两步验证
2. Google 账户 > 安全性 > 应用专用密码
3. 生成新的应用密码

## 技术说明

### 为什么不打包到主项目？

1. **减小体积**：nodemailer 及其依赖约 2MB
2. **可选功能**：不是所有用户都需要邮件功能
3. **灵活配置**：用户可以自由选择安装位置

### 动态加载原理

```typescript
// 运行时动态加载 nodemailer
const nodemailer = require('~/.deepbot/tools/email-tool/node_modules/nodemailer');
```

这样 nodemailer 不会被打包到 Electron 应用中，只在需要时加载。

## 安全建议

1. ✅ 配置文件权限设置为 600
2. ✅ 使用授权码而非登录密码
3. ✅ 定期更换授权码
4. ❌ 不要在代码中硬编码密码
5. ❌ 不要将配置文件提交到 Git

```bash
# 设置配置文件权限
chmod 600 ~/.deepbot/tools/email-tool/config.json
```
