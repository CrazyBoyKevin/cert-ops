import assert from "node:assert/strict";
import test from "node:test";
import { certificateMetrics, certificateWorkspaceScope, certificatesInProject, certificatesInScope } from "../lib/certificate-scope.ts";
import { navigationMessages } from "../lib/navigation-i18n.ts";
import { rootDeletionMessages } from "../lib/root-deletion-i18n.ts";

const certificates = [
  { id: "public-a", groupId: "a" },
  { id: "private-a", groupId: "a", privateCa: true, privateAuthorityId: "ca-shared" },
  { id: "public-b", groupId: "b", privateCa: false },
  { id: "private-b", groupId: "b", privateCa: true, privateAuthorityId: "ca-shared" },
  { id: "private-other", groupId: "b", privateCa: true, privateAuthorityId: "ca-other" },
];
const ids = records => records.map(item => item.id);
test("workspace requires explicit project selection, except for root CA service navigation", () => {
  assert.equal(certificateWorkspaceScope("all", ["a", "b"], "public", "all"), "none");
  assert.equal(certificateWorkspaceScope("all", [], "private", "all"), "none");
  assert.equal(certificateWorkspaceScope("removed", ["a"], "private", "all"), "none");
  assert.equal(certificateWorkspaceScope("a", ["a", "b"], "public", "all"), "project");
  assert.equal(certificateWorkspaceScope("a", ["a", "b"], "private", "ca-shared"), "project");
  assert.equal(certificateWorkspaceScope("all", ["a", "b"], "private", "ca-shared"), "authority");
  assert.equal(certificateWorkspaceScope("all", ["a", "b"], "public", "ca-shared"), "none");
});
test("project overview aggregates public/private health and ignores list-only scopes", () => {
  const now = Date.parse("2026-10-19T00:00:00Z"), day = 86_400_000;
  const records = certificates.map((certificate, index) => ({ ...certificate, expiresAt: new Date(now + [90, 7, -2, 30, 31][index] * day).toISOString() }));
  const project = certificatesInProject(records, "b");
  assert.deepEqual(certificateMetrics(project, now), { total: 3, healthy: 1, expiring: 1, expired: 1 });
  for (const scope of ["public", "private"]) {
    certificatesInScope(project, scope, "ca-shared");
    assert.deepEqual(certificateMetrics(project, now), { total: 3, healthy: 1, expiring: 1, expired: 1 });
  }
  assert.deepEqual(certificateMetrics(certificatesInProject(records, "all"), now), { total: 5, healthy: 2, expiring: 2, expired: 1 });
  assert.deepEqual(certificateMetrics(certificatesInProject(records, "a"), now), { total: 2, healthy: 1, expiring: 1, expired: 0 });
  assert.deepEqual(certificateMetrics([], now), { total: 0, healthy: 0, expiring: 0, expired: 0 });
});
test("project is the parent scope; both types share one group and stable total", () => {
  const project = certificatesInProject(certificates, "a");
  assert.equal(project.length, 2);
  assert.deepEqual(ids(certificatesInScope(project, "public")), ["public-a"]);
  assert.deepEqual(ids(certificatesInScope(project, "private")), ["private-a"]);
  assert.equal(certificatesInProject(certificates, "all").length, 5);
  assert.equal(certificatesInProject(certificates, "missing").length, 0);
  assert.equal(certificatesInProject(certificates, "a").length, 2);
});
test("root CA service view can cross projects while project/CA intersection remains exact", () => {
  assert.deepEqual(ids(certificatesInScope(certificatesInProject(certificates, "all"), "private", "ca-shared")), ["private-a", "private-b"]);
  assert.deepEqual(ids(certificatesInScope(certificatesInProject(certificates, "b"), "private", "ca-shared")), ["private-b"]);
  assert.equal(certificatesInScope(certificatesInProject(certificates, "a"), "private", "ca-other").length, 0);
});
test("navigation hierarchy descriptions exist in all five languages", () => {
  const keys = Object.keys(navigationMessages("zh-CN")).sort();
  for (const language of ["zh-CN", "zh-TW", "en", "ja", "ko"]) {
    assert.deepEqual(Object.keys(navigationMessages(language)).sort(), keys);
    for (const value of Object.values(navigationMessages(language))) assert.ok(value.trim());
  }
});
test("root deletion guards and warnings cover five languages", () => {
  const keys = Object.keys(rootDeletionMessages("zh-CN")).sort();
  for (const language of ["zh-CN", "zh-TW", "en", "ja", "ko"]) {
    const copy = rootDeletionMessages(language);
    assert.deepEqual(Object.keys(copy).sort(), keys);
    for (const value of Object.values(copy)) assert.ok(value.trim());
    assert.ok(copy.blocked.includes("{count}"));
  }
});
