# =============================================================================
# tb_pivot_excel/v1/test_resample.py
#
# Description:
#   Unit tests for _resample_pivot() in main.py.
#   Tests all agg functions x all frequencies using synthetic data.
#   No ThingsBoard connection, no network, no Excel writing required.
#
#   Run: python3 test_resample.py
#
# Version: 2026.02.00 - Wit Wonghanchao
# =============================================================================

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pandas as pd
from datetime import datetime, timedelta

from projects.tb_pivot_excel.v1.main import _resample_pivot

# ── Synthetic data builder ─────────────────────────────────────────────────────

def make_df(start="2026-01-01 00:00:00", days=35, interval_hours=6):
    """
    Build a synthetic pivot DataFrame with one column 'asset1 key1'.
    Values increment by 10 each interval (simulates cumulative meter).
    """
    timestamps = []
    values     = []
    ts  = datetime.fromisoformat(start)
    val = 1000.0
    end = ts + timedelta(days=days)
    while ts < end:
        timestamps.append(ts)
        values.append(round(val, 2))
        ts  += timedelta(hours=interval_hours)
        val += 10.0
    return pd.DataFrame({"Timestamp": timestamps, "asset1 key1": values})


def expected_daily(df, agg):
    """Compute expected daily values directly from raw df."""
    result  = {}
    grouped = df.groupby(df["Timestamp"].dt.date)["asset1 key1"]
    for d, g in grouped:
        if agg == "last":    result[d] = g.iloc[-1]
        elif agg == "first": result[d] = g.iloc[0]
        elif agg == "mean":  result[d] = round(g.mean(), 6)
        elif agg == "sum":   result[d] = round(g.sum(), 6)
        elif agg == "min":   result[d] = g.min()
        elif agg == "max":   result[d] = g.max()
    return result


# ── Test runner ────────────────────────────────────────────────────────────────

PASS = 0
FAIL = 0

def check(label, actual, expected, tol=0.01):
    global PASS, FAIL
    if actual is None or expected is None:
        print(f"  SKIP  {label} (no data)")
        return
    if abs(actual - expected) <= tol:
        print(f"  PASS  {label}  ({actual:,.2f})")
        PASS += 1
    else:
        print(f"  FAIL  {label}  got={actual:,.2f}  expected={expected:,.2f}  diff={actual-expected:,.4f}")
        FAIL += 1


# ── Test 1: Daily — all agg functions ─────────────────────────────────────────

print("=" * 60)
print("TEST 1: Daily aggregation — all agg functions")
print("=" * 60)

df         = make_df(start="2026-01-01 00:00:00", days=35, interval_hours=6)
sheets_cfg = {"week_start": "Sunday", "partial_period": False}

for agg in ["last", "first", "mean", "sum", "min", "max"]:
    print(f"\nagg='{agg}':")
    agg_map  = {"default": agg}
    df_daily = _resample_pivot(df, "D", agg_map, sheets_cfg)

    if df_daily.empty:
        print("  SKIP  (empty result)")
        continue

    exp = expected_daily(df, agg)
    for _, row in df_daily.head(3).iterrows():
        d   = row["Date"]
        val = row["asset1 key1"]
        check(f"Daily {d}", val, exp.get(d))


# ── Test 2: Weekly — last (week boundary check) ────────────────────────────────

print("\n" + "=" * 60)
print("TEST 2: Weekly aggregation — last (week boundary check)")
print("=" * 60)

df         = make_df(start="2026-01-01 00:00:00", days=35, interval_hours=6)
agg_map    = {"default": "last"}
sheets_cfg = {"week_start": "Sunday", "partial_period": False}
df_weekly  = _resample_pivot(df, "W", agg_map, sheets_cfg)

print(f"\nWeekly rows: {len(df_weekly)}")
for _, row in df_weekly.iterrows():
    d        = row["Date"]
    val      = row["asset1 key1"]
    week_end = d + timedelta(days=6)
    mask     = (df["Timestamp"].dt.date >= d) & (df["Timestamp"].dt.date <= week_end)
    week_df  = df[mask]
    exp_val  = week_df["asset1 key1"].iloc[-1] if not week_df.empty else None
    check(f"Weekly {d} (Sun-Sat)", val, exp_val)


# ── Test 3: Monthly — last ─────────────────────────────────────────────────────

print("\n" + "=" * 60)
print("TEST 3: Monthly aggregation — last")
print("=" * 60)

df         = make_df(start="2026-01-01 00:00:00", days=65, interval_hours=6)
agg_map    = {"default": "last"}
sheets_cfg = {"week_start": "Sunday", "partial_period": False}
df_monthly = _resample_pivot(df, "MS", agg_map, sheets_cfg)

print(f"\nMonthly rows: {len(df_monthly)}")
for _, row in df_monthly.iterrows():
    d        = row["Date"]
    val      = row["asset1 key1"]
    mask     = df["Timestamp"].dt.month == d.month
    month_df = df[mask]
    exp_val  = month_df["asset1 key1"].iloc[-1] if not month_df.empty else None
    check(f"Monthly {d}", val, exp_val)


# ── Test 4: Partial period exclusion ──────────────────────────────────────────

print("\n" + "=" * 60)
print("TEST 4: Partial period exclusion (partial_period=False)")
print("=" * 60)

df         = make_df(start="2026-01-01 12:00:00", days=5, interval_hours=6)
agg_map    = {"default": "last"}
sheets_cfg = {"week_start": "Sunday", "partial_period": False}
df_daily   = _resample_pivot(df, "D", agg_map, sheets_cfg)

first_date     = df_daily["Date"].iloc[0] if not df_daily.empty else None
expected_first = pd.Timestamp("2026-01-02").date()
print(f"\nData starts: 2026-01-01 12:00 (partial day)")
print(f"First daily row: {first_date}")
if first_date == expected_first:
    print(f"  PASS  Partial day 2026-01-01 correctly excluded")
    PASS += 1
else:
    print(f"  FAIL  Expected first date 2026-01-02, got {first_date}")
    FAIL += 1


# ── Summary ────────────────────────────────────────────────────────────────────

print("\n" + "=" * 60)
print(f"RESULTS: {PASS} passed, {FAIL} failed")
print("=" * 60)
sys.exit(0 if FAIL == 0 else 1)
