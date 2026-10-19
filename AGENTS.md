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
