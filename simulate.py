"""
simulate.py: run a bot for many rounds with a fixed seed, report mean +- SE.
"""
import math
import random
from engine import Params, Round, draw_scenario


def simulate(strategy, params: Params, n_rounds: int, seed: int):
    """Returns lists (pnl, edge, fills), one entry per round. Same seed gives the
    same rounds, so any statistical test can be replayed exactly."""
    rng = random.Random(seed)
    pnls, edges, fills = [], [], []
    for _ in range(n_rounds):
        rd = Round(params, draw_scenario(rng, params))
        while not rd.finished:
            bid, ask = strategy(rd.strategy_view())
            rd.submit(bid, ask)
        res = rd.settle()
        pnls.append(res.pnl)
        edges.append(res.edge)
        fills.append(res.n_fills)
    return pnls, edges, fills


def mean_se(xs):
    """Sample mean and its standard error."""
    n = len(xs)
    m = sum(xs) / n
    var = sum((x - m) ** 2 for x in xs) / (n - 1)
    return m, math.sqrt(var / n)


def variance(xs):
    m = sum(xs) / len(xs)
    return sum((x - m) ** 2 for x in xs) / (len(xs) - 1)


def exact_expectations(strategy, params: Params):
    """EXACT moments of a bot's round, no sampling.

    Enumerates both asset values and every possible sequence of trade
    directions, weighting each by its true probability. With 10 arrivals that
    is 2 x 1024 sequences. Returns a dict with E[pnl], E[edge], E[fills] and
    the variances of pnl and edge.

    Because it computes E[pnl] and E[edge] separately, it checks Property E
    (spec section 5) exactly, with no random error.

    The strategy sees the same StrategyView as in a live round, including the
    public tape so far, so tape-reading strategies are supported too. NOTE: it
    reuses the engine's own functions, so it is a regression check, not an
    independent proof. The independent check is tests/test_independent.py.
    """
    import itertools
    from engine import (BUY, SELL, PLAYER, RIVAL, StrategyView, TapeRecord,
                        trade_likelihoods, reference_quotes, rival_quotes,
                        update_belief, route, edge_of_fill)

    lik = trade_likelihoods(params.alpha)
    a = params.assumed
    tot = {"pnl": 0.0, "pnl2": 0.0, "edge": 0.0, "edge2": 0.0, "fills": 0.0}
    for value, pv in ((100, params.p0), (0, 1 - params.p0)):
        for dirs in itertools.product((BUY, SELL), repeat=params.n_arrivals):
            prob = pv
            for d in dirs:
                prob *= lik[(d, value)]
            belief, pnl, edge, nf = params.p0, 0.0, 0.0, 0
            tape = []
            for t, d in enumerate(dirs, start=1):
                rb, ra = reference_quotes(belief, a)
                vb, va = rival_quotes(belief, a, params.delta, params.tick)
                bid, ask = strategy(StrategyView(belief, rb, ra, vb, va, tuple(tape)))
                if route(d, bid, ask, vb, va) == PLAYER:
                    price = ask if d == BUY else bid
                    pnl += d * (price - value)
                    edge += edge_of_fill(d, price, rb, ra)
                    nf += 1
                    tape.append(TapeRecord(t, d, PLAYER, price))
                else:
                    tape.append(TapeRecord(t, d, RIVAL, va if d == BUY else vb))
                belief = update_belief(belief, d, a)
            tot["pnl"] += prob * pnl
            tot["pnl2"] += prob * pnl * pnl
            tot["edge"] += prob * edge
            tot["edge2"] += prob * edge * edge
            tot["fills"] += prob * nf
    return {
        "mean_pnl": tot["pnl"], "mean_edge": tot["edge"], "mean_fills": tot["fills"],
        "var_pnl": tot["pnl2"] - tot["pnl"] ** 2,
        "var_edge": tot["edge2"] - tot["edge"] ** 2,
    }
