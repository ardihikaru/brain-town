/** The label the town and the back-office print for a zone (WIB/WITA/WIT, else Intl shortOffset such as GMT+9). */
const NAMES: Record<string, string> = {
  'Asia/Jakarta': 'WIB',
  'Asia/Pontianak': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
  UTC: 'UTC',
  'Etc/UTC': 'UTC',
};

export function zoneLabel(zone: string, at: Date = new Date()): string {
  const known = NAMES[zone];
  if (known) return known;
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? zone;
}

/** Wall-clock HH:MM:SS (24 h) of an instant in a zone. */
export function zoneHms(zone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(at);
}

/** Wall-clock HH:MM (24 h) of an instant in a zone. */
export function zoneHm(zone: string, at: Date): string {
  return zoneHms(zone, at).slice(0, 5);
}

/** The first of `candidates` that is not `current`, so a save is always a visible change. */
export function zoneOtherThan(current: string, ...candidates: string[]): string {
  return candidates.find((z) => z !== current) ?? 'UTC';
}
