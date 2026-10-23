import path from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteJson, safeReadJson } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '../data/robinhood_state.json');
const WALLETS_FILE = path.join(__dirname, '../data/robinhood_smart_wallets.json');
const CANDIDATES_FILE = path.join(__dirname, '../data/robinhood_candidates.json');

const RH_RPC_URL = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';

// REALISTIC ROBINHOOD CHAIN (ARBITRUM L2) FRICTION
const RH_L2_GAS_ETH = 0.0001;    // 0.0001 ETH L2 gas per swap
const RH_DEX_FEE_PCT = 0.003;    // 0.3% Uniswap pool fee
const RH_SLIPPAGE_PCT = 0.015;   // 1.5% realistic execution slippage

let cachedEthPrice = 2400.0;
let lastEthFetch = 0;

export async function getEthPriceUsd() {
  const now = Date.now();
  if (now - lastEthFetch < 60000) return cachedEthPrice;
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT');
    if (res.ok) {
      const data = await res.json();
      const p = parseFloat(data.price);
      if (p > 0) {
        cachedEthPrice = p;
        lastEthFetch = now;
      }
    }
  } catch {
    // quiet fallback
  }
  return cachedEthPrice;
}

export class RobinhoodEngine {
  constructor(config, telegram) {
    this.config = config;
    this.telegram = telegram;
    this.state = {
      initial_balance_eth: config.initial_balance_eth || 0.021,
      virtual_balance_eth: config.initial_balance_eth || 0.021,
      open_positions: [],
      closed_trades: []
    };

    this.rhWallets = new Map(); // address (lowercase) -> walletObj
    this.rhCandidates = new Map(); // address -> { address, hits, tokens, firstSeen }

    this.scannedTokens = new Set();
    this.scanInterval = null;
    this.priceInterval = null;
    this.onChainInterval = null;
    this.staleInterval = null;
    this.lastCheckedBlock = 0;
    this.running = false;
  }

  async init() {
    const loaded = await safeReadJson(STATE_FILE, null);
    if (loaded && loaded.__corrupted) {
      console.error(`[RobinhoodEngine] 🚨 CORRUPT STATE DETECTED! Entering Safe Mode.`);
      this.safeMode = true;
      if (this.telegram) {
        await this.telegram.sendMessage(`🚨 <b>ROBINHOOD SAFE MODE ACTIVATED</b>\n\nState file corrupted and safely quarantined to:\n<code>${loaded.quarantinePath}</code>\nTrading is paused to protect balance.`);
      }
      return;
    }

    if (loaded && typeof loaded.virtual_balance_eth === 'number') {
      this.state = loaded;
      console.log(`[RobinhoodEngine] Loaded state: ${this.state.virtual_balance_eth.toFixed(4)} ETH, ${this.state.open_positions.length} open positions.`);
    } else {
      console.log('[RobinhoodEngine] Initializing fresh state...');
      await this.save();
    }

    await this.loadSmartWallets();
  }

  async loadSmartWallets() {
    const wList = await safeReadJson(WALLETS_FILE, []);
    this.rhWallets.clear();
    for (const w of wList) {
      this.rhWallets.set(w.address.toLowerCase(), w);
    }
    console.log(`[RobinhoodEngine] Loaded ${this.rhWallets.size} Robinhood Smart Wallets.`);

    const cList = await safeReadJson(CANDIDATES_FILE, []);
    this.rhCandidates.clear();
    for (const c of cList) {
      this.rhCandidates.set(c.address.toLowerCase(), c);
    }
  }

  async saveSmartWallets() {
    try {
      const wList = Array.from(this.rhWallets.values());
      await atomicWriteJson(WALLETS_FILE, wList);
      const cList = Array.from(this.rhCandidates.values());
      await atomicWriteJson(CANDIDATES_FILE, cList);
    } catch (err) {
      console.error('[RobinhoodEngine] Error saving smart wallets:', err.message);
    }
  }

  isSmartWallet(address) {
    if (!address) return false;
    return this.rhWallets.has(address.toLowerCase());
  }

  getWallet(address) {
    if (!address) return null;
    return this.rhWallets.get(address.toLowerCase()) || null;
  }

  getAllWallets() {
    return Array.from(this.rhWallets.values());
  }

  getTopWallets(limit = 10) {
    return Array.from(this.rhWallets.values())
      .sort((a, b) => (b.profit_7d_usd || 0) - (a.profit_7d_usd || 0))
      .slice(0, limit);
  }

