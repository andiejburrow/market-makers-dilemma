"""
app.py: the Streamlit front end for The Market Maker's Dilemma.

Run with:  streamlit run app.py

This file only DRAWS the game. Every rule and every number comes from
session.py and engine.py, so the page cannot contradict the maths.
Hidden information (true value, trader types) lives on the server inside the
Round object and is only drawn after settlement (SPEC rules L3 and L5).
Nothing here reads the sealed scenario or the bots' privileged view.
"""
import pandas as pd
import streamlit as st

from engine import BUY, Params, update_belief
from session import GameSession

PARAMS = Params()   # the spec defaults: alpha 0.2, 10 arrivals, 10 rounds, tick 1
DEFAULT_BID, DEFAULT_ASK = 30.0, 70.0
GITHUB_URL = "https://github.com/andiejburrow/market-makers-dilemma"

CSS = """
<style>
.stApp { background: radial-gradient(1100px 560px at 88% -8%, rgba(59,92,200,.20), transparent 60%),
  radial-gradient(900px 480px at -5% 8%, rgba(110,80,190,.12), transparent 55%), #0B111B; }
header[data-testid="stHeader"] { background: transparent; }
#MainMenu, footer { visibility: hidden; }
.block-container { padding-top: 1.4rem; max-width: 1180px; }
html, body, [class*="css"] { font-family: -apple-system, "Inter", "Segoe UI", sans-serif; }
.mono, .kpi-v, .tape td, .qv, .rv { font-family: "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums; }

.overline { color: #5AA9FF; font-size: .74rem; letter-spacing: .16em; text-transform: uppercase; font-weight: 600; }
.hero h1 { font-size: 2.6rem; line-height: 1.12; margin: .3rem 0 .6rem 0; color: #E6EDF7; font-weight: 700; }
.hero p { color: #9AA7BB; font-size: 1.05rem; max-width: 46rem; }
.chip { display: inline-block; border: 1px solid #223048; background: #111927; color: #9AA7BB;
  border-radius: 999px; padding: .2rem .7rem; margin: .2rem .3rem .2rem 0; font-size: .8rem; }

.card { background: linear-gradient(180deg, #141E2F, #0F1724); border: 1px solid #223048; border-radius: 12px; padding: 1rem 1.1rem; margin-bottom: .8rem; }
.card h4 { margin: 0 0 .5rem 0; font-size: .74rem; letter-spacing: .12em; text-transform: uppercase; color: #8A97AB; font-weight: 600; }
.card p { color: #C7D1E0; margin: .15rem 0; font-size: .92rem; }
.card.tall { min-height: 11.5rem; }
.card.practice { border-color: #6B5522; background: #17160F; }
.card.hidden { border-style: dashed; color: #8A97AB; }

.kpi { background: linear-gradient(180deg, #141E2F, #0F1724); border: 1px solid #223048; border-radius: 10px; padding: .65rem .9rem; }
.kpi-l { color: #8A97AB; font-size: .68rem; letter-spacing: .1em; text-transform: uppercase; }
.kpi-v { white-space: nowrap; font-size: 1.45rem; font-weight: 600; color: #E6EDF7; }
.pos { color: #3DDC97 !important; } .neg { color: #F0616D !important; }

.badge { display: inline-block; font-size: .72rem; letter-spacing: .08em; font-weight: 600;
  padding: .22rem .6rem; border-radius: 6px; text-transform: uppercase; }
.badge.ch { background: rgba(90,169,255,.12); color: #5AA9FF; border: 1px solid rgba(90,169,255,.35); }
.badge.pr { background: rgba(245,184,75,.12); color: #F5B84B; border: 1px solid rgba(245,184,75,.35); }
.title-sm { font-size: 1.05rem; font-weight: 700; color: #E6EDF7; margin-right: .6rem; }

.qlabel { font-size: .72rem; letter-spacing: .12em; text-transform: uppercase; font-weight: 600; margin: .2rem 0 .1rem 0; }
[data-testid="stForm"] [data-testid="stColumn"]:nth-of-type(1) input, [data-testid="stForm"] [data-testid="column"]:nth-of-type(1) input { color: #3DDC97; background: #0B111B; }
[data-testid="stForm"] [data-testid="stColumn"]:nth-of-type(2) input, [data-testid="stForm"] [data-testid="column"]:nth-of-type(2) input { color: #F0616D; background: #0B111B; }
.qlabel.bid { color: #3DDC97; } .qlabel.ask { color: #F0616D; }
[data-testid="stNumberInput"] input { font-size: 1.9rem; font-weight: 600; text-align: center; height: 3.3rem;
  font-family: "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace; }
[data-testid="stFormSubmitButton"], [data-testid="stFormSubmitButton"] > div { width: 100% !important; }
[data-testid="stFormSubmitButton"] button { height: 3.3rem; font-size: 1.05rem; font-weight: 700; width: 100%; border-radius: 10px; }
.stButton button { border-radius: 10px; font-weight: 600; }

table.tape { width: 100%; border-collapse: collapse; font-size: .88rem; border: none !important; }
table.tape th, table.tape td { border-left: none !important; border-right: none !important; border-top: none !important; }
table.tape th { text-align: left; color: #8A97AB; font-size: .66rem; letter-spacing: .1em; text-transform: uppercase;
  font-weight: 600; padding: .3rem .4rem; border-bottom: 1px solid #223048; }
table.tape td { padding: .55rem .4rem; border-bottom: 1px solid #172133; color: #D5DDEA; }
.pill { padding: .1rem .5rem; border-radius: 5px; font-size: .74rem; font-weight: 700; }
.pill.buy { background: rgba(61,220,151,.14); color: #3DDC97; }
.pill.sell { background: rgba(240,97,109,.14); color: #F0616D; }
.you { color: #5AA9FF; font-weight: 700; } .riv { color: #8A97AB; }

.rowline { display: flex; justify-content: space-between; padding: .22rem 0; border-bottom: 1px solid #172133; font-size: .9rem; }
.rowline span:first-child { color: #8A97AB; } .rv { color: #E6EDF7; font-weight: 600; }
.reveal { font-size: 2.2rem; font-weight: 700; font-family: "SF Mono", Menlo, monospace; color: #E6EDF7; }
.tiles { display: flex; gap: 2rem; margin: .7rem 0 .3rem 0; }
.tile-l { color: #8A97AB; font-size: .66rem; letter-spacing: .1em; text-transform: uppercase; }
.tile-v { font-size: 1.35rem; font-weight: 600; color: #E6EDF7; font-family: "SF Mono", Menlo, monospace; }
.tag { float: right; font-size: .66rem; letter-spacing: .1em; padding: .15rem .55rem; border-radius: 999px; background: #172133; color: #9AA7BB; border: 1px solid #223048; text-transform: uppercase; }
.sub { color: #8A97AB; font-size: .72rem; letter-spacing: .14em; text-transform: uppercase; }
.ticker { display: flex; gap: 1.6rem; overflow: hidden; white-space: nowrap; border: 1px solid #223048; border-radius: 10px; background: #0E1522; padding: .5rem .9rem; margin: .5rem 0 .9rem 0; font-size: .8rem; font-family: "SF Mono", Menlo, monospace; color: #9AA7BB; }
.ticker b { color: #E6EDF7; font-weight: 600; }
.foot { color: #6F7C91; font-size: .78rem; margin-top: 2rem; }
.foot a { color: #5AA9FF; }
</style>
"""


