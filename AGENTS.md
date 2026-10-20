<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 发布约定（用户要求）

- 用户要求打包发布时，除递增版本标签外，必须同时发布 `docker.io/easitwch/cert-ops:latest`。
- 未指定版本时默认递增补丁号；同步 `package.json`、锁文件、README 和 Compose 示例，保留历史版本说明。
- 构建并验证 `linux/amd64`、`linux/arm64` 镜像后，先推送版本标签，再为同一镜像索引添加并推送 `latest`，核验两个远端标签的 digest 一致。不要单独重建 latest。
- 不覆盖已发布的版本标签；本地配置、数据库密码、账号密钥、证书私钥不得打包。测试使用独立临时数据库，不调用真实 DNS/CA。
- 只有用户明确要求发布时才推送；普通代码修改不自动发布，也不自动提交或推送 Git。

## 全局一致性（用户要求）

- 每次修改先搜索所有相关入口和使用位置，统一同类 UI 与业务逻辑，不只修当前截图中的一处。
- Logo、表单、交互及校验优先复用公共组件、资源和逻辑；仅为背景或布局做必要的展示适配，不维护相互独立的重复实现。
- 验证覆盖本次改动涉及的登录前后页面、响应式布局、语言文案、路由和状态行为；不扩大到无关功能改造。
- 品牌入口统一使用 `app/brand.tsx` 和 `lib/brand.ts` 指向的 SVG；浏览器图标与页面 Logo 使用同一图形资源。
- 界面保持精简，不添加重复解释标题、字段或按钮的副标题、常驻说明段落。使用说明放 README；必要的校验错误、操作结果、真实状态、流程步骤及危险操作确认保留，不因文案精简取消业务校验。
- 整体主题使用黑白灰；图标及成功、警告、错误等语义色独立保留，不使用整页去色滤镜。新增页面、弹窗和交互状态沿用相同主题规则。
- Logo 和项目分组标记属于装饰元素，统一使用中性灰，不使用彩色强调；登录页、侧栏、证书列表和浏览器图标保持一致。
