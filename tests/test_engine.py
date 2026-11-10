"""
Acceptance tests T1 to T16 from SPEC.md v0.3, plus exact and session checks.

Statistical tests use FIXED seeds and report the sample size, mean and
standard error (spec section 9), so any failure can be replayed exactly.
Run with:  pytest -v        (add -s to see the printed statistics)
"""
import itertools
import json
import math
import random

import pytest

import coach
import strategies as S
from engine import (BUY, SELL, PLAYER, RIVAL, Params, Round, Scenario, TapeRecord,
                    trade_likelihoods, update_belief, reference_quotes,
                    belief_from_directions, rival_quotes, route, validate_quote,
                    edge_of_fill, round_pnl, draw_scenario)
from session import GameSession
from simulate import simulate, mean_se, variance, exact_expectations

P = Params()          # the spec defaults: alpha .2, p0 .5, N 10, delta 2, tick 1, R 10
N_STAT = 100_000      # rounds for statistical tests (spec T6/T7)


# ---------------------------------------------------------------- the maths
def test_T1_likelihoods_sum_to_one():
    for alpha in (0.0, 0.2, 0.6, 0.999):
        lik = trade_likelihoods(alpha)
        for v in (0, 100):
            assert lik[(BUY, v)] + lik[(SELL, v)] == pytest.approx(1.0)


def test_T2_worked_table():
    rows = [  # tape, p, bid, ask   (alpha .2, p0 .5)
        ([], 0.5, 40.0, 60.0),
        ([BUY], 0.6, 50.0, 69.2308),
        ([BUY, BUY], 0.6923, 60.0, 77.1429),
        ([BUY, SELL], 0.5, 40.0, 60.0),
        ([SELL, SELL], 0.3077, 22.8571, 40.0),
    ]
    for tape, p, bid, ask in rows:
        belief = belief_from_directions(tape, 0.2, 0.5)
        b, a = reference_quotes(belief, 0.2)
        assert belief == pytest.approx(p, abs=1e-4)
        assert b == pytest.approx(bid, abs=1e-4)
        assert a == pytest.approx(ask, abs=1e-4)


def test_T3_bid_ask_symmetry():
    rng = random.Random(1)
    for _ in range(1000):
        p, alpha = rng.uniform(0.01, 0.99), rng.uniform(0, 0.95)
        _, ask = reference_quotes(p, alpha)
        bid_mirror, _ = reference_quotes(1 - p, alpha)
        assert ask + bid_mirror == pytest.approx(100.0)


def test_T4_odds_identity_and_order_independence():
    alpha = 0.3
    r = (1 + alpha) / (1 - alpha)
    tapes = set(itertools.permutations([BUY, BUY, BUY, SELL, SELL]))
    beliefs = set()
    for tape in tapes:
        p = belief_from_directions(tape, alpha, 0.5)
        beliefs.add(round(p, 12))
        odds = p / (1 - p)
        expected = 1.0 * r ** (tape.count(BUY) - tape.count(SELL))   # prior odds are 1
        assert odds == pytest.approx(expected)
    assert len(beliefs) == 1   # order does not matter


def test_T5_extreme_alphas():
    for p in (0.1, 0.5, 0.9):
        b, a = reference_quotes(p, 0.0)
        assert b == pytest.approx(100 * p) and a == pytest.approx(100 * p)
    b, a = reference_quotes(0.5, 0.999)
    assert a - b == pytest.approx(99.9, abs=0.01)


# ------------------------------------------------- statistical tests (seeded)
def test_T6_forced_fills_at_reference_have_zero_mean_profit():
    """Sell at A* / buy at B* on every arrival (no routing): mean profit ~ 0."""
    rng = random.Random(2026)
    pnls = []
    for _ in range(N_STAT):
        sc = draw_scenario(rng, P)
        p, fills = P.p0, []
        for d in sc.directions:
            b, a = reference_quotes(p, P.alpha)
            fills.append((d, a if d == BUY else b))
            p = update_belief(p, d, P.alpha)
        pnls.append(round_pnl(fills, sc.value))
    m, se = mean_se(pnls)
    print(f"\nT6 n={N_STAT} seed=2026 mean={m:.3f} se={se:.3f}")
    assert abs(m) < 3 * se


BOTS = {
    "just inside rival": S.just_inside_rival,
    "outside reference": S.outside_reference,
    "3 points tighter": S.tighter_by(3),
}