# --------------------------------------------------------------- state
def reset_quotes():
    st.session_state.bid_input = DEFAULT_BID
    st.session_state.ask_input = DEFAULT_ASK


def start(mode: str):
    st.session_state.game = GameSession(PARAMS, mode=mode)
    st.session_state.last_step = None        # (StepResult, coach note, bid, ask)
    st.session_state.round_result = None     # (RoundResult, coach note)
    st.session_state.round_edge = 0.0
    st.session_state.error = None
    st.session_state.page = "play"
    reset_quotes()


def go(page: str):
    st.session_state.page = page


def on_lock():
    g = st.session_state.game
    bid, ask = st.session_state.bid_input, st.session_state.ask_input
    try:
        step, note = g.lock(bid, ask)
    except ValueError as e:
        st.session_state.error = str(e)
        return
    st.session_state.last_step = (step, note, bid, ask)
    if step.edge is not None:
        st.session_state.round_edge += step.edge
    st.session_state.error = None
    reset_quotes()                           # think afresh for every trader


def on_settle():
    st.session_state.round_result = st.session_state.game.settle_round()


def on_next():
    st.session_state.game.next_round()
    st.session_state.last_step = None
    st.session_state.round_result = None
    st.session_state.round_edge = 0.0
    reset_quotes()


