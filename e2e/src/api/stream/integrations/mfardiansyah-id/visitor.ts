/**
 * Per-worker visitor identity for the site's visit beacon.
 *
 * A `site.visit` carries only the page and a two-letter country, so a test can only recognise its own visit by the
 * country. Playwright's `parallelIndex` is unique among the workers running at the same time, so slot N is the
 * visitor IP 203.0.113.N (RFC 5737 TEST-NET-3: documentation space, never routed, never a real visitor) and its
 * country is "AA" + N (first letter 'A' + N/26, second 'A' + N%26). The GeoIP file written by
 * e2e/site-fixture/init (countryOf in main.go) maps the same IPs to the same codes. Tests inside one worker run one
 * after the other, so two tests never share a country at the same moment.
 */
export interface Visitor {
  readonly ip: string;
  readonly country: string;
}

/** The site's GeoIP file knows 256 slots (203.0.113.0 to 203.0.113.255). */
export const VISITOR_SLOTS = 256;

export function visitorFor(parallelIndex: number): Visitor {
  const slot = parallelIndex % VISITOR_SLOTS;
  const country = String.fromCharCode(65 + Math.floor(slot / 26), 65 + (slot % 26));
  return { ip: `203.0.113.${slot}`, country };
}

/** A desktop browser user agent: it passes the site's bot filter (it needs a "/" and no crawler keyword). */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Headers of a human page view coming from `visitor`. The site trusts X-Real-IP only in the e2e stack. */
export function browserHeaders(visitor: Visitor, extra: Record<string, string> = {}): Record<string, string> {
  return { 'user-agent': BROWSER_USER_AGENT, 'x-real-ip': visitor.ip, ...extra };
}