@pytest.mark.parametrize("name", list(BOTS))
def test_T7_property_E_statistical(name):
    """Mean of (profit minus edge) is zero within 3 standard errors.
    The variance ratio is printed for information only (not pass/fail)."""
    pnl, edge, fills = simulate(BOTS[name], P, N_STAT, seed=777)
    diff = [x - y for x, y in zip(pnl, edge)]
    m, se = mean_se(diff)
    ratio = variance(edge) / variance(pnl)
    print(f"\nT7 [{name}] n={N_STAT} seed=777 mean(pnl-edge)={m:.3f} se={se:.3f} "
          f"mean pnl={sum(pnl)/N_STAT:.2f} mean edge={sum(edge)/N_STAT:.2f} "
          f"Var(edge)/Var(pnl)={ratio:.6f} (informational)")
    assert abs(m) < 3 * se


@pytest.mark.parametrize("name", list(BOTS))
def test_T7_property_E_exact(name):
    """No sampling at all: enumerate every possible round. E[pnl] equals E[edge]."""
    r = exact_expectations(BOTS[name], P)
    assert r["mean_pnl"] == pytest.approx(r["mean_edge"], abs=1e-9)


@pytest.mark.parametrize("name", list(BOTS))
def test_simulation_matches_exact(name):
    """The engine (sampled) agrees with the independent exact enumeration."""
    pnl, edge, _ = simulate(BOTS[name], P, 50_000, seed=31415)
    exact = exact_expectations(BOTS[name], P)
    m_p, se_p = mean_se(pnl)
    m_e, se_e = mean_se(edge)
    assert abs(m_p - exact["mean_pnl"]) < 4 * se_p
    assert abs(m_e - exact["mean_edge"]) < 4 * se_e + 1e-9


def test_at_rival_gets_no_fills_ties_go_to_rival():
    r = exact_expectations(S.at_rival, P)
    assert r["mean_fills"] == 0.0 and r["mean_pnl"] == 0.0


# ------------------------------------------------------------ mechanics
def test_T8_routing_table():
    rb, ra = 38.0, 62.0
    assert route(BUY, 40, 61, rb, ra) == PLAYER   # ask below rival ask
    assert route(BUY, 40, 62, rb, ra) == RIVAL    # tie
    assert route(BUY, 40, 63, rb, ra) == RIVAL    # above
    assert route(SELL, 39, 61, rb, ra) == PLAYER  # bid above rival bid
    assert route(SELL, 38, 61, rb, ra) == RIVAL   # tie
    assert route(SELL, 37, 61, rb, ra) == RIVAL   # below


def test_T9_settlement():
    both = [(BUY, 60.0), (SELL, 50.0)]
    assert round_pnl(both, 100) == 10 and round_pnl(both, 0) == 10
    assert round_pnl([(BUY, 60.0)], 100) == -40
    assert round_pnl([(BUY, 60.0)], 0) == 60


def test_T10_rival_quotes():
    assert rival_quotes(0.5, 0.2, 2, 1) == (38, 62)
    assert rival_quotes(0.6, 0.2, 2, 1) == (48, 72)
    assert rival_quotes(belief_from_directions([BUY, BUY], 0.2), 0.2, 2, 1) == (58, 80)


def test_T11_edge():
    rb, ra = reference_quotes(0.5, 0.2)
    assert edge_of_fill(BUY, 61, rb, ra) == pytest.approx(1.0)
    assert edge_of_fill(SELL, 39, rb, ra) == pytest.approx(1.0)


def test_T12_quote_validation():
    validate_quote(40, 60, 1)
    for bid, ask in [(61, 60), (-1, 60), (40, 101), (40.5, 60), (40, 60.5)]:
        with pytest.raises(ValueError):
            validate_quote(bid, ask, 1)


# ------------------------------------------------------------ information
def _run_fixed(scenario, bot):
    rd = Round(P, scenario)
    while not rd.finished:
        rd.submit(*bot(rd.strategy_view()))
    return rd.settle()


def test_T13_no_leakage_of_value_or_types():
    """Same public tape, different hidden value and trader types: every quote
    (reference, rival, player's bot) must be identical."""
    dirs = (BUY, BUY, SELL, BUY, SELL, SELL, BUY, BUY, BUY, SELL)
    a = Scenario(100, (True,) * 10, dirs)
    b = Scenario(0, (False,) * 10, dirs)
    ra, rb = _run_fixed(a, S.just_inside_rival), _run_fixed(b, S.just_inside_rival)
    assert ra.quotes == rb.quotes
    assert ra.tape == rb.tape


