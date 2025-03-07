import { processFilterRules } from './lib/parse-filter';
import path from 'path';
import { createRuleset } from './lib/create-file';
import { processLine } from './lib/process-line';
import { createDomainSorter } from './lib/stable-sort-domain';
import { traceSync, task } from './lib/trace-runner';
import createTrie from './lib/trie';
import { getGorhillPublicSuffixPromise } from './lib/get-gorhill-publicsuffix';
import { createCachedGorhillGetDomain } from './lib/cached-tld-parse';
import * as tldts from 'tldts';

const WHITELIST_DOMAIN = new Set([
  'w3s.link',
  'dweb.link',
  'nftstorage.link',
  'square.site',
  'business.site',
  'page.link', // Firebase URL Shortener
  'fleek.cool',
  'notion.site'
]);
const BLACK_TLD = new Set([
  'xyz',
  'top',
  'win',
  'vip',
  'site',
  'space',
  'online',
  'icu',
  'fun',
  'shop',
  'cool',
  'cyou',
  'id',
  'pro',
  'za.com',
  'sa.com',
  'ltd',
  'group',
  'rest',
  'tech',
  'link',
  'ink',
  'bar',
  'tokyo',
  'tk',
  'cf',
  'gq',
  'ga',
  'ml',
  'cc',
  'cn',
  'codes',
  'cloud',
  'club',
  'click',
  'cfd',
  'fit',
  'mobi',
  'buzz',
  'one',
  'com.cn'
]);

export const buildPhishingDomainSet = task(__filename, async () => {
  const [{ black: domainSet }, gorhill] = await Promise.all([
    processFilterRules(
      'https://curbengh.github.io/phishing-filter/phishing-filter-agh.txt',
      [
        'https://phishing-filter.pages.dev/phishing-filter-agh.txt'
        // Prefer mirror, since malware-filter.gitlab.io has not been updated for a while
        // 'https://malware-filter.gitlab.io/malware-filter/phishing-filter-agh.txt'
      ]
    ),
    getGorhillPublicSuffixPromise()
  ]);

  traceSync('* whitelist', () => {
    const trieForRemovingWhiteListed = createTrie(domainSet);
    WHITELIST_DOMAIN.forEach(white => {
      trieForRemovingWhiteListed.find(`.${white}`, false).forEach(f => domainSet.delete(f));
      if (trieForRemovingWhiteListed.has(white)) {
        domainSet.delete(white);
      }
    });
  });

  const domainCountMap: Record<string, number> = {};
  const getDomain = createCachedGorhillGetDomain(gorhill);

  traceSync('* process domain set', () => {
    const domainArr = Array.from(domainSet);

    for (let i = 0, len = domainArr.length; i < len; i++) {
      const line = processLine(domainArr[i]);
      if (!line) continue;

      const apexDomain = getDomain(line);
      if (!apexDomain) continue;

      domainCountMap[apexDomain] ||= 0;

      const isPhishingDomainMockingCoJp = line.includes('-co-jp');
      if (isPhishingDomainMockingCoJp) {
        domainCountMap[apexDomain] += 0.5;
      }

      if (line.startsWith('.amaz')) {
        domainCountMap[apexDomain] += 0.5;

        if (line.startsWith('.amazon-')) {
          domainCountMap[apexDomain] += 4.5;
        }
        if (isPhishingDomainMockingCoJp) {
          domainCountMap[apexDomain] += 4;
        }
      } else if (line.startsWith('.customer')) {
        domainCountMap[apexDomain] += 0.25;
      }

      const tld = gorhill.getPublicSuffix(line[0] === '.' ? line.slice(1) : line);
      if (!tld || !BLACK_TLD.has(tld)) continue;

      domainCountMap[apexDomain] += 1;

      const lineLen = line.length;

      if (lineLen > 19) {
        // Add more weight if the domain is long enough
        if (lineLen > 44) {
          domainCountMap[apexDomain] += 3.5;
        } else if (lineLen > 34) {
          domainCountMap[apexDomain] += 2.5;
        } else if (lineLen > 29) {
          domainCountMap[apexDomain] += 1.5;
        } else if (lineLen > 24) {
          domainCountMap[apexDomain] += 0.75;
        } else {
          domainCountMap[apexDomain] += 0.25;
        }

        if (domainCountMap[apexDomain] < 5) {
          const subdomain = tldts.getSubdomain(line, { detectIp: false });
          if (subdomain?.includes('.')) {
            domainCountMap[apexDomain] += 1.5;
          }
        }
      }
    }
  });

  const domainSorter = createDomainSorter(gorhill);

  const results = traceSync('* get final results', () => Object.entries(domainCountMap)
    .reduce<string[]>((acc, [apexDomain, count]) => {
      if (count >= 5) {
        acc.push(`.${apexDomain}`);
      }
      return acc;
    }, [])
    .sort(domainSorter));

  const description = [
    'License: AGPL 3.0',
    'Homepage: https://ruleset.skk.moe',
    'GitHub: https://github.com/SukkaW/Surge',
    '',
    'The domainset supports enhanced phishing protection',
    'Build from:',
    ' - https://gitlab.com/malware-filter/phishing-filter'
  ];

  return Promise.all(createRuleset(
    'Sukka\'s Ruleset - Reject Phishing',
    description,
    new Date(),
    results,
    'domainset',
    path.resolve(__dirname, '../List/domainset/reject_phishing.conf'),
    path.resolve(__dirname, '../Clash/domainset/reject_phishing.txt')
  ));
});

if (import.meta.main) {
  buildPhishingDomainSet();
}