def on_restart():
    start(st.session_state.game.mode)


# --------------------------------------------------------------- helpers
def word(direction: int) -> str:
    return "BUY" if direction == BUY else "SELL"


def who(filler: str) -> str:
    return "you" if filler == "player" else "rival"


def tone(x: float) -> str:
    return "pos" if x > 0 else "neg" if x < 0 else ""


def kpi(label: str, value: str, cls: str = "") -> str:
    return (f'<div class="kpi"><div class="kpi-l">{label}</div>'
            f'<div class="kpi-v {cls}">{value}</div></div>')


def tape_html(tape) -> str:
    rows = "".join(
        f'<tr><td>{r["t"]}</td>'
        f'<td><span class="pill {"buy" if r["direction"] == BUY else "sell"}">{word(r["direction"])}</span></td>'
        f'<td>{r["price"]:g}</td>'
        f'<td class="{"you" if r["filler"] == "player" else "riv"}">{who(r["filler"]).upper()}</td></tr>'
        for r in reversed(tape)
    )
    return ('<table class="tape"><thead><tr><th>#</th><th>Trader</th><th>Fill price</th>'
            f'<th>Filled by</th></tr></thead><tbody>{rows}</tbody></table>')


def ticker_html(tape) -> str:
    items = [f"<span>ASSET <b>0 / 100</b></span>", f"<span>INFORMED <b>{PARAMS.alpha:.0%}</b></span>"]
    if tape:
        for r in list(reversed(tape))[:6]:
            c = "pos" if r["direction"] == BUY else "neg"
            items.append(f'<span><b class="{c}">{word(r["direction"])}</b> {r["price"]:g} '
                         f'<span class="{"you" if r["filler"] == "player" else "riv"}">'
                         f'{who(r["filler"]).upper()}</span></span>')
    else:
        items.append("<span>waiting for the first trader</span>")
    return '<div class="ticker">' + "".join(items) + "</div>"


def footer():
    st.markdown(
        f'<div class="foot">Educational model, not trading advice. Units are points. '
        f'Source and tests on <a href="{GITHUB_URL}" target="_blank">GitHub</a>. '
        f'Rules are defined in SPEC.md.</div>', unsafe_allow_html=True)


# --------------------------------------------------------------- pages
def page_home():
    st.markdown(
        '<div class="hero"><div class="overline">Bayesian market-making trainer</div>'
        "<h1>Quote against informed traders.<br>Learn what a trade tells you.</h1>"
        "<p>An interactive Glosten-Milgrom model. Post a bid and an ask, watch your belief move "
        "with every trade, and see how much of your result was skill and how much was luck.</p>"
        f'<span class="chip">{PARAMS.rounds} rounds</span>'
        f'<span class="chip">{PARAMS.n_arrivals} traders each</span>'
        f'<span class="chip">{PARAMS.alpha:.0%} informed</span>'
        '<span class="chip">asset worth 0 or 100</span></div>',
        unsafe_allow_html=True)
    st.write("")
    c1, c2, c3 = st.columns(3)
    with c1:
        st.markdown('<div class="card tall"><h4>Challenge</h4><p>The break-even reference stays hidden '
                    "until you lock your quotes. This is the scored mode.</p></div>",
                    unsafe_allow_html=True)
        st.button("Start Challenge", on_click=start, args=("challenge",), type="primary",
                  use_container_width=True)
    with c2:
        st.markdown('<div class="card tall practice"><h4>Practice</h4><p>The reference is shown before '
                    "you quote, so you can see what the maths says and test ideas.</p></div>",
                    unsafe_allow_html=True)
        st.button("Practice Mode", on_click=start, args=("practice",), use_container_width=True)
    with c3:
        st.markdown('<div class="card tall"><h4>How it works</h4><p>The model, the rival, the scoring '
                    "and what stays hidden, in one page.</p></div>", unsafe_allow_html=True)
        st.button("How It Works", on_click=go, args=("how",), use_container_width=True)
    footer()


