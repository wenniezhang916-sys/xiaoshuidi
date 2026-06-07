# 小水滴 v4 Supabase 云同步版

## 先做 1：创建数据库表
打开 Supabase → SQL Editor → New query  
把 `supabase_setup.sql` 里的内容粘贴进去，点 Run。

## 先做 2：填写你的 Supabase 信息
打开 `app.js`，找到最上面两行：

```js
const SUPABASE_URL = "PASTE_YOUR_SUPABASE_URL_HERE";
const SUPABASE_KEY = "PASTE_YOUR_PUBLISHABLE_KEY_HERE";
```

改成你自己的：

```js
const SUPABASE_URL = "https://xxxxx.supabase.co";
const SUPABASE_KEY = "你的 Publishable key";
```

注意：不要用 Secret key。

## 上传 GitHub
把这些文件上传/覆盖到 GitHub 仓库根目录：
- index.html
- style.css
- app.js
- README.md
- supabase_setup.sql

GitHub Pages 会自动更新。

## 现在支持
- Supabase 邮箱注册/登录
- Google 登录入口
- 数据云同步
- 个人主页云同步
- 待办/Daily/倒数日/打卡日历云同步
- 外部播放器优化

## Google 登录
还需要去 Supabase → Authentication → Providers → Google 配置 Google OAuth。
