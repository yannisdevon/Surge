// @ts-check
import { task } from './lib/trace-runner';

import path from 'path';
import { createRuleset } from './lib/create-file';

import { ALL, NORTH_AMERICA, EU, HK, TW, JP, KR } from '../Source/stream';

const createRulesetForStreamService = (fileId: string, title: string, streamServices: import('../Source/stream').StreamService[]) => {
  return [
    // Domains
    ...createRuleset(
      `Sukka's Ruleset - Stream Services: ${title}`,
      [
        'License: AGPL 3.0',
        'Homepage: https://ruleset.skk.moe',
        'GitHub: https://github.com/SukkaW/Surge',
        '',
        ...streamServices.map((i: { name: any; }) => `- ${i.name}`)
      ],
      new Date(),
      streamServices.flatMap((i: { rules: any; }) => i.rules),
      'ruleset',
      path.resolve(__dirname, `../List/non_ip/${fileId}.conf`),
      path.resolve(__dirname, `../Clash/non_ip/${fileId}.txt`)
    ),
    // IP
    ...createRuleset(
      `Sukka's Ruleset - Stream Services' IPs: ${title}`,
      [
        'License: AGPL 3.0',
        'Homepage: https://ruleset.skk.moe',
        'GitHub: https://github.com/SukkaW/Surge',
        '',
        ...streamServices.map((i: { name: any; }) => `- ${i.name}`)
      ],
      new Date(),
      streamServices.flatMap((i) => (
        i.ip
          ? [
            ...i.ip.v4.map((ip: any) => `IP-CIDR,${ip},no-resolve`),
            ...i.ip.v6.map((ip: any) => `IP-CIDR6,${ip},no-resolve`)
          ]
          : []
      )),
      'ruleset',
      path.resolve(__dirname, `../List/ip/${fileId}.conf`),
      path.resolve(__dirname, `../Clash/ip/${fileId}.txt`)
    )
  ];
};

export const buildStreamService = task(__filename, async () => {
  return Promise.all([
    ...createRulesetForStreamService('stream', 'All', ALL),
    ...createRulesetForStreamService('stream_us', 'North America', NORTH_AMERICA),
    ...createRulesetForStreamService('stream_eu', 'Europe', EU),
    ...createRulesetForStreamService('stream_hk', 'Hong Kong', HK),
    ...createRulesetForStreamService('stream_tw', 'Taiwan', TW),
    ...createRulesetForStreamService('stream_jp', 'Japan', JP),
    // ...createRulesetForStreamService('stream_au', 'Oceania', AU),
    ...createRulesetForStreamService('stream_kr', 'Korean', KR)
    // ...createRulesetForStreamService('stream_south_east_asia', 'South East Asia', SOUTH_EAST_ASIA)
  ]);
});

if (import.meta.main) {
  buildStreamService();
}