def page_how():
    st.button("Back", on_click=go, args=("home",))
    st.markdown('<div class="overline">Methodology</div><h2>How it works</h2>', unsafe_allow_html=True)
    st.markdown(
        f"""
**The market.** An asset is secretly worth **0 or 100**, equally likely. Traders arrive one at a
time. With probability **{PARAMS.alpha:.0%}** a trader is informed and always trades the right way
(buys if it is worth 100, sells if it is worth 0). Otherwise they flip a coin. This is the
Glosten-Milgrom adverse-selection model.

**What a trade tells you.** After each trade the coach updates the probability *p* that the asset
is worth 100 with Bayes' rule. After a BUY:
"""
    )
    st.latex(r"p' = \frac{p\,(1+\alpha)}{p\,(1+\alpha) + (1-p)\,(1-\alpha)}")
    st.markdown(
        f"""
After a SELL the two factors swap. The **reference** ask is 100 times the belief after a buy, and
the reference bid is 100 times the belief after a sell. They are *break-even* prices under the
model, not the best prices to quote. At the start, with {PARAMS.alpha:.0%} informed, the reference
is bid 40 / ask 60.

**The rival.** A computer rival quotes the reference pushed outward by {PARAMS.delta:g} points,
rounded outward to whole ticks. Each trader deals with the better price, and **ties go to the
rival**. The rival is a fixed rule, not a strategic opponent.

**Scoring.** *Expected edge* is how far your price was from break-even, summed over your fills. It
measures the quality of your quotes using only what you could know. *Realised profit* adds luck,
because ten trades is a small sample. Over many rounds the two have the same average, which the
project checks exactly. Judge yourself by edge.

**Challenge and Practice.** In Challenge the reference is hidden until you lock your quotes. In
Practice it is shown first.

**Hidden until the round ends.** The true value, which traders were informed, future arrivals and
the rival's unexecuted quotes. The public tape shows each trade's direction, fill price and who
filled it.

**Limits.** Informed traders ignore price. The rival never adapts. Break-even is a benchmark, not
an optimum. Ten trades per round means realised profit is mostly luck.
"""
    )
    st.link_button("View source and tests on GitHub", GITHUB_URL)
    footer()


