"""
session.py: the game logic that sits between the engine and the web page.

Keeping this separate from app.py means the page only has to draw things,
and everything that decides what happens is tested.
"""
import json
import random
import uuid

from engine import Params, Round, draw_scenario
import coach


class GameSession:
    """A session of `params.rounds` rounds in Challenge or Practice mode."""

    def __init__(self, params: Params = Params(), mode: str = "challenge", seed: int | None = None):
        if mode not in ("challenge", "practice"):
            raise ValueError("mode must be 'challenge' or 'practice'")
        self.params = params
        self.mode = mode
        self.seed = seed if seed is not None else random.SystemRandom().randrange(2**32)
        self.session_id = uuid.uuid4().hex[:12]
        self._market_rng = random.Random(self.seed)   # rule L6: market-only RNG
        self.results = []
        self._logs = []
        self.round_number = 0
        self.current: Round | None = None
        self.start_round()

    # ---- flow --------------------------------------------------------------
    def start_round(self):
        if self.round_number >= self.params.rounds:
            raise RuntimeError("session is over")
        self.round_number += 1
        self.current = Round(self.params, draw_scenario(self._market_rng, self.params))

    @property
    def over(self) -> bool:
        return len(self.results) >= self.params.rounds

    def practice_reference(self):
        """Reference quotes shown BEFORE quoting, Practice mode only."""
        if self.mode == "practice" and not self.current.finished:
            return self.current.preview_reference()
        return None

    def lock(self, bid: float, ask: float):
        """Lock quotes for the current arrival. Returns (StepResult, coach note)."""
        step = self.current.submit(bid, ask)
        note = coach.step_note(step.record.direction, bid, ask, step.ref_bid,
                               step.ref_ask, step.player_filled, step.edge)
        return step, note

    def settle_round(self):
        """Settle the current round once. Returns (RoundResult, coach note)."""
        res = self.current.settle()
        if len(self.results) < self.round_number:
            self.results.append(res)
            self._logs.append(self.current.log_record(self.session_id, self.seed))
        return res, coach.round_note(res.edge, res.pnl, self.params.n_arrivals)

    def next_round(self):
        if not self.current.finished or len(self.results) < self.round_number:
            raise RuntimeError("settle the current round first")
        self.start_round()

    # ---- summaries ---------------------------------------------------------
    def totals(self):
        """(total expected edge, total realised profit) so far."""
        return (sum(r.edge for r in self.results), sum(r.pnl for r in self.results))

    def to_jsonl(self) -> str:
        """One JSON line per settled round (spec section 8)."""
        return "\n".join(json.dumps(x) for x in self._logs)
