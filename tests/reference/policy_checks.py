"""Executable specification checks, NOT Solidity/Uniswap tests or an audit."""
from collections import deque
from copy import deepcopy
from decimal import Decimal, getcontext
import json
import random
import unittest

WINDOW = 300
SEED = 20261024
getcontext().prec = 60


def bell_fee(base, elapsed):
    if not 0 <= base <= 10000 or elapsed < 0:
        raise ValueError("domain")
    remaining = max(0, 300 - elapsed)
    return base + ((10000 - base) * remaining + 299) // 300


class GrossLimiter:
    def __init__(self, per_trade=(250, 250), per_window=(1000, 1000)):
        self.per_trade = per_trade
        self.per_window = per_window
        self.epoch = None
        self.current = [0, 0]
        self.previous = [0, 0]

    def accept(self, now, delta0, delta1, commit=True):
        """Whole-transition atomicity models EVM rollback, not callback behavior."""
        amounts = [abs(delta0), abs(delta1)]
        epoch = now // WINDOW
        if now < 0 or self.epoch is not None and epoch < self.epoch:
            raise ValueError("time")
        current, previous = self.current[:], self.previous[:]
        if self.epoch is None or epoch > self.epoch:
            previous = current if self.epoch is not None and epoch == self.epoch + 1 else [0, 0]
            current = [0, 0]
        if any(a > p or previous[i] + current[i] + a > self.per_window[i]
               for i, (a, p) in enumerate(zip(amounts, self.per_trade))):
            return False
        if commit:
            self.epoch, self.previous = epoch, previous
            self.current = [current[i] + amounts[i] for i in range(2)]
        return True


class ClosureLedger:
    """Model for non-refillable budgets over a committed closure interval."""
    def __init__(self, limit=(500, 500)):
        self.limit = limit
        self.records = {}

    def register(self, key, start, end):
        if start < 0 or end <= start:
            raise ValueError("interval")
        if key in self.records:
            if self.records[key][:2] != (start, end):
                raise ValueError("immutable closure")
            return
        if any(start < old_end and old_start < end
               for old_start, old_end, _ in self.records.values()):
            raise ValueError("overlapping closure")
        self.records[key] = (start, end, [0, 0])

    def consume(self, key, now, delta0, delta1, commit=True):
        start, end, used = self.records[key]
        amount = [abs(delta0), abs(delta1)]
        if not start <= now < end:
            return False
        candidate = [used[i] + amount[i] for i in range(2)]
        if any(candidate[i] > self.limit[i] for i in range(2)):
            return False
        if commit:
            self.records[key] = (start, end, candidate)
        return True


def full_policy(session, expected_closed=False, close_reference=False,
                runtime_healthy=True, report_fresh=True, corporate=False,
                pair_class="PRICE_GUARDED"):
    if not runtime_healthy:
        return "HALT", None
    if session == "CLOSED":
        if not (expected_closed and close_reference):
            return "HALT", None
        return ("CLOSED_REFERENCE" if pair_class == "PRICE_GUARDED"
                else "CLOSED_SESSION_ONLY"), 10000
    if not report_fresh or session not in {"REGULAR", "PRE", "POST", "OVERNIGHT"}:
        return "HALT", None
    base = {"REGULAR": 500, "PRE": 3000, "POST": 3000, "OVERNIGHT": 5000}[session]
    return "OPEN", max(base, 10000 if corporate else 0)


def old_cap_counterexample():
    r0 = r1 = Decimal(10000)
    total_out = Decimal(0)
    for _ in range(20):
        amount_in = Decimal(100)
        effective_in = amount_in * Decimal("0.99")
        amount_out = r1 * effective_in / (r0 + effective_in)
        assert amount_in <= r0 * Decimal("0.02")
        assert amount_out <= r1 * Decimal("0.02")
        r0 += amount_in
        r1 -= amount_out
        total_out += amount_out
    assert total_out > Decimal(200)
    return {"trades": 20, "each_passes_2_percent_cap": True,
            "initial_output_reserve": 10000,
            "total_output": str(total_out.quantize(Decimal("0.000001"))),
            "note": "constant-product mathematical example, not v4 fork execution"}


