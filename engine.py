"""
engine.py: the trading engine for The Market Maker's Dilemma (Stage 1).

Implements SPEC.md v0.3. Section numbers in the comments point at the spec.

Plain-English map of this file
------------------------------
1. The maths:        update_belief, reference_quotes         (spec section 3)
2. The rival:        rival_quotes, route                      (spec section 4.3)
3. Scoring:          edge_of_fill, round_pnl                  (spec sections 4.4, 5)
4. One round:        Scenario, draw_scenario, Round           (spec sections 4, 6)

Directions are integers: BUY = +1, SELL = -1 (the d_t of the spec).
Everything is in "points". The asset is worth 0 or 100.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, asdict

BUY = 1
SELL = -1
PLAYER = "player"
RIVAL = "rival"

_EPS = 1e-9  # guards floor/ceil against floating-point fuzz


# --------------------------------------------------------------------------- #
# Parameters (spec section 1)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Params:
    alpha: float = 0.2           # TRUE share of informed traders
    p0: float = 0.5              # prior chance the asset is worth 100
    n_arrivals: int = 10         # traders per round
    delta: float = 2.0           # rival's margin, in points
    tick: float = 1.0            # quotes must be multiples of this
    rounds: int = 10             # rounds per session
    alpha_assumed: float | None = None  # Stage 2 hook; None means "same as alpha"

    def __post_init__(self):
        if not (0 <= self.alpha < 1):
            raise ValueError("alpha must satisfy 0 <= alpha < 1")
        if self.alpha_assumed is not None and not (0 <= self.alpha_assumed < 1):
            raise ValueError("alpha_assumed must satisfy 0 <= alpha_assumed < 1")
        if not (0 < self.p0 < 1):
            raise ValueError("p0 must be strictly between 0 and 1")
        if self.tick <= 0:
            raise ValueError("tick must be positive")

    @property
    def assumed(self) -> float:
        """The alpha the reference and the rival use to price.
        Stage 2 note (SPEC F15): the spec says the rival knows the TRUE alpha,
        but here the rival prices with this assumed alpha. Identical in Stage 1.
        Decide which is intended before building Stage 2."""
        return self.alpha if self.alpha_assumed is None else self.alpha_assumed


# --------------------------------------------------------------------------- #
# 1. The maths (spec section 3)
# --------------------------------------------------------------------------- #
def trade_likelihoods(alpha: float) -> dict:
    """P(direction | value). Informed traders always trade the right way;
    uninformed traders flip a fair coin."""
    return {
        (BUY, 100): (1 + alpha) / 2,
        (BUY, 0): (1 - alpha) / 2,
        (SELL, 100): (1 - alpha) / 2,
        (SELL, 0): (1 + alpha) / 2,
    }


def update_belief(p: float, direction: int, alpha: float) -> float:
    """Bayes' rule: new belief that the asset is worth 100 after one trade.

    p is the belief BEFORE the trade. The factors of 1/2 in the likelihoods
    cancel, which is why they do not appear here.
    """
    if direction == BUY:
        worth_100 = p * (1 + alpha)
        worth_0 = (1 - p) * (1 - alpha)
    elif direction == SELL:
        worth_100 = p * (1 - alpha)
        worth_0 = (1 - p) * (1 + alpha)
    else:
        raise ValueError("direction must be BUY (+1) or SELL (-1)")
    return worth_100 / (worth_100 + worth_0)


def reference_quotes(p: float, alpha: float) -> tuple[float, float]:
    """Break-even (bid, ask) in points for the NEXT trader.

    ask = expected value of the asset given that the next trader BUYS.
    bid = expected value of the asset given that the next trader SELLS.
    """
    ask = 100 * update_belief(p, BUY, alpha)
    bid = 100 * update_belief(p, SELL, alpha)
    return bid, ask


def belief_from_directions(directions, alpha: float, p0: float = 0.5) -> float:
    """Belief after a whole tape of directions, one update at a time."""
    p = p0
    for d in directions:
        p = update_belief(p, d, alpha)
    return p


# --------------------------------------------------------------------------- #
# 2. The rival and routing (spec section 4.3)
# --------------------------------------------------------------------------- #
def floor_to_tick(x: float, tick: float) -> float:
    return math.floor(x / tick + _EPS) * tick


def ceil_to_tick(x: float, tick: float) -> float:
    return math.ceil(x / tick - _EPS) * tick


def rival_quotes(p: float, alpha: float, delta: float, tick: float) -> tuple[float, float]:
    """The rival's mechanical rule: reference quotes pushed outward by delta,
    rounded outward to the tick and clipped to [0, 100]."""
    ref_bid, ref_ask = reference_quotes(p, alpha)
    bid = floor_to_tick(max(0.0, ref_bid - delta), tick)
    ask = ceil_to_tick(min(100.0, ref_ask + delta), tick)
    return bid, ask


def validate_quote(bid: float, ask: float, tick: float) -> None:
    """Spec 4.2: multiples of the tick, 0 <= bid <= ask <= 100."""
    for name, x in (("bid", bid), ("ask", ask)):
        if abs(x / tick - round(x / tick)) > 1e-9:
            raise ValueError(f"{name} must be a multiple of {tick}")
    if not (0 <= bid <= ask <= 100):
        raise ValueError("quotes must satisfy 0 <= bid <= ask <= 100")


def route(direction: int, bid: float, ask: float, rival_bid: float, rival_ask: float) -> str:
    """Who fills this arrival? By price only; ties go to the rival."""
    if direction == BUY:
        return PLAYER if ask < rival_ask else RIVAL
    if direction == SELL:
        return PLAYER if bid > rival_bid else RIVAL
    raise ValueError("direction must be BUY (+1) or SELL (-1)")


# --------------------------------------------------------------------------- #
# 3. Scoring (spec sections 4.4 and 5)
# --------------------------------------------------------------------------- #
def edge_of_fill(direction: int, price: float, ref_bid: float, ref_ask: float) -> float:
    """Expected profit of one fill under the model, in points."""
    if direction == BUY:      # the player SOLD at `price`
        return price - ref_ask
    if direction == SELL:     # the player BOUGHT at `price`
        return ref_bid - price
    raise ValueError("direction must be BUY (+1) or SELL (-1)")


def round_pnl(fills, value: float) -> float:
    """Realised profit. `fills` is a list of (direction, price) for the player's
    fills. Settlement closes all inventory at the true value."""
    return sum(d * (price - value) for d, price in fills)


# --------------------------------------------------------------------------- #
# 4. One round (spec sections 4 and 6)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Scenario:
    """The hidden script of one round. Sealed inside the engine (rule L1)."""
    value: int
    informed: tuple
    directions: tuple


def draw_scenario(rng: random.Random, params: Params) -> Scenario:
    """Draw value, trader types and directions with the market RNG."""
    value = 100 if rng.random() < params.p0 else 0
    informed, directions = [], []
    for _ in range(params.n_arrivals):
        is_informed = rng.random() < params.alpha
        if is_informed:
            d = BUY if value == 100 else SELL
        else:
            d = BUY if rng.random() < 0.5 else SELL
        informed.append(is_informed)
        directions.append(d)
    return Scenario(value, tuple(informed), tuple(directions))


@dataclass(frozen=True)
class TapeRecord:
    """One public record per arrival, whoever filled it (spec 4.5)."""
    t: int
    direction: int
    filler: str
    price: float


@dataclass(frozen=True)
class StepResult:
    """What the player learns right after locking quotes (spec 4.1, step 3)."""
    record: TapeRecord
    ref_bid: float
    ref_ask: float
    player_filled: bool
    edge: float | None   # None if the rival filled the trade


@dataclass(frozen=True)
class StrategyView:
    """Everything a BENCHMARK BOT may use to quote. Only public-tape information,
    but it includes the rival's NEXT quote, which a human in Challenge mode never
    sees. So bots built on this view have privileged access and are benchmarks,
    not stand-ins for a human player. app.py must never call strategy_view()
    (a test checks this)."""
    belief: float
    ref_bid: float
    ref_ask: float
    rival_bid: float
    rival_ask: float
    tape: tuple


@dataclass(frozen=True)
class RoundResult:
    """Everything revealed AFTER settlement (rule L5)."""
    value: int
    informed: tuple
    pnl: float
    edge: float
    luck: float
    n_fills: int
    tape: tuple
    quotes: tuple   # one dict per arrival: all quotes, now revealed


class Round:
    """One round of the game: N arrivals, then settlement."""

    def __init__(self, params: Params, scenario: Scenario):
        self._params = params
        self._scenario = scenario          # sealed: never exposed before settle()
        self._tape: list[TapeRecord] = []
        self._log: list[dict] = []
        self._fills: list[tuple[int, float]] = []
        self._edge = 0.0
        self._cash = 0.0
        self._inventory = 0
        self._belief = params.p0
        self._t = 0
        self._result: RoundResult | None = None

    # ---- what anyone may see during the round ------------------------------
    @property
    def finished(self) -> bool:
        return self._t >= self._params.n_arrivals

    @property
    def arrival(self) -> int:
        """Number of the NEXT arrival (1-based), or n_arrivals + 1 when done."""
        return self._t + 1

    def preview_reference(self) -> tuple[float, float]:
        """Reference quotes for the next arrival. Practice mode only."""
        return reference_quotes(self._belief, self._params.assumed)

    def strategy_view(self) -> StrategyView:
        """Public-tape information for bots and tests (see StrategyView)."""
        a = self._params.assumed
        rb, ra = reference_quotes(self._belief, a)
        vb, va = rival_quotes(self._belief, a, self._params.delta, self._params.tick)
        return StrategyView(self._belief, rb, ra, vb, va, tuple(self._tape))

    def public_view(self) -> dict:
        """The only thing the browser/UI is allowed to see mid-round (rule L3):
        no value, no trader types, no future arrivals, no unexecuted rival quotes."""
        return {
            "arrival": self.arrival,
            "n_arrivals": self._params.n_arrivals,
            "alpha": self._params.alpha,
            "tape": [asdict(r) for r in self._tape],
            "cash": self._cash,
            "inventory": self._inventory,
            "finished": self.finished,
        }

    # ---- one arrival -------------------------------------------------------
    def submit(self, bid: float, ask: float) -> StepResult:
        """Lock the quotes, reveal the trader, route, update (rule L4 order)."""
        if self.finished:
            raise RuntimeError("round is finished")
        p = self._params
        validate_quote(bid, ask, p.tick)

        # Everything below uses only the public tape (belief) and the quotes.
        ref_bid, ref_ask = reference_quotes(self._belief, p.assumed)
        riv_bid, riv_ask = rival_quotes(self._belief, p.assumed, p.delta, p.tick)

        d = self._scenario.directions[self._t]
        filler = route(d, bid, ask, riv_bid, riv_ask)
        if filler == PLAYER:
            price = ask if d == BUY else bid
        else:
            price = riv_ask if d == BUY else riv_bid

        edge = None
        if filler == PLAYER:
            edge = edge_of_fill(d, price, ref_bid, ref_ask)
            self._edge += edge
            self._fills.append((d, price))
            if d == BUY:     # player sold one unit
                self._cash += price
                self._inventory -= 1
            else:            # player bought one unit
                self._cash -= price
                self._inventory += 1

        record = TapeRecord(self._t + 1, d, filler, price)
        self._tape.append(record)
        self._log.append({
            "t": self._t + 1, "belief_before": self._belief,
            "player_bid": bid, "player_ask": ask,
            "rival_bid": riv_bid, "rival_ask": riv_ask,
            "ref_bid": ref_bid, "ref_ask": ref_ask,
        })
        self._belief = update_belief(self._belief, d, p.assumed)
        self._t += 1
        return StepResult(record, ref_bid, ref_ask, filler == PLAYER, edge)

    # ---- settlement --------------------------------------------------------
    def settle(self) -> RoundResult:
        """Reveal the value and types and compute the scores (rule L5)."""
        if not self.finished:
            raise RuntimeError("cannot settle before the last arrival (rule L5)")
        if self._result is None:
            value = self._scenario.value
            pnl = self._cash + self._inventory * value
            assert abs(pnl - round_pnl(self._fills, value)) < 1e-9  # two routes agree
            self._result = RoundResult(
                value=value, informed=self._scenario.informed, pnl=pnl,
                edge=self._edge, luck=pnl - self._edge, n_fills=len(self._fills),
                tape=tuple(self._tape), quotes=tuple(self._log),
            )
        return self._result

    def log_record(self, session_id: str, seed: int) -> dict:
        """One JSON-able line per round (spec section 8). Only after settlement."""
        r = self.settle()
        return {
            "session_id": session_id, "seed": seed, "params": asdict(self._params),
            "value": r.value, "informed": list(r.informed),
            "tape": [asdict(x) for x in r.tape], "quotes": list(r.quotes),
            "edge": r.edge, "pnl": r.pnl, "n_fills": r.n_fills,
        }
