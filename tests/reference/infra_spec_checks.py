"""Infrastructure policy reference checks, not deployed workers or EVM tests."""
from dataclasses import dataclass
from math import ceil
import unittest

MONTH = 31 * 86400

def log_ranges(start, end, width=10):
    if not 1 <= width <= 10:
        raise ValueError("provider range")
    return [(b, min(b + width - 1, end)) for b in range(start, end + 1, width)]

def rpc_cost(methods):
    costs = {"eth_call": 26, "eth_getLogs": 60,
             "eth_getBlockByNumber": 20, "eth_sendRawTransaction": 40}
    return sum(costs[m] for m in methods)

@dataclass
class Lease:
    owner: str = ""
    fence: int = 0
    expires: int = 0

    def acquire(self, owner, now):
        if now < self.expires:
            return None
        self.owner, self.fence, self.expires = owner, self.fence + 1, now + 25
        return self.fence

    def valid(self, owner, fence, now):
        return (owner, fence) == (self.owner, self.fence) and now < self.expires

def due_priority(items):
    # Deadline first; deterministic tie-break, independent of pool volume.
    return sorted(items, key=lambda x: (x["deadline"], x["asset"]))

def next_wakeup(now):
    return (now // 30 + 1) * 30

def admit(stocks, pools, observed_quota_ratio, runtime_pass, source_pass):
    return (stocks <= 6 and pools <= 24 and observed_quota_ratio < .8
            and runtime_pass and source_pass)

def rotate_backups(old, candidate, verified):
    if not verified:
        return old[:]
    return (old + [candidate])[-2:]

def restore_complete(manifest, supplied):
    return set(manifest) <= set(supplied)

def two_provider_agreement(a, b):
    return a is not None and b is not None and a == b

class InfrastructureChecks(unittest.TestCase):
    def test_monthly_function_envelope(self):
        self.assertEqual(MONTH // 30, 89280)
        self.assertEqual(MONTH // 60, 44640)
        self.assertLess(89280 + 44640 + 24 + 60 + 200000, 400000)

    def test_log_ranges_no_holes_or_overlap(self):
        for start in (0, 1, 999):
            for length in range(1, 103):
                r = log_ranges(start, start + length - 1)
                self.assertTrue(all(0 < b - a + 1 <= 10 for a, b in r))
                self.assertEqual([n for a,b in r for n in range(a,b+1)],
                                 list(range(start, start + length)))

    def test_log_empty_and_forbidden_width(self):
        self.assertEqual(log_ranges(2, 1), [])
        with self.assertRaises(ValueError):
            log_ranges(0, 20, 11)

    def test_json_batch_does_not_discount_compute(self):
        self.assertEqual(rpc_cost(["eth_call"] * 6), 156)

    def test_pinax_hypothetical_small_block_scenario(self):
        # Scenario only: 240 blocks/min, 2 log shards, 8 B RPC calls/tick.
        logs = ceil(240 / 10) * 2 * (MONTH // 60)
        keeper = 8 * (MONTH // 30)
        self.assertEqual(logs + keeper, 2856960)
        self.assertLess((logs + keeper) * 6 / 1000000, 20)
        # 4 shards exceeds the budget; do not silently accept extra indexing.
        self.assertGreater((logs * 2 + keeper) * 6 / 1000000, 20)

    def test_cloudflare_duration_not_only_request_quota(self):
        conservative_gb = .128
        normal = 2880 * 20 * conservative_gb
        self.assertLess(normal, 13000 * .8)
        self.assertGreater(2880 * 30 * conservative_gb, 13000 * .8)

    def test_late_tick_skips_missed_intervals(self):
        self.assertEqual(next_wakeup(101), 120)
        self.assertEqual(next_wakeup(120), 150)

    def test_lease_blocks_overlap(self):
        lease = Lease()
        self.assertEqual(lease.acquire("a", 100), 1)
        self.assertIsNone(lease.acquire("b", 124))

    def test_expired_lease_cannot_sign(self):
        lease = Lease()
        f = lease.acquire("a", 100)
        self.assertFalse(lease.valid("a", f, 125))

    def test_new_lease_fences_old_owner(self):
        lease = Lease()
        f = lease.acquire("a", 100)
        self.assertEqual(lease.acquire("b", 125), 2)
        self.assertFalse(lease.valid("a", f, 126))

    def test_deadlines_win_over_asset_order(self):
        self.assertEqual([i["asset"] for i in due_priority([
            {"asset":"A", "deadline":200}, {"asset":"Z", "deadline":150}])],
            ["Z", "A"])

    def test_backup_upload_headroom(self):
        # 2 retained * 100 MB + candidate 100 MB + other artifacts 100 MB.
        self.assertEqual(2 * 100 + 100 + 100, 400)
        self.assertLess(400, 500)

    def test_failed_backup_keeps_old_copies(self):
        self.assertEqual(rotate_backups(["a", "b"], "bad", False), ["a", "b"])

    def test_verified_backup_retains_two(self):
        self.assertEqual(rotate_backups(["a", "b"], "c", True), ["b", "c"])

    def test_database_dump_does_not_restore_storage_bytes(self):
        self.assertFalse(restore_complete(["db", "object1"], ["db"]))
        self.assertTrue(restore_complete(["db", "object1"], ["db", "object1"]))

    def test_admission_requires_measurement_and_source(self):
        self.assertTrue(admit(6, 24, .79, True, True))
        for args in [(7,24,.1,True,True), (6,25,.1,True,True),
                     (6,24,.8,True,True), (6,24,.1,False,True),
                     (6,24,.1,True,False)]:
            self.assertFalse(admit(*args))

    def test_missing_provider_is_not_agreement(self):
        self.assertFalse(two_provider_agreement(None, None))
        self.assertFalse(two_provider_agreement((1,"a"), None))
        self.assertFalse(two_provider_agreement((1,"a"), (1,"b")))
        self.assertTrue(two_provider_agreement((1,"a"), (1,"a")))

    def test_duplicate_report_never_advances_high_water(self):
        watermark = 100
        for observation in [100, 99, 100]:
            accepted = observation > watermark
            self.assertFalse(accepted)
        self.assertTrue(101 > watermark)

if __name__ == "__main__":
    unittest.main(verbosity=2)

