import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { WalletManager } from './walletScraper.js';
import { TelegramBot } from './telegram.js';
import { PaperTradingEngine } from './paperEngine.js';
import { SolanaListener } from './solanaListener.js';
import { RobinhoodEngine } from './robinhoodEngine.js';

import { atomicWriteJson, safeReadJson } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, '../config.json');

async function loadConfig() {
  return await safeReadJson(CONFIG_FILE, {});
}

async function saveConfig(config) {
  await atomicWriteJson(CONFIG_FILE, config);
}

async function main() {
  console.log('==================================================');
  console.log(' 🚀 Starting Solana Smart Money Bot (Pump.fun)');
  console.log(' Mode: Paper Trading (Phase 1 & Phase 2)');
  console.log('==================================================');

  const config = await loadConfig();

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env');
    process.exit(1);
  }

  // 1. Initialize Smart Wallet Manager (Phase 1)
  const walletManager = new WalletManager();
  await walletManager.init();

  // 2. Initialize Telegram Bot
  const botContext = {
    config,
    walletManager,
    saveConfig: async () => saveConfig(config)
  };
  const telegram = new TelegramBot(token, chatId, botContext);
  walletManager.telegram = telegram;

  // 3. Initialize Paper Trading Engine (Phase 2)
  const paperEngine = new PaperTradingEngine(config, telegram, walletManager);
  await paperEngine.init();

  botContext.paperEngine = paperEngine;

  // 4. Initialize Solana & Pump.fun Listeners
  const solanaListener = new SolanaListener(config, walletManager, paperEngine, telegram);
  botContext.solanaListener = solanaListener;

  // 5. Initialize Robinhood Chain L2 Engine
  const robinhoodEngine = new RobinhoodEngine(config, telegram);
  await robinhoodEngine.init();
  botContext.robinhoodEngine = robinhoodEngine;

  await solanaListener.start();
  robinhoodEngine.start();
  await telegram.start();

  // Send startup notification to user on Telegram
  const startupMsg = `
🚀 <b>DUAL-CHAIN BOT ONLINE: SOLANA & ROBINHOOD CHAIN!</b>

24/7 Automated Institutional Trading Engine is live on your VPS.

🟣 <b>Solana (Pump.fun):</b>
• Active Cash: <code>${paperEngine.getState().virtual_balance_sol.toFixed(2)} SOL</code>
• Smart Wallets Monitored: <code>${walletManager.getAll().length}</code> verified wallets
• Engine: RugCheck Radar & Smart Wallet Exit Mirror

🏹 <b>Robinhood Chain (Arbitrum L2):</b>
• Active Cash: <code>${robinhoodEngine.getState().virtual_balance_eth.toFixed(4)} ETH</code>
• Monitored DEX: Uniswap v3/v4 & Pons Launchpad
• Sizing Model: Auto-compounding 25% with Safety Floor

Tap buttons below or type /menu for the command center.
  `.trim();

  await telegram.sendMessage(startupMsg);
  console.log('✅ Bot is running live and Telegram startup message sent.');

  // Handle graceful exit
  const shutdown = async (signal) => {
    console.log(`\n[Shutdown] Received ${signal}, saving state and closing connections...`);
    await paperEngine.save();
    await robinhoodEngine.save();
    robinhoodEngine.stop();
    telegram.stop();
    solanaListener.stop();
    await telegram.sendMessage(`⚠️ <b>Bot Paused Temporarily (${signal}).</b> State safely committed to disk.`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('Fatal crash on startup:', err);
  process.exit(1);
});
