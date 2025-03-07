// @ts-check
import path from 'path';
import { createRuleset } from './lib/create-file';
import { parseFelixDnsmasq } from './lib/parse-dnsmasq';
import { task } from './lib/trace-runner';

export const buildAppleCdn = task(__filename, async () => {
  const res = await parseFelixDnsmasq('https://raw.githubusercontent.com/felixonmars/dnsmasq-china-list/master/apple.china.conf');

  const description = [
    'License: AGPL 3.0',
    'Homepage: https://ruleset.skk.moe',
    'GitHub: https://github.com/SukkaW/Surge',
    '',
    'This file contains Apple\'s domains using their China mainland CDN servers.',
    '',
    'Data from:',
    ' - https://github.com/felixonmars/dnsmasq-china-list'
  ];

  const ruleset = res.map(domain => `DOMAIN-SUFFIX,${domain}`);
  const domainset = res.map(i => `.${i}`);

  return Promise.all([
    ...createRuleset(
      'Sukka\'s Ruleset - Apple CDN',
      description,
      new Date(),
      ruleset,
      'ruleset',
      path.resolve(__dirname, '../List/non_ip/apple_cdn.conf'),
      path.resolve(__dirname, '../Clash/non_ip/apple_cdn.txt')
    ),
    ...createRuleset(
      'Sukka\'s Ruleset - Apple CDN',
      description,
      new Date(),
      domainset,
      'domainset',
      path.resolve(__dirname, '../List/domainset/apple_cdn.conf'),
      path.resolve(__dirname, '../Clash/domainset/apple_cdn.txt')
    )
  ]);
});

if (import.meta.main) {
  buildAppleCdn();
}
