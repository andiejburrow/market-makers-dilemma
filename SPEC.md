# SPEC.md: The Market Maker's Dilemma (Stage 1)

**Version:** v0.5. **Status:** maths approved by ChatGPT (v0.3); section 10 figures corrected (v0.4) and independently reproduced by ChatGPT with exact rational arithmetic and by `tests/test_independent.py`. v0.5 records the audit follow-ups (tests and documentation only). Owner sign-off pending.
**Rule:** this file is the single source of truth. Neither AI changes its meaning without the owner's explicit approval. Every change is logged in section 14.

Each section starts with a **Plain English** note, then the precise definition.

---

## 0. Summary

**Plain English.** You play a market maker. A hidden asset is worth either 0 or 100. Some of the traders who arrive know which; the rest trade randomly. Before each trader arrives you post a buy price (bid) and a sell price (ask). A mechanical rival market maker competes with you for each trader. After you commit your quotes, the game reveals the trader's direction and tells you how your quotes compared with a Bayesian reference. You are scored on skill (expected edge, the headline) and also on luck (realised profit, secondary).

**Not in Stage 1:** estimating the informed share, regime changes, inventory limits, risk aversion, multiple assets, real market data, money.

---

## 1. Parameters and defaults (owner-confirmed)

| Symbol | Meaning | Default | Notes |
|---|---|---|---|
| V | true asset value | 0 or 100 | drawn once per round |
| p0 | prior P(V=100) | 0.5 | fixed in Stage 1 |
| α | share of informed traders | 0.2 | publicly shown to the player in Stage 1 |
| N | arrivals per round | 10 | |
| δ | rival's margin (points) | 2 | |
| τ | tick size (points) | 1 | quotes are multiples of τ |
| R | rounds per session | 10 | |
| Mode | default game mode | Challenge | Practice optional |
| Ties | tie-break in routing | rival wins | |
| Headline metric | | expected edge | realised P&L is secondary |

Units are **points**. £ is an optional display label.

---

## 2. Market model

**Plain English.** Each trader is either informed or just random. Their direction does not depend on the prices quoted.

- **M1.** V ∈ {0, 100}, P(V=100) = p0, independent across rounds.
- **M2.** Arrivals t = 1..N each trade one unit.
- **M3.** Each arrival is informed with probability α, independently, and uninformed otherwise.
- **M4.** An informed trader BUYS if V=100 and SELLS if V=0. An uninformed trader BUYS or SELLS with probability ½ each.
- **M5.** Direction d_t ∈ {+1 (BUY), −1 (SELL)} is therefore a function of V, the trader's type and a coin flip. It **does not depend on any quote**.
- **M6.** All quotes lie in [0, 100], so an informed trader never loses by trading at any available price. Informed traders trade whatever the price, including ties at 0 or 100.
- **M7.** BUY means the trader buys from a market maker at that maker's ask. SELL means the trader sells to a maker at its bid.

---

## 3. Bayesian reference benchmark

**Plain English.** The reference quote is the price at which, given what has been seen so far and assuming the trader buys (or sells), a market maker expects to break even. It is a benchmark, not the "best" price to quote.

**Symbols.** The public market tape T_{t-1} (section 4.5) gives the directions d_1..d_{t-1}. p_{t-1} = P(V=100 | T_{t-1}). r = (1+α)/(1−α).

**Likelihoods** (from M3-M4):

```
P(BUY  | V=100) = (1+α)/2     P(BUY  | V=0) = (1−α)/2
P(SELL | V=100) = (1−α)/2     P(SELL | V=0) = (1+α)/2
```

