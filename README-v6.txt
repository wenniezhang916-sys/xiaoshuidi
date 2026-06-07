# 小水滴 v6 功能升级版

## 新增功能
- 自习室多人实时同步
- 自习室排行榜
- 学习统计页面
- 每日学习报告
- 每周学习报告
- 番茄钟可以关联待办清单
- 番茄钟支持正向计时
- 关联待办后，专注完成会自动增加任务进度

## 使用前必须做
1. 打开 Supabase
2. SQL Editor → New Query
3. 粘贴 `supabase_v6_realtime.sql`
4. 点 Run
5. 再把 index.html / style.css / app.js 上传覆盖 GitHub

## 注意
如果 SQL 里 `alter publication supabase_realtime add table` 报已经存在，可以忽略。
