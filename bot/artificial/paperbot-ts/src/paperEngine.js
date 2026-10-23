import path from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteJson, safeReadJson } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '../data/state.json');

// REALISTIC PAPER TRADING EXECUTION FRICTION
const SOL_NETWORK_FEE = 0.0015; // 0.0015 SOL base fee + Jito priority tip
const PROTOCOL_FEE_PCT = 0.010; // 1.0% Pump.fun / DEX protocol fee
const SLIPPAGE_PCT = 0.020;     // 2.0% realistic slippage on micro-caps

let cachedSolPrice = 103.0;
let lastSolPriceFetch = 0;

export async function getSolPriceUsd() {
  const now = Date.now();
  if (now - lastSolPriceFetch < 60000) return cachedSolPrice;
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
    if (res.ok) {
      const data = await res.json();
      const p = parseFloat(data.price);
      if (p > 0) {
        cachedSolPrice = p;
        lastSolPriceFetch = now;
      }
    }
  } catch {
    // quiet fallback
  }
  return cachedSolPrice;
}

export class PaperTradingEngine {
  constructor(config, telegram, walletManager = null) {
    this.config = config;
    this.telegram = telegram;
    this.walletManager = walletManager;
    this.state = {
      initial_balance_sol: config.initial_balance_sol || 0.5,
      virtual_balance_sol: config.initial_balance_sol || 0.5,
      open_positions: [],
      closed_trades: []
    };
  }

  async init() {
    const loaded = await safeReadJson(STATE_FILE, null);
    if (loaded && loaded.__corrupted) {
      console.error(`[PaperEngine] 🚨 CORRUPT STATE DETECTED! Entering Safe Mode.`);
      this.safeMode = true;
      if (this.telegram) {
        await this.telegram.sendMessage(`🚨 <b>SYSTEM SAFE MODE ACTIVATED</b>\n\nState file corrupted and safely quarantined to:\n<code>${loaded.quarantinePath}</code>\nTrading is paused to protect balance.`);
      }
      return;
    }

    if (loaded && typeof loaded.virtual_balance_sol === 'number') {
      this.state = loaded;
      console.log(`[PaperEngine] Loaded state: ${this.state.virtual_balance_sol.toFixed(4)} SOL, ${this.state.open_positions.length} open positions.`);
    } else {
      console.log('[PaperEngine] Initializing fresh state...');
      await this.save();
    }

    // Start background monitor for stale positions & safety checks every 30s
    setInterval(() => this.checkStalePositions(), 30000);
  }

  getState() {
    return this.state;
  }

  async save() {
    try {
      await atomicWriteJson(STATE_FILE, this.state);
    } catch (err) {
      console.error('[PaperEngine] Failed to save state atomically:', err.message);
    }
  }

  calculatePositionSize(tierMultiplier = 1.0) {
    const safetyFloor = this.config.safety_net_floor_sol || 0.08;
    const avail = Math.max(0, this.state.virtual_balance_sol - safetyFloor - 0.005);
    if (avail < 0.02) return 0; // Strictly prevent trading if available balance < 0.02 SOL

    let size = 0;
    if (this.config.compounding_enabled) {
      const basePct = (this.config.position_pct_of_balance || 25.0) / 100;
      const pct = Math.min(0.35, basePct * (tierMultiplier || 1.0));
      const remainingSlots = Math.max(1, (this.config.max_open_positions || 3) - this.state.open_positions.length);
      const maxPerSlot = avail / remainingSlots;
      size = Math.min(avail * pct, maxPerSlot);
    } else {
      size = (this.config.position_size_sol || 0.05) * (tierMultiplier || 1.0);
    }

    // Strict ceiling: Never exceed avail
    size = Math.min(size, avail);
    size = Math.round(size * 1000) / 1000;
    return size >= 0.02 ? size : 0;
  }

  canOpenPosition(mint, mcapSol = 30) {
    if (this.safeMode) return false;
    if (!this.config.trading_enabled) return false;
    if (this.state.open_positions.length >= (this.config.max_open_positions || 3)) return false;

    // Safety Net: Never let balance drop below safety floor + buffer
    const safetyFloor = this.config.safety_net_floor_sol || 0.08;
    if (this.state.virtual_balance_sol <= safetyFloor + 0.02) return false;

    // Don't open duplicate position for the same token
    if (this.state.open_positions.some(p => p.mint === mint)) return false;

    // Anti-FOMO: Never buy if bonding curve is already near completion (>65 SOL)
    if (mcapSol && mcapSol > (this.config.max_entry_mcap_sol || 65.0)) return false;
    return true;
  }