  getHarvestedWallets() {
    return Array.from(this.rhWallets.values())
      .filter(w => (w.tag || '').includes('harvested'));
  }

  async addWallet(address, tag = 'rh_custom', label = '') {
    const entry = {
      address: address.toLowerCase(),
      tag,
      label: label || 'Custom RH Wallet',
      verified: true,
      profit_7d_usd: 0,
      winrate_7d: 0,
      txs_7d: 0,
      added_at: Math.floor(Date.now() / 1000)
    };
    this.rhWallets.set(address.toLowerCase(), entry);
    await this.saveSmartWallets();
    return entry;
  }

  async removeWallet(address) {
    const exists = this.rhWallets.delete(address.toLowerCase());
    if (exists) {
      await this.saveSmartWallets();
    }
    return exists;
  }

  async save() {
    try {
      await atomicWriteJson(STATE_FILE, this.state);
    } catch (err) {
      console.error('[RobinhoodEngine] Failed to save state atomically:', err.message);
    }
  }

  getState() {
    return this.state;
  }

  start() {
    this.running = true;
    console.log('[RobinhoodEngine] 🏹 Starting Robinhood Chain L2 scanner & Smart Wallet Harvester...');

    this.scanRobinhoodMarket().catch(() => {});
    this.scanInterval = setInterval(() => {
      if (this.running) this.scanRobinhoodMarket().catch(() => {});
    }, 20000);

    this.priceInterval = setInterval(() => {
      if (this.running) this.updatePositionPrices().catch(() => {});
    }, 10000);

    this.onChainInterval = setInterval(() => {
      if (this.running) this.pollOnChainSmartWallets().catch(() => {});
    }, 12000);

    this.staleInterval = setInterval(() => {
      if (this.running) this.checkStalePositions().catch(() => {});
    }, 30000);
  }

  stop() {
    this.running = false;
    if (this.scanInterval) clearInterval(this.scanInterval);
    if (this.priceInterval) clearInterval(this.priceInterval);
    if (this.onChainInterval) clearInterval(this.onChainInterval);
    if (this.staleInterval) clearInterval(this.staleInterval);
  }

  async checkStalePositions() {
    const maxHoldMs = (this.config.max_holding_time_minutes || 60) * 60 * 1000;
    const watchdogSec = this.config.velocity_watchdog_seconds || 45;
    const watchdogDropPct = this.config.velocity_exit_drop_pct || 8.0;
    const now = Date.now();

    for (const pos of [...this.state.open_positions]) {
      const holdSec = Math.floor((now - pos.entry_time) / 1000);

      // Volume Velocity Watchdog:
      if (!pos.tp1_executed && holdSec >= watchdogSec) {
        const pnlPct = ((pos.current_price_usd - pos.entry_price_usd) / pos.entry_price_usd) * 100;
        const peakPct = ((pos.peak_price_usd - pos.entry_price_usd) / pos.entry_price_usd) * 100;
        if (peakPct < 10.0 && pnlPct <= -watchdogDropPct) {
          console.log(`[Watchdog] 🐕 Exiting stagnant Robinhood token ${pos.symbol} (no buying volume after ${holdSec}s, PnL: ${pnlPct.toFixed(1)}%)`);
          await this.closePosition(pos.id, pos.current_price_usd, `Velocity Watchdog (Stagnant after ${holdSec}s)`);
          continue;
        }
      }

      // Max Time Limit Check:
      if (now - pos.entry_time >= maxHoldMs) {
        console.log(`[RobinhoodEngine] Closing stale position for ${pos.symbol} (> ${this.config.max_holding_time_minutes} mins)`);
        await this.closePosition(pos.id, pos.current_price_usd, 'Time Limit (Stale Position)');
      }
    }
  }

