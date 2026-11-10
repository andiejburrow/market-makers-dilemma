"""
app.py: the Streamlit page for The Market Maker's Dilemma.

Run with:  streamlit run app.py

This file only DRAWS the game. Every rule and every number comes from
session.py and engine.py, so the page cannot contradict the maths.
Hidden information (true value, trader types) lives on the server inside the
Round object and is only drawn after settlement (SPEC rules L3 and L5).
"""
import pandas as pd
import streamlit as st

from engine import BUY, Params
from session import GameSession

PARAMS = Params()   # the spec defaults: alpha 0.2, 10 arrivals, 10 rounds, tick 1


# --------------------------------------------------------------- state
def new_game(mode: str):
    st.session_state.game = GameSession(PARAMS, mode=mode)
    st.session_state.last_step = None        # (StepResult, coach note)
    st.session_state.round_result = None     # (RoundResult, coach note)
    st.session_state.error = None
    st.session_state.bid_input = 30.0
    st.session_state.ask_input = 70.0


def on_mode_change():
    new_game(st.session_state.mode_choice)


def on_lock():
    g = st.session_state.game
    try:
        st.session_state.last_step = g.lock(st.session_state.bid_input,
                                            st.session_state.ask_input)
        st.session_state.error = None
    except ValueError as e:
        st.session_state.error = str(e)


def on_settle():
    st.session_state.round_result = st.session_state.game.settle_round()


def on_next():
    st.session_state.game.next_round()
    st.session_state.last_step = None
    st.session_state.round_result = None


def on_restart():
    new_game(st.session_state.game.mode)


def word(direction: int) -> str:
    return "BUY" if direction == BUY else "SELL"


# --------------------------------------------------------------- page
st.set_page_config(page_title="The Market Maker's Dilemma", page_icon="📈")

if "game" not in st.session_state:
    new_game("challenge")

st.sidebar.radio(
    "Mode", ["challenge", "practice"], key="mode_choice", on_change=on_mode_change,
    format_func=lambda m: "Challenge (reference hidden until you quote)"
    if m == "challenge" else "Practice (reference shown first)",
)
st.sidebar.caption("Changing mode starts a new session.")

g: GameSession = st.session_state.game
rd = g.current

st.title("The Market Maker's Dilemma")
st.caption("A Bayesian market-making trainer. Units are points.")

with st.expander("How the game works", expanded=False):
    st.markdown(
        f"""
An asset is secretly worth **0 or 100** (equally likely). Traders arrive one at a time.
**{PARAMS.alpha:.0%} of traders are informed** and always trade the right way (buy if it
is worth 100, sell if it is worth 0). The rest flip a coin.

Before each trader you post a **bid** (you buy at it) and an **ask** (you sell at it).
A computer rival also quotes, using a fixed rule, and each trader deals with the better
price (ties go to the rival). After the round the true value is revealed and your
positions are settled.

You get two scores. **Expected edge** says how good your quotes were given what you
could know, and is the number to judge yourself by. **Realised profit** also contains
luck, which is large over only {PARAMS.n_arrivals} trades.

The "reference" is the price at which you would break even *under this model*. It is a
benchmark, not the best price to quote.
"""
    )

# ---- the round ----------------------------------------------------------
view = rd.public_view()
st.header(f"Round {g.round_number} of {PARAMS.rounds}")
c1, c2, c3 = st.columns(3)
c1.metric("Arrival", f"{min(view['arrival'], PARAMS.n_arrivals)} / {PARAMS.n_arrivals}")
c2.metric("Cash", f"{view['cash']:+.0f}")
c3.metric("Inventory", f"{view['inventory']:+d}")

if view["tape"]:
    st.subheader("Public market tape")
    st.dataframe(
        pd.DataFrame([{"arrival": r["t"], "trader": word(r["direction"]),
                       "filled by": r["filler"], "price": r["price"]} for r in view["tape"]]),
        hide_index=True,
    )

if not rd.finished:
    ref = g.practice_reference()
    if ref is not None:
        st.info(f"Practice mode. Reference (break-even under the model): "
                f"bid {ref[0]:.2f} / ask {ref[1]:.2f}")
    st.subheader(f"Arrival {view['arrival']}: set your quotes")
    q1, q2 = st.columns(2)
    q1.number_input("Your bid (you buy at this price)", min_value=0.0, max_value=100.0,
                    step=PARAMS.tick, format="%.0f", key="bid_input")
    q2.number_input("Your ask (you sell at this price)", min_value=0.0, max_value=100.0,
                    step=PARAMS.tick, format="%.0f", key="ask_input")
    st.button("Lock quotes", on_click=on_lock, type="primary")
    if st.session_state.error:
        st.error(st.session_state.error)

if st.session_state.last_step is not None:
    step, note = st.session_state.last_step
    rec = step.record
    st.subheader(f"Arrival {rec.t}: the trader wanted to {word(rec.direction)}")
    st.write(f"Filled by **{rec.filler}** at **{rec.price:g}**. "
             f"Reference quotes: bid {step.ref_bid:.2f} / ask {step.ref_ask:.2f}.")
    st.info(note)

# ---- settlement ---------------------------------------------------------
if rd.finished:
    if st.session_state.round_result is None:
        st.button("Reveal the true value and settle the round", on_click=on_settle,
                  type="primary")
    else:
        res, rnote = st.session_state.round_result
        st.subheader("Round result")
        st.write(f"The asset was worth **{res.value}**.")
        m1, m2, m3 = st.columns(3)
        m1.metric("Expected edge (headline)", f"{res.edge:+.2f}")
        m2.metric("Realised profit", f"{res.pnl:+.2f}")
        m3.metric("Luck", f"{res.luck:+.2f}")
        st.info(rnote)
        review = []
        for rec, informed, q in zip(res.tape, res.informed, res.quotes):
            review.append({
                "arrival": rec.t, "trader": word(rec.direction),
                "type": "informed" if informed else "uninformed",
                "filled by": rec.filler, "price": rec.price,
                "your bid": q["player_bid"], "your ask": q["player_ask"],
                "rival bid": q["rival_bid"], "rival ask": q["rival_ask"],
                "ref bid": round(q["ref_bid"], 2), "ref ask": round(q["ref_ask"], 2),
            })
        st.dataframe(pd.DataFrame(review), hide_index=True)
        if not g.over:
            st.button("Next round", on_click=on_next, type="primary")

# ---- session summary ----------------------------------------------------
if g.results:
    st.divider()
    st.header("Session so far")
    edge, pnl = g.totals()
    s1, s2 = st.columns(2)
    s1.metric("Total expected edge (headline)", f"{edge:+.2f}")
    s2.metric("Total realised profit", f"{pnl:+.2f}")
    st.dataframe(
        pd.DataFrame([{"round": i + 1, "value": r.value, "edge": round(r.edge, 2),
                       "profit": round(r.pnl, 2), "luck": round(r.luck, 2),
                       "fills": r.n_fills} for i, r in enumerate(g.results)]),
        hide_index=True,
    )
    st.caption("This app stores nothing on a server. The log below exists only for you "
               "to download.")
    st.download_button("Download session log (JSON lines)", g.to_jsonl(),
                       file_name=f"mmd_session_{g.session_id}.jsonl")
    if g.over:
        st.success("Session complete.")
        st.button("Play again", on_click=on_restart)
