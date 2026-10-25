"""Engineering reference checks. Not Solidity, cryptographic proof, or an audit.
Save section 18 as policy_checks.py beside this file before running.
"""
from copy import deepcopy
from fractions import Fraction
import json
import random
import unittest
from policy_checks import GrossLimiter, PolicyTests


class SeedActivation:
    def __init__(self):
        self.state = "DEPLOYED"
        self.principal = None

    def begin(self, factory_authorized=True):
        if self.state != "DEPLOYED" or not factory_authorized:
            raise ValueError("setup")
        self.state = "SEEDING"

    def capture(self, delta, fees, expected_executor=True):
        if self.state != "SEEDING" or self.principal is not None or not expected_executor:
            raise ValueError("capture")
        principal = tuple(-(d - f) for d, f in zip(delta, fees))
        if len(principal) != 2 or any(p <= 0 for p in principal):
            raise ValueError("principal")
        self.principal = principal

    def activate(self, trade, window, closure):
        if self.state != "SEEDING" or self.principal is None:
            raise ValueError("activation")
        for i in range(2):
            if not (0 < trade[i] <= window[i] and
                    0 < closure[i] <= min(2 * trade[i], window[i], self.principal[i] // 10)):
                raise ValueError("budget")
        self.state = "LIVE"


class JointLifecycle:
    """Inputs are assumed already authenticated/validated by adapters/calendar."""
    def __init__(self, count=2):
        self.count = count
        self.nonce = 0
        self.latched = False
        self.used = {}
        self.candidate_since = None
        self.baseline = None
        self.last_obs = None
        self.old_valid_until = 0
        self.mode = "HALTED"
        self.manual_pause = False
        self.now = -1

    def checkpoint(self, now, condition, observations=(), valid_until=0):
        if now < self.now:
            raise ValueError("time")
        self.now = now
        if condition == "PLANNED_CLOSED":
            if not self.latched:
                self.latched = True
                self.nonce += 1
                self.used[self.nonce] = [0, 0]
            self.candidate_since = self.baseline = None
            self.mode = "HALTED" if self.manual_pause else "CLOSED"
            return self.mode
        if condition != "ALL_OPEN_HEALTHY" or self.manual_pause or now >= valid_until:
            self.candidate_since = self.baseline = None
            self.mode = "HALTED"
            return self.mode
        if len(observations) != self.count or any(o > now or o <= 0 for o in observations):
            raise ValueError("observations")
        if self.last_obs is not None and any(o < old for o, old in zip(observations, self.last_obs)):
            raise ValueError("replay")
        expired_before_update = now >= self.old_valid_until
        if self.mode == "ACTIVE" and not expired_before_update and not self.latched:
            self.last_obs = tuple(observations)
            self.old_valid_until = valid_until
            return self.mode
        if self.candidate_since is None or expired_before_update:
            self.candidate_since = now
            self.baseline = tuple(observations)
            self.mode = "RECOVERING"
        elif now - self.candidate_since >= 60 and all(o > b for o, b in zip(observations, self.baseline)):
            self.latched = False
            self.candidate_since = self.baseline = None
            self.mode = "ACTIVE"
        else:
            self.mode = "RECOVERING"
        self.last_obs = tuple(observations)
        self.old_valid_until = valid_until
        return self.mode

    def swap_closed(self, a0, a1, commit=True, limit=(500, 500)):
        if self.mode != "CLOSED" or self.manual_pause or not self.latched or a0 <= 0 or a1 <= 0:
            return False
        candidate = [self.used[self.nonce][0] + a0, self.used[self.nonce][1] + a1]
        if any(candidate[i] > limit[i] for i in range(2)):
            return False
        if commit:
            self.used[self.nonce] = candidate
        return True


def price_allowed(pre, post, ref, band=200):
    if min(pre, post, ref) <= 0:
        return False
    low = ref * Fraction(10000 - band, 10000)
    high = ref * Fraction(10000 + band, 10000)
    if low <= pre <= high:
        return low <= post <= high
    if pre < low:
        return pre < post <= high
    return low <= post < pre


def band_wide_matches_reference(s, p0, p1, d0, d1, band):
    lhs = s * s * p1 * 10**d0 * 10000
    lo = 2**192 * p0 * 10**d1 * (10000 - band)
    hi = 2**192 * p0 * 10**d1 * (10000 + band)
    assert max(lhs, lo, hi).bit_length() <= 768
    raw_price = Fraction(s * s, 2**192)
    ref = Fraction(p0 * 10**d1, p1 * 10**d0)
    reference = ref * Fraction(10000-band, 10000) <= raw_price <= ref * Fraction(10000+band, 10000)
    assert (lo <= lhs <= hi) == reference


class EngineeringTests(unittest.TestCase):
    def test_seed_swap_cannot_activate_without_capture(self):
        s = SeedActivation(); s.begin()
        with self.assertRaises(ValueError): s.activate((250,250),(1000,1000),(500,500))

    def test_seed_principal_excludes_accrued_fees(self):
        s = SeedActivation(); s.begin(); s.capture((-9990,-4990),(10,10))
        self.assertEqual(s.principal, (10000,5000))
        s.activate((250,250),(1000,1000),(500,500))
        self.assertEqual(s.state,"LIVE")

    def test_seed_is_single_use(self):
        s = SeedActivation(); s.begin(); s.capture((-10000,-10000),(0,0))
        with self.assertRaises(ValueError): s.capture((-1,-1),(0,0))

    def test_seed_wrong_executor_fails(self):
        s = SeedActivation(); s.begin()
        with self.assertRaises(ValueError): s.capture((-100,-100),(0,0),False)

    def test_seed_closure_limit_rounds_down(self):
        s = SeedActivation(); s.begin(); s.capture((-999,-999),(0,0))
        with self.assertRaises(ValueError): s.activate((100,100),(400,400),(100,100))
        s.activate((100,100),(400,400),(99,99))

    def test_unexpected_closure_halts_without_new_episode(self):
        j=JointLifecycle(); j.checkpoint(100,"UNEXPECTED_CLOSED")
        self.assertEqual((j.mode,j.nonce),("HALTED",0))

    def test_planned_closure_repeated_does_not_refill(self):
        j=JointLifecycle(); j.checkpoint(100,"PLANNED_CLOSED")
        self.assertTrue(j.swap_closed(500,500))
        j.checkpoint(86400,"PLANNED_CLOSED")
        self.assertEqual(j.nonce,1); self.assertFalse(j.swap_closed(1,1))

    def test_one_open_stock_does_not_end_joint_episode(self):
        j=JointLifecycle(); j.checkpoint(100,"PLANNED_CLOSED")
        j.swap_closed(500,500); j.checkpoint(200,"PLANNED_CLOSED")
        self.assertEqual((j.latched,j.nonce,j.used[1]),(True,1,[500,500]))

    def test_both_stocks_require_new_observations(self):
        j=JointLifecycle(); j.checkpoint(100,"PLANNED_CLOSED")
        j.checkpoint(200,"ALL_OPEN_HEALTHY",(200,200),320)
        j.checkpoint(260,"ALL_OPEN_HEALTHY",(260,200),320)
        self.assertEqual(j.mode,"RECOVERING")
        j.checkpoint(261,"ALL_OPEN_HEALTHY",(261,261),381)
        self.assertEqual((j.mode,j.latched),("ACTIVE",False))

    def test_duplicate_proof_does_not_end_recovery(self):
        j=JointLifecycle(); j.checkpoint(100,"ALL_OPEN_HEALTHY",(100,100),220)
        j.checkpoint(160,"ALL_OPEN_HEALTHY",(100,100),220)
        self.assertEqual(j.mode,"RECOVERING")

    def test_gap_is_checked_against_old_deadline(self):
        j=JointLifecycle(); j.checkpoint(100,"ALL_OPEN_HEALTHY",(100,100),220)
        j.checkpoint(221,"ALL_OPEN_HEALTHY",(221,221),341)
        self.assertEqual((j.mode,j.candidate_since),("RECOVERING",221))

    def test_unknown_breaks_recovery_not_episode(self):
        j=JointLifecycle(); j.checkpoint(100,"PLANNED_CLOSED"); j.swap_closed(200,200)
        j.checkpoint(200,"ALL_OPEN_HEALTHY",(200,200),320)
        j.checkpoint(230,"FAULT")
        self.assertEqual((j.latched,j.nonce,j.used[1]),(True,1,[200,200]))
        j.checkpoint(260,"ALL_OPEN_HEALTHY",(260,260),380)
        self.assertEqual((j.mode,j.candidate_since),("RECOVERING",260))

    def test_confirmed_open_then_next_closure_is_new_episode(self):
        j=JointLifecycle(); j.checkpoint(100,"PLANNED_CLOSED"); j.swap_closed(500,500)
        j.checkpoint(200,"ALL_OPEN_HEALTHY",(200,200),320)
        j.checkpoint(260,"ALL_OPEN_HEALTHY",(260,260),380)
        j.checkpoint(300,"PLANNED_CLOSED")
        self.assertEqual((j.nonce,j.used[1],j.used[2]),(2,[500,500],[0,0]))

    def test_pause_and_resume_cannot_refill_episode(self):
        j=JointLifecycle(); j.checkpoint(100,"PLANNED_CLOSED"); j.swap_closed(500,500)
        j.manual_pause=True; j.checkpoint(200,"PLANNED_CLOSED")
        self.assertFalse(j.swap_closed(1,1))
        j.manual_pause=False; j.checkpoint(300,"PLANNED_CLOSED")
        self.assertEqual((j.nonce,j.used[1]),(1,[500,500]))

    def test_closed_failed_settlement_is_not_committed(self):
        j=JointLifecycle(); j.checkpoint(100,"PLANNED_CLOSED")
        state=deepcopy(j.used)
        self.assertTrue(j.swap_closed(100,100,commit=False))
        self.assertEqual(state,j.used)

    def test_old_observations_rejected(self):
        j=JointLifecycle(); j.checkpoint(100,"ALL_OPEN_HEALTHY",(100,100),220)
        with self.assertRaises(ValueError): j.checkpoint(101,"ALL_OPEN_HEALTHY",(99,100),221)

    def test_single_stock_recovery_is_supported(self):
        j=JointLifecycle(count=1); j.checkpoint(100,"ALL_OPEN_HEALTHY",(100,),220)
        j.checkpoint(160,"ALL_OPEN_HEALTHY",(160,),280)
        self.assertEqual(j.mode,"ACTIVE")

    def test_repricing_below_can_progress_but_not_reverse_or_overshoot(self):
        self.assertTrue(price_allowed(Fraction(90),Fraction(95),Fraction(100)))
        self.assertTrue(price_allowed(Fraction(90),Fraction(102),Fraction(100)))
        self.assertFalse(price_allowed(Fraction(90),Fraction(89),Fraction(100)))
        self.assertFalse(price_allowed(Fraction(90),Fraction(103),Fraction(100)))
        self.assertFalse(price_allowed(Fraction(90),Fraction(90),Fraction(100)))

    def test_repricing_above_can_progress_but_not_reverse_or_overshoot(self):
        self.assertTrue(price_allowed(Fraction(110),Fraction(105),Fraction(100)))
        self.assertTrue(price_allowed(Fraction(110),Fraction(98),Fraction(100)))
        self.assertFalse(price_allowed(Fraction(110),Fraction(111),Fraction(100)))
        self.assertFalse(price_allowed(Fraction(110),Fraction(97),Fraction(100)))

    def test_inside_band_cannot_exit(self):
        self.assertTrue(price_allowed(Fraction(100),Fraction(102),Fraction(100)))
        self.assertFalse(price_allowed(Fraction(100),Fraction(103),Fraction(100)))

    def test_mode_change_keeps_rolling_history(self):
        g=GrossLimiter(); self.assertTrue(g.accept(100,-250,250))
        g.per_trade=(50,50); g.per_window=(250,250)
        self.assertFalse(g.accept(101,-1,1))

    def test_wide_math_against_fraction_oracle(self):
        rng=random.Random(20261024)
        for _ in range(100000):
            band_wide_matches_reference(rng.randrange(1,2**160), rng.randrange(1,2**128),
                                        rng.randrange(1,2**128),rng.randrange(19),rng.randrange(19),
                                        rng.choice([200,500]))

    def test_random_lifecycle_never_decrements_same_episode(self):
        rng=random.Random(20261024); j=JointLifecycle(); now=100
        last_nonce=0; last_used={}
        for _ in range(50000):
            now+=rng.randrange(1,31)
            cond=rng.choice(["ALL_OPEN_HEALTHY","PLANNED_CLOSED","PLANNED_CLOSED","FAULT","UNEXPECTED_CLOSED"])
            j.checkpoint(now,cond,(now,now),now+120)
            j.swap_closed(rng.randrange(1,100),rng.randrange(1,100))
            self.assertGreaterEqual(j.nonce,last_nonce)
            for key,value in last_used.items():
                self.assertTrue(all(x>=y for x,y in zip(j.used[key],value)))
            self.assertTrue(all(all(x<=500 for x in v) for v in j.used.values()))
            last_nonce=j.nonce; last_used=deepcopy(j.used)


if __name__ == "__main__":
    suite=unittest.TestSuite([
        unittest.defaultTestLoader.loadTestsFromTestCase(PolicyTests),
        unittest.defaultTestLoader.loadTestsFromTestCase(EngineeringTests)])
    result=unittest.TextTestRunner(verbosity=1).run(suite)
    print(json.dumps({"tests_run":result.testsRun,"passed":result.wasSuccessful(),
                      "rolling_proposals":100000,"wide_math_cases":100000,
                      "lifecycle_steps":50000,"seed":20261024},indent=2))
    raise SystemExit(0 if result.wasSuccessful() else 1)

