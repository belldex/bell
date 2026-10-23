import path from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteJson, safeReadJson } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '../data/smart_wallets.json');
const CANDIDATES_FILE = path.join(__dirname, '../data/wallet_candidates.json');

export class WalletManager {
  constructor(telegram = null) {
    this.telegram = telegram;
    this.wallets = new Map();
    this.candidates = new Map(); // address -> { address, hits: number, tokens: [], firstSeen }
    this.autoSyncTimer = null;
  }

  async init() {
    const list = await safeReadJson(DATA_FILE, []);
    this.wallets.clear();
    for (const w of list) {
      this.wallets.set(w.address, w);
    }
    console.log(`[WalletManager] Loaded ${this.wallets.size} smart wallets.`);

    const cList = await safeReadJson(CANDIDATES_FILE, []);
    this.candidates.clear();
    for (const c of cList) {
      this.candidates.set(c.address, c);
    }

    // Auto-sync & rotate every 6 hours
    this.autoSyncTimer = setInterval(() => {
      console.log('[WalletManager] Running scheduled 6-hour wallet sync & rotation...');
      this.syncAndRotate().catch(err => console.error('[WalletManager] Auto-sync error:', err));
    }, 6 * 3600 * 1000);
  }

  isSmartWallet(address) {
    return this.wallets.has(address);
  }

  getWallet(address) {
    return this.wallets.get(address) || null;
  }

  getWalletTier(address) {
    const w = this.getWallet(address);
    if (!w) return { tier: 'C', multiplier: 0.5, name: 'Unverified (Tier C - 0.5x)' };
    // Any unverified wallet (harvested scouts, dev scouts, etc.) is strictly Tier C
    if (!w.verified) {
      return { tier: 'C', multiplier: 0.5, name: 'Unverified Scout (Tier C - 0.5x Sizing)' };
    }
    const pnl = w.profit_7d_usd || 0;
    const wr = w.winrate_7d || 0;
    if (w.verified && pnl >= 30000 && wr >= 58) {
      return { tier: 'S', multiplier: 1.25, name: 'Whale Alpha (Tier S)' };
    }
    if (w.verified && (pnl >= 10000 || wr >= 50 || w.tag === 'launchpad_smart')) {
      return { tier: 'A', multiplier: 1.0, name: 'Smart Degen (Tier A)' };
    }
    return { tier: 'B', multiplier: 0.75, name: 'Leaderboard (Tier B)' };
  }

  getAll() {
    return Array.from(this.wallets.values());
  }

  getTop(limit = 10) {
    return Array.from(this.wallets.values())
      .sort((a, b) => (b.profit_7d_usd || 0) - (a.profit_7d_usd || 0))
      .slice(0, limit);
  }

  getHarvested() {
    return Array.from(this.wallets.values())
      .filter(w => w.tag.includes('harvested'));
  }

  async addWallet(address, tag = 'custom', label = '') {
    const entry = {
      address,
      tag,
      label: label || 'Custom Wallet',
      verified: true,
      profit_7d_usd: 0,
      winrate_7d: 0,
      txs_7d: 0,
      avg_hold_sec: 0,
      added_at: Math.floor(Date.now() / 1000)
    };
    this.wallets.set(address, entry);
    await this.save();
    return entry;
  }

  async removeWallet(address) {
    const exists = this.wallets.delete(address);
    if (exists) {
      await this.save();
    }
    return exists;
  }

  async save() {
    const list = Array.from(this.wallets.values());
    await atomicWriteJson(DATA_FILE, list);
    const cList = Array.from(this.candidates.values());
    await atomicWriteJson(CANDIDATES_FILE, cList);
  }

