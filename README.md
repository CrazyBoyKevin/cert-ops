# CertOps

CertOps 是一个用于集中上传、解析、分组、监控和提醒 SSL/TLS 证书的管理平台。

## 功能

- 上传 PEM、CRT、CER 证书或直接粘贴 PEM 内容
- 解析域名、SAN、颁发机构、有效期、序列号、指纹和密钥算法
- 校验证书与私钥是否匹配
- 复制公钥、私钥，或分别下载公钥和私钥
- 将公钥和私钥打包为 ZIP 导出
- 创建、重命名和删除证书分组；包含证书的分组不能删除
- 使用 AES-256-GCM 加密保存私钥和通知凭证
- 在证书到期前 15、7、3、1 天发送钉钉、飞书或邮件通知

## 使用 Docker Compose 部署

推荐直接使用发布到 Docker Hub 的固定版本镜像：

```text
docker.io/easitwch/cert-ops:0.0.1
```

> 当前 `0.0.1` 镜像平台为 `linux/arm64`，适用于 Apple Silicon 和 ARM64 Linux。AMD64 服务器需要启用 ARM64 模拟，或重新构建 AMD64/多架构镜像。

### 1. 准备环境变量

在项目目录创建 `.env`，并替换以下三个必填值：

```dotenv
POSTGRES_PASSWORD=replace-with-a-strong-password
CERT_ENCRYPTION_KEY=replace-with-at-least-32-random-characters
CRON_SECRET=replace-with-a-random-cron-token
CERTOPS_PORT=3000
```

可以使用下面的命令生成安全随机值：

```bash
openssl rand -hex 24
openssl rand -hex 32
openssl rand -hex 32
```

- `POSTGRES_PASSWORD`：PostgreSQL 用户密码。建议使用字母和数字，避免连接 URL 中的特殊字符编码问题。
- `CERT_ENCRYPTION_KEY`：用于加密私钥和通知凭证。部署后不要更换，否则已有密文将无法解密。
- `CRON_SECRET`：用于保护证书到期检查接口。
- `CERTOPS_PORT`：宿主机访问端口，默认是 `3000`。

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

- `certops`：`docker.io/easitwch/cert-ops:0.0.1` Web 服务
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
  --platform linux/arm64 \
  -p 3000:3000 \
  -e DATABASE_URL='postgresql://certops:password@db.example.com:5432/certops?sslmode=require' \
  -e CERT_ENCRYPTION_KEY='replace-with-at-least-32-random-characters' \
  -e CRON_SECRET='replace-with-a-random-cron-token' \
  docker.io/easitwch/cert-ops:0.0.1
```

数据库用户需要具备目标数据库的连接、创建 schema、建表和创建索引权限。密码含有 `@`、`:`、`/`、`#` 等字符时，必须先进行 URL 编码。

## 到期检查任务

生产环境建议每天调用一次到期检查接口：

```bash
curl -X POST https://certops.example.com/api/cron/reminders \
  -H "Authorization: Bearer $CRON_SECRET"
```

只有证书剩余 15、7、3、1 天时才会发送通知。多个通知渠道启用时，会向所有已启用渠道发送。

## 本地开发

本地开发需要 Node.js 22+ 和 PostgreSQL 14+：

```bash
npm install
npm run dev
```

在 `.env.local` 中配置：

```dotenv
DATABASE_URL=postgresql://certops:password@127.0.0.1:5432/certops
CERT_ENCRYPTION_KEY=replace-with-at-least-32-random-characters
CRON_SECRET=replace-with-a-random-cron-token
```

默认访问 `http://localhost:3000`。如果没有配置可用的 PostgreSQL，应用会进入演示模式。

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
- `compose.example.yml`：基于 Docker Hub 镜像的部署示例
