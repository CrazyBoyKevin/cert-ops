# CertOps

CertOps 是一个用于集中上传、解析、分组、监控和提醒 SSL/TLS 证书的管理平台。

当前版本：[`0.0.10`](https://hub.docker.com/r/easitwch/cert-ops/tags?name=0.0.10)，支持 `linux/amd64` 和 `linux/arm64`。`latest` 与当前发布版本指向同一份镜像。

## 功能

从 `0.0.6` 开始支持多阿里云账号凭证管理；`0.0.5` 及更早镜像仍为单账号。

- 上传 PEM、CRT、CER 证书或直接粘贴 PEM 内容
- 解析域名、SAN、颁发机构、有效期、序列号、指纹和密钥算法
- 校验证书与私钥是否匹配
- 复制证书内容、私钥，或分别下载 `域名.pem` 和 `域名.key`
- 将证书链（`域名.pem`）和私钥（`域名.key`）两个文件打包为 ZIP 导出，不包含单独的公钥文件
- 创建、重命名和删除证书分组；包含证书的分组不能删除
- 单管理员登录，无在线注册；账号由容器环境变量配置
- HttpOnly 签名会话和主动退出登录
- 使用 AES-256-GCM 加密保存私钥和通知凭证
- 在证书到期前 15、7、3、1 天发送钉钉、飞书或邮件通知
- 通过阿里云 DNS 自动申请 Let’s Encrypt 普通域名/通配符证书、自动续签及手动重试
- 保存多组命名的阿里云 AK / SK，申请时选择账号，后续续签保持账号绑定
- 无 AK / SK 时可手动添加 DNS TXT，检查解析后确认签发；此模式续签也需要人工操作
- 申请弹窗仅处理新申请、DNS 检查、签发与失败重试；未完成申请分页展示，签发后自动移出
- 续签和自动续签开关统一位于证书详情；新申请默认关闭自动续签，已有设置保持不变。手动 DNS 的上次验证记录折叠保留，便于清理 TXT

## 局域网 IP 证书（从 0.0.10 开始提供）

从“证书签发”工具迁入私有 CA 与 IP 服务证书功能，使用 CertOps 的登录、PostgreSQL、加密存储、分组和到期提醒，不再需要单独运行 Python 服务。

1. 左侧以项目分组为主导航，分组在公有、私有证书间共用，侧栏数量是两类证书总数。选中项目后，在内容区切换「公有证书 / 私有证书」，切换类型不会丢失项目选择；顶部统计合并当前项目的公有、私有证书，不随类型、CA、搜索或状态筛选变化；下方列表遵循这些筛选。公有区保留 Let’s Encrypt 与原有上传记录；这是管理分类，不代表对历史上传证书的公共信任认证。
2. 左侧独立的「根 CA 管理」支持创建、导入多个 CA。CA 是跨项目资源，不属于某个分组；点击「查看跨项目服务证书」会转到「全部项目 → 私有证书」并显示可清除的 CA 筛选。选择其他项目会清除旧 CA 筛选，避免隐式漏掉证书。创建根 CA 时可填写名称、组织、部门、国家代码、省 / 州、城市及有效期，签名后不可修改。
3. 点击「签发私有 IP 证书」，选择有私钥的 CA 和项目分组，填写服务名称以及 IPv4 / IPv6 地址。支持多个 IP，不支持协议、端口、网段或 IP 通配符。
4. 在证书详情中续签、调整 IP、下载或删除历史版本。续签使用原 CA、生成新私钥，保留旧版本；不自动续期或部署。
5. 导出仅包含 `.pem` 证书和 `.key` 服务私钥。根证书 `.crt` / `.cer` 单独下载，根私钥不提供网页导出。
6. 删除版本需要确认未使用；删除当前版本会回退到剩余最新版本，删除最后一版则移除服务。主列表删除服务会连同所有历史版本一起删除。删除不是吊销，已部署副本不受影响。
7. 根 CA 支持二次确认后删除；只要任何项目中仍有关联服务证书（包括已过期、无私钥及包含历史版本的服务），就禁止删除。页面展示关联数量，后端在事务中重新校验并保留数据库外键保护，不级联删除服务。删除会同时移除平台保存的根证书与根私钥，平台内不可恢复；请确认备份及未使用。平台之外的证书副本或系统信任不会因此撤销。

私有 CA 不受浏览器默认信任，需在访问设备上手动安装并信任根证书；续签后需手动替换服务端证书与私钥、重载 Nginx 等服务。工具不修改系统信任，不提供 CRL / OCSP，不需要阿里云 AK / SK，也不调用公共 CA 或 DNS。

要求可用 PostgreSQL、至少 32 字符且不是示例值的固定 `CERT_ENCRYPTION_KEY`。签发不会降级到演示存储。根私钥与所有历史私钥均加密保存在数据库；请同时安全备份数据库及加密密钥。服务证书最长 365 天，不能超过根 CA 剩余有效期。

本地需安装 OpenSSL 1.1.1+ / 3.x；`0.0.10` 镜像已包含 OpenSSL 与此功能，`0.0.9` 及更早镜像不包含。数据库会增量创建 `private_authorities`、`private_services`、`private_versions` 表以及证书来源字段，不清空现有数据。此次仅迁移功能，没有复制原工具的 CA、服务证书、私钥或登录配置。

### 导入已有根 CA 和服务证书

- 根 CA 支持上传 PEM / CRT / CER（PEM 或 DER）文件或粘贴 PEM；只接受单张自签根 CA，验证 CA 属性和自签名，不把普通服务证书或中间 CA 当作根。
- 根私钥可选。仅有根证书时可管理及导入它下面的服务证书，但不能签发或续签。再次导入同一根证书并附带匹配的未加密 PEM 私钥，可补充签发能力；按指纹去重，不重复建 CA，也不会因省略私钥而清除已有私钥。
- 在「项目 → 私有证书 → 导入服务证书」选择根 CA 和分组，上传证书（或完整的叶证书在前的中间证书链），服务私钥可选。上传、导入和申请默认选中当前项目。服务证书可绑定 IP 或域名；当前在线签发/续签仍只支持 IP，含域名的服务可导入、管理及下载。
- 导入会验证整条链的签名、CA 约束和服务端用途，不能只凭颁发者名称关联。只信任所选根 CA，不联网下载中间证书。允许已过期证书归档并保留真实有效期，不代表它仍可安全使用。验证依据：[OpenSSL verify](https://docs.openssl.org/3.4/man1/openssl-verification-options/)。
- 无服务私钥的历史版本可以下载 PEM，但不可导出包含私钥的 ZIP。重复导入已有证书/历史版本会拒绝；已有普通上传记录不会被静默覆盖或移动。
- 单次证书文件最大 256 KiB，证书链最多 10 张，私钥最大 32 KiB；不支持 PFX / P12 或带口令私钥。根私钥加密存储且不提供网页下载。

验证：`npm test`；`npm run build -- --webpack` 后运行 `node --experimental-strip-types tests/aliyun-credentials.integration.mjs`（使用 Apple Container 临时 PostgreSQL，含完整私有 CA 流程，不访问用户数据库或公共 CA）。

## 使用 Docker Compose 部署

推荐直接使用发布到 Docker Hub 的固定版本镜像：

```text
docker.io/easitwch/cert-ops:0.0.10
```

也可使用 `docker.io/easitwch/cert-ops:latest`。`latest` 会随新版本发布更新，运行中的容器不会自动升级；仍需拉取镜像并重建容器。需要固定部署版本时保留版本号标签。

`0.0.10` 是多架构镜像，同时支持：

- `linux/amd64`：Intel/AMD 服务器、普通 x86_64 Linux 主机
- `linux/arm64`：Apple Silicon、ARM64 Linux 主机

Docker 会根据运行机器自动拉取正确的架构，无需手动指定 `--platform`。

### 1. 准备环境变量

在项目目录创建 `.env`，并替换所有必填值：

```dotenv
POSTGRES_PASSWORD=replace-with-a-strong-password
CERT_ENCRYPTION_KEY=replace-with-at-least-32-random-characters
CRON_SECRET=replace-with-a-random-cron-token
CERTOPS_ADMIN_USERNAME=admin
CERTOPS_ADMIN_PASSWORD=replace-with-a-strong-admin-password
CERTOPS_SESSION_SECRET=replace-with-at-least-32-random-characters
CERTOPS_PORT=3000
```

可以使用下面的命令生成安全随机值：

```bash
openssl rand -hex 24
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 24
openssl rand -hex 32
```

- `POSTGRES_PASSWORD`：PostgreSQL 用户密码。建议使用字母和数字，避免连接 URL 中的特殊字符编码问题。
- `CERT_ENCRYPTION_KEY`：用于加密私钥和通知凭证。部署后不要更换，否则已有密文将无法解密。
- `CRON_SECRET`：用于保护可选的手动到期检查接口；内置定时器不依赖该值。
- `CERTOPS_ADMIN_USERNAME`：唯一管理员用户名，不会保存在数据库中。
- `CERTOPS_ADMIN_PASSWORD`：唯一管理员密码，生产环境至少 12 个字符。仅本地开发预览可显式设置 `CERTOPS_LOCAL_PREVIEW=true` 使用至少 6 位的测试密码；此开关在生产环境无效，预览服务应绑定 `127.0.0.1`。
- `CERTOPS_SESSION_SECRET`：登录会话签名密钥，至少 32 个字符；修改用户名、密码或该密钥会使已有会话失效。
- `CERTOPS_PORT`：宿主机访问端口，默认是 `3000`。

系统不提供注册功能。部署完成后，使用上述管理员账号在 `/login` 登录；可以从左下角用户区域退出登录。

### 2. 启动服务

```bash
cp compose.example.yml compose.yml
docker compose pull
docker compose up -d
docker compose ps
```

启动后访问：

```text
http://localhost:3000
```

如果修改了 `CERTOPS_PORT`，请使用对应端口访问。

Compose 会启动：

- `certops`：`docker.io/easitwch/cert-ops:0.0.10` Web 服务
- `postgres`：PostgreSQL 16，数据保存在 `certops_postgres_data` Volume 中

应用首次访问数据库时会自动创建 `cert_ops` schema、数据表和索引，无需手动导入 SQL。

### 3. 日常维护

查看状态和日志：

```bash
docker compose ps
docker compose logs -f certops
docker compose logs -f postgres
```

重启或停止：

```bash
docker compose restart certops
docker compose down
```

`docker compose down` 不会删除数据库数据。不要随意执行 `docker compose down -v`，该命令会删除 PostgreSQL 数据卷。

重新拉取并启动当前配置的镜像：

```bash
docker compose pull certops
docker compose up -d certops
```

## 使用已有 PostgreSQL

如果使用独立 PostgreSQL，可以不启动 Compose 中的 `postgres` 服务，并直接运行应用镜像：

```bash
docker run -d \
  --name certops \
  --restart unless-stopped \
  -p 3000:3000 \
  -e DATABASE_URL='postgresql://certops:password@db.example.com:5432/certops?sslmode=require' \
  -e CERT_ENCRYPTION_KEY='replace-with-at-least-32-random-characters' \
  -e CRON_SECRET='replace-with-a-random-cron-token' \
  -e CERTOPS_ADMIN_USERNAME='admin' \
  -e CERTOPS_ADMIN_PASSWORD='replace-with-a-strong-admin-password' \
  -e CERTOPS_SESSION_SECRET='replace-with-at-least-32-random-characters' \
  docker.io/easitwch/cert-ops:0.0.10
```

数据库用户需要具备目标数据库的连接、创建 schema、建表和创建索引权限。密码含有 `@`、`:`、`/`、`#` 等字符时，必须先进行 URL 编码。

## 到期检查任务

应用内置到期检查定时器，随 Web 服务启动立即检查一次，之后每轮完成后等待 10 分钟再次检查，无需外部 cron 或 HTTP 调用。请在系统设置中启用通知渠道并保存 Webhook、加签密钥或 SMTP 配置。

仅剩余 15、7、3、1 天（按距离到期时刻的剩余小时数向上取整）时发送提醒，已过期证书不发送。每张证书、每个提醒节点、每个渠道成功后不再重复发送，重启容器后仍有效。失败渠道在下一轮检查重试，直到当前提醒窗口结束；停机错过的窗口不会补发。

发送结果保存在 PostgreSQL 的 `cert_ops.notification_logs` 表，容器日志中可以看到定时器启动、检查结果及失败数量。数据库不可用时会跳过发送并在下一轮重试，不会使用演示证书发送通知。多个应用实例通过数据库锁避免同时执行检查。

查看定时器日志：

```bash
docker compose logs --tail=100 certops
```

注意：通知平台已接收消息、但应用尚未写入成功记录时发生进程崩溃，恢复后的重试仍可能重复发送；外部通知服务无法与本地数据库保证原子提交。

如需手动立即检查，也保留以下受保护接口（与定时器共享去重记录）：

```bash
curl -X POST https://certops.example.com/api/cron/reminders \
  -H "Authorization: Bearer $CRON_SECRET"
```

内置定时器从 `0.0.3` 开始提供。从旧版本升级时，将 `compose.yml` 中 `certops.image` 更新为 `docker.io/easitwch/cert-ops:0.0.10`（或 `latest`）。升级前，先备份数据库和加密密钥，并停止全部旧版 CertOps 实例；不要停止或删除数据库，也不要混跑新旧版本。单实例示例：

```bash
docker compose pull certops
docker compose stop certops
docker compose up -d certops
```

### 0.0.10 更新内容：私有证书管理与导航整理

- 新增多个私有根 CA 的创建、导入及删除；支持只导入根证书，之后补充私钥。根 CA 存在关联服务证书时禁止删除。
- 支持 IPv4 / IPv6 服务证书签发、已有服务证书导入、续签历史与 PEM / KEY 导出；私钥加密保存，镜像内置 OpenSSL。
- 项目分组下分别管理公有、私有证书，顶部统计合并两类证书；根 CA 作为跨项目资源独立管理。
- 项目、证书类型、CA 筛选和详情使用 URL 保存导航状态，刷新及重新登录后保留位置；系统设置改为独立页面，通知与签发配置使用 Tab 切换。
- 五语言切换移至右上角下拉菜单，支持键盘操作和浏览器记忆；更新品牌样式，统一移除重复页面大标题及冗余说明。
- 提供 `0.0.10` 和 `latest` 两个双架构标签；发布测试在独立临时数据库验证公有与私有证书流程，不调用真实 DNS / 公共 CA。
- 升级前备份数据库及 `CERT_ENCRYPTION_KEY`，停止旧应用后再启动新镜像。数据库增量迁移不会清空现有记录；回退时应恢复升级前备份。

### 0.0.9 更新内容：申请与续签分离

- 申请弹窗仅保留新申请、添加 DNS、检查并签发及失败重试；未完成申请每页 10 条，签发成功后自动移出。
- 续签、自动续签开关及续签失败处理统一移至证书详情；续签任务不会混入新申请列表。
- 新申请默认关闭自动续签，可在签发后的详情中开启；已有证书的自动续签设置不变。
- 手动 DNS 的上次验证记录默认折叠，供清理 TXT 使用；续签成功后刷新证书信息和导出内容。
- 同步五种语言、数据库查询索引及隔离集成测试，发布 `0.0.9` 和 `latest` 两个双架构标签。
- Docker 使用 Webpack 生产构建，与本地验证流程一致。若 Apple Container 遗漏构建上下文子目录，可将提交中的应用源码以 tar 归档传入，并在构建阶段使用 `ADD` 解包；归档不得包含 `.env`、密钥或本地配置。

### 0.0.8 更新内容：HTTP 复制兼容

- 修复通过 HTTP 地址访问时，复制证书、私钥、域名、指纹及手动 DNS 记录失败的问题。
- 优先使用 Clipboard API；接口不可用或调用失败时使用兼容复制方式，保留 PEM 换行并恢复原焦点。
- 复制被浏览器阻止时显示明确提示，不误报成功。
- 更新兼容范围内的安全依赖。2026-10-10 审计仍报告 Nodemailer 和 `acme-client` 依赖的 `node-forge` 高危告警；本次不进行邮件库大版本升级或 ACME 不兼容降级，不能视为零漏洞版本。
- 发布时提供 `0.0.8` 和 `latest` 两个标签；`latest` 随后续版本更新，`0.0.8` 保持不变。

### 0.0.7 更新内容：手动 DNS 验证

- 申请时可选择「手动添加 DNS」，无需阿里云 AK / SK，支持任意 DNS 服务商、普通域名和通配符。
- 展示并复制 TXT 主机记录、完整名称及记录值；逐条检查公共 DNS，通过后需确认「继续签发」，提交 CA 前再次核验。
- 同名不同值的 TXT 分开显示；状态、加密私钥和 ACME 订单持久化，支持刷新、重启及签发中断恢复。
- 手动模式禁止自动续签；续签需再次人工操作，过期记录需重新生成，签发后自行清理本次 TXT。原阿里云自动模式保留。
- 五种语言同步更新，补充隔离 PostgreSQL、模拟 CA/DNS 集成测试和双架构镜像冒烟测试。
- 发布时提供 `0.0.7` 和 `latest` 两个标签；`latest` 随后续版本更新，`0.0.7` 保持不变。
- 升级前备份数据库与加密密钥、停止全部旧版应用；新增状态和字段自动迁移，不应混跑或直接降级旧版。

### 0.0.6 更新内容：多阿里云账号

> 以下为 `0.0.6` 的历史行为；`0.0.7` 新增手动 DNS 模式，无需选择阿里云账号。

- 「系统设置 → 证书签发」分别管理联系邮箱/协议和阿里云账号列表，支持新增、重命名、同账号密钥轮换与删除未引用凭证。
- 申请证书及 DNS 权限检查必须选择账号。申请记录显示关联账号；自动续签、手动重试均沿用该账号，不会退回其他账号。
- AK / SK 均加密保存，只返回账号名称、AK 尾号和关联申请数。仍被申请引用的凭证不能删除，关闭自动续签也不解除引用。
- 旧版单账号配置自动迁移为 `Aliyun (migrated)`，历史申请自动绑定；迁移失败整体回滚，可修复数据库/加密密钥后重试。没有旧凭证的历史申请不会猜测账号。
- 升级前备份数据库及 `CERT_ENCRYPTION_KEY`，停止所有旧版本实例后再启动新源码，避免新旧版本混跑。迁移后不应直接降级运行旧镜像；如需回退，应恢复升级前数据库备份。
- 密钥轮换仅适用于同一阿里云账号，会影响其全部关联申请。签发进行中或关联 DNS 清理未完成时禁止轮换；临时 DNS 清理仍使用创建记录时的加密凭证快照，请保留旧密钥权限直到清理完成。
- 当前 API：`GET/POST/PATCH/DELETE /api/acme/credentials` 管理凭证；申请 `POST /api/acme/orders` 和权限检查 `POST /api/acme/dns-test` 必须传入 `credentialId`。`PUT /api/acme/settings` 仅接受通用设置，AK / SK 请通过凭证接口管理。所有接口仍需管理员登录会话。
- 从本版本开始，每次发布同时提供递增版本标签和 `latest`，两个标签指向同一份多架构镜像。

### 镜像发布规则

每次明确要求发布时，默认递增补丁版本号，同时更新项目版本、锁文件、文档和 Compose 示例。构建并验证双架构镜像后，先发布版本标签，再将同一镜像索引标记为 `latest` 并推送；核验 Docker Hub 上两个标签的 digest 一致。已发布版本标签不覆盖，普通代码修改不自动触发发布。双架构镜像构建后运行 `node --experimental-strip-types tests/release-smoke.mjs`，该脚本根据 `package.json` 的版本测试对应镜像，使用临时数据库且不请求真实 DNS / CA。

### 0.0.5 更新内容

- 导出 ZIP 仅包含 `域名.pem`（证书及已保存的中间证书链）和 `域名.key`（PEM 编码私钥）；单独下载也使用相同文件名。通配符域名的 `*.` 替换为 `wildcard.`。
- 详情页明确区分证书和私钥，导出入口文案同步更新为五种语言。
- `0.0.4` 及更早的镜像保持原有导出格式，升级到 `0.0.5` 后生效。

### 0.0.4 更新内容

- 新增 Let’s Encrypt 签发入口，支持阿里云 DNS 自动验证、普通域名和通配符证书。
- 自动续签、手动重试、进度及失败原因展示；签发成功后自动入库，续签保留原名称和分组。
- 密钥加密保存，临时 TXT 记录持久跟踪与清理，多实例协调和中断恢复。
- ZIP 导出包含可部署的完整证书链、公钥和私钥。
- 证书签发设置及申请界面支持简体中文、繁体中文、英语、日语、韩语。
- 补充阿里云 RAM 最小权限说明、测试环境说明及独立数据库部署示例。
- 本地短密码预览须显式开启且仅适用于开发模式，生产容器仍要求至少 12 位密码；本地 `.env.local` 不会打包进镜像。

### 0.0.3 更新内容

- 内置定时检查：启动立即检查，之后每 10 分钟检查，无需外部调用。
- 通知成功记录持久化、按渠道去重和失败重试，多实例通过数据库锁协调。
- Webhook 地址明文显示，加签密钥和 SMTP 密码支持点击图标显示或隐藏。
- 通知网络请求增加超时，数据库不可用时停止发送并等待重试。
- 更新兼容范围内的安全依赖；发布构建时 npm 审计未发现已知漏洞。

## Let’s Encrypt 自动签发与续签（阿里云 DNS）

### 手动 DNS 验证（0.0.7 新增）

拿不到阿里云 AK / SK 时，也可以在「申请证书 → DNS 验证方式」选择「手动添加 DNS（无需 AK / SK）」。不要求添加或选择阿里云账号，也不要求 DNS 托管在阿里云，但必须能在实际 DNS 服务商处添加 TXT 记录。

1. 在「系统设置 → 证书签发」保存联系邮箱、同意服务协议；仍需 PostgreSQL 和固定的 `CERT_ENCRYPTION_KEY`。
2. 选择手动 DNS，填写 DNS 解析区域、域名、分组和环境，点击「生成 DNS 验证记录」。建议先使用测试环境，测试证书不受浏览器信任。
3. 后台准备完成后，在「未完成申请」复制 TXT 的主机记录、完整记录名和记录值，到 DNS 服务商逐条添加。主域名和通配符可能使用同名但不同值的记录，必须同时保留，不能相互覆盖；不要删除其他业务记录。若有 CNAME/NS 委派，请在实际承接验证的区域添加对应记录。
4. 点击「检查 DNS 记录」。平台通过两个公共 DNS 解析器检查所有 TXT 值，并显示逐条结果；未生效或查询失败时不会提交 CA 验证，可等待传播后再检查。服务器需允许访问公共 DNS（UDP/TCP 53）。
5. 全部通过后，在 10 分钟内点击「继续签发」。后台在提交 CA 前再次检查 DNS；最终由 CA 验证并签发。CA 复用有效授权时可能无需新增 TXT，但仍需检查和确认。
6. 签发成功后自动移出申请弹窗，在证书列表中管理、导出 `.pem` 和 `.key`。详情中展开「上次 DNS 验证记录 · 清理提示」，可查看并手动清理本次 TXT 值；平台不会写入或删除手动模式的 DNS 记录。

手动模式**不能无人值守自动续签**，界面和 API 都会禁止开启。到期前在「证书详情 → 证书续签」发起续签，后续添加 DNS、检查、确认签发及失败重试均在该详情中完成，不会回到新申请弹窗；已有到期提醒继续适用。申请状态和加密私钥持久化，关闭窗口、刷新或服务重启后可恢复，不会自动跳过人工确认。验证有效期取 CA 订单/授权期限与本地 24 小时上限中的最早时间；过期后需重试生成新记录。重试前请记录并清理本次旧 TXT，取消未签发申请时也需自行清理。

API：`POST /api/acme/orders` 传 `dnsProvider: "manual"`、`autoRenew: false`，不传 `credentialId`；`PATCH /api/acme/orders` 传 `id` 和 `action: "checkDns"` 或 `"continue"`。默认不传 `dnsProvider` 时仍走阿里云模式，必须选择账号。所有接口需要管理员登录，不返回 ACME 私钥或内部订单数据。阿里云模式维持原有自动验证/续签。

升级源码前备份数据库与加密密钥、停止全部旧版应用后再启动；不要混跑新旧版本。新增状态及字段自动迁移，现有申请默认保留阿里云模式。

可运行 `npm test`、`npm run lint`，构建后运行 `node --experimental-strip-types tests/aliyun-credentials.integration.mjs`。集成测试使用 Apple Container 创建独立临时 PostgreSQL，包含多账号与手动 DNS 的模拟 CA/DNS 全流程，不访问真实 CA/DNS、不使用业务数据库。

### 阿里云自动模式

ACME 功能从 `0.0.4` 开始提供，旧的 `docker.io/easitwch/cert-ops:0.0.3` 镜像不包含此功能。可直接使用 `0.0.10` 镜像，也可使用下面的源码构建方式。

### 配置与申请

1. 确保 PostgreSQL 可连接，并设置固定且保密的 `CERT_ENCRYPTION_KEY`（至少 32 字符，不能使用 `replace-with-...` 示例值）。签发功能不会降级到演示/内存模式。
2. 域名的**权威 DNS 必须托管在阿里云云解析 DNS**。仅在阿里云购买域名不代表 DNS 托管在阿里云。本版本不自动追踪 `_acme-challenge` 的 CNAME/NS 委派，也不支持跨多个解析区域的一张证书；按解析区域分别申请。
3. 创建专用 RAM 用户和 AccessKey，按下文授予目标域名权限。不要使用主账号 AccessKey。
4. 打开「系统设置 → 证书签发」，填写 ACME 联系邮箱并阅读、同意 [Let’s Encrypt 服务协议](https://letsencrypt.org/repository/)。在「阿里云账号凭证」中为每个账号分别填写名称、AccessKey ID 和 Secret；`0.0.5` 镜像仍在通用表单中填写单组密钥。保存不会修改 DNS；取消协议同意会暂停后续签发/续签，但仍会清理已创建的验证记录。
5. 选择要检查的阿里云账号，输入 DNS 主域名，点击「检查 DNS 读取权限」。此操作只读取记录，不验证写入/删除权限；更改授权后先保存，再检查。
6. 在证书页面点击「申请证书」，选择名称、分组、阿里云账号、DNS 主域名和证书域名。所选账号必须有该解析区域的权限，同一张证书不能混用多组凭证。建议先用测试环境申请，确认完整流程后再选择正式环境重新申请。测试证书不受浏览器信任，不可用于生产 HTTPS。
7. 在「未完成申请」中查看新申请进度、失败原因及重试。签发成功后自动移至证书列表；自动续签开关和立即续签统一位于证书详情，新申请默认关闭自动续签，需在详情中开启。未完成申请每页 10 条，已有证书的续签任务不会混入。从 `0.0.5` 开始，通过详情页「导出证书 ZIP」下载两个文件：`域名.pem`（完整证书链）和 `域名.key`（私钥）。`0.0.4` 镜像仍使用旧格式，其中证书链为 `*.fullchain.pem`、私钥为 `*.private-key.pem`，额外的 `*.public-key.pem` 不是 HTTPS 服务需要的证书文件。

例如 DNS 主域名为 `example.com`，证书域名可以填写：

```text
example.com
*.example.com
```

最多支持 20 个域名。`*.example.com` 不覆盖根域名 `example.com`，也不覆盖 `a.b.example.com`。普通子域名和通配符均使用 [DNS-01 验证](https://letsencrypt.org/docs/challenge-types/)，无需开放服务器入站 80 端口。

### RAM 最小权限示例

把 `1234567890123456` 替换成你的阿里云账号 ID，把 `example.com` 替换成云解析 DNS 中的主域名；管理多个域名时，在 Resource 数组中逐一列出。

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "alidns:DescribeDomainRecords",
        "alidns:AddDomainRecord",
        "alidns:DeleteDomainRecord"
      ],
      "Resource": ["acs:alidns::1234567890123456:domain/example.com"]
    }
  ]
}
```

权限依据阿里云官方 [查询记录](https://www.alibabacloud.com/help/en/dns/api-alidns-2015-01-09-describedomainrecords)、[新增记录](https://www.alibabacloud.com/help/en/dns/api-alidns-2015-01-09-adddomainrecord)、[删除记录](https://www.alibabacloud.com/help/en/dns/api-alidns-2015-01-09-deletedomainrecord) 文档。该策略限制到域名，但仍能修改此域名的其他记录，请妥善保护授权与平台登录入口。

### 续签、恢复与安全边界

- 服务启动约 5 秒后检查，之后每轮处理结束 60 秒后再次检查；每轮最多处理一条申请。数据库持久保存申请、ACME 账户和临时 DNS 记录，多实例使用 PostgreSQL 会话锁防止同时签发。
- 开启自动续签后，剩余有效期进入证书总有效期的最后三分之一时续签，最多提前 30 天，不硬编码证书必须为 90 天。此版本使用时间阈值，尚未实现 ACME ARI。
- 已签发证书续签失败后每 6 小时重试；初次申请失败须手动重试，避免错误配置持续消耗 CA 配额。手动续签/重试距上次尝试需至少 1 小时。同环境、相同域名组合不能重复创建申请。
- 自动续签会替换原证书的证书链和私钥，保留原 ID、名称及当前分组，并重置该证书的到期通知去重记录。旧私钥不会保留历史版本。关掉自动续签只停止未来的自动任务，不取消已排队/正在处理的任务。
- **续签不等于部署**：不会自动更新 Nginx、CDN、负载均衡或其他服务中的证书。请下载后部署并按需重新加载服务。
- 仅自动续签通过本平台 ACME 申请的证书；手动上传的证书不自动转换为 ACME 管理。删除已签发证书会同时删除关联申请，停止其后续续签。未签发且不在处理中的申请可单独移除。
- AccessKey、ACME 账户私钥、证书私钥均加密保存。配置 API 不回传完整 AccessKey 或 Secret；更换授权时需同时填写两项，留空保留原配置。数据库备份和 `CERT_ENCRYPTION_KEY` 必须一起妥善保管，不能随意更换加密密钥。
- DNS 验证仅添加新的 TXT 值，不覆盖已有记录；清理时匹配本任务的名称、类型、随机验证值及记录 ID。清理意图先入库，服务重启后可恢复；删除证书不会删掉待清理记录。清理失败会在申请页面提示并继续重试，处理完前暂停新签发。轮换 AccessKey 时，在旧验证记录全部清理前保持旧授权有效。
- DNS TXT 生效等待最多 10 分钟，需要 `223.5.5.5`、`1.1.1.1` 两个公共 DNS 均能解析到预期值。容器需允许出站 UDP/TCP 53，并允许 HTTPS 443 访问 `alidns.aliyuncs.com`、`acme-v02.api.letsencrypt.org`、`acme-staging-v02.api.letsencrypt.org`。
- 如果服务重启中断任务，该任务标记失败，清理临时记录后可重试；已签发且启用自动续签的证书会再次调度。保持服务持续运行，不适用于会被挂起的无服务器函数。首次签发失败显示在未完成申请，续签失败显示在对应证书详情；原有钉钉/飞书/邮件仍负责 15/7/3/1 天的到期提醒。

### Compose 示例：包含 PostgreSQL

按前文准备 `.env` 后，在仓库目录运行：

```bash
docker compose -f compose.example.yml -f compose.acme.example.yml up -d --build
docker compose -f compose.example.yml -f compose.acme.example.yml logs -f certops
```

这个可选覆盖文件会将镜像替换为本地源码构建的 `cert-ops:acme-local`，保留已有数据库服务和数据卷。数据库结构在启动时自动增量创建，不清空原证书。使用 `compose.example.yml` 中的 `0.0.10` 镜像时，无需此覆盖文件。

### Compose 示例：独立 PostgreSQL

保存以下内容为 `compose.external.yml`。`DATABASE_URL` 填写容器可访问的数据库地址；Docker Desktop 连接宿主机 PostgreSQL 可使用 `host.docker.internal`，不要写容器自身的 `127.0.0.1`。Linux 上同时启用注释中的 `extra_hosts`，数据库还需允许来自容器网络的连接。

```yaml
services:
  certops:
    build: .
    image: cert-ops:acme-local
    restart: unless-stopped
    ports:
      - "3000:3000"
    # extra_hosts:
    #   - "host.docker.internal:host-gateway"
    environment:
      DATABASE_URL: "${DATABASE_URL:?Set DATABASE_URL}"
      CERT_ENCRYPTION_KEY: "${CERT_ENCRYPTION_KEY:?Set CERT_ENCRYPTION_KEY}"
      CERTOPS_ADMIN_USERNAME: "${CERTOPS_ADMIN_USERNAME:?Set CERTOPS_ADMIN_USERNAME}"
      CERTOPS_ADMIN_PASSWORD: "${CERTOPS_ADMIN_PASSWORD:?Set CERTOPS_ADMIN_PASSWORD}"
      CERTOPS_SESSION_SECRET: "${CERTOPS_SESSION_SECRET:?Set CERTOPS_SESSION_SECRET}"
      CRON_SECRET: "${CRON_SECRET:?Set CRON_SECRET}"
      ACME_SCHEDULER_ENABLED: "true"
