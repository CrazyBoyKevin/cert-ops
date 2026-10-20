import { BRAND_ICON_URL } from "@/lib/brand";

export function Brand({ appearance = "sidebar" }: { appearance?: "sidebar" | "login" }) {
  return <div className={`brand brand--${appearance}`} role="img" aria-label="CertOps">
    {/* The small static SVG is also the favicon; no raster optimization is needed. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="brand-symbol" src={BRAND_ICON_URL} width={32} height={36} alt="" aria-hidden="true" />
    <span className="brand-copy" aria-hidden="true"><span className="brand-name">Cert<span>Ops</span></span></span>
  </div>;
}