  // -----------------------------------------------------------------
  // AUTO-HARVESTER: Promotes early buyers of winning tokens to smart wallet
  // -----------------------------------------------------------------
  async recordWinningTokenEarlyBuyer(address, tokenMint, symbol, isDeployer = false) {
    if (!address) return null;
    if (this.isSmartWallet(address)) return null;

    let cand = this.candidates.get(address);
    if (!cand) {
      cand = {
        address,
        hits: 0,
        tokens: [],
        firstSeen: Math.floor(Date.now() / 1000),
        isDeployer
      };
      this.candidates.set(address, cand);
    }

    if (!cand.tokens.includes(symbol || tokenMint)) {
      cand.tokens.push(symbol || tokenMint);
      cand.hits += 1;
    }

    console.log(`[AutoHarvester] Candidate ${address.slice(0, 8)}... hits=${cand.hits} (tokens: ${cand.tokens.join(', ')})`);

    // Qualification threshold: 2+ winning token early buys
    if (cand.hits >= 2) {
      const promoted = {
        address,
        tag: isDeployer ? 'harvested_dev' : 'harvested_unverified',
        label: `Auto-Harvested (${cand.tokens.join(', ')})`,
        verified: false,
        observed_hits: cand.hits,
        observed_tokens: cand.tokens,
        profit_7d_usd: 0,
        winrate_7d: 0,
        txs_7d: cand.hits,
        avg_hold_sec: 0,
        added_at: Math.floor(Date.now() / 1000)
      };

      this.wallets.set(address, promoted);
      this.candidates.delete(address);
      await this.save();

      console.log(`[AutoHarvester] 🌾 PROMOTED TO SMART WALLET: ${address} (${promoted.label})`);

      if (this.telegram) {
        const msg = `
🌾 <b>[AUTO-HARVEST] NEW SMART WALLET DISCOVERED!</b>

Address: <code>${address}</code>
Category: <b>${promoted.tag}</b>
Evidence: Early entry on breakout tokens: <b>${cand.tokens.join(', ')}</b>
Total Smart Wallets in Database: <b>${this.wallets.size}</b>
        `.trim();
        await this.telegram.sendMessage(msg);
      }

      return promoted;
    }

    await this.save();
    return null;
  }

  // -----------------------------------------------------------------
  // AUTO-SYNC & ROTATION: Refresh leaderboards & prune underperformers
  // -----------------------------------------------------------------
  async syncAndRotate(minWinrate = 42) {
    try {
      const res = await fetch('https://raw.githubusercontent.com/nirholas/kol-quest/main/solwallets.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rawWallets = data?.smartMoney?.wallets || {};

      let added = 0;
      let updated = 0;
      let pruned = 0;

      // 1. Process Launchpad Smart & Smart Degen
      const sourceList = [
        ...(rawWallets.launchpad_smart || []).map(w => ({ ...w, tag: 'launchpad_smart' })),
        ...(rawWallets.smart_degen || []).map(w => ({ ...w, tag: 'smart_degen' }))
      ];

      for (const w of sourceList) {
        const addr = w.wallet_address || w.address;
        if (!addr) continue;

        const pnl = Math.round(Number(w.realized_profit_7d || 0));
        const wr = Math.round((Number(w.winrate_7d || 0)) * 1000) / 10;
        const txs = w.txs_7d || 0;

        // Filter: only keep if profitable & decent winrate
        if (pnl >= 2000 && wr >= minWinrate) {
          if (this.wallets.has(addr)) {
            const existing = this.wallets.get(addr);
            existing.profit_7d_usd = pnl;
            existing.winrate_7d = wr;
            existing.txs_7d = txs;
            updated++;
          } else {
            this.wallets.set(addr, {
              address: addr,
              tag: w.tag,
              label: 'Leaderboard Smart Money',
              verified: true,
              profit_7d_usd: pnl,
              winrate_7d: wr,
              txs_7d: txs,
              avg_hold_sec: Math.round(Number(w.avg_holding_period_7d || 0)),
              added_at: Math.floor(Date.now() / 1000)
            });
            added++;
          }
        }
      }

      // 2. Prune old wallets with winrate < 35% or losing money (except custom/harvested)
      for (const [addr, w] of Array.from(this.wallets.entries())) {
        if (w.tag === 'custom' || w.tag.includes('harvested')) continue;
        if (w.profit_7d_usd < 0 || (w.winrate_7d > 0 && w.winrate_7d < 35)) {
          this.wallets.delete(addr);
          pruned++;
        }
      }

      await this.save();
      console.log(`[WalletManager] Sync & Rotate complete: +${added} added, ~${updated} updated, -${pruned} pruned. Total: ${this.wallets.size}`);

      if (this.telegram && (added > 0 || pruned > 0)) {
        const msg = `
🔄 <b>[AUTO-SYNC] Smart Wallets Updated!</b>

• New Wallets Added: <b>+${added}</b>
• Wallets Updated: <b>${updated}</b>
• Underperforming Pruned: <b>-${pruned}</b>
• Total Active Smart Wallets: <b>${this.wallets.size}</b>
        `.trim();
        await this.telegram.sendMessage(msg);
      }

      return { success: true, added, updated, pruned, total: this.wallets.size };
    } catch (err) {
      console.error('[WalletManager] Sync error:', err.message);
      return { success: false, error: err.message };
    }
  }
}
