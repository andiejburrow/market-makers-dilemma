# The Market Maker's Dilemma

An interactive Bayesian market-making trainer. You quote a bid and an ask on an asset that is
secretly worth 0 or 100. Some of the traders know which. A coach shows the break-even price
under the model and scores you on **expected edge** (skill) separately from **realised profit**
(skill plus luck).

The model is the Glosten-Milgrom adverse-selection model, which is established theory. The
project's value is a careful, tested implementation and an honest account of what it does and
does not show. The full definition is in [`SPEC.md`](SPEC.md).

## Run it (Mac)

```bash
cd market-makers-dilemma
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest -v              # runs the acceptance tests (about 35 seconds)
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