def page_play():
    g: GameSession = st.session_state.game
    rd = g.current
    view = rd.public_view()
    practice = g.mode == "practice"

    # ---- top bar -------------------------------------------------------
    t1, t2 = st.columns([5, 1])
    badge = ('<span class="badge pr">Practice · reference shown before you quote</span>' if practice
             else '<span class="badge ch">Challenge · reference hidden until you quote</span>')
    t1.markdown(f'<span class="title-sm">THE MARKET MAKER\'S DILEMMA</span>{badge}'
                '<div class="sub">Bayesian trading simulator</div>', unsafe_allow_html=True)
    t2.button("Home", on_click=go, args=("home",), use_container_width=True)

    st.markdown(ticker_html(view["tape"]), unsafe_allow_html=True)

    # ---- numbers ---------------------------------------------------------
    done = min(view["arrival"] - 1, PARAMS.n_arrivals)
    edge = st.session_state.round_edge
    k = st.columns(4)
    k[0].markdown(kpi("Round", f"{g.round_number} / {PARAMS.rounds}"), unsafe_allow_html=True)
    k[1].markdown(kpi("Trader", f"{done} / {PARAMS.n_arrivals}"), unsafe_allow_html=True)
    k[2].markdown(kpi("Expected edge", f"{edge:+.2f}", tone(edge)), unsafe_allow_html=True)
    k[3].markdown(kpi("Informed share", f"{PARAMS.alpha:.0%}"), unsafe_allow_html=True)
    st.progress(done / PARAMS.n_arrivals)
    st.write("")

    left, right = st.columns([3, 2], gap="large")

    # ---- left: your move and the coach -----------------------------------
    with left:
        if not rd.finished:
            ref = g.practice_reference()
            if ref is not None:
                st.markdown(
                    f'<div class="card practice"><h4>Practice reference · break-even under the model</h4>'
                    f'<p class="mono">BID {ref[0]:.2f} &nbsp;/&nbsp; ASK {ref[1]:.2f}</p></div>',
                    unsafe_allow_html=True)
            else:
                st.caption("Reference hidden until you lock your quotes.")
            with st.form("quote_form", border=False):
                st.markdown(f"**Arrival {view['arrival']}: set your quotes**")
                q1, q2 = st.columns(2)
                with q1:
                    st.markdown('<div class="qlabel bid">Bid · you buy at</div>', unsafe_allow_html=True)
                    st.number_input("Bid", min_value=0.0, max_value=100.0, step=PARAMS.tick,
                                    format="%.0f", key="bid_input", label_visibility="collapsed")
                with q2:
                    st.markdown('<div class="qlabel ask">Ask · you sell at</div>', unsafe_allow_html=True)
                    st.number_input("Ask", min_value=0.0, max_value=100.0, step=PARAMS.tick,
                                    format="%.0f", key="ask_input", label_visibility="collapsed")
                st.form_submit_button("Lock quotes", on_click=on_lock, type="primary",
                                      use_container_width=True)
            if st.session_state.error:
                st.error(st.session_state.error)

        if st.session_state.last_step is not None:
            step, note, my_bid, my_ask = st.session_state.last_step
            rec = step.record
            side_ref = step.ref_ask if rec.direction == BUY else step.ref_bid
            mine = step.edge is not None
            edge_tile = (f'<div class="tile-v {tone(step.edge)}">{step.edge:+.2f}</div>' if mine
                         else '<div class="tile-v">none</div>')
            st.markdown(
                f'<div class="card"><h4>Bayesian coach · arrival {rec.t}<span class="tag">after trade</span></h4>'
                f'<p>Trader wanted to <span class="pill {"buy" if rec.direction == BUY else "sell"}">'
                f'{word(rec.direction)}</span> &nbsp;·&nbsp; you quoted '
                f'<span class="mono">{my_bid:g} / {my_ask:g}</span> &nbsp;·&nbsp; filled by '
                f'<span class="{"you" if mine else "riv"}">{who(rec.filler).upper()}</span></p>'
                f'<div class="tiles">'
                f'<div><div class="tile-l">Break-even ({"ask" if rec.direction == BUY else "bid"})</div>'
                f'<div class="tile-v">{side_ref:.2f}</div></div>'
                f'<div><div class="tile-l">{"Your price" if mine else "Rival price"}</div>'
                f'<div class="tile-v">{rec.price:g}</div></div>'
                f'<div><div class="tile-l">Expected edge</div>{edge_tile}</div></div>'
                f"<p style='margin-top:.6rem'>{note}</p></div>",
                unsafe_allow_html=True)

    # ---- right: the public tape ------------------------------------------
    with right:
        st.markdown(
            f'<div class="card"><h4>Your position</h4>'
            f'<div class="rowline"><span>Cash</span>'
            f'<span class="rv {tone(view["cash"])}">{view["cash"]:+.0f}</span></div>'
            f'<div class="rowline"><span>Inventory</span>'
            f'<span class="rv">{view["inventory"]:+d}</span></div>'
            f'<p style="color:#8A97AB;font-size:.78rem;margin-top:.5rem">+ means you hold units, '
            f'&minus; means you sold units you do not hold. Everything closes out at the true value '
            f'when the round ends.</p></div>', unsafe_allow_html=True)
        body = (tape_html(view["tape"]) if view["tape"]
                else '<p style="color:#8A97AB">No trades yet.</p>')
        st.markdown(f'<div class="card"><h4>Public market tape</h4>{body}</div>',
                    unsafe_allow_html=True)
        st.caption("Shows every trade, including the rival's. It never shows the true value, "
                   "trader types or future arrivals.")

    # ---- settlement and review --------------------------------------------
    if rd.finished:
        if st.session_state.round_result is None:
            st.button("Reveal the true value and settle the round", on_click=on_settle,
                      type="primary")
        else:
            show_review()

    # ---- session summary --------------------------------------------------
    if g.results:
        st.divider()
        st.markdown("### Session so far")
        s_edge, s_pnl = g.totals()
        a, b = st.columns(2)
        a.markdown(kpi("Total expected edge (headline)", f"{s_edge:+.2f}", tone(s_edge)),
                   unsafe_allow_html=True)
        b.markdown(kpi("Total realised profit", f"{s_pnl:+.2f}", tone(s_pnl)),
                   unsafe_allow_html=True)
        st.write("")
        st.dataframe(
            pd.DataFrame([{"round": i + 1, "value": r.value, "edge": round(r.edge, 2),
                           "profit": round(r.pnl, 2), "luck": round(r.luck, 2),
                           "fills": r.n_fills} for i, r in enumerate(g.results)]),
            hide_index=True, use_container_width=True)
        st.caption("This app stores nothing on a server. The log below exists only for you "
                   "to download.")
        st.download_button("Download session log (JSON lines)", g.to_jsonl(),
                           file_name=f"mmd_session_{g.session_id}.jsonl")
        if g.over:
            st.success("Session complete.")
            st.button("Play again", on_click=on_restart)
    footer()