```

```bash
docker compose -f compose.external.yml up -d --build
```

无需另建 cron 容器。若运维统一使用外部调度，可设置 `ACME_SCHEDULER_ENABLED=false`，每分钟以 `Authorization: Bearer <CRON_SECRET>` 调用 `POST /api/cron/acme`。该接口最多处理一条任务，请给调用方至少 15 分钟超时；并发调用会被数据库锁跳过。不要同时禁用内置调度且不配置外部调度。

## 本地开发

本地开发需要 Node.js 22+、PostgreSQL 14+；局域网证书签发还需 OpenSSL 1.1.1+ / 3.x：

```bash
npm install
npm run dev
```

在 `.env.local` 中配置：

```dotenv
DATABASE_URL=postgresql://certops:password@127.0.0.1:5432/certops
CERT_ENCRYPTION_KEY=replace-with-at-least-32-random-characters
CRON_SECRET=replace-with-a-random-cron-token
CERTOPS_ADMIN_USERNAME=admin
CERTOPS_ADMIN_PASSWORD=replace-with-a-strong-admin-password
CERTOPS_SESSION_SECRET=replace-with-at-least-32-random-characters
```

默认访问 `http://localhost:3000`。如果没有配置可用的 PostgreSQL，应用会进入演示模式。

### 页面路由

