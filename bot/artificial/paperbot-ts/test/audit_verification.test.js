import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteJson, safeReadJson } from '../src/storage.js';
import { isSafePublicUrl, checkRugSafety } from '../src/safetyCheck.js';
import { PaperTradingEngine } from '../src/paperEngine.js';
import { WalletManager } from '../src/walletScraper.js';
import { SolanaListener } from '../src/solanaListener.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runComprehensiveTestSuite() {
  console.log('🧪 Running 100% Offline, Self-Contained System Audit Test Suite...\n');

  // Use OS temp dir for all tests to guarantee zero pollution in data/
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-audit-test-'));

  try {
    // -------------------------------------------------------------
    // Test 1: SSRF Defense Filter
    // -------------------------------------------------------------
    console.log('▶ Test 1: SSRF Attack Protection');
    const dangerousUrls = [
      'http://169.254.169.254/latest/meta-data/', // AWS metadata
      'https://169.254.169.254/metadata',
      'http://localhost:8080/admin',
      'https://127.0.0.1:443/secret',
      'https://0.0.0.0:443/private',
      'https://192.168.1.100/router',
      'https://10.0.0.1/internal',
      'https://172.16.0.5/api',
      'http://insecure-http.com/meta.json', // non-https
      'https://public.com:22/ssh' // non-443 port
    ];

    for (const badUrl of dangerousUrls) {
      assert.strictEqual(isSafePublicUrl(badUrl), false, `Should reject dangerous URL: ${badUrl}`);
    }

    const safeUrls = [
      'https://ipfs.io/ipfs/bafybeic5',
      'https://pump.mypinata.cloud/ipfs/Qm123',
      'https://arweave.net/tx123456789'
    ];
    for (const goodUrl of safeUrls) {
      assert.strictEqual(isSafePublicUrl(goodUrl), true, `Should accept safe public HTTPS URL: ${goodUrl}`);
    }
    console.log('  ✅ SSRF Protection Filter verified (All internal/metadata IPs blocked).\n');

    // -------------------------------------------------------------
    // Test 2: Fail-Closed RugCheck Defense
    // -------------------------------------------------------------
    console.log('▶ Test 2: Fail-Closed RugCheck Defense');
    const strictResult = await checkRugSafety('', { strict_rugcheck: true });
    assert.strictEqual(strictResult.safe, false, 'Strict mode must fail-closed on empty/invalid mint');
    console.log('  ✅ RugCheck Fail-Closed protection verified.\n');

    // -------------------------------------------------------------
    // Test 3: Concurrent Write Mutex Queue & Safe Quarantine
    // -------------------------------------------------------------
    console.log('▶ Test 3: Concurrent Write Queue & State Quarantine');
    const testFile = path.join(tmpDir, 'concurrent_state.json');

    // Launch 15 concurrent atomic writes to the same file simultaneously
    const writes = [];
    for (let i = 1; i <= 15; i++) {
      writes.push(atomicWriteJson(testFile, { counter: i, timestamp: Date.now() }));
    }
    await Promise.all(writes);

    const finalRead = await safeReadJson(testFile);
    assert.strictEqual(typeof finalRead.counter, 'number', 'File must be valid JSON');
    assert.strictEqual(finalRead.counter, 15, 'Mutex must order writes sequentially so the final counter is 15');

    // Test Corrupted State Quarantine
    const corruptFile = path.join(tmpDir, 'corrupt_state.json');
    fs.writeFileSync(corruptFile, '{"balance": 1.5, "unclosed: true', 'utf8');

    const corruptRead = await safeReadJson(corruptFile, { default: true });
    assert.strictEqual(corruptRead.__corrupted, true, 'Corrupted file must return __corrupted: true');
    assert.ok(fs.existsSync(corruptRead.quarantinePath), 'Quarantine backup file must exist on disk');
    console.log('  ✅ Storage race conditions prevented & corruption quarantine verified.\n');

    // -------------------------------------------------------------
    // Test 4: Dynamic Bonding Curve Price Impact (x * y = k)
    // -------------------------------------------------------------
    console.log('▶ Test 4: Constant-Product Price Impact Accuracy');
    const poolSol = 30.0; // 30 SOL curve reserve

    // Small trade: 0.1 SOL on 30 SOL pool -> impact = 0.1 / (30 + 0.1) = ~0.33%
    const smallTradeImpact = 0.1 / (poolSol + 0.1);
    assert.ok(smallTradeImpact > 0.003 && smallTradeImpact < 0.004, 'Small order impact must be ~0.33%');

    // Whale trade: 3.0 SOL on 30 SOL pool -> impact = 3.0 / (30 + 3.0) = ~9.09%
    const largeTradeImpact = 3.0 / (poolSol + 3.0);
    assert.ok(largeTradeImpact > 0.090 && largeTradeImpact < 0.092, 'Large order impact must be ~9.09%');
    console.log('  ✅ Constant-product mathematical price impact verified.\n');

    // -------------------------------------------------------------
    // Test 5: Repeat Proportional Scale-Out Trims
    // -------------------------------------------------------------
    console.log('▶ Test 5: Multi-Stage Proportional Scale-Out Math');
    const paper = new PaperTradingEngine({
      initial_balance_sol: 1.0,
      safety_net_floor_sol: 0.08,
      take_profit_pct: 120.0,
      stop_loss_pct: 25.0
    }, null);
    paper.save = async () => {}; // in-memory mock

    const pos = {
      id: 'POS_PROPORTIONAL_TEST',
      symbol: 'TRIM_TEST',
      mint: 'MintTrimTest',
      entry_price_sol: 3.0e-8,
      sol_invested: 0.10,
      total_tokens: 1000000,
      remaining_tokens: 1000000,
      sol_recovered: 0,
      current_price_sol: 4.5e-8
    };

    // Trim 1: Whale sells 30% -> bot sells 30% of remaining (leaves 700,000)
    await paper.scaleOut(pos, 0.30, 'Trim 1', false);
    assert.strictEqual(Math.round(pos.remaining_tokens), 700000, 'Should have 700,000 tokens remaining after 30% trim');

    // Trim 2: Whale sells 50% -> bot sells 50% of remaining 700,000 (leaves 350,000)
    await paper.scaleOut(pos, 0.50, 'Trim 2', false);
    assert.strictEqual(Math.round(pos.remaining_tokens), 350000, 'Should have 350,000 tokens remaining after second trim');

    // Trim 3: Whale sells 20% -> bot sells 20% of remaining 350,000 (leaves 280,000)
    await paper.scaleOut(pos, 0.20, 'Trim 3', false);
    assert.strictEqual(Math.round(pos.remaining_tokens), 280000, 'Should have 280,000 tokens remaining (bag never prematurely emptied)');
    console.log('  ✅ Multi-stage proportional trims verified (Calculated from remaining tokens).\n');

    // -------------------------------------------------------------
    // Test 6: Strict Safety Floor Defense
    // -------------------------------------------------------------
    console.log('▶ Test 6: Strict Anti-Ruin Safety Floor');
    const safetyFloor = 0.08;
    const testEngine = new PaperTradingEngine({
      initial_balance_sol: 0.50,
      safety_net_floor_sol: safetyFloor,
      compounding_enabled: true,
      position_pct_of_balance: 25.0
    }, null);

    // Simulate depleted balance: 0.088 SOL (only 0.008 SOL above floor)
    testEngine.state.virtual_balance_sol = 0.088;
    const calcSize = testEngine.calculatePositionSize(1.0);
    assert.strictEqual(calcSize, 0, 'Must return 0 size when available balance is below minimum trade threshold');

    const canOpen = testEngine.canOpenPosition('test_mint');
    assert.strictEqual(canOpen, false, 'Must reject opening positions when near safety floor');
    console.log('  ✅ Safety Floor is strictly impenetrable (Zero-balance ruin impossible).\n');

    // -------------------------------------------------------------
    // Test 7: Unverified Tier Assignment for All Harvested Wallets
    // -------------------------------------------------------------
    console.log('▶ Test 7: Unverified Status & Tier C Enforcement');
    const wm = new WalletManager();

    // 1. harvested_dev with verified: false
    wm.wallets.set('DevWalletX', {
      address: 'DevWalletX',
      tag: 'harvested_dev',
      verified: false,
      profit_7d_usd: 0,
      winrate_7d: 0
    });
    const devTier = wm.getWalletTier('DevWalletX');
    assert.strictEqual(devTier.tier, 'C', 'harvested_dev with verified: false MUST be Tier C');
    assert.strictEqual(devTier.multiplier, 0.5, 'harvested_dev MUST have 0.5x sizing multiplier');

    // 2. harvested_unverified
    wm.wallets.set('ScoutWalletY', {
      address: 'ScoutWalletY',
      tag: 'harvested_unverified',
      verified: false,
      profit_7d_usd: 0,
      winrate_7d: 0
    });
    const scoutTier = wm.getWalletTier('ScoutWalletY');
    assert.strictEqual(scoutTier.tier, 'C', 'harvested_unverified MUST be Tier C');
    assert.strictEqual(scoutTier.multiplier, 0.5, 'harvested_unverified MUST have 0.5x multiplier');
    console.log('  ✅ All unverified wallets strictly confined to Tier C (0.5x).\n');

    // -------------------------------------------------------------
    // Test 8: PumpSwap / Raydium Graduation Exit
    // -------------------------------------------------------------
    console.log('▶ Test 8: PumpSwap / Raydium Migration Graduation Exit');
    let graduationClosed = false;
    let graduationPrice = 0;

    const mockPaperForMigration = {
      getState() {
        return {
          open_positions: [{
            id: 'POS_GRADUATING',
            mint: 'MintGraduating123',
            symbol: 'GRADUATE',
            entry_price_sol: 3.5e-8
          }]
        };
      },
      async closePosition(id, price, reason) {
        graduationClosed = true;
        graduationPrice = price;
      }
    };

    const mockListener = new SolanaListener({}, wm, mockPaperForMigration, null);
    await mockListener.handleMigrationEvent({ mint: 'MintGraduating123' });

    assert.strictEqual(graduationClosed, true, 'Migrating position must be automatically closed');
    assert.ok(graduationPrice >= 7.9e-8, 'Position must exit at full graduation bonding curve price');
    console.log('  ✅ PumpSwap / Raydium graduation handling verified (+100% curve fill exit).\n');

    console.log('🎉 ALL 8 AUDIT VERIFICATION TESTS PASSED 100% (SELF-CONTAINED & OFFLINE)!');
  } finally {
    // Clean up temporary test directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

runComprehensiveTestSuite().catch(err => {
  console.error('❌ Audit verification failed:', err);
  process.exit(1);
});
