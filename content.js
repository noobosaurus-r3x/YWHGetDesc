(() => {
  const SEVERITY_ORDER = ['Low', 'Medium', 'High', 'Critical'];

  function cleanText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function escapeMdCell(value) {
    return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  function detectWildcard(asset) {
    const value = (asset || '').toLowerCase();
    return value.includes('*.') || value.includes('/*') || value.includes('/**') || value.includes('{subdomain}');
  }

  function normalizeAssetType(type) {
    const value = (type || '').toLowerCase();

    if (!value) return 'unknown';
    if (value.includes('api')) return 'api';
    if (value.includes('android')) return 'android_app';
    if (value.includes('ios')) return 'ios_app';
    if (value.includes('mobile')) return 'mobile_app';
    if (value.includes('web') || value.includes('url') || value.includes('website')) return 'web';
    if (value.includes('domain') || value.includes('host') || value.includes('subdomain')) return 'domain';
    if (value.includes('ip') || value.includes('cidr') || value.includes('range')) return 'ip';
    if (value.includes('source')) return 'source_code';
    if (value.includes('repo') || value.includes('git')) return 'repository';
    if (value.includes('desktop')) return 'desktop_app';
    if (value.includes('hardware') || value.includes('device') || value.includes('iot')) return 'device';
    if (value.includes('email')) return 'email';

    return value.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
  }

  function inferEnvironment(asset) {
    const value = (asset || '').toLowerCase();
    const patterns = [
      ['staging', /(^|[^a-z])(recette)([^a-z]|$)/],
      ['sandbox', /(^|[^a-z])(sandbox)([^a-z]|$)/],
      ['staging', /(^|[^a-z])(staging|stage|preprod|pre-prod)([^a-z]|$)/],
      ['development', /(^|[^a-z])(dev|development)([^a-z]|$)/],
      ['test', /(^|[^a-z])(test|testing|qa|uat)([^a-z]|$)/],
      ['production', /(^|[^a-z])(prod|production|live)([^a-z]|$)/]
    ];

    for (const [name, regex] of patterns) {
      if (regex.test(value)) return name;
    }

    return 'unknown';
  }

  function extractSeverityLabels(value) {
    const text = (value || '').toLowerCase();
    return SEVERITY_ORDER.filter(label => text.includes(label.toLowerCase()));
  }

  function highestRewardSeverity(rewards) {
    const available = SEVERITY_ORDER.filter(label => cleanText(rewards[label]));
    return available.length ? available[available.length - 1] : '';
  }

  function inferMaxSeverity(assetValue, rewards) {
    const severityLabels = extractSeverityLabels(assetValue);
    if (severityLabels.length) return severityLabels[severityLabels.length - 1];

    const text = (assetValue || '').toLowerCase();
    if (!text) return '';
    if (/(not eligible|no bounty|non rewarded|informational only|swag only|hall of fame only)/.test(text)) return 'None';
    if (/(bounty|reward|eligible|paid|yes)/.test(text)) return highestRewardSeverity(rewards);

    return '';
  }

  function inferBountyEligibility(assetValue, rewards) {
    const text = (assetValue || '').toLowerCase();
    if (!text) return null;
    if (/(not eligible|no bounty|non rewarded|informational only|swag only|hall of fame only)/.test(text)) return false;
    if (/(bounty|reward|eligible|paid|yes)/.test(text)) return true;
    if (extractSeverityLabels(assetValue).length) return true;
    return highestRewardSeverity(rewards) ? null : false;
  }

  function normalizeScope(scope, rewards) {
    const asset = cleanText(scope.scope || scope.asset || '');
    const assetValue = cleanText(scope.assetValue);

    return {
      ...scope,
      asset,
      asset_type: normalizeAssetType(scope.type),
      wildcard: detectWildcard(asset),
      environment: inferEnvironment(asset),
      max_severity: inferMaxSeverity(assetValue, rewards),
      bounty_eligible: inferBountyEligibility(assetValue, rewards)
    };
  }

  function rewardsToMarkdown(rewards) {
    const rewardRows = SEVERITY_ORDER.filter(label => cleanText(rewards[label]));
    if (!rewardRows.length) return '_No reward data extracted._\n\n';

    let md = '| Severity | Amount |\n| --- | --- |\n';
    rewardRows.forEach(label => {
      md += `| ${label} | ${escapeMdCell(rewards[label])} |\n`;
    });
    return `${md}\n`;
  }

  function listToMarkdown(items, emptyMessage) {
    if (!items.length) return `${emptyMessage}\n\n`;
    return `${items.map(item => `- ${item}`).join('\n')}\n\n`;
  }

  function scopeTableToMarkdown(scopes) {
    if (!scopes.length) return '_No in-scope assets extracted._\n\n';

    let md = '| Asset | Type | Normalized Type | Wildcard | Environment | Max Severity | Bounty Eligible | Reports | Asset Value |\n';
    md += '| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n';
    scopes.forEach(scope => {
      md += `| ${escapeMdCell(scope.asset)} | ${escapeMdCell(scope.type)} | ${escapeMdCell(scope.asset_type)} | ${scope.wildcard ? 'yes' : 'no'} | ${escapeMdCell(scope.environment)} | ${escapeMdCell(scope.max_severity || '')} | ${scope.bounty_eligible === null ? '' : scope.bounty_eligible ? 'yes' : 'no'} | ${escapeMdCell(scope.reports)} | ${escapeMdCell(scope.assetValue)} |\n`;
    });
    return `${md}\n`;
  }

  function headingMatches(text, expected) {
    const normalized = cleanText(text).toLowerCase();
    return normalized === expected || normalized.includes(expected);
  }

  function collectListItemsFromNode(node) {
    if (!node) return [];

    if (node.tagName === 'UL' || node.tagName === 'OL') {
      return Array.from(node.querySelectorAll(':scope > li'))
        .map(li => cleanText(li.innerText || li.textContent))
        .filter(Boolean);
    }

    const directLists = Array.from(node.querySelectorAll(':scope > ul, :scope > ol'));
    if (directLists.length) {
      return directLists.flatMap(list => collectListItemsFromNode(list));
    }

    return Array.from(node.querySelectorAll('li'))
      .map(li => cleanText(li.innerText || li.textContent))
      .filter(Boolean);
  }

  function shouldMergeListItem(previous, current) {
    if (!previous || !current) return false;

    const currentWordCount = current.split(/\s+/).filter(Boolean).length;
    const currentStartsLowercase = /^[a-z(]/.test(current);
    const previousEndsWithConnector = /(and|or|to|an|a|the|of|for|via|with|without|through|under|that|not|victim's|services \(e\.g\.|HTTP|Logout \/)$/i.test(previous);
    const previousEndsOpen = /[(\/]$/.test(previous);
    const previousParenBalance = (previous.match(/\(/g) || []).length - (previous.match(/\)/g) || []).length;

    if (previousEndsWithConnector && currentWordCount <= 6) return true;
    if (previousEndsOpen && currentWordCount <= 8) return true;
    if (previousParenBalance > 0) return true;
    if (currentStartsLowercase && currentWordCount <= 8) return true;

    return false;
  }

  function normalizeListItems(items) {
    return items.reduce((result, item) => {
      if (!result.length) {
        result.push(item);
        return result;
      }

      const previous = result[result.length - 1];
      if (shouldMergeListItem(previous, item)) {
        result[result.length - 1] = `${previous} ${item}`;
      } else {
        result.push(item);
      }

      return result;
    }, []);
  }

  function extractListByHeading(expectedHeading) {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    for (const heading of headings) {
      if (!headingMatches(heading.textContent, expectedHeading)) continue;

      let node = heading.nextElementSibling;
      while (node) {
        if (/^H[1-6]$/.test(node.tagName)) break;

        const items = normalizeListItems(collectListItemsFromNode(node));
        if (items.length) return items;

        node = node.nextElementSibling;
      }
    }

    return [];
  }

  function extractProgramData() {
    const title = document.querySelector('h1.program-title')?.textContent?.trim() || '';
    const url = window.location.href;

    // Program description (the markdown-rendered HTML block)
    const descriptionEl = document.querySelector('#program-rules-paragraph.markdown-html');
    const descriptionHtml = descriptionEl?.innerHTML?.trim() || '';
    const descriptionText = descriptionEl?.innerText?.trim() || '';

    // Reward grid
    const rewards = {};
    const rewardGrid = document.querySelector('ywh-reward-grid section.reward-grid');
    if (rewardGrid) {
      const values = rewardGrid.querySelectorAll('.reward-grid-value .tag-content');
      const titles = rewardGrid.querySelectorAll('.reward-grid-title');
      titles.forEach((titleEl, i) => {
        const label = titleEl.textContent.trim();
        const value = values[i]?.textContent?.trim() || '';
        if (label) rewards[label] = value;
      });
    }

    // Scopes
    const scopes = [];
    document.querySelectorAll('#program-scopes-table tbody tr:not(.rewards-row)').forEach(row => {
      const scopeEl = row.querySelector('span.scope');
      const typeEl = row.querySelector('.cdk-column-type');
      const reportsEl = row.querySelector('.cdk-column-reports .tag-content');
      const assetValueEl = row.querySelector('.cdk-column-assetValue .tag-content');
      if (scopeEl) {
        scopes.push({
          scope: scopeEl.textContent.trim(),
          type: typeEl?.textContent?.trim() || '',
          reports: reportsEl?.textContent?.trim() || '0',
          assetValue: assetValueEl?.textContent?.trim() || ''
        });
      }
    });

    // Qualifying vulnerabilities
    const qualifying = extractListByHeading('qualifying vulnerabilities');

    // Non-qualifying vulnerabilities
    const nonQualifying = extractListByHeading('non-qualifying vulnerabilities');

    // Out of scopes
    const outOfScopes = extractListByHeading('out of scopes');

    // Program info
    const programType = document.querySelector('#program-card-information-section .tag-content')?.textContent?.trim() || '';
    const visibility = document.querySelectorAll('#program-card-information-section .tag-content')?.[1]?.textContent?.trim() || '';
    document.querySelectorAll('#program-card-information-section span').forEach(span => {
      if (span.textContent.includes('Last update on')) {
        const match = span.textContent.match(/Last update on (\S+)/);
        if (match) rewards.lastUpdate = match[1];
      }
    });

    // User agent requirement
    let userAgent = '';
    document.querySelectorAll('#hunting-requirements strong').forEach(el => {
      const text = el.textContent.trim();
      if (text && !text.includes('collaboration')) {
        userAgent = text;
      }
    });

    const normalizedScopes = scopes.map(scope => normalizeScope(scope, rewards));

    return {
      title,
      url,
      programType,
      visibility,
      descriptionText,
      descriptionHtml,
      rewards,
      scopes: normalizedScopes,
      outOfScopes,
      qualifyingVulnerabilities: qualifying,
      nonQualifyingVulnerabilities: nonQualifying,
      userAgent,
      extractedAt: new Date().toISOString()
    };
  }

  // Convert data to markdown
  function toMarkdown(data) {
    const scopeStats = {
      wildcard: data.scopes.filter(scope => scope.wildcard).length,
      bountyEligible: data.scopes.filter(scope => scope.bounty_eligible === true).length
    };

    let md = `# ${data.title}\n\n`;
    md += `## Program\n\n`;
    md += `- URL: ${data.url}\n`;
    md += `- Type: ${data.programType || 'Unknown'}\n`;
    md += `- Visibility: ${data.visibility || 'Unknown'}\n`;
    md += `- Extracted: ${data.extractedAt}\n`;
    if (data.rewards.lastUpdate) md += `- Last update: ${data.rewards.lastUpdate}\n`;
    if (data.userAgent) md += `- User-Agent: \`${data.userAgent}\`\n`;
    md += `- Scope count: ${data.scopes.length}\n`;
    md += `- Wildcard scope count: ${scopeStats.wildcard}\n`;
    md += `- Bounty-eligible scope count: ${scopeStats.bountyEligible}\n\n`;

    md += `## Rewards\n\n`;
    md += rewardsToMarkdown(data.rewards);

    md += `## Scope\n\n`;
    md += scopeTableToMarkdown(data.scopes);

    md += `## Out of Scope\n\n`;
    md += listToMarkdown(data.outOfScopes, '_No explicit out-of-scope items extracted._');

    md += `## Qualifying Vulns\n\n`;
    md += listToMarkdown(data.qualifyingVulnerabilities, '_No qualifying vulnerability list extracted._');

    md += `## Non-Qualifying Vulns\n\n`;
    md += listToMarkdown(data.nonQualifyingVulnerabilities, '_No non-qualifying vulnerability list extracted._');

    md += `## Notes\n\n`;
    md += '- Initial focus:\n';
    md += '- Interesting assets:\n';
    md += '- Auth requirements / test accounts:\n';
    md += '- Potential high-signal vuln classes:\n';
    md += '- Follow-up recon:\n\n';

    md += `## Program Description\n\n`;
    md += `${data.descriptionText || '_No program description extracted._'}\n`;

    return md;
  }

  // Convert data to plain text
  function toText(data) {
    let txt = `${data.title}\n${'='.repeat(data.title.length)}\n\n`;
    txt += `URL: ${data.url}\n`;
    txt += `Type: ${data.programType}\n`;
    txt += `Visibility: ${data.visibility}\n`;
    if (data.userAgent) txt += `User-Agent: ${data.userAgent}\n`;
    txt += `Extracted: ${data.extractedAt}\n\n`;

    txt += `REWARDS\n${'-'.repeat(7)}\n`;
    for (const [key, val] of Object.entries(data.rewards)) {
      if (key === 'lastUpdate') continue;
      txt += `  ${key}: ${val}\n`;
    }
    txt += '\n';

    txt += `PROGRAM DESCRIPTION\n${'-'.repeat(19)}\n${data.descriptionText}\n\n`;

    txt += `SCOPES (${data.scopes.length})\n${'-'.repeat(10)}\n`;
    data.scopes.forEach(s => {
      txt += `  ${s.scope} [${s.type}] - Reports: ${s.reports} - Asset: ${s.assetValue}\n`;
    });
    txt += '\n';

    if (data.outOfScopes.length) {
      txt += `OUT OF SCOPES\n${'-'.repeat(13)}\n`;
      data.outOfScopes.forEach(s => { txt += `  - ${s}\n`; });
      txt += '\n';
    }

    if (data.qualifyingVulnerabilities.length) {
      txt += `QUALIFYING VULNERABILITIES\n${'-'.repeat(25)}\n`;
      data.qualifyingVulnerabilities.forEach(v => { txt += `  - ${v}\n`; });
      txt += '\n';
    }

    if (data.nonQualifyingVulnerabilities.length) {
      txt += `NON-QUALIFYING VULNERABILITIES\n${'-'.repeat(29)}\n`;
      data.nonQualifyingVulnerabilities.forEach(v => { txt += `  - ${v}\n`; });
      txt += '\n';
    }

    return txt;
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extract') {
      const data = extractProgramData();
      sendResponse(data);
    } else if (request.action === 'exportJSON') {
      const data = extractProgramData();
      sendResponse({ content: JSON.stringify(data, null, 2), filename: `${sanitize(data.title)}.json` });
    } else if (request.action === 'exportTXT') {
      const data = extractProgramData();
      sendResponse({ content: toText(data), filename: `${sanitize(data.title)}.txt` });
    } else if (request.action === 'exportMD') {
      const data = extractProgramData();
      sendResponse({ content: toMarkdown(data), filename: `${sanitize(data.title)}.md` });
    }
    return true;
  });

  function sanitize(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80) || 'ywh_program';
  }
})();
