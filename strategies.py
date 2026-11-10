"""
strategies.py: simple fixed-rule bots, used by the tests and simulations.

Each strategy takes a StrategyView (public-tape information only) and returns
(bid, ask). They exist to check the engine's maths, not to be "good" players.

BENCHMARK BOTS ONLY: the StrategyView includes the rival's next quote, which a
human in Challenge mode never sees. These bots therefore have privileged access
and must not be presented as representative human players.
"""
from engine import StrategyView, floor_to_tick, ceil_to_tick

TICK = 1.0


def _fix(bid: float, ask: float) -> tuple[float, float]:
    """Clip to [0, 100] and make sure bid <= ask."""
    bid = min(max(bid, 0.0), 100.0)
    ask = min(max(ask, 0.0), 100.0)
    if bid > ask:
        mid = round((bid + ask) / 2)
        bid = ask = float(mid)
    return bid, ask


def just_inside_rival(v: StrategyView):
    """One tick inside the rival's quotes on both sides."""
    return _fix(v.rival_bid + TICK, v.rival_ask - TICK)


def outside_reference(v: StrategyView):
    """Just outside the reference: floor(B*), ceil(A*)."""
    return _fix(floor_to_tick(v.ref_bid, TICK), ceil_to_tick(v.ref_ask, TICK))


def at_rival(v: StrategyView):
    """Exactly the rival's quotes. Ties go to the rival, so no fills."""
    return _fix(v.rival_bid, v.rival_ask)


def tighter_by(k: float):
    """Rounded reference quotes pulled in by k points: loses on average."""
    def strategy(v: StrategyView):
        return _fix(round(v.ref_bid) + k, round(v.ref_ask) - k)
    return strategy