  // -------------------------------------------------------------
  // AUTO-HARVESTER FOR ROBINHOOD CHAIN (UNVERIFIED SCOUTS)
  // -------------------------------------------------------------
  async recordWinningTokenEarlyBuyer(address, tokenAddress, symbol) {
    if (!address || address.length !== 42) return null;
    const lower = address.toLowerCase();
    if (this.isSmartWallet(lower)) return null;

    let cand = this.rhCandidates.get(lower);
    if (!cand) {
      cand = {
        address: lower,
        hits: 0,
        tokens: [],
        firstSeen: Math.floor(Date.now() / 1000)
      };
      this.rhCandidates.set(lower, cand);
    }

    const tName = symbol || tokenAddress.slice(0, 8);
    if (!cand.tokens.includes(tName)) {
      cand.tokens.push(tName);
      cand.hits += 1;
    }

    console.log(`[RobinhoodHarvester] 🌾 Candidate ${lower.slice(0, 10)}... hits=${cand.hits} (tokens: ${cand.tokens.join(', ')})`);

    // Qualification threshold: 2+ winning Robinhood meme tokens
    if (cand.hits >= 2) {
      const promoted = {
        address: lower,
        tag: 'rh_harvested_unverified',
        label: `Auto-Harvested RH (${cand.tokens.join(', ')})`,
        verified: false,
        observed_hits: cand.hits,
        observed_tokens: cand.tokens,
        profit_7d_usd: 0,
        winrate_7d: 0,
        txs_7d: cand.hits,
        added_at: Math.floor(Date.now() / 1000)
      };

      this.rhWallets.set(lower, promoted);
      this.rhCandidates.delete(lower);
      await this.saveSmartWallets();

      console.log(`[RobinhoodHarvester] 🌟 PROMOTED TO ROBINHOOD WATCHLIST: ${lower}`);

      if (this.telegram) {
        const msg = `
🌾 <b>[ROBINHOOD HARVEST] NEW WALLET DISCOVERED!</b>

Address (EVM): <code>${lower}</code>
Network: <b>Robinhood Chain (Arbitrum L2)</b>
Track Record: Early buyer on tokens: <b>${cand.tokens.join(', ')}</b>
Status: <i>Unverified Scout (Tier C - 0.5x Sizing)</i>
Total Tracked: <b>${this.rhWallets.size} wallets</b>
        `.trim();
        await this.telegram.sendMessage(msg);
      }

      return promoted;
    }

    await this.saveSmartWallets();
    return null;
  }

