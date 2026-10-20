import test from "node:test";
import assert from "node:assert/strict";
import { readAppRoute, appRouteHref, safeReturnHref, loginHref } from "../lib/app-route.ts";

const project = "aaaaaaaa-1111-2222-3333-444444444444";
const ca = "bbbbbbbb-1111-2222-3333-444444444444";
const certificate = "cccccccc-1111-2222-3333-444444444444";
const read = query => readAppRoute(new URLSearchParams(query));

test("workspace defaults have a clean root URL", () => {
  assert.deepEqual(read(""), { view: "services", project: "all", type: "public", ca: "all", status: "all", settings: null, certificate: null });
  assert.equal(appRouteHref(read("")), "/");
});
test("project, certificate type, CA, status and details survive a URL round trip", () => {
  const route = read(`project=${project}&type=private&ca=${ca}&status=expired&certificate=${certificate}`);
  assert.deepEqual(read(appRouteHref(route).slice(2)), route);
  assert.equal(route.ca, ca);
  assert.equal(route.certificate, certificate);
});
test("each settings tab retains its underlying root management context", () => {
  for (const settings of ["notifications", "acme", "https"]) {
    const route = read(`view=roots&project=${project}&type=private&settings=${settings}`);
    const url = new URL(appRouteHref(route), "http://localhost");
    assert.equal(url.pathname, "/settings");
    assert.deepEqual(readAppRoute(url.searchParams, url.pathname), route);
    assert.equal(route.settings, settings);
  }
});
test("legacy general settings links open notifications after language moves to sidebar", () => {
  const route = read(`project=${project}&settings=general`);
  assert.equal(route.settings, "notifications");
  assert.equal(appRouteHref(route), `/settings?project=${project}&tab=notifications`);
});
test("invalid route values fall back safely and public certificates ignore a CA filter", () => {
  assert.deepEqual(read("view=invalid&project=invalid&type=invalid&ca=invalid&status=invalid&settings=invalid&certificate=invalid"), read(""));
  assert.equal(read(`ca=${ca}`).ca, "all");
  assert.equal(read(`project=${project.toUpperCase()}`).project, project);
});
test("login links preserve only recognized navigation fields", () => {
  const destination = `/?project=${project}&type=private&settings=acme&secret=never-persist`;
  const login = new URL(loginHref(destination), "http://localhost");
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("next"), `/settings?project=${project}&type=private&tab=acme`);
  assert.equal(safeReturnHref(login.searchParams.get("next")), `/settings?project=${project}&type=private&tab=acme`);
  assert.equal(loginHref("/"), "/login");
});
test("settings paths support direct entry, safe defaults and authenticated return", () => {
  assert.equal(readAppRoute(new URLSearchParams(), "/settings").settings, "notifications");
  assert.equal(readAppRoute(new URLSearchParams("tab=bad"), "/settings").settings, "notifications");
  assert.equal(safeReturnHref("/settings?tab=acme&secret=discard"), "/settings?tab=acme");
  assert.equal(safeReturnHref("/settings-evil?tab=acme"), "/");
  assert.equal(safeReturnHref("/settings//evil.test"), "/");
  const url = new URL(loginHref("/settings?tab=acme"), "http://localhost");
  assert.equal(url.searchParams.get("next"), "/settings?tab=acme");
});
test("login return targets reject external redirects, login loops and control characters", () => {
  for (const value of [null, "", "https://evil.test", "//evil.test", "javascript:alert(1)", "/login?next=/login", "/\\evil.test", "/?settings=acme\r\nLocation:evil", "/api/certificates"]) {
    assert.equal(safeReturnHref(value), "/");
  }
});
