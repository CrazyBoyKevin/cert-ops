// URL's IPv6 serialization gives the same compressed representation in Node and the browser.
export function canonicalAddress(value: string) {
  if (!value.includes(":")) return value;
  try { return new URL(`http://[${value}]/`).hostname.slice(1, -1); }
  catch { return value; }
}
