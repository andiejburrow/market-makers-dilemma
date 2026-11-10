"""
Independent exact check of SPEC section 10.

This file deliberately imports NOTHING from engine.py, simulate.py or
strategies.py. It re-implements the model from the spec with exact fractions
(no floating point at all), so a bug shared by the engine and its own
enumerator cannot hide here. It enumerates all 2 x 2**10 (value, direction)
sequences.

The expected values were also obtained separately by ChatGPT's own code.
"""
import itertools
import math
from fractions import Fraction as F

import pytest

ALPHA, P0, N, DELTA, TICK = F(1, 5), F(1, 2), 10, 2, 1
BUY, SELL = 1, -1


def upd(p, d):
    if d == BUY:
        a, b = p * (1 + ALPHA), (1 - p) * (1 - ALPHA)
    else:
        a, b = p * (1 - ALPHA), (1 - p) * (1 + ALPHA)
    return a / (a + b)


def ref(p):
    return 100 * upd(p, SELL), 100 * upd(p, BUY)          # (bid, ask)


def rival(p):
    rb, ra = ref(p)
    return math.floor(max(F(0), rb - DELTA)), math.ceil(min(F(100), ra + DELTA))


def clip(bid, ask):
    bid, ask = min(max(bid, 0), 100), min(max(ask, 0), 100)
    if bid > ask:
        bid = ask = round(F(bid + ask, 2))
    return bid, ask


def just_inside(p):
    vb, va = rival(p)
    return clip(vb + 1, va - 1)


def floor_ceil(p):
    rb, ra = ref(p)
    return clip(math.floor(rb), math.ceil(ra))


def at_rival(p):
    return clip(*rival(p))


def tighter3(p):
    rb, ra = ref(p)
    return clip(round(rb) + 3, round(ra) - 3)


def lik(d, v):
    p_buy = (1 + ALPHA) / 2 if v == 100 else (1 - ALPHA) / 2
    return p_buy if d == BUY else 1 - p_buy


def exact(strategy):
    e_pnl = e_edge = e_fills = e_pnl2 = e_edge2 = F(0)
    for value, pv in ((100, P0), (0, 1 - P0)):
        for dirs in itertools.product((BUY, SELL), repeat=N):
            prob = pv
            p, pnl, edge, nf = P0, F(0), F(0), 0
            for d in dirs:
                prob *= lik(d, value)
                rb, ra = ref(p)
                vb, va = rival(p)
                bid, ask = strategy(p)
                if (d == BUY and ask < va) or (d == SELL and bid > vb):
                    price = ask if d == BUY else bid
                    pnl += d * (price - value)
                    edge += (price - ra) if d == BUY else (rb - price)
                    nf += 1
                p = upd(p, d)
            e_pnl += prob * pnl
            e_edge += prob * edge
            e_fills += prob * nf
            e_pnl2 += prob * pnl * pnl
            e_edge2 += prob * edge * edge
    return e_pnl, e_edge, e_fills, e_pnl2 - e_pnl ** 2, e_edge2 - e_edge ** 2


CASES = [
    ("just inside rival", just_inside, 13.151455744),
    ("floor/ceil reference", floor_ceil, 3.1576072192),
    ("exactly at rival", at_rival, 0.0),
    ("reference 3 points tighter", tighter3, -30.101023744),
]


@pytest.mark.parametrize("name,strategy,expected", CASES)
def test_section_10_exact_fractions(name, strategy, expected):
    e_pnl, e_edge, e_fills, var_pnl, var_edge = exact(strategy)
    assert e_pnl == e_edge                       # Property E, exactly equal as fractions
    assert float(e_pnl) == pytest.approx(expected, abs=1e-8)


def test_just_inside_rival_moments():
    _, _, fills, var_pnl, var_edge = exact(just_inside)
    assert float(fills) == pytest.approx(10.0)
    assert math.sqrt(var_pnl) == pytest.approx(123.4887, abs=1e-3)
    assert math.sqrt(var_edge) == pytest.approx(1.3860, abs=1e-3)


def test_engine_agrees_with_independent_calculation():
    """Link the two worlds: the engine's float enumerator must match the fractions."""
    import strategies as S
    from engine import Params
    from simulate import exact_expectations
    pairs = [(S.just_inside_rival, just_inside), (S.outside_reference, floor_ceil),
             (S.at_rival, at_rival), (S.tighter_by(3), tighter3)]
    for bot, frac in pairs:
        eng = exact_expectations(bot, Params())
        assert eng["mean_pnl"] == pytest.approx(float(exact(frac)[0]), abs=1e-8)