**Update** (Bayes' rule, the factors of ½ cancel):

```
after BUY : p' = p(1+α) / [p(1+α) + (1−p)(1−α)]
after SELL: p' = p(1−α) / [p(1−α) + (1−p)(1+α)]
```

**Odds identity.** With odds O = p/(1−p): O_t = O_0 · r^(B_t − S_t), where B_t and S_t count BUYs and SELLs so far on the tape. Only the net imbalance matters, not the order.

**Reference quotes** at arrival t, with p = p_{t-1}:

```
A*_t = 100 · p(1+α) / [p(1+α) + (1−p)(1−α)]  =  E[V | T_{t-1}, d_t = BUY]
B*_t = 100 · p(1−α) / [p(1−α) + (1−p)(1+α)]  =  E[V | T_{t-1}, d_t = SELL]
```

At p=½: A* = 50(1+α), B* = 50(1−α), spread = 100α.

**Property R (zero expected edge).** Conditional on T_{t-1} and d_t = BUY, selling one unit at A*_t has expected profit 0. Likewise for buying at B*_t after a SELL.

**What the reference is NOT.** It is the zero-expected-edge price per fill. It is **not** the optimal quote in the competitive game, because the number of fills depends on your quote.

**Worked values** (α=0.2, p0=0.5, so r=1.5):

| Tape (directions) | p | B* | A* |
|---|---|---|---|
| (none) | 0.5000 | 40.0000 | 60.0000 |
| BUY | 0.6000 | 50.0000 | 69.2308 |
| BUY, BUY | 0.6923 | 60.0000 | 77.1429 |
| BUY, SELL | 0.5000 | 40.0000 | 60.0000 |
| SELL, SELL | 0.3077 | 22.8571 | 40.0000 |

---

## 4. Game mechanics

**Plain English.** Each arrival has four steps: you commit your quotes, the game reveals what happened, the trade is routed, and the books update. The rival is a fixed computer rule, not a thinking opponent. You cannot see the reference or the rival's quote before you commit.

### 4.1 Round flow (Challenge mode, default)

For t = 1..N:
1. **Display.** The UI shows the round and arrival number, α, the public market tape so far (4.5), and your cash and inventory. It does **not** show reference quotes, rival quotes, V, trader types or future arrivals.
2. **Commit.** The player submits (b_t, a_t). The quote is validated and locked.
3. **Reveal.** The engine reveals d_t and the routing result (4.3), appends the record to the tape, and shows the reference quotes (A*_t, B*_t) and the edge of the fill, if any. The rival's quote on the side that traded is visible as the fill price if the rival filled the trade (see F14). Its other quote is not shown until the post-round review.
4. **Update.** p_t is updated from d_t.

After arrival N: V is revealed, positions are settled, and the round review shows everything (including types and all rival quotes).

**Practice mode** (optional) also shows (A*_t, B*_t) at step 1. This is for learning only. It is expected to make the game much easier (see F4).

### 4.2 Quote validity

b_t and a_t must be multiples of τ, with 0 ≤ b_t ≤ a_t ≤ 100.

### 4.3 The rival and routing

**The rival is a mechanical pricing rule, not a strategic competitor.** It does not observe the player's quotes, does not adapt to the player's behaviour, has no profit objective, never refuses a trade and never changes δ. It exists only to give the player a reason not to quote 0 and 100, and to make the number of fills depend on the player's quotes. It knows the true α and sees the same public tape the player sees. At arrival t, with p = p_{t-1}:

```
b^R_t = floor_τ( max(0,   B*_t − δ) )
a^R_t = ceil_τ ( min(100, A*_t + δ) )
```

**Routing.** Each arrival is filled by exactly one maker, by price only:
- BUY goes to the player iff a_t < a^R_t. Otherwise it goes to the rival.
- SELL goes to the player iff b_t > b^R_t. Otherwise it goes to the rival.

**Ties go to the rival.** (Alternative: a fair coin. See F9.)

### 4.4 Inventory and settlement

When a BUY is filled by the player at price a_t, the player sells one unit: cash += a_t, inventory −= 1. When a SELL is filled at b_t, the player buys one unit: cash −= b_t, inventory += 1. At the end of the round all inventory is closed at V:

```
Π = cash + inventory · V = Σ over player fills of  s_t (price_t − V),   s_t = +1 for BUY, −1 for SELL
```

No inventory limits, no risk penalty, and no carry-over between rounds. Session wealth is the sum of round Π over R rounds.

### 4.5 The public market tape

**Plain English.** The tape is the list of every trade in the market, whoever filled it. You see the rival's trades as well as your own, which is what lets you (and the reference) learn from every arrival.

For every arrival t, the tape T_t contains one record:

```
(t, d_t, filler ∈ {player, rival}, fill price)
```

- The tape includes **all** arrivals, including those filled by the rival. Every arrival is filled by exactly one maker (4.3).
- It is public to the player, the reference, the rival and the coach.
- A record is added only after the quotes for that arrival are locked (L4).
- It never contains V, trader types, future arrivals, or the quote on the side that did not trade.
- Reference, rival and coach functions read only T_{t-1} (plus α, p0, δ, τ).

---

## 5. Scoring

**Plain English.** There are two scores. **Expected edge** measures whether your quotes were good given what you knew, and is the headline score. **Realised P&L** is what you actually made, and it includes luck. In this game luck is much larger than skill, so edge leads and P&L is shown secondarily.

**Reference edge of a fill:**

```
BUY  filled at a_t:  e_t = a_t − A*_t
SELL filled at b_t:  e_t = B*_t − b_t
Round edge  E = Σ e_t over the player's fills;   Luck = Π − E
```

**Property E (edge is expected P&L).** E[Π] = E[E].

*Argument.* s_t, price_t and the fill event G_t are determined by the public tape through arrival t and the player's quotes. The player's quotes depend only on T_{t-1} and randomness unrelated to V. By M5, whether the player is filled is decided by (quotes, d_t) and not by V. So V is independent of G_t given (T_{t-1}, d_t). That gives

```
E[V | T_{t-1}, d_t, G_t] = E[V | T_{t-1}, d_t] = A*_t (BUY) or B*_t (SELL)
```

By the law of iterated expectations, each fill's expected P&L equals its edge e_t. Summing over t gives the result. **This requires the leakage rules in section 6.** If any quote-setting component sees V or trader types, Property E fails. This needs independent verification (F1).

---

## 6. Information-leakage rules

- **L1.** Each round's scenario (V, types, d_1..d_N) is drawn with a market RNG when the round starts and stays sealed in the engine.
- **L2.** Reference, rival and coach functions take only (T_{t-1}, α, p0, δ, τ). They never see V, types or future arrivals.
- **L3.** The client payload before round end contains no V, types, future directions or unexecuted rival quotes.
- **L4.** Reveal order is fixed: quote lock, then d_t and routing, then the tape record, then the coach note.
- **L5.** V and types are revealed only after settlement.
- **L6.** The market RNG is separate from any other RNG. Each session records its seed.

---

## 7. Coach

The coach's notes are generated from numbers only: the reference quotes, the player's quotes, the edge-if-filled on each side, who filled the trade, and realised versus edge. Banned words: "optimal", "correct price", "you should have". Approved wording: "reference", "break-even under the model". The coach reports expected edge first and realised P&L second.

---

## 8. Logging and reproducibility

One JSON line per round: anonymous session id, seed, parameters, V, types, tape, player and rival quotes, fills, edge, Π. Same seed gives an identical round. No personal data is collected. The hosted game must say what it logs.

---

## 9. Acceptance tests

All tests below are implemented in `tests/test_engine.py` and pass against the section 1 defaults (α=0.2, p0=0.5, N=10, δ=2, τ=1, R=10, ties to the rival).

| ID | Test |
|---|---|
| T1 | P(BUY \| V) + P(SELL \| V) = 1 for each V. |
| T2 | α=0.2, p0=0.5 reproduces the section 3 table to 1e-4. |
| T3 | A*(p) + B*(1−p) = 100 for random p and α. |
| T4 | Sequential updates equal the odds identity. Any permutation of the same trades gives the same p. |
| T5 | α=0 gives B*=A*=100p. α=0.999, p=0.5 gives a spread near 99.9. |
| T6 | Forced fills at reference quotes (no routing): mean Π is within 3 standard errors of 0 over 100,000 rounds. |
| T7 | **Required statistical test (Property E).** For each fixed-rule strategy in a stated list (for example: just inside the rival; floor B*/ceil A*; 3 points tighter than reference), the mean of Π − E over at least 100,000 rounds is within 3 standard errors of 0. **Informational only, not pass/fail:** report Var(E) / Var(Π). In the corrected runs it was about 0.0001 or smaller; this is an empirical observation for these strategies, not a general property. |
| T8 | Routing table: BUY with a_t below, equal to and above a^R_t goes to player, rival, rival. SELL likewise with b_t above, equal to and below b^R_t. |
| T9 | Settlement: V=100, BUY filled at 60 and SELL filled at 50 gives Π = +10. The same fills at V=0 also give +10. A single BUY at 60 gives −40 at V=100 and +60 at V=0. |
| T10 | Rival quotes (α=0.2, τ=1, δ=2): no history (38, 62). After BUY (48, 72). After BUY, BUY (58, 80). |
| T11 | Edge: at t=1, ask 61 and a BUY gives +1. Bid 39 and a SELL gives +1. |
| T12 | Quote validation rejects b>a, values outside [0,100] and off-tick values. Helpers reject invalid directions, and `Params` rejects invalid numbers. |
| T13 | No leakage: changing V and types while keeping the tape the same leaves every reference, rival and coach quote unchanged. Tested through the real `GameSession`: step results, coach notes and the public view are identical before settlement. |
| T14 | The client payload before round end has no V, types, future directions or unexecuted rival quotes. Tested before and after each quote through the session, plus a source check that `app.py` never touches `strategy_view` or the sealed scenario. A browser-level test is not done (see F11). |
| T15 | Same seed gives an identical round. Clipping at 0 and 100 works near p=0 and p=1 (for example, α=0.999 gives a rival ask of 100). |
| T16 | Tape: every arrival has exactly one record, including rival-filled ones, and a mixed player/rival round records every execution price. A record contains no V, type or unexecuted quote. |

**Reproducibility rule for statistical tests.** Every simulation-based test (T6, T7) uses a fixed, recorded random seed, so a failure can be replayed exactly. Each reports its sample size, the mean, and the standard error, so sampling uncertainty is visible and not hidden behind pass/fail.

Compatibility with the defaults: T10 and T11 use τ=1 and δ=2 explicitly and their numbers were recomputed. T5, T6 and T15 do not depend on τ or δ. T7 uses Π − E, which is zero in expectation for any quoting rule that obeys section 6. No test depends on R, so R=10 changes nothing.

---

## 10. Simulation figures (CORRECTED v0.4)

**Status.** The v0.2/v0.3 figures were provisional and **were wrong**: a throwaway script had floating-point rounding fuzz at exactly round reference prices (for example 40.00000000000001), which moved the rival's rounded quotes. The implementation now computes these figures **exactly** (`simulate.exact_expectations`, enumerating every possible round with its true probability) and by seeded simulation (`tests/test_engine.py`). The two agree. **Independently verified (v0.5):** ChatGPT recomputed all four values with separate code using exact fractions (+13.151455744, +3.1576072192, 0, −30.101023744; SD Π 123.4887, SD edge 1.3860), and `tests/test_independent.py` repeats that calculation without importing the engine. Treat the exact column as the reference.

N=10, α=0.2, δ=2, τ=1, p0=0.5, ties to the rival.

| Strategy | Fills/round | Exact E[Π] = E[edge] | SD Π | SD edge | Var(edge)/Var(Π) |
|---|---|---|---|---|---|
| Just inside rival (rival bid +1, rival ask −1) | 10.00 | +13.1515 | 123.49 | 1.386 | 0.000126 |
| Floor B* / ceil A* (just outside reference) | 10.00 | +3.1576 | 123.48 | 1.394 | 0.000127 |
| Exactly at rival's quotes | 0.00 | 0 | 0 | 0 | n/a |
| Rounded reference, 3 points tighter | 10.00 | −30.1010 | 123.74 | 0.703 | 0.000032 |

Simulated checks (100,000 rounds, fixed seeds, `pytest -s`): T6 forced fills at the reference, mean Π = +0.40 ± 0.39 (zero within sampling error). T7, seed 777: mean(Π − E) = −0.41 ± 0.39 for all three bots (they see the same random rounds, so they share the same luck). Simulated mean edge for "just inside the rival" was 13.15; mean Π 12.74 ± 0.39, consistent with the exact value.

Observations: **Property E holds exactly** (E[Π] = E[edge] to 1e-9 for every bot). The best expected edge is about +13 per round (about 1.3 per fill, because the rival rounds outward), against a round-to-round SD of Π near 124. Over R=10 rounds the expected edge (about 131) is well below the SD of total Π (about 390), so edge must be the headline score. The variance ratio is an empirical observation for these bots only.

**Not yet reproduced by the implementation:** the misspecification figure (a maker assuming α=0.2 when the truth is 0.6 lost about 104 per round in forced-fill mode, from the old throwaway script). It stays provisional until Stage 2.

---

## 11. Decisions and flagged issues

| ID | Status | Issue |
|---|---|---|
| F1 | Verified (v0.5) | Property E and the selection argument in section 5 checked independently by ChatGPT (argument plus exact enumeration). The tests prove it for the listed bots only. The general result rests on the section 5 argument and rules L1 to L6. |
| F2 | Accepted | Full-tape visibility is unrealistic. It keeps direction exogenous and will be needed for the Stage 2 estimator. |
| F3 | Accepted | The rival knows α and is non-adaptive (4.3). It may be too easy or too hard. |
| F4 | **Decided** | Challenge mode default, Practice optional. In Practice the best play is to undercut by a tick, so the maths plays little role there. |
| F5 | Accepted | Informed traders ignore price within [0,100]. This is a simplification. |
| F6 | **Decided** | α = 0.2, publicly shown in Stage 1, hidden in Stage 2. |
| F7 | **Decided** | τ = 1, δ = 2. Exploitable margin about 1.3 points per fill (section 10, exact), so the edge ceiling for the best simple bot is about +13 per round. |
| F8 | Accepted | N=10, R=10, p0=0.5, no inventory limit, no risk aversion. |
| F9 | **Decided** | Ties go to the rival. |
| F10 | Accepted | Units are points, with £ as a display label only. |
| F11 | OPEN | The deployed app must not expose the scenario to the browser. T14 covers the session data flow and a source check on `app.py`, not a browser-level test. Re-check before any public deployment. |
| F12 | CLOSED for Stage 1 | Section 10 recomputed by the implementation, then independently by ChatGPT (exact fractions) and `tests/test_independent.py`. The misspecification figure in section 10 stays provisional until Stage 2. |
| F13 | **Decided** | The rival's rule and δ are not treated as a secret. Challenge mode hides the rival's next quote, but the project documents the model and its limits openly. A player finding a near-best strategy is acceptable for an educational game. Rival stays mechanical; no new features. |
| F15 | Stage 2 | The spec says the rival knows the TRUE α; the code prices the rival with `params.assumed`. Identical in Stage 1. Decide which is intended before building Stage 2. |
| F16 | Documented | Bots in `strategies.py` use `StrategyView`, which includes the rival's next quote. They are privileged benchmarks, not stand-ins for a human. `exact_expectations` is a regression check that reuses engine functions, so independence comes from `tests/test_independent.py`. |
| F14 | **Decided** | The tape shows the rival's price on the side that traded, after the player has committed. This does not violate L4. "Rival quotes hidden" means only unexecuted quotes and the rival's next quote. Accepted under F13. |

---

## 12. Stage 2 hooks (not implemented in Stage 1)

- Engine and reference functions take `alpha_assumed` and `alpha_true` as separate arguments from the start.
- The scenario generator accepts a per-round α schedule.

---

## 13. Out of scope

Real market data, money, multiple assets, adaptive rival, multi-user play.

---

## 14. Change log

- **v0.1** (draft): initial specification.
- **v0.2** (draft): (1) T7 split into a required Π−E statistical test and an informational variance ratio; (2) section 10 labelled provisional and recomputed with τ=1 tick-constrained quotes; (3) rival defined as a mechanical rule, not a strategic competitor (4.3); (4) public market tape defined, including rival-filled orders (4.5, T16). Section 1 defaults and the F4/F6/F7/F9 decisions recorded. New flags F13 and F14. No change to the model in sections 2, 3 or 5.
- **v0.3** (draft): F13 and F14 marked Decided (no secrecy of the rival's rule; rival stays mechanical); added the fixed-seed and standard-error reporting rule to section 9. No change to the model, defaults or tests. ChatGPT approved v0.2's maths and plan.
- **v0.4** (draft): section 10 corrected using an exact enumeration in the implementation (earlier figures were off by about 0.8 per round from floating-point rounding in a throwaway script); F7 and F12 updated; T7 note updated. No change to the model, defaults, rules or tests.
- **v0.5** (draft): ChatGPT audit follow-ups. Tests and documentation only; no change to the model, defaults or rules. Added `tests/test_independent.py` (exact fractions, no engine imports); exact enumerator now passes the real tape to strategies; T12, T13, T14, T16 strengthened; `edge_of_fill` rejects invalid directions; flags F1, F11, F12 updated and F15, F16 added.
