import { checkRugSafety, checkTokenSocials } from './safetyCheck.js';

export class SolanaListener {
  constructor(config, walletManager, paperEngine, telegram) {
    this.config = config;
    this.walletManager = walletManager;
    this.paperEngine = paperEngine;
    this.telegram = telegram;

    this.pumpportalWs = null;
    this.pumpportalConnected = false;

    this.solanaWs = null;
    this.solanaWsConnected = false;

    // Token metadata cache: mint -> { mint, symbol, name, bondingCurveKey, priceSol, mcapSol, creator, uri }
    this.tokenCache = new Map();

    // Confluence tracker: mint -> [ { wallet, tag, time } ]
    this.confluenceMap = new Map();

    // Mapping for account subscriptions to prevent cross-contamination:
    // reqId -> { bondingCurveKey, mint }
    this.pendingCurveReqs = new Map();
    // subId (number) -> { bondingCurveKey, mint }
    this.subIdToCurve = new Map();
    // bondingCurveKey -> { mint, reqId, subId }
    this.curveSubscriptions = new Map();

    // Tracked smart wallets for WS logs: wallet -> reqId
    this.walletSubscriptions = new Map();

    this.running = false;
  }

  async start() {
    this.running = true;
    this.connectPumpPortal();
    this.connectSolanaWs();

    // Fallback price poller for open positions every 10 seconds
    setInterval(() => this.pollOpenPositionPrices(), 10000);
  }

  stop() {
    this.running = false;
    if (this.pumpportalWs) {
      try { this.pumpportalWs.close(); } catch {}
    }
    if (this.solanaWs) {
      try { this.solanaWs.close(); } catch {}
    }
  }