def show_review():
    g: GameSession = st.session_state.game
    res, rnote = st.session_state.round_result
    st.divider()
    st.markdown("### Round review")
    v, e, p, l = st.columns(4)
    v.markdown(f'<div class="kpi"><div class="kpi-l">True value revealed</div>'
               f'<div class="reveal">{res.value}</div></div>', unsafe_allow_html=True)
    e.markdown(kpi("Expected edge (headline)", f"{res.edge:+.2f}", tone(res.edge)),
               unsafe_allow_html=True)
    p.markdown(kpi("Realised P&L", f"{res.pnl:+.2f}", tone(res.pnl)), unsafe_allow_html=True)
    l.markdown(kpi("Luck (P&L minus edge)", f"{res.luck:+.2f}", tone(res.luck)),
               unsafe_allow_html=True)
    st.write("")
    st.info(rnote)

    # belief history: belief before each arrival, then after the last one
    beliefs = [q["belief_before"] * 100 for q in res.quotes]
    last = res.quotes[-1]["belief_before"]
    beliefs.append(update_belief(last, res.tape[-1].direction, PARAMS.assumed) * 100)
    chart = pd.DataFrame({
        "Belief the asset is worth 100 (%)": beliefs,
        "True value (%)": [float(res.value)] * len(beliefs),
    }, index=pd.RangeIndex(0, len(beliefs), name="after this many trades"))
    st.markdown("**Belief history**")
    st.line_chart(chart, color=["#5AA9FF", "#8A97AB"], height=260)

    per_edge, cum_edge, cum_pnl, e_run, p_run = [], [], [], 0.0, 0.0
    for rec, q in zip(res.tape, res.quotes):
        if rec.filler == "player":
            e = (rec.price - q["ref_ask"]) if rec.direction == BUY else (q["ref_bid"] - rec.price)
            p_run += rec.direction * (rec.price - res.value)
        else:
            e = 0.0
        e_run += e
        per_edge.append(e)
        cum_edge.append(e_run)
        cum_pnl.append(p_run)
    idx = pd.RangeIndex(1, len(per_edge) + 1, name="arrival")
    ca, cb = st.columns(2)
    with ca:
        st.markdown("**Edge versus luck, cumulative**")
        st.line_chart(pd.DataFrame({"Expected edge": cum_edge, "Realised P&L": cum_pnl}, index=idx),
                      color=["#5AA9FF", "#F5B84B"], height=240)
    with cb:
        st.markdown("**Expected edge on each trade**")
        st.bar_chart(pd.DataFrame({"Gain": [max(x, 0.0) for x in per_edge],
                                   "Loss": [min(x, 0.0) for x in per_edge]}, index=idx),
                     color=["#3DDC97", "#F0616D"], height=240)

    review = []
    for rec, informed, q in zip(res.tape, res.informed, res.quotes):
        review.append({
            "arrival": rec.t, "trader": word(rec.direction),
            "type": "informed" if informed else "uninformed",
            "filled by": who(rec.filler), "price": rec.price,
            "your bid": q["player_bid"], "your ask": q["player_ask"],
            "rival bid": q["rival_bid"], "rival ask": q["rival_ask"],
            "ref bid": round(q["ref_bid"], 2), "ref ask": round(q["ref_ask"], 2),
        })
    st.dataframe(pd.DataFrame(review), hide_index=True, use_container_width=True)
    if not g.over:
        st.button("Next round", on_click=on_next, type="primary")


# --------------------------------------------------------------- run
st.set_page_config(page_title="The Market Maker's Dilemma", page_icon="📈", layout="wide",
                   initial_sidebar_state="collapsed")
st.markdown(CSS, unsafe_allow_html=True)

if "page" not in st.session_state:
    st.session_state.page = "home"
if st.session_state.page == "play" and "game" not in st.session_state:
    st.session_state.page = "home"

{"home": page_home, "how": page_how, "play": page_play}[st.session_state.page]()