def test_T14_public_view_has_no_hidden_information():
    sc = draw_scenario(random.Random(5), P)
    rd = Round(P, sc)
    rd.submit(30, 70)
    view = rd.public_view()
    assert set(view) == {"arrival", "n_arrivals", "alpha", "tape", "cash", "inventory", "finished"}
    text = json.dumps(view)
    for word in ("value", "informed", "rival_bid", "rival_ask", "direction_future"):
        assert word not in text.replace("direction", "")  # tape's own 'direction' key is fine
    assert all(set(rec) == {"t", "direction", "filler", "price"} for rec in view["tape"])
    assert len(view["tape"]) == 1            # no future arrivals
    with pytest.raises(RuntimeError):        # rule L5: no settlement mid-round
        rd.settle()


def test_T15_same_seed_same_round_and_clipping():
    r1 = simulate(S.just_inside_rival, P, 50, seed=99)
    r2 = simulate(S.just_inside_rival, P, 50, seed=99)
    assert r1 == r2
    assert rival_quotes(0.5, 0.999, 2, 1)[1] == 100     # ask clipped at 100
    assert rival_quotes(0.9999, 0.2, 2, 1)[1] == 100
    assert rival_quotes(1e-6, 0.2, 2, 1)[0] == 0        # bid clipped at 0


def test_T16_tape_has_one_record_per_arrival_including_rival_fills():
    sc = draw_scenario(random.Random(8), P)
    rd = Round(P, sc)
    while not rd.finished:
        rd.submit(1, 99)          # absurdly wide quotes: the rival fills everything
    res = rd.settle()
    assert len(res.tape) == P.n_arrivals
    assert [r.t for r in res.tape] == list(range(1, P.n_arrivals + 1))
    assert all(isinstance(r, TapeRecord) and r.filler == RIVAL for r in res.tape)
    assert res.n_fills == 0 and res.pnl == 0


# ------------------------------------------------- hand-checked scenario
def test_hand_checked_round():
    """The spec's worked example, played by hand: BUY, BUY, SELL ..."""
    dirs = (BUY, BUY, SELL) + (BUY, SELL) * 3 + (BUY,)
    sc = Scenario(100, (False,) * 10, dirs)
    rd = Round(P, sc)
    s1 = rd.submit(39, 61)                   # rival is 38/62, so the player fills
    assert s1.player_filled and s1.edge == pytest.approx(1.0)   # 61 - 60
    assert (s1.ref_bid, s1.ref_ask) == (pytest.approx(40), pytest.approx(60))
    s2 = rd.submit(49, 71)                   # rival 48/72; reference ask 69.2308
    assert s2.player_filled and s2.edge == pytest.approx(71 - 69.230769, abs=1e-5)
    s3 = rd.submit(39, 99)                   # SELL: p was 0.6923 so rival bid is 58
    assert not s3.player_filled and s3.record.filler == RIVAL and s3.record.price == 58


# ----------------------------------------------------- coach and session
def test_coach_never_uses_banned_words_and_never_leaks_value():
    sc = draw_scenario(random.Random(3), P)
    rd = Round(P, sc)
    notes = []
    while not rd.finished:
        st = rd.submit(35, 65)
        notes.append(coach.step_note(st.record.direction, 35, 65, st.ref_bid,
                                     st.ref_ask, st.player_filled, st.edge))
    res = rd.settle()
    notes.append(coach.round_note(res.edge, res.pnl, P.n_arrivals))
    for n in notes:
        for w in coach.BANNED_WORDS:
            assert w not in n.lower()
    assert all("worth 100" not in n and "worth 0" not in n for n in notes[:-1])


def test_session_plays_a_full_game():
    g = GameSession(P, mode="challenge", seed=42)
    assert g.practice_reference() is None          # Challenge hides the reference
    while not g.over:
        while not g.current.finished:
            g.lock(*S.just_inside_rival(g.current.strategy_view()))
        g.settle_round()
        if not g.over:
            g.next_round()
    assert len(g.results) == P.rounds
    assert len(g.to_jsonl().splitlines()) == P.rounds
    edge, pnl = g.totals()
    assert edge == pytest.approx(sum(r.edge for r in g.results))
    with pytest.raises(RuntimeError):
        g.start_round()


def test_session_practice_mode_shows_reference_before_quoting():
    g = GameSession(P, mode="practice", seed=1)
    assert g.practice_reference() == pytest.approx((40.0, 60.0))


def test_session_is_reproducible_from_its_seed():
    def play(seed):
        g = GameSession(P, seed=seed)
        while not g.current.finished:
            g.lock(30, 70)
        return g.settle_round()[0].value, [t.direction for t in g.current.settle().tape]
    assert play(7) == play(7)


def test_session_blocks_skipping_settlement():
    g = GameSession(P, seed=3)
    with pytest.raises(RuntimeError):
        g.next_round()


