import { URL } from 'url';

/**
 * SSRF Protection Filter
 * Blocks private IP ranges, cloud metadata, localhost, and internal ports.
 */
export function isSafePublicUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:') return false;

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost & loopback
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
      return false;
    }

    // Block AWS/GCP/Cloud metadata service
    if (hostname === '169.254.169.254' || hostname.endsWith('.internal')) {
      return false;
    }

    // Block private IPv4 ranges (RFC 1918)
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const b1 = parseInt(ipMatch[1], 10);
      const b2 = parseInt(ipMatch[2], 10);
      if (b1 === 10) return false; // 10.0.0.0/8
      if (b1 === 172 && b2 >= 16 && b2 <= 31) return false; // 172.16.0.0/12
      if (b1 === 192 && b2 === 168) return false; // 192.168.0.0/16
      if (b1 === 127) return false; // loopback
      if (b1 === 169 && b2 === 254) return false; // link-local
    }

    // Only allow standard HTTPS port (443 or default empty)
    if (parsed.port && parsed.port !== '443') {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * RugCheck & Token Safety Analysis Engine (Fail-Closed Default)
 */
export async function checkRugSafety(mint, config = {}) {
  if (!mint) return { safe: false, reason: 'Empty token mint' };

  const isStrict = config.strict_rugcheck !== false; // Default: true (Fail-Closed)

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      if (isStrict) {
        return { safe: false, reason: `RugCheck API returned HTTP ${res.status} (Strict Fail-Closed Protected)` };
      }
      return {
        safe: true,
        unverified: true,
        warning: 'RugCheck API unavailable, proceeding with caution',
        score: null,
        risksCount: 0
      };
    }

    const data = await res.json();
    const risks = data.risks || [];

    const dangerRisks = risks.filter(r => r.level === 'danger');
    const hasRugHistory = dangerRisks.some(r => {
      const name = (r.name || '').toLowerCase();
      const desc = (r.description || '').toLowerCase();
      return name.includes('rugged') || desc.includes('rugged') || name.includes('scam') || name.includes('blacklist');
    });

    const hasExtremeConcentration = dangerRisks.some(r => {
      const name = (r.name || '').toLowerCase();
      return name.includes('single holder') || name.includes('large amount') || name.includes('high supply');
    });

    if (hasRugHistory) {
      return { safe: false, reason: 'Creator has a confirmed history of rugpulls/scams' };
    }
    if (hasExtremeConcentration) {
      return { safe: false, reason: 'Extreme single holder concentration (>25% supply)' };
    }
    if (data.token?.freezeAuthority) {
      return { safe: false, reason: 'Freeze authority is not revoked (honeypot risk)' };
    }

    return {
      safe: true,
      unverified: false,
      score: data.score || 0,
      risksCount: risks.length,
      rugcheckStatus: 'Good'
    };
  } catch (err) {
    if (isStrict) {
      return { safe: false, reason: 'RugCheck safety timeout (Strict Fail-Closed Protected)' };
    }
    return {
      safe: true,
      unverified: true,
      warning: 'RugCheck request timed out',
      score: null,
      risksCount: 0
    };
  }
}

/**
 * Fetch and verify token social links with strict SSRF defense.
 */
export async function checkTokenSocials(uri) {
  if (!uri || !isSafePublicUrl(uri)) {
    return { hasSocials: false, twitter: '', telegram: '', website: '' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(uri, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { hasSocials: false, twitter: '', telegram: '', website: '' };

    const meta = await res.json();
    const twitter = meta.twitter || meta.extensions?.twitter || '';
    const telegram = meta.telegram || meta.extensions?.telegram || '';
    const website = meta.website || meta.extensions?.website || '';

    const hasSocials = !!(twitter || telegram || website);
    return {
      hasSocials,
      twitter,
      telegram,
      website
    };
  } catch {
    return { hasSocials: false, twitter: '', telegram: '', website: '' };
  }
}
