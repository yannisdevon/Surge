// @ts-check
import { fetchWithRetry } from './fetch-retry';
import * as tldts from './cached-tld-parse';
import { fetchRemoteTextAndCreateReadlineInterface } from './fetch-remote-text-by-line';
import { NetworkFilter } from '@cliqz/adblocker';
import { processLine } from './process-line';
import { performance } from 'perf_hooks';
import { getGorhillPublicSuffixPromise } from './get-gorhill-publicsuffix';
import type { PublicSuffixList } from 'gorhill-publicsuffixlist';

const DEBUG_DOMAIN_TO_FIND = null; // example.com | null
let foundDebugDomain = false;

const warnOnceUrl = new Set<string>();
const warnOnce = (url: string, isWhite: boolean, ...message: any[]) => {
  const key = `${url}${isWhite ? 'white' : 'black'}`;
  if (warnOnceUrl.has(key)) {
    return;
  }
  warnOnceUrl.add(key);
  console.warn(url, isWhite ? '(white)' : '(black)', ...message);
};

const normalizeDomain = (domain: string) => {
  if (!domain) return null;

  const parsed = tldts.parse(domain);
  if (parsed.isIp) return null;

  if (parsed.isIcann || parsed.isPrivate) {
    const h = parsed.hostname;

    if (h === null) return null;

    return h[0] === '.' ? h.slice(1) : h;
  }

  return null;
};

export async function processDomainLists(domainListsUrl: string | URL) {
  if (typeof domainListsUrl === 'string') {
    domainListsUrl = new URL(domainListsUrl);
  }

  /** @type Set<string> */
  const domainSets = new Set();

  for await (const line of await fetchRemoteTextAndCreateReadlineInterface(domainListsUrl)) {
    if (line[0] === '!') {
      continue;
    }

    const domainToAdd = processLine(line);
    if (!domainToAdd) {
      continue;
    }

    if (DEBUG_DOMAIN_TO_FIND && domainToAdd.includes(DEBUG_DOMAIN_TO_FIND)) {
      warnOnce(domainListsUrl.toString(), false, DEBUG_DOMAIN_TO_FIND);
      foundDebugDomain = true;
    }

    domainSets.add(domainToAdd);
  }

  return domainSets;
}

export async function processHosts(hostsUrl: string | URL, includeAllSubDomain = false) {
  console.time(`- processHosts: ${hostsUrl}`);

  if (typeof hostsUrl === 'string') {
    hostsUrl = new URL(hostsUrl);
  }

  const domainSets = new Set<string>();

  for await (const l of await fetchRemoteTextAndCreateReadlineInterface(hostsUrl)) {
    const line = processLine(l);
    if (!line) {
      continue;
    }

    const [, ...domains] = line.split(' ');
    const _domain = domains.join(' ').trim();

    if (DEBUG_DOMAIN_TO_FIND && _domain.includes(DEBUG_DOMAIN_TO_FIND)) {
      warnOnce(hostsUrl.href, false, DEBUG_DOMAIN_TO_FIND);
      foundDebugDomain = true;
    }

    const domain = normalizeDomain(_domain);
    if (domain) {
      if (includeAllSubDomain) {
        domainSets.add(`.${domain}`);
      } else {
        domainSets.add(domain);
      }
    }
  }

  console.timeEnd(`   - processHosts: ${hostsUrl}`);

  return domainSets;
}

