// Loopback-only protocol regressions: no real SMTP, DNS, CA or database access.
// node --experimental-strip-types --test tests/security-transports.integration.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createServer as httpServer } from "node:http";
import { createServer as tcpServer } from "node:net";
import { once } from "node:events";
import { createPublicKey, randomBytes, verify, X509Certificate } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as acme from "acme-client";
import { sendNotifications } from "../lib/notifier.ts";

const exec = promisify(execFile);
async function listen(server, t) {
  const sockets = new Set();
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return server.address().port;
}

test("Nodemailer sends authenticated reminders and reports SMTP rejection", { timeout: 20_000 }, async t => {
  const messages = [], recipients = [], auth = [];
  let reject = false;
  const server = tcpServer(socket => {
    socket.setEncoding("utf8");
    socket.write("220 localhost SMTP test\r\n");
    let buffer = "", dataMode = false, lines = [];
    socket.on("data", chunk => {
      buffer += chunk;
      while (buffer.includes("\r\n")) {
        const boundary = buffer.indexOf("\r\n"), line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (dataMode) {
          if (line === ".") { messages.push(lines.join("\r\n")); lines = []; dataMode = false; socket.write("250 queued\r\n"); }
          else lines.push(line);
        } else if (/^EHLO|^HELO/.test(line)) socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
        else if (line.startsWith("AUTH PLAIN ")) { auth.push(Buffer.from(line.slice(11), "base64").toString()); socket.write("235 authenticated\r\n"); }
        else if (line.startsWith("MAIL FROM:")) socket.write("250 sender accepted\r\n");
        else if (line.startsWith("RCPT TO:")) { recipients.push(line); socket.write(reject ? "550 recipient rejected\r\n" : "250 recipient accepted\r\n"); }
        else if (line === "DATA") { dataMode = true; socket.write("354 send message\r\n"); }
        else if (line === "QUIT") socket.end("221 goodbye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  const port = await listen(server, t);
  const settings = { emailEnabled: true, smtpHost: "127.0.0.1", smtpPort: port, smtpSecure: false, smtpUser: "smtp-test", smtpPassword: "test-only", emailFrom: "certops@example.test", emailRecipients: "first@example.test;second@example.test" };
  const cert = { primaryDomain: "example.test", expiresAt: "2027-01-01T00:00:00Z" };
  assert.deepEqual(await sendNotifications(settings, cert, 7), [{ channel: "email", success: true, detail: "已发送" }]);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /From: certops@example\.test/);
  assert.match(messages[0], /multipart\/alternative/);
  assert.deepEqual(auth, ["\0smtp-test\0test-only"]);
  assert.ok(recipients.some(value => value.includes("first@example.test")));
  assert.ok(recipients.some(value => value.includes("second@example.test")));
  reject = true;
  const failed = await sendNotifications(settings, cert, 1);
  assert.equal(failed[0].success, false);
  assert.match(failed[0].detail, /550|rejected/);
  assert.equal(messages.length, 1);
});

test("native ACME client completes signed DNS-01 orders against a local mock CA", { timeout: 30_000 }, async t => {
  const scratch = await mkdtemp(path.join(tmpdir(), "certops-security-acme-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const [key, csr] = await acme.crypto.createCsr({ commonName: "example.test", altNames: ["example.test", "*.example.test"] });
  await writeFile(path.join(scratch, "leaf.key"), key, { mode: 0o600 });
  await writeFile(path.join(scratch, "leaf.csr"), csr);
  const checked = await exec("openssl", ["req", "-in", path.join(scratch, "leaf.csr"), "-verify", "-noout"]);
  assert.match(checked.stderr + checked.stdout, /verify OK|verify ok/i);
  await exec("openssl", ["x509", "-req", "-in", path.join(scratch, "leaf.csr"), "-signkey", path.join(scratch, "leaf.key"), "-days", "1", "-copy_extensions", "copy", "-out", path.join(scratch, "leaf.pem")]);
  const pem = await readFile(path.join(scratch, "leaf.pem"), "utf8");
  const accountKey = await acme.crypto.createPrivateKey(), accountPublic = createPublicKey(accountKey);
  const errors = [], paths = [], nonces = new Set();
  let base, retryNonce = true, finalized = false;
  const challenge = () => ({ type: "dns-01", url: base + "/challenge", token: "local-test-token", status: "valid" });
  const order = () => ({ status: finalized ? "valid" : "pending", identifiers: [{ type: "dns", value: "example.test" }, { type: "dns", value: "*.example.test" }], authorizations: [base + "/authz"], finalize: base + "/finalize", ...(finalized ? { certificate: base + "/certificate" } : {}) });
  const server = httpServer(async (req, res) => {
    try {
      paths.push(req.url);
      const nonce = randomBytes(18).toString("base64url"); nonces.add(nonce);
      res.setHeader("Replay-Nonce", nonce); res.setHeader("Content-Type", "application/json");
      const reply = (body, status = 200, location) => { if (location) res.setHeader("Location", base + location); res.writeHead(status); res.end(JSON.stringify(body)); };
      if (req.url === "/directory") return reply({ newNonce: base + "/nonce", newAccount: base + "/account", newOrder: base + "/new-order" });
      if (req.url === "/nonce") { assert.equal(req.method, "HEAD"); res.writeHead(200); return res.end(); }
      assert.equal(req.method, "POST");
      let raw = ""; for await (const chunk of req) raw += chunk;
      const jws = JSON.parse(raw), header = JSON.parse(Buffer.from(jws.protected, "base64url"));
      assert.equal(header.url, base + req.url); assert.equal(header.alg, "RS256");
      assert.ok(nonces.delete(header.nonce));
      assert.equal(verify("sha256", Buffer.from(`${jws.protected}.${jws.payload}`), accountPublic, Buffer.from(jws.signature, "base64url")), true);
      const body = jws.payload ? JSON.parse(Buffer.from(jws.payload, "base64url")) : null;
      if (req.url === "/account") {
        assert.deepEqual(header.jwk, accountPublic.export({ format: "jwk" }));
        assert.equal(body.termsOfServiceAgreed, true);
        return reply({ status: "valid", contact: body.contact }, 201, "/account/1");
      }
      assert.equal(header.kid, base + "/account/1");
      if (req.url === "/new-order") {
        if (retryNonce) { retryNonce = false; return reply({ type: "urn:ietf:params:acme:error:badNonce" }, 400); }
        assert.deepEqual(new Set(body.identifiers.map(item => item.value)), new Set(["example.test", "*.example.test"]));
        return reply(order(), 201, "/order");
      }
      if (req.url === "/authz") return reply({ status: "pending", identifier: { type: "dns", value: "example.test" }, challenges: [challenge()] });
      if (req.url === "/challenge") return reply(challenge());
      if (req.url === "/finalize") { assert.equal(body.csr, acme.crypto.getPemBodyAsB64u(csr)); finalized = true; return reply(order()); }
      if (req.url === "/certificate") { res.setHeader("Content-Type", "application/pem-certificate-chain"); return res.end(pem); }
      throw new Error(`Unexpected mock CA path: ${req.url}`);
    } catch (error) { errors.push(error); res.writeHead(400); res.end(JSON.stringify({ detail: error.message })); }
  });
  base = `http://127.0.0.1:${await listen(server, t)}`;
  const events = [];
  const client = new acme.Client({ directoryUrl: base + "/directory", accountKey, backoffMin: 1, backoffMax: 2, backoffAttempts: 2 });
  const issued = await client.auto({ csr, email: "admin@example.test", termsOfServiceAgreed: true, skipChallengeVerification: true, challengePriority: ["dns-01"],
    challengeCreateFn: async (_, item, txt) => { assert.equal(item.type, "dns-01"); assert.match(txt, /^[A-Za-z0-9_-]{43}$/); events.push("create"); },
    challengeRemoveFn: async () => { events.push("remove"); },
  });
  assert.deepEqual(errors, []); assert.deepEqual(events, ["create", "remove"]);
  assert.equal(paths.filter(value => value === "/new-order").length, 2);
  assert.equal(issued, pem);
  assert.deepEqual(acme.crypto.readCertificateInfo(issued).domains.altNames, ["example.test", "*.example.test"]);
  assert.equal(new X509Certificate(issued).verify(createPublicKey(key)), true);
});