界面语言在页面右上角通过语言菜单切换，支持简体中文、繁體中文、English、日本語和 한국어；选择即时生效并保存在当前浏览器。菜单支持方向键选择、Enter 确认、Esc 关闭。系统设置为独立的 `/settings` 页面，使用 Tab 切换通知设置与证书签发（含 Let’s Encrypt 配置和阿里云账号管理）。旧的 `/?settings=...` 链接兼容跳转至新页面，`settings=general` 进入通知设置。

左侧仅显示具体项目分组，不提供“全部项目”入口。首次进入时请自行选择分组；尚无分组时先创建。已有分组链接刷新后保持选中，失效分组链接提示重新选择；根 CA 管理仍可查看该 CA 的跨项目服务证书。

项目分组、公有／私有证书、根 CA 管理、状态筛选、系统设置页签和证书详情均同步到 URL。刷新、浏览器前进／后退或重新登录后会恢复对应位置，也可收藏页面链接。例如：

- `/?view=roots`：根 CA 管理
- `/settings?tab=notifications`：通知设置（默认页签）
- `/settings?tab=acme`：证书签发与账号管理
- `/?project=<分组 UUID>&type=private`：指定项目的私有证书
- `/?certificate=<证书 UUID>`：证书详情

URL 仅保存导航状态；搜索输入、未提交的申请／编辑表单及密钥不会写入地址或在刷新后恢复。

常用检查命令：

```bash
npm test
npm run lint
npm run build
```

## 关键目录

- `app/`：管理界面和 API 路由
- `lib/certificate.ts`：证书解析和私钥匹配
- `lib/repository.ts`：PostgreSQL 数据访问
- `lib/notifier.ts`：钉钉、飞书和邮件通知
- `db/schema.sql`：数据库结构和索引
- `compose.example.yml`：基于 Docker Hub 多架构镜像的部署示例
- `compose.acme.example.yml`：自动签发功能的本地源码构建覆盖文件
- `lib/acme-worker.ts`：阿里云 DNS 验证、签发与自动续签任务
- `lib/acme-store.ts`、`db/acme.sql`：签发账户、任务和清理记录的持久化