export async function processFilterRules(
  filterRulesUrl: string | URL,
  fallbackUrls?: readonly (string | URL)[] | undefined
): Promise<{ white: Set<string>, black: Set<string>, foundDebugDomain: boolean }> {
  const runStart = performance.now();

  const whitelistDomainSets = new Set<string>();
  const blacklistDomainSets = new Set<string>();

  /**
   * @param {string} domainToBeAddedToBlack
   * @param {boolean} isSubDomain
   */
  const addToBlackList = (domainToBeAddedToBlack: string, isSubDomain: boolean) => {
    if (isSubDomain && domainToBeAddedToBlack[0] !== '.') {
      blacklistDomainSets.add(`.${domainToBeAddedToBlack}`);
    } else {
      blacklistDomainSets.add(domainToBeAddedToBlack);
    }
  };
  /**
   * @param {string} domainToBeAddedToWhite
   * @param {boolean} [isSubDomain]
   */
  const addToWhiteList = (domainToBeAddedToWhite: string, isSubDomain = true) => {
    if (isSubDomain && domainToBeAddedToWhite[0] !== '.') {
      whitelistDomainSets.add(`.${domainToBeAddedToWhite}`);
    } else {
      whitelistDomainSets.add(domainToBeAddedToWhite);
    }
  };

  let downloadTime = 0;
  const gorhill = await getGorhillPublicSuffixPromise();

  /**
   * @param {string} line
   */
  const lineCb = (line: string) => {
    const result = parse(line, gorhill);
    if (result) {
      const flag = result[1];
      const hostname = result[0];

      if (DEBUG_DOMAIN_TO_FIND) {
        if (hostname.includes(DEBUG_DOMAIN_TO_FIND)) {
          warnOnce(filterRulesUrl.toString(), flag === 0 || flag === -1, DEBUG_DOMAIN_TO_FIND);
          foundDebugDomain = true;

          console.log({ result, flag });
        }
      }

      switch (flag) {
        case 0:
          addToWhiteList(hostname, true);
          break;
        case -1:
          addToWhiteList(hostname, false);
          break;
        case 1:
          addToBlackList(hostname, false);
          break;
        case 2:
          addToBlackList(hostname, true);
          break;
        default:
          throw new Error(`Unknown flag: ${flag}`);
      }
    }
  };

  if (!fallbackUrls || fallbackUrls.length === 0) {
    downloadTime = 0;
    let last = performance.now();
    for await (const line of await fetchRemoteTextAndCreateReadlineInterface(filterRulesUrl)) {
      const now = performance.now();
      downloadTime += performance.now() - last;
      last = now;
      // don't trim here
      lineCb(line);
    }
  } else {
    let filterRules;

    const downloadStart = performance.now();
    try {
      const controller = new AbortController();

      /** @type string[] */
      filterRules = (
        await Promise.any(
          [filterRulesUrl, ...(fallbackUrls || [])].map(async url => {
            const r = await fetchWithRetry(url, { signal: controller.signal });
            const text = await r.text();

            controller.abort();
            return text;
          })
        )
      ).split('\n');
    } catch (e) {
      console.log(`Download Rule for [${filterRulesUrl}] failed`);
      throw e;
    }
    downloadTime = performance.now() - downloadStart;

    for (let i = 0, len = filterRules.length; i < len; i++) {
      lineCb(filterRules[i]);
    }
  }

  console.log(`   ┬ processFilterRules (${filterRulesUrl}): ${(performance.now() - runStart).toFixed(3)}ms`);
  console.log(`   └── download time: ${downloadTime.toFixed(3)}ms`);

  return {
    white: whitelistDomainSets,
    black: blacklistDomainSets,
    foundDebugDomain
  };
}

