# CLAUDE.md — ALARMZXC 的网页项目

## 项目概述
个人 HTML 网页项目，包含首页、图集页面等，部署于 GitHub Pages。  
使用 AI 辅助编写 HTML/CSS/JavaScript，探索前端交互效果。

## 提交约定

### 由 Claude Code 完成的内容
- 所有由 Claude Code 生成或修改的代码，commit message **必须**以 `by claude code` 结尾。
- 格式：`<改动描述> by claude code`
- 示例：
  ```
  feat: 添加暗色主题切换功能 by claude code
  fix: 修复移动端灯箱导航错位 by claude code
  refactor: 优化搜索栏样式 by claude code
  ```
- 手动编写的改动不添加此标记。

### 提交风格
- 保持简洁中文描述，参考已有 commit：
  - `优化图集页面：修复移动端灯箱导航、固定分页栏、放大搜索/标签、柔化暗色主题、主题切换图标动画`
  - `图片集更新`
  - `图集动画添加`

## 技术栈
- 纯 HTML + CSS + JavaScript（无框架）
- 外部依赖：Font Awesome 6.4（图标库）
- 第三方服务：Google Analytics (G-L9VP1EQP6G)、Google AdSense (ca-pub-3951887033933056)
- 部署：GitHub Pages（通过 CNAME 自定义域名）

## 项目文件结构
| 文件 | 用途 |
|---|---|
| `index.html` | 首页，入口页面 |
| `photos.html` | 图集页面，图片展示与浏览 |
| `deepseek_html and gemini.html` | AI 相关实验页面 |
| `人物介绍模板.html` | 人物介绍模板页面 |
| `runoob-test.html` | 测试页面 |
| `image/` | 图片资源目录 |
| `README.md` | 项目说明（简短） |

## Git 工作流
- 主分支：`main`
- 直接向 `main` 提交（单人项目）
- 避免提交大文件或敏感信息（API key 等）
- GitHub Pages 部署：推送 `main` 后自动部署

## 代码风格
- HTML：语义化标签、UTF-8 编码、响应式 viewport
- CSS：中英文注释分隔（`/* ===== 中文标题 ===== */`），层叠清晰
- JavaScript：ES6 语法，事件监听使用 `addEventListener`
- 移动端优先的响应式设计
- 图片资源放在 `image/` 目录下，使用相对路径引用

## 约定和提醒
- 添加新页面时同步更新本文件中的文件结构表
- 使用 Google Analytics / AdSense 时保持现有配置不变
- 所有外部资源优先使用 CDN 链接
- 不要删除已有的 favicon、Analytics、AdSense 配置