  async harvestWinningToken(tokenAddress, symbol) {
    try {
      const bRes = await fetch(RH_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] })
      });
      const bData = await bRes.json();
      const latestBlock = parseInt(bData.result, 16);
      const fromBlock = '0x' + Math.max(1, latestBlock - 500).toString(16);
      const toBlock = '0x' + latestBlock.toString(16);

      const logsRes = await fetch(RH_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'eth_getLogs',
          params: [{
            address: tokenAddress,
            fromBlock,
            toBlock,
            topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
          }]
        })
      });
      const data = await logsRes.json();
      const logs = data.result || [];

      for (const l of logs) {
        if (l.topics && l.topics[2]) {
          const recipient = '0x' + l.topics[2].slice(26).toLowerCase();
          if (recipient !== '0x0000000000000000000000000000000000000000') {
            await this.recordWinningTokenEarlyBuyer(recipient, tokenAddress, symbol);
          }
        }
      }
    } catch {
      // quiet fallback
    }
  }

  // -------------------------------------------------------------
  // ON-CHAIN SMART WALLET MONITOR (ROBINHOOD CHAIN)
  // -------------------------------------------------------------
  async pollOnChainSmartWallets() {
    if (!this.config.trading_enabled) return;
    if (this.state.open_positions.length >= (this.config.max_open_positions || 3)) return;

    try {
      const bRes = await fetch(RH_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] })
      });
      const bData = await bRes.json();
      const latestBlock = parseInt(bData.result, 16);
      if (!this.lastCheckedBlock) {
        this.lastCheckedBlock = latestBlock - 20;
      }
      if (latestBlock <= this.lastCheckedBlock) return;

      const fromBlock = '0x' + this.lastCheckedBlock.toString(16);
      const toBlock = '0x' + latestBlock.toString(16);
      this.lastCheckedBlock = latestBlock;

      const logsRes = await fetch(RH_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'eth_getLogs',
          params: [{
            fromBlock,
            toBlock,
            topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
          }]
        })
      });
      const data = await logsRes.json();
      const logs = data.result || [];

      for (const l of logs) {
        if (!l.topics || !l.topics[2]) continue;
        const buyer = '0x' + l.topics[2].slice(26).toLowerCase();
        const seller = l.topics[1] ? ('0x' + l.topics[1].slice(26).toLowerCase()) : '';
        const tokenAddr = l.address;

        // 🚨 CASE 1: SMART WALLET SELLS ON ROBINHOOD CHAIN
        if (seller && this.isSmartWallet(seller)) {
          const openPos = this.state.open_positions.find(p => p.tokenAddress.toLowerCase() === tokenAddr.toLowerCase());
          if (openPos) {
            // Verify that recipient is indeed the DEX pool or router
            const pairData = await this.fetchTokenPair(tokenAddr);
            const poolAddr = (pairData?.pairAddress || '').toLowerCase();
            const isToPool = (buyer === poolAddr);
            if (!isToPool) {
              console.log(`[RobinhoodEngine] ℹ️ Smart Wallet ${seller} transferred ${openPos.symbol} to non-pool address ${buyer}. Ignoring (not a DEX sell).`);
              continue;
            }
            console.log(`[RobinhoodEngine] 🚨 Smart Wallet ${seller} SOLD token ${openPos.symbol} to Uniswap Pool! Instant mirror exit executed!`);
            await this.closePosition(openPos.id, openPos.current_price_usd, `Whale Exit Mirror (${seller.slice(0, 8)}... sold on DEX)`);
            continue;
          }
        }

        // 🟢 CASE 2: SMART WALLET BUYS ON ROBINHOOD CHAIN
        if (this.isSmartWallet(buyer)) {
          const w = this.getWallet(buyer);
          console.log(`[RobinhoodEngine] 🎯 Smart Wallet BUY detected on Robinhood Chain: ${buyer} (${w.label}) for token ${tokenAddr}`);

          const pairData = await this.fetchTokenPair(tokenAddr);
          if (pairData && (pairData.liquidity?.usd || 0) >= 3000) {
            // Verify interaction is with DEX Liquidity Pool to reject arbitrary EOA-to-EOA transfers
            const poolAddr = (pairData.pairAddress || '').toLowerCase();
            const isFromPool = (seller === poolAddr);
            if (!isFromPool) {
              console.log(`[RobinhoodEngine] ⚠️ Skipping non-swap transfer for ${buyer.slice(0, 8)}: sender is not DEX pool ${poolAddr}`);
              continue;
            }

            const tierMultiplier = w.verified ? 1.0 : 0.5;
            await this.openPosition(pairData, `Robinhood Smart Wallet: ${w.label || buyer.slice(0, 8)}`, tierMultiplier);
            break;
          }
        }
      }
    } catch {
      // quiet fallback
    }
  }

  // -------------------------------------------------------------
  // MARKET SCANNER: DexScreener Discovery & Auto-Harvest Trigger
  // -------------------------------------------------------------
  async scanRobinhoodMarket() {
    if (!this.config.trading_enabled) return;
    if (this.config.momentum_scanner_enabled !== true) return; // Dedicated to Smart Money Copy Trading by default
    if (this.state.open_positions.length >= (this.config.max_open_positions || 3)) return;

    try {
      const res = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
      if (!res.ok) return;
      const list = await res.json();
      const rhTokens = (list || []).filter(item => item.chainId === 'robinhood');

      for (const item of rhTokens) {
        const tokenAddr = item.tokenAddress;
        if (!tokenAddr || this.scannedTokens.has(tokenAddr.toLowerCase())) continue;

        const pairData = await this.fetchTokenPair(tokenAddr);
        if (!pairData) continue;

        const liqUsd = pairData.liquidity?.usd || 0;
        const fdv = pairData.fdv || 0;
        const txns5m = pairData.txns?.m5 || { buys: 0, sells: 0 };

        // Auto-harvest high volume / winning tokens on Robinhood Chain
        if (liqUsd >= 10000 || fdv >= 100000) {
          this.harvestWinningToken(tokenAddr, pairData.baseToken?.symbol).catch(() => {});
        }

        if (liqUsd >= 3000 && fdv > 0 && fdv <= 15000000 && (txns5m.buys >= txns5m.sells)) {
          this.scannedTokens.add(tokenAddr.toLowerCase());
          await this.openPosition(pairData, 'Robinhood Momentum & DexScreener Boost', 0.75);
          break;
        }
      }
    } catch {
      // quiet fallback
    }
  }

  async fetchTokenPair(tokenAddr) {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`);
      if (!res.ok) return null;
      const data = await res.json();
      const rhPairs = (data.pairs || []).filter(p => p.chainId === 'robinhood');
      rhPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      return rhPairs[0] || null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------
  // POSITION MANAGEMENT (ETH COMPOUNDING & REALISTIC FRICTION)
  // -------------------------------------------------------------
  calculatePositionSize(tierMultiplier = 1.0) {
    const safetyFloor = this.config.safety_net_floor_eth || 0.003;
    const avail = Math.max(0, this.state.virtual_balance_eth - safetyFloor - 0.0003);
    if (avail < 0.002) return 0; // Strictly prevent trading if available balance < 0.002 ETH

    let size = 0;
    if (this.config.compounding_enabled) {
      const basePct = (this.config.position_pct_of_balance || 25.0) / 100;
      const pct = Math.min(0.35, basePct * (tierMultiplier || 1.0));
      const remainingSlots = Math.max(1, (this.config.max_open_positions || 3) - this.state.open_positions.length);
      const maxPerSlot = avail / remainingSlots;
      size = Math.min(avail * pct, maxPerSlot);
    } else {
      size = (this.config.position_size_eth || 0.004) * (tierMultiplier || 1.0);
    }

    size = Math.min(size, avail);
    size = Math.round(size * 10000) / 10000;
    return size >= 0.002 ? size : 0;
  }

  async openPosition(pair, triggerReason, tierMultiplier = 1.0) {
    if (!this.config.trading_enabled) return null;
    if (this.state.open_positions.length >= (this.config.max_open_positions || 3)) return null;

    const sym = (pair.baseToken?.symbol || '').toUpperCase();
    const EXCLUDED = ['WETH', 'ETH', 'USDC', 'USDT', 'USDG', 'TSLA', 'AAPL', 'NVDA', 'PLTR', 'MSFT', 'AMZN', 'GOOGL', 'META'];
    if (EXCLUDED.includes(sym)) return null;

    const sizeEth = this.calculatePositionSize(tierMultiplier);
    if (sizeEth <= 0) return null;
    if (this.state.open_positions.some(p => p.tokenAddress.toLowerCase() === pair.baseToken.address.toLowerCase())) return null;

    const ethUsd = await getEthPriceUsd();
    const rawPriceUsd = parseFloat(pair.priceUsd) || 0.0001;

    // Apply realistic friction: 1.5% slippage on entry
    const effectiveEntryPriceUsd = rawPriceUsd * (1 + RH_SLIPPAGE_PCT);
    const effectiveEntryPriceEth = effectiveEntryPriceUsd / ethUsd;

    // Deduct L2 gas & pool fee
    const netEthForTokens = Math.max(0.0005, (sizeEth * (1 - RH_DEX_FEE_PCT)) - RH_L2_GAS_ETH);
    const tokensBought = netEthForTokens / effectiveEntryPriceEth;

    const position = {
      id: `RH_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      chainId: 'robinhood',
      tokenAddress: pair.baseToken.address,
      pairAddress: pair.pairAddress,
      symbol: pair.baseToken.symbol,
      name: pair.baseToken.name,
      dexId: pair.dexId || 'uniswap',
      indicative_price_usd: rawPriceUsd,
      entry_price_eth: effectiveEntryPriceEth,
      entry_price_usd: effectiveEntryPriceUsd,
      entry_mcap_usd: pair.fdv || (pair.liquidity?.usd * 2),
      liquidity_usd: pair.liquidity?.usd || 0,
      eth_invested: sizeEth,
      token_amount: tokensBought,
      total_tokens: tokensBought,
      remaining_tokens: tokensBought,
      eth_recovered: 0,
      tp1_executed: false,
      tp2_executed: false,
      entry_time: Date.now(),
      trigger_reason: triggerReason,
      current_price_usd: rawPriceUsd,
      current_price_eth: rawPriceUsd / ethUsd,
      peak_price_usd: rawPriceUsd,
      guaranteed_floor_pct: 0
    };

    this.state.virtual_balance_eth -= sizeEth;
    this.state.open_positions.push(position);
    await this.save();

    console.log(`[RobinhoodEngine] 🏹 BUY executed: ${position.symbol} on Robinhood Chain for ${sizeEth} ETH (Effective: $${effectiveEntryPriceUsd.toFixed(6)})`);

    // Trigger auto-harvesting of early buyers on this token
    this.harvestWinningToken(position.tokenAddress, position.symbol).catch(() => {});

    // Send Rich Telegram Alert
    if (this.telegram) {
      const posUsd = (sizeEth * ethUsd).toFixed(2);
      const mcapStr = Math.round(position.entry_mcap_usd).toLocaleString();
      const liqStr = Math.round(position.liquidity_usd).toLocaleString();

      const alertMsg = `
🏹 <b>[ROBINHOOD CHAIN - SIMULATION BUY] ${position.symbol}</b>

🪙 <b>Token Name:</b> ${position.name}
📍 <b>Contract (EVM):</b> <code>${position.tokenAddress}</code> <i>(tap to copy)</i>
🌐 <b>Network:</b> Robinhood Chain L2 (Arbitrum Orbit / ID 4663)
🏛 <b>DEX:</b> ${position.dexId.toUpperCase()} (v3/v4)

🎯 <b>Signals & Trigger:</b>
• Signal: <b>${triggerReason}</b>
• Pool Liquidity: <b>$${liqStr} USD</b>
• Market Cap (FDV): <b>$${mcapStr} USD</b>
• Capital In: <b>${sizeEth} ETH</b> (~$${posUsd})
• Effective Fill: <code>$${effectiveEntryPriceUsd.toFixed(6)}</code> <i>(1.5% slip + fee accounted)</i>
• Active ETH Cash: <code>${this.state.virtual_balance_eth.toFixed(4)} ETH</code>

🛡 <b>Strategy:</b> Scale-Out TP1 (Principal 100% Back), TP2 (+120%), Moonbag Trailing Stop
⚡ <b>Terminals:</b> <a href="https://dexscreener.com/robinhood/${position.pairAddress}">DexScreener</a> | <a href="https://robinhoodchain.blockscout.com/token/${position.tokenAddress}">Blockscout</a>
      `.trim();
      await this.telegram.sendMessage(alertMsg);
    }

    return position;
  }

  // -------------------------------------------------------------
  // SCALE-OUT TAKE PROFIT (EXACT PRINCIPAL RECOVERY)
  // -------------------------------------------------------------
  async scaleOut(pos, sellFraction, triggerReason, isExactCapitalRecovery = false) {
    if (pos.remaining_tokens <= 0) return;

    let tokensToSell = 0;
    const ethUsd = await getEthPriceUsd();

    if (isExactCapitalRecovery) {
      const targetEthNeeded = Math.max(0, pos.eth_invested - (pos.eth_recovered || 0));
      const targetUsdNeeded = targetEthNeeded * ethUsd;
      const effectiveSellPriceUsd = pos.current_price_usd * (1 - RH_SLIPPAGE_PCT) * (1 - RH_DEX_FEE_PCT);
      tokensToSell = Math.min(pos.remaining_tokens, (targetUsdNeeded + (RH_L2_GAS_ETH * ethUsd)) / effectiveSellPriceUsd);
    } else {
      tokensToSell = Math.min(pos.remaining_tokens, pos.remaining_tokens * sellFraction);
    }

    if (tokensToSell <= 0) return;

    // Realistic execution friction:
    const grossUsd = tokensToSell * pos.current_price_usd * (1 - RH_SLIPPAGE_PCT);
    const netUsd = grossUsd * (1 - RH_DEX_FEE_PCT);
    const ethGained = Math.max(0, (netUsd / ethUsd) - RH_L2_GAS_ETH);

    pos.remaining_tokens -= tokensToSell;
    pos.eth_recovered = (pos.eth_recovered || 0) + ethGained;
    this.state.virtual_balance_eth += ethGained;
    await this.save();

    const pctGained = ((pos.current_price_usd - pos.entry_price_usd) / pos.entry_price_usd) * 100;
    const soldFractionPct = Math.round((tokensToSell / pos.total_tokens) * 100);

    console.log(`[RobinhoodEngine] 🎯 SCALE-OUT executed: ${pos.symbol} | Sold ${soldFractionPct}% of total | Gained: ${ethGained.toFixed(4)} ETH | Total Recovered: ${pos.eth_recovered.toFixed(4)} / ${pos.eth_invested.toFixed(4)} ETH`);

    if (this.telegram) {
      const isRiskFree = pos.eth_recovered >= pos.eth_invested;
      const msg = `
🎯 <b>[ROBINHOOD SCALE-OUT - CAPITAL SECURED!] ${pos.symbol}</b>

📈 <b>Current Gain:</b> <b>+${pctGained.toFixed(1)}%</b>
💰 <b>Partial Exit:</b> <b>${soldFractionPct}%</b> of bag sold <i>(real slip & fee deducted)</i>
💵 <b>ETH Returned to Cash:</b> <b>+${ethGained.toFixed(4)} ETH</b> (~$${(ethGained * ethUsd).toFixed(2)})
💼 <b>Capital Recovered:</b> <b>${pos.eth_recovered.toFixed(4)} / ${pos.eth_invested.toFixed(4)} ETH</b>
${isRiskFree ? '🎉 <b>STATUS: RISK-FREE RIDE!</b> 100% of initial capital has returned to cash balance. Remaining bag is pure profit hunting for the moon!' : ''}
🚀 <b>Remaining Moonbag:</b> <b>${Math.round((pos.remaining_tokens / pos.total_tokens) * 100)}%</b> trailing to ATH!
      `.trim();
      await this.telegram.sendMessage(msg);
    }
  }

  async updatePositionPrices() {
    if (this.state.open_positions.length === 0) return;

    for (const pos of [...this.state.open_positions]) {
      try {
        const pair = await this.fetchTokenPair(pos.tokenAddress);
        if (!pair) continue;

        const currentPriceUsd = parseFloat(pair.priceUsd) || pos.current_price_usd;
        const ethUsd = await getEthPriceUsd();
        const currentPriceEth = parseFloat(pair.priceNative) || (currentPriceUsd / ethUsd);

        pos.current_price_usd = currentPriceUsd;
        pos.current_price_eth = currentPriceEth;

        if (currentPriceUsd > pos.peak_price_usd) {
          pos.peak_price_usd = currentPriceUsd;
        }

        const pnlPct = ((currentPriceUsd - pos.entry_price_usd) / pos.entry_price_usd) * 100;
        const tpTarget = this.config.take_profit_pct || 120.0;
        const tp1TriggerPct = Math.min(60.0, tpTarget * 0.5);

        // 1. Scale-Out TP1: Return 100% of initial capital
        if (!pos.tp1_executed && pnlPct >= tp1TriggerPct) {
          pos.tp1_executed = true;
          pos.guaranteed_floor_pct = 15.0;
          await this.scaleOut(pos, 0.50, `Scale-Out TP1 (+${pnlPct.toFixed(1)}%)`, true);
        }

        // 2. Scale-Out TP2: At configured Take Profit, sell 50% of remaining bag
        if (!pos.tp2_executed && pnlPct >= tpTarget) {
          pos.tp2_executed = true;
          pos.guaranteed_floor_pct = 50.0;
          await this.scaleOut(pos, 0.50, `Scale-Out TP2 (+${pnlPct.toFixed(1)}%)`, false);
        }

        // 3. Guaranteed Floor Check
        if (pos.guaranteed_floor_pct > 0 && pnlPct <= pos.guaranteed_floor_pct) {
          await this.closePosition(pos.id, currentPriceUsd, `Profit Floor Lock (+${pos.guaranteed_floor_pct}%)`);
          continue;
        }

        // 4. Stop Loss (if TP1 not executed yet)
        const slThreshold = -(this.config.stop_loss_pct || 25.0);
        if (!pos.tp1_executed && pnlPct <= slThreshold) {
          await this.closePosition(pos.id, currentPriceUsd, `Stop Loss (${pnlPct.toFixed(1)}%)`);
          continue;
        }

        // 5. Dynamic Trailing Stop for Moonbag
        if (this.config.trailing_stop_enabled) {
          const peakPnlPct = ((pos.peak_price_usd - pos.entry_price_usd) / pos.entry_price_usd) * 100;
          if (peakPnlPct >= (this.config.trailing_stop_activation_pct || 40.0)) {
            const drawdownFromPeak = ((pos.peak_price_usd - currentPriceUsd) / pos.peak_price_usd) * 100;
            const allowedPullback = pos.tp1_executed ? 25.0 : (this.config.trailing_stop_callback_pct || 20.0);
            if (drawdownFromPeak >= allowedPullback) {
              await this.closePosition(pos.id, currentPriceUsd, `Trailing Moonbag (+${pnlPct.toFixed(1)}% from ATH +${peakPnlPct.toFixed(1)}%)`);
              continue;
            }
          }
        }
      } catch {
        // quiet fallback
      }
    }
  }

  async closePosition(positionId, exitPriceUsd, reason) {
    const index = this.state.open_positions.findIndex(p => p.id === positionId);
    if (index === -1) return null;

    const pos = this.state.open_positions[index];
    const ethUsd = await getEthPriceUsd();
    const finalPriceUsd = exitPriceUsd || pos.current_price_usd;

    // Realistic friction on close:
    const remainingTokens = pos.remaining_tokens !== undefined ? pos.remaining_tokens : pos.token_amount;
    const grossUsd = remainingTokens * finalPriceUsd * (1 - RH_SLIPPAGE_PCT);
    const netUsd = grossUsd * (1 - RH_DEX_FEE_PCT);
    const finalEthReturned = Math.max(0, (netUsd / ethUsd) - RH_L2_GAS_ETH);
    const totalEthReturned = (pos.eth_recovered || 0) + finalEthReturned;

    const realizedPnlEth = totalEthReturned - pos.eth_invested;
    const realizedPnlPct = (realizedPnlEth / pos.eth_invested) * 100;
    const peakPnlPct = ((pos.peak_price_usd - pos.entry_price_usd) / pos.entry_price_usd) * 100;
    const holdSec = Math.floor((Date.now() - pos.entry_time) / 1000);

    this.state.virtual_balance_eth += finalEthReturned;
    this.state.open_positions.splice(index, 1);

    const closedRecord = {
      id: pos.id,
      chainId: 'robinhood',
      tokenAddress: pos.tokenAddress,
      symbol: pos.symbol,
      name: pos.name,
      entry_price_usd: pos.entry_price_usd,
      exit_price_usd: finalPriceUsd,
      eth_invested: pos.eth_invested,
      eth_returned: totalEthReturned,
      realized_pnl_eth: realizedPnlEth,
      realized_pnl_pct: realizedPnlPct,
      entry_time: pos.entry_time,
      exit_time: Date.now(),
      holding_seconds: holdSec,
      exit_reason: reason
    };

    this.state.closed_trades.push(closedRecord);
    await this.save();

    console.log(`[RobinhoodEngine] SELL executed: ${pos.symbol} on RH Chain | PnL: ${realizedPnlEth.toFixed(4)} ETH (${realizedPnlPct.toFixed(2)}%) | Reason: ${reason}`);

    // Send Rich Telegram alert
    if (this.telegram) {
      const isWin = realizedPnlEth >= 0;
      const sign = isWin ? '+' : '';
      const icon = isWin ? '🎯' : '🛑';
      const durMins = Math.floor(holdSec / 60);
      const durSecs = holdSec % 60;
      const durStr = `${durMins}m ${durSecs}s`;

      const totalClosed = this.state.closed_trades.length;
      const wins = this.state.closed_trades.filter(t => t.realized_pnl_eth > 0).length;
      const losses = totalClosed - wins;
      const winRate = totalClosed > 0 ? ((wins / totalClosed) * 100).toFixed(1) : '0.0';

      const alertMsg = `
${icon} <b>[ROBINHOOD CHAIN - ${isWin ? 'PROFIT' : 'LOSS'}] ${pos.symbol}</b>

🪙 <b>Token:</b> ${pos.name}
📍 <b>Contract (EVM):</b> <code>${pos.tokenAddress}</code>

📋 <b>Execution Reason:</b> <b>${reason}</b>

📈 <b>Trade Results:</b>
• Total Realized PnL: <b>${sign}${realizedPnlEth.toFixed(4)} ETH (${sign}${realizedPnlPct.toFixed(2)}%)</b> (~${sign}$${(realizedPnlEth * ethUsd).toFixed(2)})
• Initial Capital: <code>${pos.eth_invested.toFixed(4)} ETH</code> ➜ Total Returned: <code>${totalEthReturned.toFixed(4)} ETH</code>
• Peak ATH: <code>+${peakPnlPct.toFixed(1)}%</code>
• Holding Time: <b>${durStr}</b>

💼 <b>Updated Robinhood Portfolio:</b>
• New Cash Balance: <b>${this.state.virtual_balance_eth.toFixed(4)} ETH</b> (~$${(this.state.virtual_balance_eth * ethUsd).toFixed(2)})
• RH Win Rate: <b>${winRate}%</b> (${wins}W / ${losses}L from ${totalClosed} trades)

⚡ <b>Charts:</b> <a href="https://dexscreener.com/robinhood/${pos.pairAddress}">DexScreener</a>
      `.trim();
      await this.telegram.sendMessage(alertMsg);
    }

    return closedRecord;
  }
}
