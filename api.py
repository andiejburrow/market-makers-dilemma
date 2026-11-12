"""
api.py: the JSON layer between the game engine and the web page.

Everything the browser can ever receive is built in THIS file, from the public
view of the round. The hidden scenario (true value, trader types, future
arrivals) is only added to a response after settlement (SPEC rules L3 and L5).
The web page therefore cannot show anything the spec forbids, because the server
never sends it.
"""
import math
import secrets

from engine import BUY, Params, update_belief
from session import GameSession

PARAMS = Params()
MAX_SESSIONS = 500


class ApiError(Exception):
    """A problem the player should see (bad quote, wrong order of steps)."""


def _word(direction: int) -> str:
    return "BUY" if direction == BUY else "SELL"


def _who(filler: str) -> str:
    return "you" if filler == "player" else "rival"


class GameApi:
    def __init__(self, params: Params = PARAMS):
        self.params = params
        self._sessions: dict = {}

    # ---- helpers ------------------------------------------------------------
    def _get(self, sid):
        try:
            return self._sessions[sid]
        except (KeyError, TypeError):
            raise ApiError("unknown or expired session; start a new one")

    def config(self) -> dict:
        p = self.params
        return {"alpha": p.alpha, "p0": p.p0, "n_arrivals": p.n_arrivals, "rounds": p.rounds,
                "delta": p.delta, "tick": p.tick}

    # ---- the public state ---------------------------------------------------
    def state(self, sid) -> dict:
        st = self._get(sid)
        g: GameSession = st["game"]
        view = g.current.public_view()          # public information only
        ref = g.practice_reference()            # None in Challenge mode
        results = [{"round": i + 1, "value": r.value, "edge": r.edge, "pnl": r.pnl,
                    "luck": r.luck, "fills": r.n_fills} for i, r in enumerate(g.results)]
        total_edge, total_pnl = g.totals()
        return {
            "sid": sid, "mode": g.mode, "round": g.round_number, "rounds": self.params.rounds,
            "n_arrivals": self.params.n_arrivals,
            "arrival": view["arrival"],
            "served": min(view["arrival"] - 1, self.params.n_arrivals),
            "finished": view["finished"],
            "cash": view["cash"], "inventory": view["inventory"],
            "round_edge": st["edge"], "alpha": view["alpha"], "tick": self.params.tick,
            "tape": [{"t": r["t"], "direction": _word(r["direction"]),
                      "filler": _who(r["filler"]), "price": r["price"]} for r in view["tape"]],
            "reference": None if ref is None else {"bid": ref[0], "ask": ref[1]},
            "last": st["last"],
            "review": st["review"],
            "session": {"results": results, "total_edge": total_edge, "total_pnl": total_pnl,
                        "over": g.over},
        }

    # ---- actions ------------------------------------------------------------
    def start(self, mode) -> dict:
        if mode not in ("challenge", "practice"):
            raise ApiError("mode must be 'challenge' or 'practice'")
        while len(self._sessions) >= MAX_SESSIONS:
            self._sessions.pop(next(iter(self._sessions)))      # drop the oldest
        sid = secrets.token_urlsafe(12)
        self._sessions[sid] = {"game": GameSession(self.params, mode=mode),
                               "last": None, "edge": 0.0, "review": None}
        return self.state(sid)

    def lock(self, sid, bid, ask) -> dict:
        st = self._get(sid)
        g: GameSession = st["game"]
        if g.current.finished:
            raise ApiError("the round is finished; settle it first")
        try:
            bid, ask = float(bid), float(ask)
        except (TypeError, ValueError):
            raise ApiError("bid and ask must be numbers")
        if not (math.isfinite(bid) and math.isfinite(ask)):
            raise ApiError("bid and ask must be numbers")
        try:
            step, note = g.lock(bid, ask)
        except ValueError as e:
            raise ApiError(str(e))
        rec = step.record
        st["last"] = {"t": rec.t, "direction": _word(rec.direction), "my_bid": bid, "my_ask": ask,
                      "filler": _who(rec.filler), "price": rec.price,
                      "ref_bid": step.ref_bid, "ref_ask": step.ref_ask,
                      "edge": step.edge, "note": note}
        if step.edge is not None:
            st["edge"] += step.edge
        return self.state(sid)

    def settle(self, sid) -> dict:
        st = self._get(sid)
        g: GameSession = st["game"]
        if not g.current.finished:
            raise ApiError("cannot settle before the last arrival")
        res, note = g.settle_round()
        st["review"] = self._review(res, note)
        return self.state(sid)

    def next_round(self, sid) -> dict:
        st = self._get(sid)
        try:
            st["game"].next_round()
        except RuntimeError as e:
            raise ApiError(str(e))
        st["last"], st["edge"], st["review"] = None, 0.0, None
        return self.state(sid)

    def log(self, sid) -> str:
        return self._get(sid)["game"].to_jsonl()

    # ---- after settlement only ----------------------------------------------
    def _review(self, res, note) -> dict:
        p = self.params
        beliefs = [q["belief_before"] * 100 for q in res.quotes]
        beliefs.append(update_belief(res.quotes[-1]["belief_before"], res.tape[-1].direction,
                                     p.assumed) * 100)
        per_edge, cum_edge, cum_pnl, e_run, p_run, rows = [], [], [], 0.0, 0.0, []
        for rec, informed, q in zip(res.tape, res.informed, res.quotes):
            if rec.filler == "player":
                e = (rec.price - q["ref_ask"]) if rec.direction == BUY else (q["ref_bid"] - rec.price)
                p_run += rec.direction * (rec.price - res.value)
            else:
                e = 0.0
            e_run += e
            per_edge.append(e)
            cum_edge.append(e_run)
            cum_pnl.append(p_run)
            rows.append({"t": rec.t, "direction": _word(rec.direction),
                         "type": "informed" if informed else "uninformed",
                         "filler": _who(rec.filler), "price": rec.price,
                         "my_bid": q["player_bid"], "my_ask": q["player_ask"],
                         "rival_bid": q["rival_bid"], "rival_ask": q["rival_ask"],
                         "ref_bid": q["ref_bid"], "ref_ask": q["ref_ask"]})
        return {"value": res.value, "edge": res.edge, "pnl": res.pnl, "luck": res.luck,
                "note": note, "beliefs": beliefs, "per_edge": per_edge,
                "cum_edge": cum_edge, "cum_pnl": cum_pnl, "rows": rows}