# ------------------------------------------------ audit follow-ups (SPEC v0.5)
def test_T12_invalid_directions_and_parameters():
    """Every helper rejects a bad direction; Params rejects bad numbers."""
    for bad in (0, 2, -2):
        with pytest.raises(ValueError):
            update_belief(0.5, bad, 0.2)
        with pytest.raises(ValueError):
            route(bad, 40, 60, 38, 62)
        with pytest.raises(ValueError):
            edge_of_fill(bad, 60, 40.0, 60.0)
    for kwargs in ({"alpha": 1.0}, {"alpha": -0.1}, {"p0": 0.0}, {"p0": 1.0},
                   {"tick": 0}, {"alpha_assumed": 1.0}):
        with pytest.raises(ValueError):
            Params(**kwargs)


def _two_sessions():
    """Two sessions with the SAME public directions but different hidden value and
    trader types, built through the real GameSession (not just Round)."""
    dirs = (BUY, BUY, SELL, BUY, SELL, SELL, BUY, BUY, BUY, SELL)
    sessions = []
    for value, informed in ((100, (True,) * 10), (0, (False,) * 10)):
        g = GameSession(P, mode="challenge", seed=1)
        g.current = Round(P, Scenario(value, informed, dirs))
        sessions.append(g)
    return sessions


def test_T13_coach_and_session_outputs_do_not_depend_on_hidden_state():
    """Same tape, different value/types: everything the player is shown before
    settlement (step result, coach note, public view) is identical."""
    ga, gb = _two_sessions()
    for _ in range(P.n_arrivals):
        sa, na = ga.lock(35, 65)
        sb, nb = gb.lock(35, 65)
        assert sa == sb and na == nb
        assert ga.current.public_view() == gb.current.public_view()
    ra, rna = ga.settle_round()
    rb, rnb = gb.settle_round()
    assert ra.value != rb.value               # after settlement they may differ


def test_T14_session_flow_leaks_nothing_before_settlement_and_app_stays_thin():
    g = GameSession(P, mode="challenge", seed=5)
    hidden = ("value", "informed", "rival_bid", "rival_ask", "ref_bid", "ref_ask")
    for _ in range(P.n_arrivals):
        text = json.dumps(g.current.public_view())            # before quoting
        assert not any(w in text for w in hidden)
        g.lock(30, 70)
        text = json.dumps(g.current.public_view())            # after quoting
        assert not any(w in text for w in hidden)
    with pytest.raises(RuntimeError):                         # L5 via the session too
        GameSession(P, seed=6).settle_round()
    # The page may not reach into the sealed scenario or the bots' privileged view.
    import pathlib
    src = (pathlib.Path(__file__).parent.parent / "app.py").read_text()
    assert "strategy_view" not in src
    assert "_scenario" not in src


def test_T16_mixed_player_and_rival_fills_every_price_recorded():
    p3 = Params(n_arrivals=3)
    rd = Round(p3, Scenario(100, (False,) * 3, (BUY, BUY, SELL)))
    rd.submit(39, 61)     # rival 38/62: player ask 61 < 62 -> PLAYER fills at 61
    rd.submit(49, 72)     # rival 48/72: player ask 72 ties -> RIVAL fills at 72
    rd.submit(59, 99)     # rival bid 58: player bid 59 > 58 -> PLAYER fills at 59
    res = rd.settle()
    assert [(r.t, r.direction, r.filler, r.price) for r in res.tape] == [
        (1, BUY, PLAYER, 61), (2, BUY, RIVAL, 72), (3, SELL, PLAYER, 59)]
    assert res.n_fills == 2
    assert res.pnl == pytest.approx(2.0)      # (61 - 100) + (100 - 59), same at V=0
    assert res.edge == pytest.approx(2.0)     # 1 + 1
    assert [q["rival_ask"] for q in res.quotes][1] == 72


def _reads_tape(v):
    """Tape-reading bot: stand aside right after the player's own fill, so it
    fills about every other arrival. It only works if the tape is correct."""
    if v.tape and v.tape[-1].filler == PLAYER:
        return S.at_rival(v)
    return S.just_inside_rival(v)


def test_exact_enumerator_supports_tape_reading_strategies():
    pnl, edge, _ = simulate(_reads_tape, P, 50_000, seed=2718)
    exact = exact_expectations(_reads_tape, P)
    assert abs(sum(pnl) / len(pnl) - exact["mean_pnl"]) < 4 * mean_se(pnl)[1]
    assert abs(sum(edge) / len(edge) - exact["mean_edge"]) < 4 * mean_se(edge)[1] + 1e-9
    assert 3 < exact["mean_fills"] < 7       # really alternates (empty tape would give 10)
