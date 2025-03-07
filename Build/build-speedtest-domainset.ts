import { domainDeduper } from './lib/domain-deduper';
import path from 'path';
import { createRuleset } from './lib/create-file';
import domainSorter from './lib/stable-sort-domain';

import { Sema } from 'async-sema';
import * as tldts from 'tldts';
import { task } from './lib/trace-runner';
const s = new Sema(3);

const latestTopUserAgentsPromise = fetch('https://unpkg.com/top-user-agents@latest/index.json')
  .then(res => res.json() as Promise<string[]>);

const querySpeedtestApi = async (keyword: string): Promise<(string | null)[]> => {
  const [topUserAgents] = await Promise.all([
    latestTopUserAgentsPromise,
    s.acquire()
  ]);

  const randomUserAgent = topUserAgents[Math.floor(Math.random() * topUserAgents.length)];

  try {
    const key = `fetch speedtest endpoints: ${keyword}`;
    console.time(key);

    const res = await fetch(`https://www.speedtest.net/api/js/servers?engine=js&search=${keyword}&limit=100`, {
      headers: {
        dnt: '1',
        Referer: 'https://www.speedtest.net/',
        accept: 'application/json, text/plain, */*',
        'User-Agent': randomUserAgent,
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Ch-Ua': '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Gpc': '1'
      }
    });
    if (!res.ok) {
      throw new Error(res.statusText + '\n' + await res.text());
    }

    const json = await res.json() as { url: string; }[];
    s.release();

    console.timeEnd(key);

    return json.map(({ url }) => tldts.getHostname(url, { detectIp: false }));
  } catch (e) {
    s.release();
    console.log(e);
    return [];
  }
};

export const buildSpeedtestDomainSet = task(__filename, async () => {
  /** @type {Set<string>} */
  const domains: Set<string> = new Set([
    '.speedtest.net',
    '.speedtestcustom.com',
    '.ooklaserver.net',
    '.speed.misaka.one',
    '.speed.cloudflare.com',
    '.speedtest.rt.ru',
    '.speedtest.aptg.com.tw',
    '.speedtest.gslnetworks.com',
    '.speedtest.jsinfo.net',
    '.speedtest.i3d.net',
    '.speedtestkorea.com',
    '.speedtest.telus.com',
    '.speedtest.telstra.net',
    '.speedtest.clouvider.net',
    '.speedtest.idv.tw',
    '.speedtest.frontier.com',
    '.speedtest.orange.fr',
    '.speedtest.centurylink.net',
    '.srvr.bell.ca',
    '.speedtest.contabo.net',
    'speedtest.hk.chinamobile.com',
    'speedtestbb.hk.chinamobile.com',
    '.hizinitestet.com',
    '.linknetspeedtest.net.br',
    'speedtest.rit.edu',
    'speedtest.ropa.de',
    'speedtest.sits.su',
    'speedtest.tigo.cr',
    'speedtest.upp.com',
    '.fast.com'
  ]);

  const hostnameGroups = await Promise.all([
    'Hong Kong',
    'Taiwan',
    'China Telecom',
    'China Mobile',
    'China Unicom',
    'Japan',
    'Tokyo',
    'Singapore',
    'Korea',
    'Canada',
    'Toronto',
    'Montreal',
    'Los Ang',
    'San Jos',
    'Seattle',
    'New York',
    'Dallas',
    'Miami',
    'Berlin',
    'Frankfurt',
    'London',
    'Paris',
    'Amsterdam',
    'Moscow',
    'Australia',
    'Sydney',
    'Brazil',
    'Turkey'
  ].map(querySpeedtestApi));

  for (const hostnames of hostnameGroups) {
    if (Array.isArray(hostnames)) {
      for (const hostname of hostnames) {
        if (hostname) {
          domains.add(hostname);
        }
      }
    }
  }

  const deduped = domainDeduper(Array.from(domains)).sort(domainSorter);
  const description = [
    'License: AGPL 3.0',
    'Homepage: https://ruleset.skk.moe',
    'GitHub: https://github.com/SukkaW/Surge'
  ];

  return Promise.all(createRuleset(
    'Sukka\'s Ruleset - Speedtest Domains',
    description,
    new Date(),
    deduped,
    'domainset',
    path.resolve(__dirname, '../List/domainset/speedtest.conf'),
    path.resolve(__dirname, '../Clash/domainset/speedtest.txt')
  ));
});

if (import.meta.main) {
  buildSpeedtestDomainSet();
}