  async openPosition({ mint, symbol, name, bondingCurveKey, creator, priceSol, mcapSol, vSol }, triggerWallet, triggerTag, tierInfo = null) {
    if (!this.canOpenPosition(mint, mcapSol)) return null;

    const multiplier = tierInfo?.multiplier || 1.0;
    const sizeSol = this.calculatePositionSize(multiplier);
    if (sizeSol <= 0) return null;

    // Apply realistic bonding curve price impact (x * y = k) & execution friction:
    // Marginal impact = sizeSol / (poolSol + sizeSol)
    const poolSol = Number(vSol) || (mcapSol ? mcapSol * 0.35 : 30.0);
    const dynamicImpactPct = Math.min(0.20, sizeSol / (poolSol + sizeSol));
    const effectiveEntryPrice = priceSol * (1 + dynamicImpactPct + SLIPPAGE_PCT);

    // Net SOL available for token purchase after 1% DEX fee and 0.0015 SOL gas/tip
    const netSolForTokens = Math.max(0.001, (sizeSol * (1 - PROTOCOL_FEE_PCT)) - SOL_NETWORK_FEE);
    const tokensBought = netSolForTokens / effectiveEntryPrice;
    const solUsd = await getSolPriceUsd();

    const position = {
      id: `POS_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      mint,
      symbol: symbol || 'UNKNOWN',
      name: name || 'Pump.fun Token',
      bondingCurveKey: bondingCurveKey || '',
      creator: creator || '',
      indicative_entry_price_sol: priceSol,
      entry_price_sol: effectiveEntryPrice,
      entry_mcap_sol: mcapSol || 30.0,
      sol_invested: sizeSol,
      token_amount: tokensBought,
      total_tokens: tokensBought,
      remaining_tokens: tokensBought,
      sol_recovered: 0,
      tp1_executed: false,
      tp2_executed: false,
      entry_time: Date.now(),
      trigger_wallet: triggerWallet,
      trigger_tag: triggerTag || 'smart_money',
      trigger_tier: tierInfo?.name || 'Standard',
      current_price_sol: priceSol,
      current_val_sol: sizeSol,
      peak_price_sol: priceSol,
      guaranteed_floor_pct: 0
    };

    this.state.virtual_balance_sol -= sizeSol;
    this.state.open_positions.push(position);
    await this.save();

    console.log(`[PaperEngine] BUY executed: ${position.symbol} (${position.mint}) for ${sizeSol} SOL (Effective: ${effectiveEntryPrice.toExponential(4)} SOL after slippage & fees)`);

    // Send Rich Telegram alert
    if (this.telegram) {
      const posUsd = (sizeSol * solUsd).toFixed(2);
      const mcapUsd = Math.round(position.entry_mcap_sol * solUsd).toLocaleString();
      const curvePct = Math.min(100, (position.entry_mcap_sol / 85 * 100)).toFixed(1);

      let walletDetails = '';
      if (this.walletManager) {
        const wInfo = this.walletManager.getWallet(triggerWallet);
        if (wInfo && wInfo.winrate_7d) {
          walletDetails = `\n   └ <i>History: WR ${wInfo.winrate_7d}% | 7d Profit: +$${(wInfo.profit_7d_usd || 0).toLocaleString()}</i>`;
        }
      }

      const alertMsg = `
🟢 <b>[SIMULATION BUY] ${position.symbol}</b>

🪙 <b>Token:</b> ${position.name}
📍 <b>CA:</b> <code>${position.mint}</code> <i>(tap to copy)</i>

🎯 <b>Smart Money Trigger:</b>
• Wallet: <code>${triggerWallet}</code>
• Tier / Tag: <b>${position.trigger_tier || triggerTag}</b>${walletDetails}

📊 <b>Entry Metrics:</b>
• Raw Price: <code>${priceSol.toExponential(4)} SOL</code>
• Effective Fill: <code>${effectiveEntryPrice.toExponential(4)} SOL</code> <i>(2% slip + fee accounted)</i>
• Market Cap: <b>${position.entry_mcap_sol.toFixed(1)} SOL</b> (~$${mcapUsd})
• Curve Progress: <b>${curvePct}%</b>
• Capital In: <b>${sizeSol} SOL</b> (~$${posUsd})
• Active Cash Balance: <code>${this.state.virtual_balance_sol.toFixed(4)} SOL</code>

🛡 <b>Strategy:</b> Scale-Out TP1 (Principal 100% Back), TP2 (+120%), Moonbag Trailing Stop
⚡ <b>Terminals:</b> <a href="https://pump.fun/${position.mint}">Pump.fun</a> | <a href="https://dexscreener.com/solana/${position.mint}">DexScreener</a>
      `.trim();
      await this.telegram.sendMessage(alertMsg);
    }

    return position;
  }

  // -------------------------------------------------------------
  // SCALE-OUT TAKE PROFIT (PRO WHALE STRATEGY)
  // -------------------------------------------------------------
  async scaleOut(pos, sellFraction, triggerReason, isExactCapitalRecovery = false) {
    if (pos.remaining_tokens <= 0) return;

    let tokensToSell = 0;

    if (isExactCapitalRecovery) {
      // Mathematically calculate the exact tokens needed to return 100% of remaining principal!
      const targetSolNeeded = Math.max(0, pos.sol_invested - pos.sol_recovered);
      const effectiveSellPricePerToken = pos.current_price_sol * (1 - SLIPPAGE_PCT) * (1 - PROTOCOL_FEE_PCT);
      tokensToSell = Math.min(pos.remaining_tokens, Math.ceil((targetSolNeeded + SOL_NETWORK_FEE) / effectiveSellPricePerToken));
    } else {
      // Proportional trim from REMAINING tokens
      tokensToSell = Math.min(pos.remaining_tokens, pos.remaining_tokens * sellFraction);
    }

    if (tokensToSell <= 0) return;

    // Realistic execution friction on sell:
    const grossSol = tokensToSell * pos.current_price_sol * (1 - SLIPPAGE_PCT);
    const solGained = Math.max(0, (grossSol * (1 - PROTOCOL_FEE_PCT)) - SOL_NETWORK_FEE);

    pos.remaining_tokens -= tokensToSell;
    pos.sol_recovered += solGained;
    this.state.virtual_balance_sol += solGained;
    await this.save();

    const solUsd = await getSolPriceUsd();
    const pctGained = ((pos.current_price_sol - pos.entry_price_sol) / pos.entry_price_sol) * 100;
    const soldFractionPct = Math.round((tokensToSell / pos.total_tokens) * 100);

    console.log(`[PaperEngine] 🎯 SCALE-OUT executed: ${pos.symbol} | Sold ${soldFractionPct}% of total | Gained: ${solGained.toFixed(4)} SOL | Total Recovered: ${pos.sol_recovered.toFixed(4)} / ${pos.sol_invested.toFixed(4)} SOL`);

    if (this.telegram) {
      const isRiskFree = pos.sol_recovered >= pos.sol_invested;
      const msg = `
🎯 <b>[SCALE-OUT - CAPITAL SECURED!] ${pos.symbol}</b>

📈 <b>Current Gain:</b> <b>+${pctGained.toFixed(1)}%</b>
💰 <b>Partial Exit:</b> <b>${soldFractionPct}%</b> of bag sold <i>(real slip & fee deducted)</i>
💵 <b>Net SOL Returned:</b> <b>+${solGained.toFixed(4)} SOL</b> (~$${(solGained * solUsd).toFixed(2)})
💼 <b>Capital Recovered:</b> <b>${pos.sol_recovered.toFixed(4)} / ${pos.sol_invested.toFixed(4)} SOL</b>
${isRiskFree ? '🎉 <b>STATUS: RISK-FREE RIDE!</b> 100% of initial capital has returned to cash balance. Remaining bag is pure profit hunting for the moon!' : ''}
🚀 <b>Remaining Moonbag:</b> <b>${Math.round((pos.remaining_tokens / pos.total_tokens) * 100)}%</b> trailing to ATH!
      `.trim();
      await this.telegram.sendMessage(msg);
    }
  }

  async updatePrice(mint, newPriceSol, newMcapSol) {
    const pos = this.state.open_positions.find(p => p.mint === mint);
    if (!pos) return;

    pos.current_price_sol = newPriceSol;
    pos.current_val_sol = pos.remaining_tokens * newPriceSol;
    if (newPriceSol > pos.peak_price_sol) {
      pos.peak_price_sol = newPriceSol;
    }

    const pnlPct = ((newPriceSol - pos.entry_price_sol) / pos.entry_price_sol) * 100;
    const tpTarget = this.config.take_profit_pct || 120.0;
    const tp1TriggerPct = Math.min(70.0, tpTarget * 0.5);

    // 1. Scale-Out TP1: Return 100% of initial capital
    if (!pos.tp1_executed && pnlPct >= tp1TriggerPct) {
      pos.tp1_executed = true;
      pos.guaranteed_floor_pct = 15.0; // Floor locked at +15%
      await this.scaleOut(pos, 0.50, `Scale-Out TP1 (+${pnlPct.toFixed(1)}%)`, true);
    }

    // 2. Scale-Out TP2: At configured Take Profit, sell 50% of remaining bag
    if (!pos.tp2_executed && pnlPct >= tpTarget) {
      pos.tp2_executed = true;
      pos.guaranteed_floor_pct = 50.0; // Floor locked at +50%
      await this.scaleOut(pos, 0.50, `Scale-Out TP2 (+${pnlPct.toFixed(1)}%)`, false);
    }

    // 3. Check Guaranteed Floor (for remaining tokens)
    if (pos.guaranteed_floor_pct > 0 && pnlPct <= pos.guaranteed_floor_pct) {
      await this.closePosition(pos.id, newPriceSol, `Profit Floor Lock (+${pos.guaranteed_floor_pct}%)`);
      return;
    }

    // 4. Stop Loss Target (if TP1 not executed yet)
    const slThreshold = -(this.config.stop_loss_pct || 25.0);
    if (!pos.tp1_executed && pnlPct <= slThreshold) {
      await this.closePosition(pos.id, newPriceSol, `Stop Loss (${pnlPct.toFixed(1)}%)`);
      return;
    }

    // 5. Dynamic Trailing Stop for Moonbag (remaining tokens)
    if (this.config.trailing_stop_enabled) {
      const peakPnlPct = ((pos.peak_price_sol - pos.entry_price_sol) / pos.entry_price_sol) * 100;
      if (peakPnlPct >= (this.config.trailing_stop_activation_pct || 40.0)) {
        const drawdownFromPeak = ((pos.peak_price_sol - newPriceSol) / pos.peak_price_sol) * 100;
        const allowedPullback = pos.tp1_executed ? 25.0 : (this.config.trailing_stop_callback_pct || 20.0);
        if (drawdownFromPeak >= allowedPullback) {
          await this.closePosition(pos.id, newPriceSol, `Trailing Moonbag (+${pnlPct.toFixed(1)}% from ATH +${peakPnlPct.toFixed(1)}%)`);
          return;
        }
      }
    }
  }

  async closePosition(positionId, exitPriceSol, reason) {
    const index = this.state.open_positions.findIndex(p => p.id === positionId);
    if (index === -1) return null;

    const pos = this.state.open_positions[index];
    const finalPrice = exitPriceSol || pos.current_price_sol;

    // Realistic execution friction on close:
    const grossSol = pos.remaining_tokens * finalPrice * (1 - SLIPPAGE_PCT);
    const solReturnedFinal = Math.max(0, (grossSol * (1 - PROTOCOL_FEE_PCT)) - SOL_NETWORK_FEE);
    const totalSolReturned = pos.sol_recovered + solReturnedFinal;
    const realizedPnlSol = totalSolReturned - pos.sol_invested;
    const realizedPnlPct = (realizedPnlSol / pos.sol_invested) * 100;
    const peakPnlPct = ((pos.peak_price_sol - pos.entry_price_sol) / pos.entry_price_sol) * 100;
    const holdSec = Math.floor((Date.now() - pos.entry_time) / 1000);

    const solUsd = await getSolPriceUsd();
    const pnlUsd = (realizedPnlSol * solUsd).toFixed(2);

    this.state.virtual_balance_sol += solReturnedFinal;
    this.state.open_positions.splice(index, 1);

    const closedRecord = {
      id: pos.id,
      mint: pos.mint,
      symbol: pos.symbol,
      name: pos.name,
      entry_price_sol: pos.entry_price_sol,
      exit_price_sol: finalPrice,
      sol_invested: pos.sol_invested,
      sol_returned: totalSolReturned,
      realized_pnl_sol: realizedPnlSol,
      realized_pnl_pct: realizedPnlPct,
      entry_time: pos.entry_time,
      exit_time: Date.now(),
      holding_seconds: holdSec,
      exit_reason: reason
    };

    this.state.closed_trades.push(closedRecord);
    await this.save();

    console.log(`[PaperEngine] SELL executed: ${pos.symbol} | Net PnL: ${realizedPnlSol.toFixed(4)} SOL (${realizedPnlPct.toFixed(2)}%) | Reason: ${reason}`);

    // Send Rich Telegram alert
    if (this.telegram) {
      const isWin = realizedPnlSol >= 0;
      const sign = isWin ? '+' : '';
      const icon = isWin ? '🎯' : '🛑';

      const totalClosed = this.state.closed_trades.length;
      const wins = this.state.closed_trades.filter(t => t.realized_pnl_sol > 0).length;
      const losses = totalClosed - wins;
      const winRate = totalClosed > 0 ? ((wins / totalClosed) * 100).toFixed(1) : '0.0';

      const durMins = Math.floor(holdSec / 60);
      const durSecs = holdSec % 60;
      const durStr = `${durMins}m ${durSecs}s`;

      const alertMsg = `
${icon} <b>[SIMULATION SELL - ${isWin ? 'PROFIT' : 'LOSS'}] ${pos.symbol}</b>

🪙 <b>Token:</b> ${pos.name}
📍 <b>CA:</b> <code>${pos.mint}</code> <i>(tap to copy)</i>

📋 <b>Execution Reason:</b> <b>${reason}</b>

📈 <b>Trade Results:</b>
• Total Realized PnL: <b>${sign}${realizedPnlSol.toFixed(4)} SOL (${sign}${realizedPnlPct.toFixed(2)}%)</b> (~${sign}$${pnlUsd})
• Initial Capital: <code>${pos.sol_invested.toFixed(4)} SOL</code> ➜ Total Returned: <code>${totalSolReturned.toFixed(4)} SOL</code>
• Peak ATH: <code>+${peakPnlPct.toFixed(1)}%</code>
• Holding Time: <b>${durStr}</b>

💼 <b>Updated Portfolio:</b>
• New Cash Balance: <b>${this.state.virtual_balance_sol.toFixed(4)} SOL</b> (~$${(this.state.virtual_balance_sol * solUsd).toFixed(2)})
• Bot Win Rate: <b>${winRate}%</b> (${wins}W / ${losses}L from ${totalClosed} trades)

⚡ <b>Charts:</b> <a href="https://dexscreener.com/solana/${pos.mint}">DexScreener</a> | <a href="https://pump.fun/${pos.mint}">Pump.fun</a>
      `.trim();
      await this.telegram.sendMessage(alertMsg);
    }

    return closedRecord;
  }

  async closeAllPositions(reason = 'Manual close all') {
    const list = [...this.state.open_positions];
    for (const pos of list) {
      await this.closePosition(pos.id, pos.current_price_sol, reason);
    }
    return list.length;
  }

  async checkStalePositions() {
    const maxHoldMs = (this.config.max_holding_time_minutes || 60) * 60 * 1000;
    const watchdogSec = this.config.velocity_watchdog_seconds || 45;
    const watchdogDropPct = this.config.velocity_exit_drop_pct || 8.0;
    const now = Date.now();

    for (const pos of [...this.state.open_positions]) {
      const holdSec = Math.floor((now - pos.entry_time) / 1000);

      // 1. Volume Velocity Watchdog:
      if (!pos.tp1_executed && holdSec >= watchdogSec) {
        const pnlPct = ((pos.current_price_sol - pos.entry_price_sol) / pos.entry_price_sol) * 100;
        const peakPct = ((pos.peak_price_sol - pos.entry_price_sol) / pos.entry_price_sol) * 100;
        if (peakPct < 10.0 && pnlPct <= -watchdogDropPct) {
          console.log(`[Watchdog] 🐕 Exiting stagnant token ${pos.symbol} (no volume after ${holdSec}s, PnL: ${pnlPct.toFixed(1)}%)`);
          await this.closePosition(pos.id, pos.current_price_sol, `Velocity Watchdog (Stagnant after ${holdSec}s)`);
          continue;
        }
      }

      // 2. Max Time Limit Check:
      if (now - pos.entry_time >= maxHoldMs) {
        console.log(`[PaperEngine] Closing stale position for ${pos.symbol} (> ${this.config.max_holding_time_minutes} mins)`);
        await this.closePosition(pos.id, pos.current_price_sol, 'Time Limit (Stale Position)');
      }
    }
  }
}