  // -------------------------------------------------------------
  // 1. PumpPortal WebSocket: Stream New Token Creations
  // -------------------------------------------------------------
  connectPumpPortal() {
    if (!this.running) return;
    const url = process.env.PUMPPORTAL_WSS_URL || 'wss://pumpportal.fun/api/data';
    console.log(`[PumpPortal] Connecting to ${url}...`);

    try {
      this.pumpportalWs = new WebSocket(url);

      this.pumpportalWs.onopen = () => {
        this.pumpportalConnected = true;
        console.log('[PumpPortal] Connected! Subscribing to new tokens & migrations...');
        this.pumpportalWs.send(JSON.stringify({ method: 'subscribeNewToken' }));
        this.pumpportalWs.send(JSON.stringify({ method: 'subscribeMigration' }));
      };

      this.pumpportalWs.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.mint) {
            if (data.txType === 'migrate' || data.type === 'migration') {
              await this.handleMigrationEvent(data);
            } else {
              await this.handleNewToken(data);
            }
          }
        } catch (err) {
          // ignore parsing error
        }
      };

      this.pumpportalWs.onclose = () => {
        this.pumpportalConnected = false;
        console.log('[PumpPortal] Disconnected. Reconnecting in 5s...');
        setTimeout(() => this.connectPumpPortal(), 5000);
      };

      this.pumpportalWs.onerror = (err) => {
        console.error('[PumpPortal] WS Error:', err?.message || err);
      };
    } catch (err) {
      console.error('[PumpPortal] Init error:', err.message);
      setTimeout(() => this.connectPumpPortal(), 5000);
    }
  }

  async handleMigrationEvent(data) {
    const mint = data.mint;
    if (!mint) return;
    console.log(`[PumpPortal] 🎓 Token Graduated/Migrated to Raydium/PumpSwap: ${mint}`);
    const cached = this.tokenCache.get(mint);

    // If we have an open position on this token, execute full exit at bonding curve graduation price (~85 SOL mcap)
    const openPos = this.paperEngine.getState().open_positions.find(p => p.mint === mint);
    if (openPos) {
      const graduationPrice = 7.9e-8; // ~85 SOL market cap graduation
      console.log(`[PumpSwap] 🚀 Position ${openPos.symbol} completed bonding curve graduation! Locking in max profit!`);
      await this.paperEngine.closePosition(openPos.id, graduationPrice, 'Raydium/PumpSwap Graduation Complete (+100% Curve Fill)');
    }

    // Harvest early buyers and creator for winning token
    if (cached && cached.creator) {
      await this.walletManager.recordWinningTokenEarlyBuyer(cached.creator, mint, cached.symbol, true);
    }
    this.harvestEarlyBuyersFromChain(mint, cached?.symbol || 'PUMP').catch(() => {});
  }

  async harvestEarlyBuyersFromChain(mint, symbol) {
    if (!mint) return;
    try {
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignaturesForAddress',
          params: [mint, { limit: 15 }]
        })
      });
      const json = await res.json();
      const sigs = json?.result || [];

      // Process earliest signatures
      for (const item of sigs.slice(-6)) {
        const tx = await this.fetchTransaction(item.signature);
        const signers = this.extractSigners(tx);
        const buyer = signers[0];
        if (buyer) {
          await this.walletManager.recordWinningTokenEarlyBuyer(buyer, mint, symbol, false);
        }
      }
    } catch {
      // quiet fallback
    }
  }

  async handleNewToken(data) {
    const vTokens = Number(data.vTokensInBondingCurve) || 1073000000;
    const vSol = Number(data.vSolInBondingCurve) || 30.0;
    const priceSol = vTokens > 0 ? (vSol / vTokens) : 2.8e-8;
    const mcapSol = data.marketCapSol || (priceSol * 1e9);

    const info = {
      mint: data.mint,
      symbol: data.symbol || 'PUMP',
      name: data.name || 'Pump Token',
      bondingCurveKey: data.bondingCurveKey,
      creator: data.traderPublicKey,
      uri: data.uri || '',
      vSol,
      vTokens,
      priceSol,
      mcapSol,
      timestamp: Date.now()
    };

    this.tokenCache.set(data.mint, info);
    if (this.tokenCache.size > 2000) {
      const oldestKey = this.tokenCache.keys().next().value;
      this.tokenCache.delete(oldestKey);
    }

    // If creator is a smart wallet, we track it but DO NOT blindly self-ape
    // to protect against dev rug traps and honeypots. We wait for outside smart wallet confirmation!
    if (this.walletManager.isSmartWallet(data.traderPublicKey)) {
      const walletInfo = this.walletManager.getWallet(data.traderPublicKey);
      console.log(`[SmartMoney] 🔍 Smart Wallet Deployer created token: ${data.traderPublicKey} (${walletInfo.tag}) for ${info.symbol}. Waiting for independent buyer confirmation.`);
    }
  }

  // -------------------------------------------------------------
  // 2. Solana WebSocket: Monitor Smart Wallets & Bonding Curves
  // -------------------------------------------------------------
  connectSolanaWs() {
    if (!this.running) return;
    const url = process.env.SOLANA_WSS_URL || 'wss://api.mainnet-beta.solana.com';
    console.log(`[SolanaWS] Connecting to ${url}...`);

    try {
      this.solanaWs = new WebSocket(url);

      this.solanaWs.onopen = () => {
        this.solanaWsConnected = true;
        console.log('[SolanaWS] Connected to Solana Mainnet WebSocket!');
        this.subscribeTopSmartWallets();
        this.refreshActiveBondingCurveSubscriptions();
      };

      this.solanaWs.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle subscription confirmation responses
          if (data.id && this.pendingCurveReqs.has(data.id)) {
            const meta = this.pendingCurveReqs.get(data.id);
            const subId = data.result;
            if (typeof subId === 'number') {
              this.subIdToCurve.set(subId, meta);
              const existing = this.curveSubscriptions.get(meta.bondingCurveKey);
              if (existing) existing.subId = subId;
              console.log(`[SolanaWS] ✅ Bound subId ${subId} to curve ${meta.bondingCurveKey.slice(0, 8)} (${meta.mint.slice(0, 8)})`);
            }
            this.pendingCurveReqs.delete(data.id);
            return;
          }

          // Handle account notifications (Bonding Curve price updates with strict mapping)
          if (data.method === 'accountNotification') {
            this.handleAccountNotification(data);
          }
          // Handle logs notifications (Smart wallet trades)
          else if (data.method === 'logsNotification') {
            await this.handleLogsNotification(data);
          }
        } catch (err) {
          // ignore
        }
      };

      this.solanaWs.onclose = () => {
        this.solanaWsConnected = false;
        console.log('[SolanaWS] Disconnected. Reconnecting in 5s...');
        this.curveSubscriptions.clear();
        this.subIdToCurve.clear();
        this.pendingCurveReqs.clear();
        this.walletSubscriptions.clear();
        setTimeout(() => this.connectSolanaWs(), 5000);
      };

      this.solanaWs.onerror = (err) => {
        console.error('[SolanaWS] WS Error:', err?.message || err);
      };
    } catch (err) {
      console.error('[SolanaWS] Init error:', err.message);
      setTimeout(() => this.connectSolanaWs(), 5000);
    }
  }

  subscribeTopSmartWallets() {
    if (!this.solanaWsConnected) return;
    const topWallets = this.walletManager.getTop(35);
    console.log(`[SolanaWS] Subscribing to live logs for top ${topWallets.length} smart wallets...`);

    topWallets.forEach((w, idx) => {
      const reqId = 1000 + idx;
      this.solanaWs.send(JSON.stringify({
        jsonrpc: '2.0',
        id: reqId,
        method: 'logsSubscribe',
        params: [
          { mentions: [w.address] },
          { commitment: 'processed' }
        ]
      }));
      this.walletSubscriptions.set(w.address, reqId);
    });
  }

  // Robust Signer Extraction (Legacy + Versioned 0)
  extractSigners(tx) {
    const signers = [];
    const msg = tx?.transaction?.message;
    if (!msg) return signers;

    if (Array.isArray(msg.accountKeys)) {
      const numReq = msg.header?.numRequiredSignatures || 1;
      msg.accountKeys.forEach((k, i) => {
        if (typeof k === 'object') {
          if (k.signer) signers.push(k.pubkey);
        } else if (typeof k === 'string' && i < numReq) {
          signers.push(k);
        }
      });
    } else if (Array.isArray(msg.staticAccountKeys)) {
      const numReq = msg.header?.numRequiredSignatures || 1;
      for (let i = 0; i < numReq && i < msg.staticAccountKeys.length; i++) {
        const k = msg.staticAccountKeys[i];
        signers.push(typeof k === 'string' ? k : k.pubkey);
      }
    }
    return signers;
  }

  async handleLogsNotification(data) {
    const val = data?.params?.result?.value;
    if (!val || val.err) return;

    const signature = val.signature;
    const logs = val.logs || [];

    // Check if it relates to Pump.fun program
    const isPumpTrade = logs.some(l => l.includes('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'));
    if (!isPumpTrade) return;

    const isBuy = logs.some(l => l.includes('Instruction: Buy'));
    const isSell = logs.some(l => l.includes('Instruction: Sell'));
    if (!isBuy && !isSell) return;

    try {
      const tx = await this.fetchTransaction(signature);
      if (!tx || !tx.meta) return;

      const postBalances = tx.meta.postTokenBalances || [];
      const preBalances = tx.meta.preTokenBalances || [];

      // Find token mint whose balance changed
      let mint = null;
      for (const p of postBalances) {
        if (p.mint && p.mint !== 'So11111111111111111111111111111111111111112') {
          const preMatch = preBalances.find(b => b.accountIndex === p.accountIndex);
          const preAmt = preMatch?.uiTokenAmount?.uiAmount || 0;
          const postAmt = p.uiTokenAmount?.uiAmount || 0;
          if (preAmt !== postAmt) {
            mint = p.mint;
            break;
          }
        }
      }

      if (!mint) {
        const anyEntry = [...postBalances, ...preBalances].find(b => b.mint && b.mint !== 'So11111111111111111111111111111111111111112');
        mint = anyEntry?.mint;
      }
      if (!mint) return;

      const signers = this.extractSigners(tx);
      const primarySigner = signers[0] || '';

      // 🚨 CASE 1: SELL TRANSACTION (WHALE EXIT & DEV DUMP MIRROR)
      if (isSell) {
        const openPos = this.paperEngine.getState().open_positions.find(p => p.mint === mint);
        if (openPos) {
          // Check Dev / Creator Dump
          const isCreatorDump = signers.includes(openPos.creator) || (openPos.creator && primarySigner === openPos.creator);
          if (isCreatorDump) {
            console.log(`[DevDump] 🚨 CREATOR ${openPos.creator} DUMPED token ${openPos.symbol}! Fetching fresh quote for exit...`);
            let freshPrice = openPos.current_price_sol;
            if (openPos.bondingCurveKey) {
              const freshCurve = await this.getBondingCurveData(openPos.bondingCurveKey);
              if (freshCurve && freshCurve.priceSol > 0) {
                freshPrice = freshCurve.priceSol;
              }
            }
            await this.paperEngine.closePosition(openPos.id, freshPrice, `Dev Dump Protection (Creator dumped)`);
            return;
          }

          // Check Smart Wallet Exit
          const smartSigner = signers.find(s => s === openPos.trigger_wallet || this.walletManager.isSmartWallet(s));
          if (smartSigner) {
            const preBal = preBalances.find(b => b.owner === smartSigner && b.mint === mint)?.uiTokenAmount?.uiAmount || 0;
            const postBal = postBalances.find(b => b.owner === smartSigner && b.mint === mint)?.uiTokenAmount?.uiAmount || 0;
            const soldTokens = Math.max(0, preBal - postBal);
            const pctSold = preBal > 0 ? (soldTokens / preBal) : 1.0;

            let freshPrice = openPos.current_price_sol;
            if (openPos.bondingCurveKey) {
              const freshCurve = await this.getBondingCurveData(openPos.bondingCurveKey);
              if (freshCurve && freshCurve.priceSol > 0) freshPrice = freshCurve.priceSol;
            }

            if (pctSold >= 0.75) {
              console.log(`[WhaleExit] 🚨 Smart Wallet ${smartSigner} DUMPED ALL (${Math.round(pctSold * 100)}%) of ${openPos.symbol}! Full mirror exit!`);
              await this.paperEngine.closePosition(openPos.id, freshPrice, `Whale Full Exit (${smartSigner.slice(0, 6)}... sold ${Math.round(pctSold * 100)}%)`);
            } else {
              console.log(`[WhaleTrim] ✂️ Smart Wallet ${smartSigner} trimmed ${Math.round(pctSold * 100)}% of ${openPos.symbol}! Executing proportional scale out!`);
              await this.paperEngine.scaleOut(openPos, pctSold, `Whale Proportional Trim (${Math.round(pctSold * 100)}%)`, false);
            }
            return;
          }
        }
        return;
      }

      // 🟢 CASE 2: BUY TRANSACTION
      if (isBuy) {
        const smartBuyer = signers.find(s => this.walletManager.isSmartWallet(s));
        if (!smartBuyer) return;

        // Isolate exact SOL spent by smartBuyer (excluding gas if fee payer)
        let signerIdx = -1;
        const msg = tx.transaction?.message;
        const keys = msg?.accountKeys || msg?.staticAccountKeys || [];
        signerIdx = keys.findIndex(k => (typeof k === 'object' ? k.pubkey : k) === smartBuyer);

        let solSpent = 0;
        if (signerIdx !== -1) {
          const preSol = tx.meta?.preBalances?.[signerIdx] || 0;
          const postSol = tx.meta?.postBalances?.[signerIdx] || 0;
          const fee = (signerIdx === 0 ? (tx.meta?.fee || 0) : 0);
          solSpent = Math.max(0, (preSol - postSol - fee) / 1e9);
        }

        const minConviction = this.config.min_whale_buy_sol || 0.20;
        if (solSpent > 0 && solSpent < minConviction) {
          console.log(`[ConvictionFilter] ⚠️ Skipping smart wallet ${smartBuyer.slice(0, 6)} buy: ${solSpent.toFixed(3)} SOL < ${minConviction} SOL minimum threshold.`);
          return;
        }

        const walletInfo = this.walletManager.getWallet(smartBuyer);
        console.log(`[SmartMoney] 🎯 High Conviction Smart Wallet BUY: ${smartBuyer} spent ${solSpent.toFixed(3)} SOL on ${mint}`);

        let tokenInfo = this.tokenCache.get(mint);
        const bondingAccount = postBalances.find(b => b.owner && b.owner !== smartBuyer)?.owner;

        let liveCurve = null;
        if (bondingAccount) {
          liveCurve = await this.getBondingCurveData(bondingAccount);
        }

        if (!tokenInfo) {
          tokenInfo = {
            mint,
            symbol: 'PUMP',
            name: 'Pump.fun Token',
            bondingCurveKey: bondingAccount || '',
            priceSol: liveCurve ? liveCurve.priceSol : 2.8e-8,
            mcapSol: liveCurve ? liveCurve.mcapSol : 28.0,
            timestamp: Date.now()
          };
          this.tokenCache.set(mint, tokenInfo);
        } else if (liveCurve) {
          tokenInfo.priceSol = liveCurve.priceSol;
          tokenInfo.mcapSol = liveCurve.mcapSol;
        }

        await this.handleSmartWalletSignal(smartBuyer, walletInfo.tag, tokenInfo, 'smart_buy');
      }
    } catch (err) {
      console.error('[SolanaWS] Error parsing trade tx:', err.message);
    }
  }

  async fetchTransaction(signature) {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [
          signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
        ]
      })
    });
    const json = await res.json();
    return json.result;
  }

  async getBondingCurveData(bondingCurveKey) {
    if (!bondingCurveKey) return null;
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [bondingCurveKey, { encoding: 'base64' }]
        })
      });
      const json = await res.json();
      const b64 = json?.result?.value?.data?.[0];
      if (b64) {
        const buf = Buffer.from(b64, 'base64');
        if (buf.length >= 24) {
          const vTokens = Number(buf.readBigUInt64LE(8)) / 1e6;
          const vSol = Number(buf.readBigUInt64LE(16)) / 1e9;
          if (vTokens > 0) {
            const priceSol = vSol / vTokens;
            const mcapSol = priceSol * 1e9;
            return { vTokens, vSol, priceSol, mcapSol };
          }
        }
      }
    } catch {
      // quiet fallback
    }
    return null;
  }

  // -------------------------------------------------------------
  // 3. Multi-Wallet Confluence & Entry Handler
  // -------------------------------------------------------------
  async handleSmartWalletSignal(walletAddress, walletTag, tokenInfo, signalType) {
    const mint = tokenInfo.mint;
    const now = Date.now();
    const windowMs = (this.config.confluence_window_seconds || 120) * 1000;

    if (!this.confluenceMap.has(mint)) {
      this.confluenceMap.set(mint, []);
    }

    const buys = this.confluenceMap.get(mint);
    const recent = buys.filter(b => now - b.time <= windowMs);
    recent.push({ wallet: walletAddress, tag: walletTag, time: now, type: signalType });
    this.confluenceMap.set(mint, recent);

    const uniqueWallets = Array.from(new Set(recent.map(b => b.wallet)));
    console.log(`[Confluence] Token ${mint.slice(0, 8)} has ${uniqueWallets.length} smart wallet signal(s) in window.`);

    let shouldTrade = false;
    if (this.config.confluence_required) {
      shouldTrade = uniqueWallets.length >= 2;
    } else {
      shouldTrade = true;
    }

    if (shouldTrade) {
      // Check minimum real reserve liquidity in SOL
      const minLiq = this.config.min_liquidity_sol || 25.0;
      const reserveSol = tokenInfo.vSol || (tokenInfo.mcapSol ? tokenInfo.mcapSol * 0.35 : 0);
      if (reserveSol < minLiq) {
        console.log(`[LiquidityFilter] ⚠️ Skipping ${tokenInfo.symbol}: reserve liquidity ${reserveSol.toFixed(1)} SOL below min threshold (${minLiq} SOL).`);
        return;
      }

      // 🛡 RugCheck Safety Radar & Socials Check in Parallel
      const [safety, socials] = await Promise.all([
        checkRugSafety(mint, this.config),
        checkTokenSocials(tokenInfo.uri)
      ]);

      if (!safety.safe) {
        console.log(`[RugCheck] 🛑 Token ${tokenInfo.symbol} (${mint.slice(0, 8)}) REJECTED: ${safety.reason}`);
        if (this.telegram) {
          await this.telegram.sendMessage(`🛡 <b>[RUGCHECK SHIELD] Token Blocked!</b>\n\nToken: <b>${tokenInfo.symbol}</b> (<code>${mint}</code>)\nReason: <i>${safety.reason}</i>\n<i>Bot avoided potential scam/rugpull!</i>`);
        }
        return;
      }

      let tierInfo = this.walletManager.getWalletTier(walletAddress);

      // If RugCheck was unverified or token has no socials, reduce position sizing multiplier to scout level
      if (safety.unverified || !socials.hasSocials) {
        tierInfo = {
          tier: 'C',
          multiplier: Math.min(tierInfo.multiplier, 0.5),
          name: `${tierInfo.name} (Scout Sizing - ${safety.unverified ? 'Unverified RugCheck' : 'No Socials'})`
        };
      }

      const pos = await this.paperEngine.openPosition(
        tokenInfo,
        walletAddress,
        uniqueWallets.length > 1 ? `Confluence (${uniqueWallets.length} Wallets)` : walletTag,
        tierInfo
      );

      if (pos && pos.bondingCurveKey) {
        this.subscribeBondingCurve(pos.bondingCurveKey, pos.mint);
      }
    }
  }

  // -------------------------------------------------------------
  // 4. Live Bonding Curve Subscriptions for Open Positions
  // -------------------------------------------------------------
  refreshActiveBondingCurveSubscriptions() {
    const openPos = this.paperEngine.getState().open_positions;
    for (const pos of openPos) {
      if (pos.bondingCurveKey) {
        this.subscribeBondingCurve(pos.bondingCurveKey, pos.mint);
      }
    }
  }

  subscribeBondingCurve(bondingCurveKey, mint) {
    if (!this.solanaWsConnected || !bondingCurveKey) return;
    if (this.curveSubscriptions.has(bondingCurveKey)) return;

    const reqId = 5000 + Math.floor(Math.random() * 4000);
    this.pendingCurveReqs.set(reqId, { bondingCurveKey, mint });
    this.curveSubscriptions.set(bondingCurveKey, { mint, reqId, subId: null });

    this.solanaWs.send(JSON.stringify({
      jsonrpc: '2.0',
      id: reqId,
      method: 'accountSubscribe',
      params: [
        bondingCurveKey,
        { encoding: 'base64', commitment: 'processed' }
      ]
    }));

    console.log(`[SolanaWS] Subscribed to bonding curve ${bondingCurveKey.slice(0, 8)}... (reqId: ${reqId}) for token ${mint.slice(0, 8)}`);
  }

  handleAccountNotification(data) {
    const subId = data?.params?.subscription;
    if (typeof subId !== 'number') return;

    // Strict Subscription-to-Token Routing: Prevents price contamination across positions!
    const curveMeta = this.subIdToCurve.get(subId);
    if (!curveMeta) return;

    const rawData = data?.params?.result?.value?.data?.[0];
    if (!rawData) return;

    try {
      const buf = Buffer.from(rawData, 'base64');
      if (buf.length < 48) return;

      const vTokens = Number(buf.readBigUInt64LE(8)) / 1e6;
      const vSol = Number(buf.readBigUInt64LE(16)) / 1e9;
      if (vTokens <= 0) return;

      const priceSol = vSol / vTokens;
      const mcapSol = priceSol * 1e9;

      // Update ONLY the exact token linked to this subscription ID!
      this.paperEngine.updatePrice(curveMeta.mint, priceSol, mcapSol);
    } catch (err) {
      // ignore
    }
  }

  // Fallback poller for active open positions
  async pollOpenPositionPrices() {
    const openPos = this.paperEngine.getState().open_positions;
    if (openPos.length === 0) return;

    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

    for (const pos of openPos) {
      if (!pos.bondingCurveKey) continue;
      try {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getAccountInfo',
            params: [
              pos.bondingCurveKey,
              { encoding: 'base64' }
            ]
          })
        });
        const json = await res.json();
        const b64 = json?.result?.value?.data?.[0];
        if (b64) {
          const buf = Buffer.from(b64, 'base64');
          const vTokens = Number(buf.readBigUInt64LE(8)) / 1e6;
          const vSol = Number(buf.readBigUInt64LE(16)) / 1e9;
          if (vTokens > 0) {
            const priceSol = vSol / vTokens;
            const mcapSol = priceSol * 1e9;
            await this.paperEngine.updatePrice(pos.mint, priceSol, mcapSol);
          }
        }
      } catch (err) {
        // quiet fallback
      }
    }
  }
}
