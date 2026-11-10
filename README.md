# The Market Maker's Dilemma

An interactive Bayesian market-making trainer. You quote a bid and an ask on an asset that is
secretly worth 0 or 100. Some of the traders know which. A coach shows the break-even price
under the model and scores you on **expected edge** (skill) separately from **realised profit**
(skill plus luck).

The model is the Glosten-Milgrom adverse-selection model, which is established theory. The
project's value is a careful, tested implementation and an honest account of what it does and
does not show. The full definition is in [`SPEC.md`](SPEC.md).

## What it shows

An asset is worth 0 or 100. Each trader is informed with probability 20% (and trades the right
way) or flips a coin. After every trade the game updates the probability the asset is worth 100
using Bayes' rule, and the break-even bid and ask move with it. For example, after one BUY the
break-even ask rises from 60 to 69.23.

Because ten trades is a tiny sample, **realised profit is mostly luck**. The standard deviation
of one round's profit is about 123 points, while the best simple strategy's expected edge is
about +13 points per round. So the game scores you on expected edge, shows the luck separately,
and tells you which is which.

**Checked three ways** (see `SPEC.md` section 10):

| Check | What it establishes |
|---|---|
| 42 automated tests, including 16 acceptance tests specified in `SPEC.md` before the code was written | The maths, routing, settlement and leakage rules behave as specified |
| Exact enumeration of all 2 x 1,024 possible rounds | Expected profit equals expected edge exactly, for the tested strategies |
| Independent re-derivation with exact fractions (`tests/test_independent.py`), reproduced separately by another reviewer | The headline figures, for example +13.1515 per round for quoting one tick inside the rival |

An earlier set of figures was wrong by about 0.8 per round because of floating-point rounding in
a throwaway script. The exact calculation caught it, and `SPEC.md` records the correction.

## Run it (Mac)

```bash
cd market-makers-dilemma
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest -v              # runs all 42 tests (about a minute)
streamlit run app.py   # opens the game in your browser
```

If `pip install` fails on a very new Python (for example 3.15), create the environment with an
older Python such as 3.12 or 3.13 instead.

## What is in the folder

| File | What it does |
|---|---|
| `SPEC.md` | The single source of truth: model, rules, tests, decisions. |
| `engine.py` | The maths (Bayes update, break-even quotes), the rival, routing, settlement, one round. |
| `session.py` | A 10-round game: modes, seeds, totals, log. |
| `coach.py` | The coach's wording. Never says "optimal"; never mentions the true value mid-round. |
| `app.py` | The Streamlit page. It only draws what `session.py` gives it. |
| `strategies.py`, `simulate.py` | Simple fixed-rule bots, seeded simulations, and an **exact** calculation by enumerating every possible round. |
| `tests/test_engine.py` | Spec tests T1 to T16, an exact check of Property E, and session tests. |
| `tests/test_independent.py` | Independent exact check of the section 10 figures using fractions, importing nothing from the engine. |

## Honest limitations

- Break-even is a benchmark, not the best quote. How many trades you win depends on your quote.
- The rival is a fixed rule, not a strategic opponent. Its rule is public in this repository.
- Informed traders ignore price. Trade direction does not depend on quotes by assumption.
- A round has 10 trades, so realised profit is mostly luck. Judge yourself by expected edge.
- The bots in `strategies.py` see the rival's next quote, which a human never sees. They are benchmarks, not model players.
- The leakage tests cover the session data flow, not a real browser. Re-check before any public deployment.
- Stage 1 assumes the rival and reference use the true informed share. Stage 2 will need that decided (SPEC F15).