class PolicyTests(unittest.TestCase):
    def test_full_session_fee_table(self):
        for session, fee in [("REGULAR", 500), ("PRE", 3000), ("POST", 3000), ("OVERNIGHT", 5000)]:
            self.assertEqual(full_policy(session), ("OPEN", fee))

    def test_expected_weekend_does_not_require_fresh_underlying_report(self):
        self.assertEqual(full_policy("CLOSED", expected_closed=True,
                                    close_reference=True, report_fresh=False),
                         ("CLOSED_REFERENCE", 10000))

    def test_outage_during_open_is_not_weekend_permission(self):
        self.assertEqual(full_policy("REGULAR", report_fresh=False,
                                    expected_closed=True, close_reference=True), ("HALT", None))

    def test_invalid_closure_evidence_halts(self):
        self.assertEqual(full_policy("CLOSED", expected_closed=True), ("HALT", None))
        self.assertEqual(full_policy("CLOSED", close_reference=True), ("HALT", None))

    def test_issuer_pause_overrides_weekend_mode(self):
        self.assertEqual(full_policy("CLOSED", expected_closed=True, close_reference=True,
                                    runtime_healthy=False), ("HALT", None))

    def test_unpriced_pair_has_no_price_guard_badge(self):
        self.assertEqual(full_policy("CLOSED", expected_closed=True, close_reference=True,
                                    pair_class="SESSION_ONLY"), ("CLOSED_SESSION_ONLY", 10000))

    def test_closure_budget_cannot_refill_at_midnight_or_bucket_boundary(self):
        led = ClosureLedger()
        led.register("weekend", 0, 200000)
        for t in [299, 300, 86400, 172800, 199999]:
            self.assertTrue(led.consume("weekend", t, -100, 100))
        self.assertFalse(led.consume("weekend", 199999, -1, 1))

    def test_duplicate_closure_and_report_do_not_reset_budget(self):
        led = ClosureLedger()
        led.register("holiday", 0, 10000)
        self.assertTrue(led.consume("holiday", 1, -500, 500))
        led.register("holiday", 0, 10000)
        self.assertFalse(led.consume("holiday", 2, -1, 1))

    def test_closure_intervals_cannot_be_split_to_refill(self):
        led = ClosureLedger()
        led.register("weekend", 0, 10000)
        with self.assertRaises(ValueError):
            led.register("fake_child", 5000, 10000)
        with self.assertRaises(ValueError):
            led.register("weekend", 0, 9999)

    def test_closed_ledger_uses_gross_and_end_exclusive(self):
        led = ClosureLedger()
        led.register("c", 100, 200)
        self.assertTrue(led.consume("c", 100, -250, 250))
        self.assertTrue(led.consume("c", 199, 250, -250))
        self.assertFalse(led.consume("c", 199, -1, 1))
        self.assertFalse(led.consume("c", 200, 0, 0))

    def test_failed_trade_does_not_spend_closure_budget(self):
        led = ClosureLedger()
        led.register("c", 0, 1000)
        before = deepcopy(led.records)
        self.assertTrue(led.consume("c", 1, -100, 100, commit=False))
        self.assertEqual(led.records, before)

    def test_old_cap_is_not_cumulative(self):
        self.assertTrue(old_cap_counterexample()["each_passes_2_percent_cap"])

    def test_boundary_has_no_double_budget(self):
        lim = GrossLimiter()
        for _ in range(4):
            self.assertTrue(lim.accept(299, -250, 250))
        self.assertFalse(lim.accept(300, -1, 1))
        self.assertFalse(lim.accept(599, -1, 1))
        self.assertTrue(lim.accept(600, -250, 250))

    def test_sign_reversal_does_not_refund_budget(self):
        lim = GrossLimiter(per_window=(250, 250))
        self.assertTrue(lim.accept(1, -250, 250))
        self.assertFalse(lim.accept(2, 250, -250))

    def test_failed_settlement_does_not_charge_budget(self):
        lim = GrossLimiter()
        state = deepcopy(lim.__dict__)
        self.assertTrue(lim.accept(1, -250, 250, commit=False))
        self.assertEqual(state, lim.__dict__)

    def test_rejected_candidate_does_not_mutate(self):
        lim = GrossLimiter()
        self.assertTrue(lim.accept(1, -200, 200))
        state = deepcopy(lim.__dict__)
        self.assertFalse(lim.accept(301, -251, 1))
        self.assertEqual(state, lim.__dict__)

    def test_replay_does_not_create_budget(self):
        lim = GrossLimiter()
        for _ in range(4):
            self.assertTrue(lim.accept(60, -250, 250))
        self.assertFalse(lim.accept(60, -1, 1))

    def test_long_idle_expires_old_buckets(self):
        lim = GrossLimiter()
        self.assertTrue(lim.accept(1, -250, 250))
        self.assertTrue(lim.accept(10000, -250, 250))
        self.assertEqual(lim.previous, [0, 0])

    def test_per_trade_cap_survives_small_second_leg(self):
        self.assertFalse(GrossLimiter().accept(1, -251, 1))
        self.assertFalse(GrossLimiter().accept(1, -1, 251))

    def test_absolute_signed_min_is_representable_after_widening(self):
        self.assertEqual(abs(-(1 << 127)), 1 << 127)
        self.assertFalse(GrossLimiter().accept(1, -(1 << 127), 1))

    def test_fee_is_monotone_and_bounded(self):
        for base in [500, 3000, 5000]:
            fees = [bell_fee(base, t) for t in range(1000)]
            self.assertEqual(fees[0], 10000)
            self.assertEqual(fees[300], base)
            self.assertTrue(all(base <= f <= 10000 for f in fees))
            self.assertTrue(all(a >= b for a, b in zip(fees, fees[1:])))
        self.assertEqual(bell_fee(500, 150), 5250)

    def test_randomized_against_exact_sliding_history(self):
        rng = random.Random(SEED)
        lim = GrossLimiter()
        history = deque()
        now = 0
        accepted = rejected = 0
        for _ in range(100000):
            now += rng.randrange(0, 20)
            while history and history[0][0] <= now - WINDOW:
                history.popleft()
            a0, a1 = rng.randrange(0, 400), rng.randrange(0, 400)
            d0, d1 = (-a0, a1) if rng.randrange(2) else (a0, -a1)
            if lim.accept(now, d0, d1):
                accepted += 1
                history.append((now, a0, a1))
                self.assertLessEqual(sum(x[1] for x in history), 1000)
                self.assertLessEqual(sum(x[2] for x in history), 1000)
                self.assertLessEqual(a0, 250)
                self.assertLessEqual(a1, 250)
            else:
                rejected += 1
        type(self).random_result = {"proposals": 100000, "accepted": accepted,
                                    "rejected": rejected, "seed": SEED}


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PolicyTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(json.dumps({"tests_run": result.testsRun, "passed": result.wasSuccessful(),
                      "randomized": getattr(PolicyTests, "random_result", {}),
                      "old_cap_counterexample": old_cap_counterexample()}, indent=2))
    raise SystemExit(0 if result.wasSuccessful() else 1)

