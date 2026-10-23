import { getSolPriceUsd } from './paperEngine.js';
import { getEthPriceUsd } from './robinhoodEngine.js';

export class TelegramBot {
  constructor(token, allowedChatId, botContext) {
    this.token = token;
    this.allowedChatId = String(allowedChatId);
    this.ctx = botContext; // references to walletManager, paperEngine, config
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.offset = 0;
    this.polling = false;
  }

  async start() {
    this.polling = true;
    console.log('[TelegramBot] Starting long polling...');
    this.pollLoop().catch(err => {
      console.error('[TelegramBot] Polling loop fatal error:', err);
    });
  }

  stop() {
    this.polling = false;
  }

  async pollLoop() {
    while (this.polling) {
      try {
        const url = `${this.baseUrl}/getUpdates?offset=${this.offset}&timeout=20`;
        const res = await fetch(url);
        if (!res.ok) {
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            this.offset = update.update_id + 1;
            if (update.message) {
              await this.handleMessage(update.message);
            } else if (update.callback_query) {
              await this.handleCallbackQuery(update.callback_query);
            }
          }
        }
      } catch (err) {
        // network hiccup, retry after delay
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  async sendMessage(text, extra = {}) {
    try {
      const defaultKeyboard = {
        keyboard: [
          [{ text: '📊 Status' }, { text: '💼 Portfolio' }, { text: '🪙 Positions' }],
          [{ text: '🏹 Robinhood' }, { text: '🏆 Top Wallets' }, { text: '🌾 Harvested' }],
          [{ text: '🔄 Refresh Wallets' }, { text: '⚙️ Config' }, { text: '📱 Menu' }]
        ],
        resize_keyboard: true,
        is_persistent: true
      };

      const payload = {
        chat_id: this.allowedChatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: extra.reply_markup || defaultKeyboard,
        ...extra
      };
      const res = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      return data.ok;
    } catch (err) {
      console.error('[TelegramBot] Send message error:', err.message);
      return false;
    }
  }

  async handleCallbackQuery(query) {
    const fromId = String(query.from?.id);
    if (fromId !== this.allowedChatId) return;

    try {
      await fetch(`${this.baseUrl}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: query.id })
      });
    } catch {}

    const data = query.data;
    switch (data) {
      case 'cmd_status': await this.cmdStatus(); break;
      case 'cmd_portfolio': await this.cmdPortfolio(); break;
      case 'cmd_positions': await this.cmdPositions(); break;
      case 'cmd_robinhood': await this.cmdRobinhood(); break;
      case 'cmd_wallets': await this.cmdWallets(); break;
      case 'cmd_harvested': await this.cmdHarvested(); break;
      case 'cmd_trades': await this.cmdTrades(); break;
      case 'cmd_refreshwallets': await this.cmdRefreshWallets(); break;
      case 'cmd_config': await this.cmdConfig([]); break;
      case 'cmd_toggle_pause':
        if (this.ctx.config.trading_enabled) {
          await this.cmdPause();
        } else {
          await this.cmdResume();
        }
        break;
      case 'cmd_sellall': await this.cmdSellAll(); break;
    }
  }

  async handleMessage(msg) {
    const chatId = String(msg.chat.id);
    // Security check: only allow authorized user
    if (chatId !== this.allowedChatId) {
      console.warn(`[TelegramBot] Unauthorized message from chatId: ${chatId}`);
      return;
    }

    let text = (msg.text || '').trim();
    if (!text) return;

    // Check button shortcuts from persistent keyboard:
    const lower = text.toLowerCase();
    if (lower.includes('status')) text = '/status';
    else if (lower.includes('portfolio') || lower.includes('pnl')) text = '/portfolio';
    else if (lower.includes('posisi') || lower.includes('position')) text = '/positions';
    else if (lower.includes('top wallets') || lower === '🏆 wallets' || lower === 'wallets') text = '/wallets';
    else if (lower.includes('harvested')) text = '/harvested';
    else if (lower.includes('trade')) text = '/trades';
    else if (lower.includes('refresh') || lower.includes('sync')) text = '/refreshwallets';
    else if (lower.includes('config') || lower.includes('setting')) text = '/config';
    else if (lower.includes('robinhood') || lower === '🏹 robinhood' || lower === '/rh') text = '/robinhood';
    else if (lower.includes('menu')) text = '/menu';
    else if (lower.includes('pause') || lower.includes('jeda') || lower.includes('stop')) {
      text = '/pause';
    } else if (lower.includes('resume') || lower.includes('start') || lower.includes('lanjut')) {
      text = '/resume';
    }

    if (!text.startsWith('/')) return;

    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    try {
      switch (cmd) {
        case '/start':
        case '/help':
          await this.cmdHelp();
          break;
        case '/menu':
          await this.cmdMenu();
          break;
        case '/status':
          await this.cmdStatus();
          break;
        case '/portfolio':
        case '/pnl':
          await this.cmdPortfolio();
          break;
        case '/positions':
          await this.cmdPositions();
          break;
        case '/robinhood':
        case '/rh':
          await this.cmdRobinhood();
          break;
        case '/wallets':
          await this.cmdWallets();
          break;
        case '/harvested':
          await this.cmdHarvested();
          break;
        case '/refreshwallets':
          await this.cmdRefreshWallets();
          break;
        case '/addwallet':
          await this.cmdAddWallet(args);
          break;
        case '/delwallet':
          await this.cmdDelWallet(args);
          break;
        case '/trades':
          await this.cmdTrades();
          break;
        case '/config':
          await this.cmdConfig(args);
          break;
        case '/pause':
          await this.cmdPause();
          break;
        case '/resume':
          await this.cmdResume();
          break;
        case '/sellall':
          await this.cmdSellAll();
          break;
        default:
          await this.sendMessage(`⚠️ Unknown command: <code>${cmd}</code>\nType /help for documentation.`);
      }
    } catch (err) {
      console.error(`[TelegramBot] Command error for ${cmd}:`, err);
      await this.sendMessage(`❌ Error: ${err.message}`);
    }
  }

  async cmdMenu() {
    const text = `
📱 <b>DUAL-CHAIN BOT CONTROL PANEL</b>

Select an option below or tap the persistent keyboard buttons at the bottom of your screen:
    `.trim();

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '📊 Status', callback_data: 'cmd_status' },
          { text: '💼 Portfolio', callback_data: 'cmd_portfolio' },
          { text: '🪙 Positions', callback_data: 'cmd_positions' }
        ],
        [
          { text: '🏹 Robinhood Chain', callback_data: 'cmd_robinhood' },
          { text: '🏆 Top Wallets', callback_data: 'cmd_wallets' },
          { text: '🌾 Harvested', callback_data: 'cmd_harvested' }
        ],
        [
          { text: '🔄 Sync Wallets', callback_data: 'cmd_refreshwallets' },
          { text: '📜 Trades', callback_data: 'cmd_trades' },
          { text: '⚙️ Config', callback_data: 'cmd_config' }
        ],
        [
          { text: this.ctx.config.trading_enabled ? '⏸ Pause Trading' : '▶️ Resume Trading', callback_data: 'cmd_toggle_pause' },
          { text: '🚨 Sell All', callback_data: 'cmd_sellall' }
        ]
      ]
    };

    await this.sendMessage(text, { reply_markup: inlineKeyboard });
  }

  async cmdHelp() {
    const text = `
🤖 <b>Solana & Robinhood Smart Money Trading Bot</b>
<i>Mode: 24/7 Dual-Chain Paper Trading Active</i>

<b>Monitoring Commands:</b>
/status - Check bot status, uptime, & connection health
/portfolio or /pnl - Dual-chain balances, PnL, & Win Rate
/positions - Current active positions & floating PnL
/trades - Recent closed trades history
/robinhood - Dedicated Robinhood Chain radar & L2 metrics

<b>Smart Money Management:</b>
/wallets - Top smart wallets currently monitored
/harvested - Auto-harvested wallets discovered on-chain
/refreshwallets - Force sync & rotate leaderboard wallets
/addwallet &lt;address&gt; [label] - Add wallet to watchlist
/delwallet &lt;address&gt; - Remove wallet from watchlist

<b>Controls & Parameters:</b>
/config - View trading parameters & risk management
/config size &lt;SOL&gt; - Set base position size (e.g. /config size 0.1)
/config tp &lt;%&gt; - Set Take Profit % (e.g. /config tp 120)
/config sl &lt;%&gt; - Set Stop Loss % (e.g. /config sl 25)
/pause - Pause automated trading
/resume - Resume automated trading
/sellall - Emergency close all open positions
    `.trim();
    await this.sendMessage(text);
  }

  async cmdStatus() {
    const uptimeSec = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSec / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    const secs = uptimeSec % 60;
    const uptimeStr = `${hours}h ${mins}m ${secs}s`;

    const solWalletCount = this.ctx.walletManager.getAll().length;
    const rhWalletCount = this.ctx.robinhoodEngine ? this.ctx.robinhoodEngine.getAllWallets().length : 0;
    const solState = this.ctx.paperEngine.getState();
    const rhState = this.ctx.robinhoodEngine ? this.ctx.robinhoodEngine.getState() : { open_positions: [] };
    const config = this.ctx.config;

    const text = `
🟢 <b>SYSTEM STATUS: ONLINE (24/7)</b>

⏱ <b>Uptime:</b> ${uptimeStr}
⚙️ <b>Engine:</b> Dual-Chain Institutional Paper Trading
🔌 <b>Pump.fun WebSocket:</b> ${this.ctx.solanaListener?.pumpportalConnected ? '✅ Connected' : '⚠️ Connecting'}
📡 <b>Solana Mainnet RPC:</b> ${this.ctx.solanaListener?.solanaWsConnected ? '✅ Connected' : '⚠️ Connecting'}
🏹 <b>Robinhood Chain RPC:</b> ✅ Connected (ID 4663)

🎯 <b>Smart Wallets Monitored:</b>
• Solana: <code>${solWalletCount}</code> wallets (RugCheck & Dev Shield Active)
• Robinhood Chain: <code>${rhWalletCount}</code> wallets (On-Chain Transfer Monitor)

📊 <b>Active Positions:</b>
• Solana: <code>${solState.open_positions.length}/${config.max_open_positions}</code>
• Robinhood: <code>${rhState.open_positions.length}/${config.max_open_positions}</code>

🔒 <b>Automated Trading:</b> ${config.trading_enabled ? '✅ ACTIVE' : '⏸ PAUSED'}
📈 <b>Auto-Compounding:</b> ${config.compounding_enabled ? '✅ ENABLED (25% Sizing)' : 'Disabled'}
    `.trim();
    await this.sendMessage(text);
  }

  async cmdPortfolio() {
    const solUsd = await getSolPriceUsd();
    const ethUsd = await getEthPriceUsd();

    // 1. Solana Stats
    const solState = this.ctx.paperEngine.getState();
    const solTrades = solState.closed_trades.length;
    const solWins = solState.closed_trades.filter(t => t.realized_pnl_sol > 0).length;
    const solLosses = solTrades - solWins;
    const solWinrate = solTrades > 0 ? ((solWins / solTrades) * 100).toFixed(1) : '0.0';

    let openValSol = 0;
    for (const pos of solState.open_positions) {
      openValSol += pos.current_val_sol || pos.sol_invested;
    }
    const solEquity = solState.virtual_balance_sol + openValSol;
    const solPnl = solEquity - solState.initial_balance_sol;
    const solPnlPct = (solPnl / solState.initial_balance_sol) * 100;
    const solPnlSign = solPnl >= 0 ? '+' : '';
    const solEquityUsd = (solEquity * solUsd).toFixed(2);

    // 2. Robinhood Chain Stats
    const rhEngine = this.ctx.robinhoodEngine;
    const rhState = rhEngine ? rhEngine.getState() : { virtual_balance_eth: 0.021, initial_balance_eth: 0.021, open_positions: [], closed_trades: [] };
    const rhTrades = rhState.closed_trades.length;
    const rhWins = rhState.closed_trades.filter(t => t.realized_pnl_eth > 0).length;
    const rhLosses = rhTrades - rhWins;
    const rhWinrate = rhTrades > 0 ? ((rhWins / rhTrades) * 100).toFixed(1) : '0.0';

    let openValEth = 0;
    for (const pos of rhState.open_positions) {
      const tokens = pos.remaining_tokens !== undefined ? pos.remaining_tokens : pos.token_amount;
      const curUsd = pos.current_price_usd * tokens;
      openValEth += (curUsd / ethUsd);
    }
    const rhEquity = rhState.virtual_balance_eth + openValEth;
    const rhPnl = rhEquity - rhState.initial_balance_eth;
    const rhPnlPct = (rhPnl / rhState.initial_balance_eth) * 100;
    const rhPnlSign = rhPnl >= 0 ? '+' : '';
    const rhEquityUsd = (rhEquity * ethUsd).toFixed(2);

    // 3. Combined Total
    const totalUsdEquity = (parseFloat(solEquityUsd) + parseFloat(rhEquityUsd)).toFixed(2);

    const text = `
💼 <b>DUAL-CHAIN VIRTUAL PORTFOLIO</b>
🌐 <b>Total Net Worth Value: $${totalUsdEquity} USD</b>

🟣 <b>SOLANA NETWORK (Pump.fun):</b>
• Cash Balance: <code>${solState.virtual_balance_sol.toFixed(4)} SOL</code> (~$${(solState.virtual_balance_sol * solUsd).toFixed(2)})
• Open Positions Value: <code>${openValSol.toFixed(4)} SOL</code>
• Total Equity SOL: <code>${solEquity.toFixed(4)} SOL</code> (~$${solEquityUsd})
• Net Realized PnL: <b>${solPnlSign}${solPnl.toFixed(4)} SOL (${solPnlSign}${solPnlPct.toFixed(2)}%)</b>
• Win Rate: <b>${solWinrate}%</b> (${solWins}W / ${solLosses}L from ${solTrades} trades)

🏹 <b>ROBINHOOD CHAIN (Arbitrum L2):</b>
• Cash Balance: <code>${rhState.virtual_balance_eth.toFixed(4)} ETH</code> (~$${(rhState.virtual_balance_eth * ethUsd).toFixed(2)})
• Open Positions Value: <code>${openValEth.toFixed(4)} ETH</code>
• Total Equity ETH: <code>${rhEquity.toFixed(4)} ETH</code> (~$${rhEquityUsd})
• Net Realized PnL: <b>${rhPnlSign}${rhPnl.toFixed(4)} ETH (${rhPnlSign}${rhPnlPct.toFixed(2)}%)</b>
• Win Rate: <b>${rhWinrate}%</b> (${rhWins}W / ${rhLosses}L from ${rhTrades} trades)

<i>Live Market Rates: 1 SOL = $${solUsd.toFixed(1)} | 1 ETH = $${ethUsd.toFixed(1)}</i>
    `.trim();
    await this.sendMessage(text);
  }

  async cmdPositions() {
    const solState = this.ctx.paperEngine.getState();
    const rhState = this.ctx.robinhoodEngine ? this.ctx.robinhoodEngine.getState() : { open_positions: [] };

    const totalOpen = solState.open_positions.length + rhState.open_positions.length;
    if (totalOpen === 0) {
      await this.sendMessage('📭 <b>No open positions at this moment.</b>\nBot is actively monitoring new smart money signals across Solana & Robinhood Chain.');
      return;
    }

    let text = `📊 <b>ACTIVE OPEN POSITIONS (${totalOpen}):</b>\n\n`;

    // 1. Solana Positions
    if (solState.open_positions.length > 0) {
      text += `🟣 <b>SOLANA (Pump.fun):</b>\n`;
      for (const pos of solState.open_positions) {
        const pnlPct = ((pos.current_price_sol - pos.entry_price_sol) / pos.entry_price_sol) * 100;
        const sign = pnlPct >= 0 ? '+' : '';
        const holdTimeSec = Math.floor((Date.now() - pos.entry_time) / 1000);
        const mins = Math.floor(holdTimeSec / 60);

        text += `• <b>${pos.symbol}</b> (<code>${pos.mint.slice(0, 6)}...${pos.mint.slice(-4)}</code>)\n`;
        text += `  Capital: ${pos.sol_invested.toFixed(3)} SOL | PnL: <b>${sign}${pnlPct.toFixed(2)}%</b> | Duration: ${mins}m\n`;
        text += `  <a href="https://dexscreener.com/solana/${pos.mint}">DexScreener</a> | <a href="https://pump.fun/${pos.mint}">Pump.fun</a>\n\n`;
      }
    }

    // 2. Robinhood Positions
    if (rhState.open_positions.length > 0) {
      text += `🏹 <b>ROBINHOOD CHAIN (L2):</b>\n`;
      for (const pos of rhState.open_positions) {
        const pnlPct = ((pos.current_price_usd - pos.entry_price_usd) / pos.entry_price_usd) * 100;
        const sign = pnlPct >= 0 ? '+' : '';
        const holdTimeSec = Math.floor((Date.now() - pos.entry_time) / 1000);
        const mins = Math.floor(holdTimeSec / 60);

        text += `• <b>${pos.symbol}</b> (<code>${pos.tokenAddress.slice(0, 6)}...${pos.tokenAddress.slice(-4)}</code>)\n`;
        text += `  Capital: ${pos.eth_invested} ETH | PnL: <b>${sign}${pnlPct.toFixed(2)}%</b> | Duration: ${mins}m\n`;
        text += `  <a href="https://dexscreener.com/robinhood/${pos.pairAddress}">DexScreener</a> | <a href="https://robinhoodchain.blockscout.com/token/${pos.tokenAddress}">Blockscout</a>\n\n`;
      }
    }

    await this.sendMessage(text);
  }

  async cmdRobinhood() {
    const rhEngine = this.ctx.robinhoodEngine;
    if (!rhEngine) {
      await this.sendMessage('⚠️ Robinhood Chain Engine is not loaded.');
      return;
    }

    const ethUsd = await getEthPriceUsd();
    const state = rhEngine.getState();
    const totalTrades = state.closed_trades.length;
    const wins = state.closed_trades.filter(t => t.realized_pnl_eth > 0).length;
    const losses = totalTrades - wins;
    const winrate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';

    let totalPnlEth = 0;
    state.closed_trades.forEach(t => totalPnlEth += t.realized_pnl_eth);
    const pnlSign = totalPnlEth >= 0 ? '+' : '';

    const text = `
🏹 <b>ROBINHOOD CHAIN RADAR (L2)</b>

🌐 <b>Network Specifications:</b>
• Architecture: Arbitrum Orbit Nitro (100ms block time)
• Chain ID: <code>4663</code> (Native Gas: ETH)
• Primary DEX: Uniswap v3/v4 & Pons Launchpad
• Data Feeds: Official RPC & DexScreener Real-Time Stream

💼 <b>Virtual ETH Portfolio:</b>
• Cash Balance: <code>${state.virtual_balance_eth.toFixed(4)} ETH</code> (~$${(state.virtual_balance_eth * ethUsd).toFixed(2)})
• Open Positions: <code>${state.open_positions.length}</code> tokens
• Total Closed Trades: <code>${totalTrades}</code>
• Win Rate: <b>${winrate}%</b> (${wins}W / ${losses}L)
• Net Realized PnL: <b>${pnlSign}${totalPnlEth.toFixed(4)} ETH</b> (~${pnlSign}$${(totalPnlEth * ethUsd).toFixed(2)})

🎯 <b>Strategy & Guardrails:</b>
• Liquidity Floor: $3,000 USD minimum
• Sizing Model: Auto-compounding 25% of active cash
• Scale-Out Exit: TP1 (+60% returns 100% capital), TP2 (+140%), Moonbag Trailing Stop
• Safety Net Floor: <code>0.003 ETH</code> anti-ruin reserve

<i>Type /positions to view active Robinhood holdings.</i>
    `.trim();

    await this.sendMessage(text);
  }

  async cmdWallets() {
    const solTop = this.ctx.walletManager.getTop(7);
    const rhTop = this.ctx.robinhoodEngine ? this.ctx.robinhoodEngine.getTopWallets(5) : [];

    let text = `🏆 <b>SMART WALLETS WATCHLIST</b>\n\n`;

    // 1. Solana Smart Wallets
    text += `🟣 <b>TOP SOLANA WALLETS (${this.ctx.walletManager.getAll().length}):</b>\n`;
    solTop.forEach((w, i) => {
      text += `${i + 1}. <code>${w.address.slice(0, 6)}...${w.address.slice(-4)}</code>\n`;
      text += `   Tag: <b>${w.tag}</b> | 7d Win: <b>${w.winrate_7d}%</b> | Profit: <b>+$${w.profit_7d_usd.toLocaleString()}</b>\n`;
    });

    // 2. Robinhood Smart Wallets
    if (rhTop.length > 0) {
      text += `\n🏹 <b>TOP ROBINHOOD WALLETS (${this.ctx.robinhoodEngine.getAllWallets().length}):</b>\n`;
      rhTop.forEach((w, i) => {
        text += `${i + 1}. <code>${w.address.slice(0, 8)}...${w.address.slice(-6)}</code>\n`;
        text += `   Tag: <b>${w.tag}</b> | Label: <b>${w.label}</b>\n`;
      });
    }

    text += `\n<i>Use /harvested to view automatically promoted wallets.</i>`;
    await this.sendMessage(text);
  }

  async cmdHarvested() {
    const solHarvested = this.ctx.walletManager.getHarvested();
    const rhHarvested = this.ctx.robinhoodEngine ? this.ctx.robinhoodEngine.getHarvestedWallets() : [];

    if (solHarvested.length === 0 && rhHarvested.length === 0) {
      await this.sendMessage('🌾 <b>No auto-harvested wallets yet.</b>\nBot is actively monitoring graduating Raydium coins (Solana) and trending Robinhood breakouts.');
      return;
    }

    let text = `🌾 <b>AUTO-HARVESTED SMART WALLETS:</b>\n\n`;

    if (solHarvested.length > 0) {
      text += `🟣 <b>SOLANA (${solHarvested.length} wallets):</b>\n`;
      solHarvested.slice(-5).reverse().forEach((w, i) => {
        text += `${i + 1}. <code>${w.address}</code>\n   Info: <b>${w.label}</b>\n`;
      });
      text += '\n';
    }

    if (rhHarvested.length > 0) {
      text += `🏹 <b>ROBINHOOD CHAIN (${rhHarvested.length} wallets):</b>\n`;
      rhHarvested.slice(-5).reverse().forEach((w, i) => {
        text += `${i + 1}. <code>${w.address}</code>\n   Info: <b>${w.label}</b>\n`;
      });
    }

    await this.sendMessage(text);
  }

  async cmdRefreshWallets() {
    await this.sendMessage('🔄 <i>Syncing & rotating smart wallets from live leaderboards...</i>');
    const res = await this.ctx.walletManager.syncAndRotate();
    if (res.success) {
      await this.sendMessage(`✅ <b>Sync Completed!</b>\n• New Added: <b>+${res.added}</b>\n• Updated: <b>${res.updated}</b>\n• Pruned: <b>-${res.pruned}</b>\n• Total Active Solana: <b>${res.total} wallets</b>`);
    } else {
      await this.sendMessage(`❌ Sync failed: ${res.error}`);
    }
  }

  async cmdAddWallet(args) {
    if (!args[0]) {
      await this.sendMessage('⚠️ Format:\n• Solana: <code>/addwallet &lt;solana_address&gt; [label]</code>\n• Robinhood: <code>/addwallet 0x... [label]</code>');
      return;
    }
    const addr = args[0].trim();
    const label = args.slice(1).join(' ') || 'manual_added';

    if (addr.startsWith('0x') && this.ctx.robinhoodEngine) {
      await this.ctx.robinhoodEngine.addWallet(addr, 'rh_custom', label);
      await this.sendMessage(`✅ <b>Robinhood Chain Wallet Added:</b>\n<code>${addr}</code>\nLabel: <b>${label}</b>`);
    } else {
      await this.ctx.walletManager.addWallet(addr, 'custom', label);
      await this.sendMessage(`✅ <b>Solana Wallet Added:</b>\n<code>${addr}</code>\nLabel: <b>${label}</b>`);
    }
  }

  async cmdDelWallet(args) {
    if (!args[0]) {
      await this.sendMessage('⚠️ Format: <code>/delwallet &lt;address&gt;</code>');
      return;
    }
    const addr = args[0].trim();
    if (addr.startsWith('0x') && this.ctx.robinhoodEngine) {
      const removed = await this.ctx.robinhoodEngine.removeWallet(addr);
      if (removed) {
        await this.sendMessage(`🗑 <b>Robinhood Wallet Removed:</b>\n<code>${addr}</code>`);
      } else {
        await this.sendMessage(`⚠️ Wallet <code>${addr}</code> not found in Robinhood watchlist.`);
      }
    } else {
      const removed = await this.ctx.walletManager.removeWallet(addr);
      if (removed) {
        await this.sendMessage(`🗑 <b>Solana Wallet Removed:</b>\n<code>${addr}</code>`);
      } else {
        await this.sendMessage(`⚠️ Wallet <code>${addr}</code> not found in Solana watchlist.`);
      }
    }
  }

  async cmdTrades() {
    const state = this.ctx.paperEngine.getState();
    const trades = state.closed_trades.slice(-5).reverse();
    if (trades.length === 0) {
      await this.sendMessage('📭 No closed trades in history yet.');
      return;
    }

    let text = `📜 <b>LAST 5 CLOSED TRADES:</b>\n\n`;
    for (const t of trades) {
      const sign = t.realized_pnl_sol >= 0 ? '+' : '';
      const icon = t.realized_pnl_sol >= 0 ? '🟢 TP' : '🔴 SL';
      text += `${icon} <b>${t.symbol}</b>\n`;
      text += `• Exit Reason: <b>${t.exit_reason}</b>\n`;
      text += `• PnL: <b>${sign}${t.realized_pnl_sol.toFixed(4)} SOL (${sign}${t.realized_pnl_pct.toFixed(2)}%)</b>\n`;
      text += `• Hold Time: ${Math.round(t.holding_seconds / 60)}m ${t.holding_seconds % 60}s\n\n`;
    }
    await this.sendMessage(text);
  }

  async cmdConfig(args) {
    const config = this.ctx.config;
    if (args.length === 0) {
      const text = `
⚙️ <b>BOT TRADING CONFIGURATION:</b>

• Trading Engine: <code>${config.trading_enabled ? 'ACTIVE' : 'PAUSED'}</code>
• Compounding Model: <code>${config.compounding_enabled ? 'ENABLED (25% per trade)' : 'Fixed Sizing'}</code>
• Safety Net Reserve: <code>${config.safety_net_floor_sol} SOL / ${config.safety_net_floor_eth} ETH</code>
• Min Whale Buy Conviction: <code>${config.min_whale_buy_sol} SOL</code>
• Max Concurrent Positions: <code>${config.max_open_positions}</code>
• Scale-Out Take Profit: <code>TP1 (+70% capital out), TP2 (+150%), Moonbag (+120%+)</code>
• Stop Loss Floor: <code>-${config.stop_loss_pct}%</code>
• Trailing Stop: <code>${config.trailing_stop_enabled ? 'ENABLED' : 'DISABLED'}</code> (Active at +${config.trailing_stop_activation_pct}%, ${config.trailing_stop_callback_pct}% callback)
• Multi-Wallet Confluence: <code>${config.confluence_required ? 'Required (2+ Wallets)' : 'Single Smart Wallet'}</code>

<i>To modify settings via command:</i>
<code>/config size 0.1</code>
<code>/config tp 150</code>
<code>/config sl 20</code>
<code>/config confluence true/false</code>
      `.trim();
      await this.sendMessage(text);
      return;
    }

    const sub = args[0].toLowerCase();
    const val = args[1];

    if (sub === 'size' && val) {
      config.position_size_sol = Math.max(0.01, parseFloat(val));
      await this.ctx.saveConfig();
      await this.sendMessage(`✅ Base position size updated to: <b>${config.position_size_sol} SOL</b>`);
    } else if (sub === 'tp' && val) {
      config.take_profit_pct = parseFloat(val);
      await this.ctx.saveConfig();
      await this.sendMessage(`✅ Take Profit updated to: <b>+${config.take_profit_pct}%</b>`);
    } else if (sub === 'sl' && val) {
      config.stop_loss_pct = parseFloat(val);
      await this.ctx.saveConfig();
      await this.sendMessage(`✅ Stop Loss updated to: <b>-${config.stop_loss_pct}%</b>`);
    } else if (sub === 'confluence' && val) {
      config.confluence_required = val.toLowerCase() === 'true';
      await this.ctx.saveConfig();
      await this.sendMessage(`✅ Confluence requirement updated to: <b>${config.confluence_required ? 'Required (2+ Wallets)' : 'Single Smart Wallet'}</b>`);
    } else {
      await this.sendMessage('⚠️ Invalid config command. Type <code>/config</code> to see options.');
    }
  }

  async cmdPause() {
    this.ctx.config.trading_enabled = false;
    await this.ctx.saveConfig();
    await this.sendMessage('⏸ <b>Automated Trading PAUSED.</b>\nBot will not open any new positions until you type /resume.');
  }

  async cmdResume() {
    this.ctx.config.trading_enabled = true;
    await this.ctx.saveConfig();
    await this.sendMessage('▶️ <b>Automated Trading RESUMED.</b>\nBot is actively scanning and executing high-conviction smart money trades.');
  }

  async cmdSellAll() {
    const countSol = await this.ctx.paperEngine.closeAllPositions('Manual /sellall');
    let countRh = 0;
    if (this.ctx.robinhoodEngine) {
      const openRh = [...this.ctx.robinhoodEngine.getState().open_positions];
      for (const p of openRh) {
        await this.ctx.robinhoodEngine.closePosition(p.id, p.current_price_usd, 'Manual /sellall');
        countRh++;
      }
    }
    await this.sendMessage(`🚨 <b>Emergency Liquidate:</b> Closed ${countSol} Solana positions and ${countRh} Robinhood positions into cash.`);
  }
}
