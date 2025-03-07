// @ts-check
import path from 'path';
import { isIPv4, isIPv6 } from 'net';
import { createRuleset } from './lib/create-file';
import { fetchRemoteTextAndCreateReadlineInterface, readFileByLine } from './lib/fetch-remote-text-by-line';
import { processLine } from './lib/process-line';
import { task } from './lib/trace-runner';

const getBogusNxDomainIPs = async () => {
  /** @type {string[]} */
  const result = [];
  for await (const line of await fetchRemoteTextAndCreateReadlineInterface('https://raw.githubusercontent.com/felixonmars/dnsmasq-china-list/master/bogus-nxdomain.china.conf')) {
    if (line.startsWith('bogus-nxdomain=')) {
      const ip = line.slice(15).trim();
      if (isIPv4(ip)) {
        result.push(`IP-CIDR,${ip}/32,no-resolve`);
      } else if (isIPv6(ip)) {
        result.push(`IP-CIDR6,${ip}/128,no-resolve`);
      }
    }
  }
  return result;
};

export const buildAntiBogusDomain = task(__filename, async () => {
  const bogusIpPromise = getBogusNxDomainIPs();

  /** @type {string[]} */
  const result = [];
  for await (const line of readFileByLine(path.resolve(__dirname, '../Source/ip/reject.conf'))) {
    if (line === '# --- [Anti Bogus Domain Replace Me] ---') {
      (await bogusIpPromise).forEach(rule => result.push(rule));
      continue;
    } else {
      const l = processLine(line);
      if (l) {
        result.push(l);
      }
    }
  }

  const description = [
    'License: AGPL 3.0',
    'Homepage: https://ruleset.skk.moe',
    'GitHub: https://github.com/SukkaW/Surge',
    '',
    'This file contains known addresses that are hijacking NXDOMAIN results returned by DNS servers.',
    '',
    'Data from:',
    ' - https://github.com/felixonmars/dnsmasq-china-list'
  ];

  return Promise.all(createRuleset(
    'Sukka\'s Ruleset - Anti Bogus Domain',
    description,
    new Date(),
    result,
    'ruleset',
    path.resolve(__dirname, '../List/ip/reject.conf'),
    path.resolve(__dirname, '../Clash/ip/reject.txt')
  ));
});

if (import.meta.main) {
  buildAntiBogusDomain();
}
