# 🚀 部署指南 - 发布到网上

将你的语音待办应用发布到网上，让朋友们可以访问使用！

## 方案一：GitHub Pages（推荐，免费）

### 优点
- ✅ 完全免费
- ✅ 部署简单，5分钟搞定
- ✅ 自动获得 `https://你的用户名.github.io/Todo` 网址
- ✅ 支持 HTTPS（安全连接）
- ✅ 可以自定义域名

### 步骤

#### 1. 创建 GitHub 账号
如果还没有，前往 [github.com](https://github.com) 注册（免费）

#### 2. 创建仓库
1. 登录 GitHub
2. 点击右上角 `+` → `New repository`
3. 填写信息：
   - Repository name: `Todo` （或其他名字）
   - 设为 `Public`（公开）
   - 不勾选任何初始化选项
4. 点击 `Create repository`

#### 3. 上传文件

有两种方法：

##### 方法A：网页上传（简单）
1. 在新创建的仓库页面，点击 `uploading an existing file`
2. 拖拽以下文件到页面：
   ```
   - index.html
   - USAGE.md
   - README.md
   - css/ 文件夹（包含 style.css）
   - js/ 文件夹（包含所有 .js 文件）
   ```
3. 在底部填写提交信息：`Initial commit`
4. 点击 `Commit changes`

##### 方法B：使用 Git 命令（高级）
在 Todo 文件夹中打开终端，执行：

```bash
# 初始化 git 仓库
git init

# 添加所有文件
git add .

# 提交
git commit -m "Initial commit"

# 连接到 GitHub（替换为你的用户名和仓库名）
git remote add origin https://github.com/你的用户名/Todo.git

# 推送
git branch -M main
git push -u origin main
```

#### 4. 启用 GitHub Pages
1. 在仓库页面，点击 `Settings`（设置）
2. 左侧菜单找到 `Pages`
3. 在 `Source` 下拉菜单选择 `main` 分支
4. 点击 `Save`
5. 等待几分钟，页面会显示你的网站地址：
   ```
   https://你的用户名.github.io/Todo/
   ```

#### 5. 分享给朋友
把这个网址发给朋友，他们就可以使用了！

### 更新网站
修改代码后，重新上传文件或使用 git push，网站会自动更新。

---

## 方案二：Vercel（也很简单，免费）

### 优点
- ✅ 完全免费
- ✅ 部署超快
- ✅ 自动 HTTPS
- ✅ 更快的全球 CDN

### 步骤
1. 前往 [vercel.com](https://vercel.com)
2. 用 GitHub 账号登录
3. 点击 `Add New` → `Project`
4. 导入你的 GitHub 仓库
5. 点击 `Deploy`
6. 完成！会得到一个 `https://xxx.vercel.app` 网址

---

## 方案三：Netlify（也很好用，免费）

### 步骤
1. 前往 [netlify.com](https://netlify.com)
2. 注册/登录
3. 点击 `Add new site` → `Import from Git`
4. 选择 GitHub，授权
5. 选择你的 Todo 仓库
6. 点击 `Deploy`
7. 完成！会得到一个 `https://xxx.netlify.app` 网址

---

## 方案四：直接拖拽部署（最简单！）

### Netlify Drop
1. 前往 [app.netlify.com/drop](https://app.netlify.com/drop)
2. 把整个 `Todo` 文件夹拖到页面上
3. 等待几秒
4. 完成！自动生成网址

不需要注册，不需要命令行，拖拽即可！

---

## 📱 自定义域名（可选）

如果你有自己的域名（如 `todo.yourdomain.com`），可以：

### GitHub Pages
1. 在仓库根目录创建 `CNAME` 文件
2. 内容写入你的域名：`todo.yourdomain.com`
3. 在域名服务商设置 CNAME 记录指向 `你的用户名.github.io`

### Vercel/Netlify
在设置页面直接添加自定义域名，按提示配置 DNS。

---

## 🔒 注意事项

### 1. API Key 安全
- ✅ 当前应用设计安全：API Key 存在用户浏览器（sessionStorage）
- ✅ 不会暴露到服务器或代码中
- ⚠️ 每个用户需要自己输入 API Key
- ⚠️ 提醒朋友不要在公共设备上保存 API Key

### 2. 数据隐私
- ✅ 所有待办数据存在用户本地浏览器（localStorage）
- ✅ 不会上传到任何服务器
- ✅ 完全私密

### 3. HTTPS
- ✅ GitHub Pages、Vercel、Netlify 都自动提供 HTTPS
- ✅ 语音识别需要 HTTPS（或 localhost）才能工作

---

## 📊 推荐方案对比

| 方案 | 难度 | 速度 | 自定义域名 | 推荐度 |
|------|------|------|-----------|--------|
| GitHub Pages | ⭐⭐ | 快 | ✅ | ⭐⭐⭐⭐⭐ |
| Vercel | ⭐ | 超快 | ✅ | ⭐⭐⭐⭐⭐ |
| Netlify | ⭐ | 超快 | ✅ | ⭐⭐⭐⭐ |
| Netlify Drop | ⭐ | 快 | ❌ | ⭐⭐⭐ |

**最推荐**：先用 **Netlify Drop** 快速体验（拖拽即可），正式使用选 **GitHub Pages** 或 **Vercel**。

---

## 🎯 快速开始（5分钟）

### 最快方案（无需注册）
1. 打开 [app.netlify.com/drop](https://app.netlify.com/drop)
2. 拖拽 `Todo` 文件夹
3. 完成！把生成的网址发给朋友

### 推荐方案（长期使用）
1. 注册 GitHub 账号
2. 创建仓库并上传文件
3. 启用 GitHub Pages
4. 分享网址

---

## 📞 遇到问题？

### 网站打不开
- 等待 5-10 分钟（部署需要时间）
- 检查是否启用了 GitHub Pages
- 确保仓库是 Public（公开）

### 语音识别不工作
- 确保网站使用 HTTPS（GitHub Pages 自动提供）
- 只支持 Chrome 和 Edge 浏览器
- 需要允许麦克风权限

### 朋友无法使用
- 确认他们使用的是 Chrome 或 Edge
- 确认网站是 HTTPS 连接
- 提醒首次使用可以不输入 API Key（使用简单模式）

---

## 💡 使用提示

### 告诉朋友
```
嗨！我做了一个语音待办应用，分享给你：
🔗 https://你的用户名.github.io/Todo/

特点：
✅ 用语音快速记录待办，说话就能生成
✅ 完全免费，无需注册
✅ 数据保存在你本地，隐私安全
✅ 支持自动识别时间和优先级

使用方法：
1. 用 Chrome 或 Edge 打开
2. 点麦克风按钮，说出待办事项
3. 自动生成，超方便！

试试说："明天开会，周五交报告"，会自动生成2个待办！
```

---

祝你发布顺利！🎉
