export interface BrowserActBrowserSummary {
  id: string;
  name: string;
  type: 'chrome' | 'chrome-direct' | 'stealth' | string;
  state?: string;
  desc?: string;
}

export interface BrowserActProfileSummary {
  id: string;
  name: string;
  kind: string;
  source?: string;
}

export function parseBrowserActBrowserList(output: string): BrowserActBrowserSummary[] {
  const rows: BrowserActBrowserSummary[] = [];
  const lines = output.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^id=(\S+)\s+name="([^"]+)"\s+type=(\S+)(?:\s+state=(\S+))?/);
    if (!match) continue;

    const descLine = lines[index + 1]?.match(/^\s+desc="([^"]*)"/);
    rows.push({
      id: match[1],
      name: match[2],
      type: match[3],
      state: match[4],
      desc: descLine?.[1],
    });
  }

  return rows;
}

export function parseBrowserActProfileList(output: string): BrowserActProfileSummary[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('Total:') && !line.startsWith('Tip:'))
    .map((line) => {
      const firstSpace = line.search(/\s/);
      if (firstSpace === -1) {
        return { id: line, name: line, kind: 'unknown' };
      }
      const id = line.slice(0, firstSpace);
      const rest = line.slice(firstSpace).trim();
      const parts = rest.split(/\s{2,}/);
      if (parts.length === 1) {
        const tokens = rest.split(/\s+/);
        return {
          id,
          name: tokens[0] || id,
          kind: tokens[1] || 'unknown',
          source: tokens[3],
        };
      }
      return {
        id,
        name: parts[0] || id,
        kind: parts[1] || 'unknown',
        source: parts[3],
      };
    });
}

export function extractRemoteAssistUrl(output: string): string {
  const match = output.match(/https?:\/\/\S+/);
  if (!match) throw new Error('browser-act remote-assist output did not contain a URL');
  return match[0].replace(/[)\].,;]+$/, '');
}
