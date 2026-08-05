# CertOps

CertOps 是一个简洁实用的 SSL 证书管理平台，用于集中上传、解析、分组、监控和提醒证书。

## 核心能力

- 支持 PEM/CRT/CER 证书文件上传或 PEM 文本粘贴
- 自动解析域名、SAN、颁发机构、生效/到期时间、序列号、指纹和密钥算法
- 上传私钥时自动校验证书与私钥是否匹配
- 私钥与通知凭证使用 AES-256-GCM 加密存储
- 按项目分组管理证书，支持搜索和状态筛选
- 删除证书需要人工勾选确认，接口层也会校验确认字段
- 在到期前 15、7、3、1 天发送钉钉、飞书和邮件通知
- PostgreSQL 不可用时自动进入演示模式，方便本地界面验收

## 本地运行

需要 Node.js 22+ 和 PostgreSQL 14+。

```bash
cp .env.example .env.local
npm install
npm run dev
```

打开 `http://localhost:3000`。

应用首次访问接口时会自动创建 `cert_ops` schema 和所需数据表，不会污染 PostgreSQL 的 public schema。

## Docker Compose 示例

仓库已经包含可直接使用的 `Dockerfile` 和 `compose.example.yml`。该示例会启动两个容器：

- `certops`：CertOps Web 服务，对外开放 `3000` 端口。
- `postgres`：PostgreSQL 16，数据保存在 Docker Volume 中。

完整的 Compose 配置如下：

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: certops
      POSTGRES_USER: certops
      POSTGRES_PASSWORD: change-this-database-password
    volumes:
      - certops_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U certops -d certops"]
      interval: 5s
      timeout: 5s
      retries: 10

  certops:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://certops:change-this-database-password@postgres:5432/certops
      CERT_ENCRYPTION_KEY: change-this-to-a-random-string-of-at-least-32-characters
      CRON_SECRET: change-this-to-another-random-string
    ports:
      - "3000:3000"

volumes:
  certops_postgres_data:
```

启动前请至少替换以下三个值：

- `POSTGRES_PASSWORD`：数据库密码，同时更新 `DATABASE_URL` 中的密码。
- `CERT_ENCRYPTION_KEY`：用于加密证书私钥和通知渠道凭证，建议使用 32 字节以上的随机值；部署后不要随意更换，否则已有密文无法解密。
- `CRON_SECRET`：保护到期检查接口的随机令牌。

启动服务：

```bash
cp compose.example.yml compose.yml
docker compose up -d --build
docker compose ps
```

打开 `http://localhost:3000`。查看日志或停止服务：

```bash
docker compose logs -f certops
docker compose down
```

`docker compose down` 不会删除 PostgreSQL 数据。只有显式执行 `docker compose down -v` 才会删除数据卷。

## 使用独立 PostgreSQL

如果 PostgreSQL 运行在独立服务器、云数据库或已有数据库集群中，只需要创建专用用户和数据库，然后为 CertOps 配置连接地址。

以 PostgreSQL 管理员身份执行：

```sql
CREATE USER certops WITH PASSWORD 'replace-with-a-strong-password';
CREATE DATABASE certops
  WITH OWNER = certops
       ENCODING = 'UTF8'
       TEMPLATE = template0;
```

然后在 CertOps 的 `.env.local` 或容器环境变量中配置：

```dotenv
# 同机数据库
DATABASE_URL=postgresql://certops:replace-with-a-strong-password@127.0.0.1:5432/certops

# 独立服务器或云数据库；服务端要求 TLS 时保留 sslmode=require
# DATABASE_URL=postgresql://certops:url-encoded-password@db.example.com:5432/certops?sslmode=require

CERT_ENCRYPTION_KEY=replace-with-at-least-32-random-characters
CRON_SECRET=replace-with-a-random-cron-token
```

注意事项：

- 密码包含 `@`、`:`、`/`、`#` 等字符时，需要先进行 URL 编码再写入 `DATABASE_URL`。
- 独立数据库需要允许 CertOps 服务器访问 TCP `5432`，并在防火墙或安全组中仅放行 CertOps 所在地址。
- 数据库用户需要拥有目标数据库的连接和建表权限。上述 `OWNER = certops` 已满足要求。
- CertOps 首次访问数据库时会自动执行 `db/schema.sql`，创建 `cert_ops` schema、数据表和索引，无需手动导入。
- 生产环境建议启用 PostgreSQL TLS，并定期备份数据库。

如需手动初始化，可执行：

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

手动初始化不是必需步骤；应用启动后仍会检查并补齐表结构。

## 到期检查任务

生产环境建议每天执行一次：

```bash
curl -X POST https://your-domain.example/api/cron/reminders \
  -H "Authorization: Bearer $CRON_SECRET"
```

仅在证书剩余 15、7、3、1 天时发送通知。若多个渠道同时启用，会向所有已启用渠道发送。

## 关键目录

- `app/`：管理界面及 API 路由
- `lib/certificate.ts`：X.509 证书解析与私钥匹配
- `lib/repository.ts`：PostgreSQL 数据访问与演示模式
- `lib/notifier.ts`：钉钉、飞书和邮件通知
- `db/schema.sql`：数据库结构与索引
