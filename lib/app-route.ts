import type { CertificateScope } from "./certificate-scope";

export type SettingsTab = "notifications" | "acme" | "https";
export type AppRoute = {
  view: "services" | "roots";
  project: string;
  type: CertificateScope;
  ca: string;
  status: "all" | "healthy" | "expiring" | "expired";
  settings: SettingsTab | null;
  certificate: string | null;
};
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
function id(value: string | null) { return value && uuid.test(value) ? value.toLowerCase() : null; }
export function readAppRoute(params: Pick<URLSearchParams, "get">, pathname = "/"): AppRoute {
  const type = params.get("type") === "private" ? "private" : "public";
  const settings = pathname === "/settings" ? params.get("tab") || "notifications" : params.get("settings"), status = params.get("status");
  return {
    view: params.get("view") === "roots" ? "roots" : "services",
    project: id(params.get("project")) || "all", type,
    ca: type === "private" ? id(params.get("ca")) || "all" : "all",
    status: status === "healthy" || status === "expiring" || status === "expired" ? status : "all",
    settings: settings === "https" ? "https" : settings === "acme" ? "acme" : pathname === "/settings" || settings === "general" || settings === "notifications" ? "notifications" : null,
    certificate: id(params.get("certificate")),
  };
}
export function appRouteHref(input: AppRoute): string {
  const params = new URLSearchParams();
  // Only known, validated navigation fields enter the URL; never persist form data.
  const route = readAppRoute(new URLSearchParams(Object.entries(input).filter(([, value]) => value !== null) as [string, string][]));
  if (route.view === "roots") params.set("view", "roots");
  if (route.project !== "all") params.set("project", route.project);
  if (route.type !== "public") params.set("type", route.type);
  if (route.ca !== "all") params.set("ca", route.ca);
  if (route.status !== "all") params.set("status", route.status);
  if (route.settings) {
    params.set("tab", route.settings);
    return `/settings?${params}`;
  }
  if (route.certificate) params.set("certificate", route.certificate);
  return params.size ? `/?${params}` : "/";
}
export function safeReturnHref(value: string | null | undefined): string {
  // Accept only known local pages; reject external URLs, login loops and unknown fields.
  if (!value || /[\\\r\n#]/.test(value)) return "/";
  const [pathname, query = ""] = value.split("?", 2);
  if (pathname !== "/" && pathname !== "/settings") return "/";
  return appRouteHref(readAppRoute(new URLSearchParams(query), pathname));
}
export function loginHref(destination: string) {
  const next = safeReturnHref(destination);
  return next === "/" ? "/login" : `/login?${new URLSearchParams({ next })}`;
}
