"""
coach.py: the Bayesian coach (spec section 7).

Notes are built from numbers only: the reference quotes, the player's quotes,
who filled the trade and the edge. Reference prices are described as
"break-even under the model", never as the optimal or correct price.
"""

BANNED_WORDS = ("optimal", "correct price", "you should have")


def _side(direction: int) -> str:
    return "ask" if direction == 1 else "bid"


def step_note(direction, bid, ask, ref_bid, ref_ask, player_filled, edge):
    """Feedback right after one arrival. Uses nothing the player could not know
    at this point (the true value is NOT mentioned)."""
    side = _side(direction)
    mine = ask if direction == 1 else bid
    ref = ref_ask if direction == 1 else ref_bid
    word = "buy" if direction == 1 else "sell"
    if player_filled:
        sign = "above" if mine > ref else "below" if mine < ref else "equal to"
        return (
            f"A trader wanted to {word}. Your {side} of {mine:g} was {abs(mine - ref):.2f} "
            f"{sign} the reference {side} of {ref:.2f} (break-even under the model). "
            f"Expected edge on this fill: {edge:+.2f} points. "
            f"Whether it made money is only known when the round ends."
        )
    return (
        f"A trader wanted to {word}, but the rival's price was more attractive than "
        f"your {side} of {mine:g}, so the rival filled it. For reference, break-even "
        f"under the model was {ref:.2f}."
    )


def round_note(edge, pnl, n_arrivals):
    """Feedback after settlement: skill (edge) first, then luck."""
    luck = pnl - edge
    return (
        f"Expected edge this round: {edge:+.2f} points (how good your quotes were, "
        f"given what you could know). Realised profit: {pnl:+.2f} points. "
        f"Luck: {luck:+.2f} points (realised minus expected edge). "
        f"With only {n_arrivals} trades per round, luck is usually much larger than skill, "
        f"so judge yourself by edge."
    )