const R_KNOWN_NOT_NETWORK_FILTER_PATTERN = /[#%&=~]/;
const R_KNOWN_NOT_NETWORK_FILTER_PATTERN_2 = /(\$popup|\$removeparam|\$popunder)/;

function parse($line: string, gorhill: PublicSuffixList): null | [hostname: string, flag: 0 | 1 | 2 | -1] {
  if (
    // doesn't include
    !$line.includes('.') // rule with out dot can not be a domain
    // includes
    || $line.includes('!')
    || $line.includes('?')
    || $line.includes('*')
    || $line.includes('[')
    || $line.includes('(')
    || $line.includes(']')
    || $line.includes(')')
    || $line.includes(',')
    || R_KNOWN_NOT_NETWORK_FILTER_PATTERN.test($line)
  ) {
    return null;
  }

  const line = $line.trim();

  /** @example line.length */
  const len = line.length;
  if (len === 0) {
    return null;
  }

  const firstChar = line[0];
  const lastChar = line[len - 1];

  if (
    firstChar === '/'
    // ends with
    || lastChar === '.' // || line.endsWith('.')
    || lastChar === '-' // || line.endsWith('-')
    || lastChar === '_' // || line.endsWith('_')
    // special modifier
    || R_KNOWN_NOT_NETWORK_FILTER_PATTERN_2.test(line)
    // || line.includes('$popup')
    // || line.includes('$removeparam')
    // || line.includes('$popunder')
  ) {
    return null;
  }

  if ((line.includes('/') || line.includes(':')) && !line.includes('://')) {
    return null;
  }

  const filter = NetworkFilter.parse(line);
  if (filter) {
    if (
      filter.isElemHide()
      || filter.isGenericHide()
      || filter.isSpecificHide()
      || filter.isRedirect()
      || filter.isRedirectRule()
      || filter.hasDomains()
      || filter.isCSP() // must not be csp rule
      || (!filter.fromAny() && !filter.fromDocument())
    ) {
      // not supported type
      return null;
    }

    if (
      filter.hostname // filter.hasHostname() // must have
      && filter.isPlain()
      // && (!filter.isRegex()) // isPlain() === !isRegex()
      && (!filter.isFullRegex())
    ) {
      if (!gorhill.getDomain(filter.hostname)) {
        return null;
      }
      const hostname = normalizeDomain(filter.hostname);
      if (!hostname) {
        return null;
      }

      // console.log({
      //   '||': filter.isHostnameAnchor(),
      //   '|': filter.isLeftAnchor(),
      //   '|https://': !filter.isHostnameAnchor() && (filter.fromHttps() || filter.fromHttp())
      // });
      const isIncludeAllSubDomain = filter.isHostnameAnchor();

      if (filter.isException() || filter.isBadFilter()) {
        return [hostname, isIncludeAllSubDomain ? 0 : -1];
      }

      const _1p = filter.firstParty();
      const _3p = filter.thirdParty();

      if (_1p) {
        if (_1p === _3p) {
          return [hostname, isIncludeAllSubDomain ? 2 : 1];
        }
        return null;
      }
      if (_3p) {
        return null;
      }
    }
  }

  /**
   * abnormal filter that can not be parsed by NetworkFilter
   */

  if (line.includes('$third-party') || line.includes('$frame')) {
    /*
     * `.bbelements.com^$third-party`
     * `://o0e.ru^$third-party`
     */
    return null;
  }

  /** @example line.endsWith('^') */
  const linedEndsWithCaret = lastChar === '^';
  /** @example line.endsWith('^|') */
  const lineEndsWithCaretVerticalBar = lastChar === '|' && line[len - 2] === '^';
  /** @example line.endsWith('^') || line.endsWith('^|') */
  const lineEndsWithCaretOrCaretVerticalBar = linedEndsWithCaret || lineEndsWithCaretVerticalBar;

  // whitelist (exception)
  if (firstChar === '@' && line[1] === '@') {
    /**
     * cname exceptional filter can not be parsed by NetworkFilter
     *
     * `@@||m.faz.net^$cname`
     *
     * Surge / Clash can't handle CNAME either, so we just ignore them
     */
    if (line.endsWith('$cname')) {
      return null;
    }

    /**
     * Some "malformed" regex-based filters can not be parsed by NetworkFilter
     * "$genericblock`" is also not supported by NetworkFilter
     *
     * `@@||cmechina.net^$genericblock`
     * `@@|ftp.bmp.ovh^|`
     * `@@|adsterra.com^|`
     */
    if (
      (
        // line.startsWith('@@|')
        line[2] === '|'
        // line.startsWith('@@.')
        || line[2] === '.'
        /**
         * line.startsWith('@@://')
         *
         * `@@://googleadservices.com^|`
         * `@@://www.googleadservices.com^|`
         */
        || (line[2] === ':' && line[3] === '/' && line[4] === '/')
      )
      && (
        lineEndsWithCaretOrCaretVerticalBar
        || line.endsWith('$genericblock')
        || line.endsWith('$document')
      )
    ) {
      const _domain = line
        .replace('@@||', '')
        .replace('@@://', '')
        .replace('@@|', '')
        .replace('@@.', '')
        .replace('^|', '')
        .replace('^$genericblock', '')
        .replace('$genericblock', '')
        .replace('^$document', '')
        .replace('$document', '')
        .replaceAll('^', '')
        .trim();

      const domain = normalizeDomain(_domain);
      if (domain) {
        return [domain, 0];
      }

      console.warn('      * [parse-filter E0001] (black) invalid domain:', _domain);
      return null;
    }
  }

  if (firstChar === '|') {
    const lineEndswithCname = line.endsWith('$cname');

    if (lineEndsWithCaretOrCaretVerticalBar || lineEndswithCname) {
      /**
       * Some malformed filters can not be parsed by NetworkFilter:
       *
       * `||smetrics.teambeachbody.com^.com^`
       * `||solutions.|pages.indigovision.com^`
       * `||vystar..0rg@client.iebetanialaargentina.edu.co^`
       * `app-uat.latrobehealth.com.au^predirect.snapdeal.com`
       */

      const includeAllSubDomain = line[1] === '|';

      const sliceStart = includeAllSubDomain ? 2 : 1;
      const sliceEnd = lastChar === '^'
        ? -1
        : lineEndsWithCaretOrCaretVerticalBar
          ? -2
          // eslint-disable-next-line sukka/unicorn/no-nested-ternary -- speed
          : (lineEndswithCname ? -6 : 0);

      const _domain = line
        .slice(sliceStart, sliceEnd) // we already make sure line startsWith "|"
        .trim();

      const domain = normalizeDomain(_domain);
      if (domain) {
        return [domain, includeAllSubDomain ? 2 : 1];
      }
      console.warn('      * [parse-filter E0002] (black) invalid domain:', _domain);

      return null;
    }
  }

  const lineStartsWithSingleDot = firstChar === '.';
  if (
    lineStartsWithSingleDot
    && lineEndsWithCaretOrCaretVerticalBar
  ) {
    /**
     * `.ay.delivery^`
     * `.m.bookben.com^`
     * `.wap.x4399.com^`
     */
    const _domain = line.slice(
      1, // remove prefix dot
      linedEndsWithCaret // replaceAll('^', '')
        ? -1
        : (lineEndsWithCaretVerticalBar ? -2 : 0) // replace('^|', '')
    );

    const suffix = gorhill.getPublicSuffix(_domain);
    if (!gorhill.suffixInPSL(suffix)) {
      // This exclude domain-like resource like `1.1.4.514.js`
      return null;
    }

    const domain = normalizeDomain(_domain);
    if (domain) {
      return [domain, 2];
    }
    console.warn('      * [parse-filter E0003] (black) invalid domain:', _domain);

    return null;
  }

  /**
 * `|http://x.o2.pl^`
 * `://mine.torrent.pw^`
 * `://say.ac^`
 */
  if (
    (
      line.startsWith('://')
      || line.startsWith('http://')
      || line.startsWith('https://')
      || line.startsWith('|http://')
      || line.startsWith('|https://')
    )
    && lineEndsWithCaretOrCaretVerticalBar
  ) {
    const _domain = line
      .replace('|https://', '')
      .replace('https://', '')
      .replace('|http://', '')
      .replace('http://', '')
      .replace('://', '')
      .replace('^|', '')
      .replaceAll('^', '')
      .trim();

    const domain = normalizeDomain(_domain);
    if (domain) {
      return [domain, 1];
    }

    console.warn('      * [parse-filter E0004] (black) invalid domain:', _domain);
    return null;
  }

  /**
 * `_vmind.qqvideo.tc.qq.com^`
 * `arketing.indianadunes.com^`
 * `charlestownwyllie.oaklawnnonantum.com^`
 * `-telemetry.officeapps.live.com^`
 * `-tracker.biliapi.net`
 * `-logging.nextmedia.com`
 * `_social_tracking.js^`
 */
  if (firstChar !== '|' && lastChar === '^') {
    const _domain = line.slice(0, -1);

    const suffix = gorhill.getPublicSuffix(_domain);
    if (!suffix || !gorhill.suffixInPSL(suffix)) {
      // This exclude domain-like resource like `_social_tracking.js^`
      return null;
    }

    const domain = normalizeDomain(_domain);
    if (domain) {
      return [domain, 1];
    }

    console.warn('      * [parse-filter E0005] (black) invalid domain:', _domain);
    return null;
  }

  if (lineStartsWithSingleDot) {
    /**
     * `.cookielaw.js`
     * `.content_tracking.js`
     * `.ads.css`
     */
    const _domain = line.slice(1);

    const suffix = gorhill.getPublicSuffix(_domain);
    if (!suffix || !gorhill.suffixInPSL(suffix)) {
      // This exclude domain-like resource like `.gatracking.js`, `.beacon.min.js` and `.cookielaw.js`
      return null;
    }

    const tryNormalizeDomain = normalizeDomain(_domain);
    if (tryNormalizeDomain === _domain) {
      // the entire rule is domain
      return [line, 2];
    }
  } else {
    /**
     * `_prebid.js`
     * `t.yesware.com`
     * `ubmcmm.baidustatic.com`
     * `://www.smfg-card.$document`
     * `portal.librus.pl$$advertisement-module`
     * `@@-ds.metric.gstatic.com^|`
     * `://gom.ge/cookie.js`
     * `://accout-update-smba.jp.$document`
     * `_200x250.png`
     * `@@://www.liquidweb.com/kb/wp-content/themes/lw-kb-theme/images/ads/vps-sidebar.jpg`
     */
    const tryNormalizeDomain = normalizeDomain(line);
    if (tryNormalizeDomain === line) {
      // the entire rule is domain
      return [line, 2];
    }
  }

  console.warn('      * [parse-filter E0010] can not parse:', line);

  return null;
}
