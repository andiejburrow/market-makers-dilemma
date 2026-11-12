"""API and server tests: the browser must never receive hidden information early."""
import json
import threading
import urllib.error
import urllib.request

import pytest

import server
from api import ApiError, GameApi

HIDDEN_KEYS = {"value", "true_value", "informed", "type", "beliefs", "rows", "rival_bid", "rival_ask"}


def walk_keys(o):
    if isinstance(o, dict):
        for k, v in o.items():
            yield k
            yield from walk_keys(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk_keys(v)


def play_round(api, sid, bid=45, ask=55):
    s = api.state(sid)
    while not s["finished"]:
        s = api.lock(sid, bid, ask)
        yield s


def test_no_hidden_keys_before_settlement_and_no_review():
    api = GameApi()
    s = api.start("challenge")
    for s in [s, *play_round(api, s["sid"])]:
        assert s["review"] is None
        assert not (set(walk_keys(s)) & HIDDEN_KEYS)
        text = json.dumps(s).lower()
        assert "informed\"" not in text and "uninformed" not in text


def test_reference_hidden_in_challenge_shown_in_practice():
    api = GameApi()
    assert api.start("challenge")["reference"] is None
    ref = api.start("practice")["reference"]
    assert ref == {"bid": 40.0, "ask": 60.0}


def test_settle_before_finished_and_unknown_sid_and_bad_input():
    api = GameApi()
    sid = api.start("challenge")["sid"]
    with pytest.raises(ApiError):
        api.settle(sid)
    with pytest.raises(ApiError):
        api.state("nope")
    with pytest.raises(ApiError):
        api.start("cheat")
    for bad in [("a", 5), (None, None), (float("nan"), 50), (60, 40), (-1, 50), (50, 101)]:
        with pytest.raises(ApiError):
            api.lock(sid, *bad)
    assert api.state(sid)["served"] == 0


def test_full_session_via_api_and_review_consistency():
    api = GameApi()
    sid = api.start("practice")["sid"]
    for r in range(1, api.params.rounds + 1):
        list(play_round(api, sid, 47, 53))
        s = api.settle(sid)
        v = s["review"]
        assert v["value"] in (0, 100)
        assert len(v["beliefs"]) == api.params.n_arrivals + 1
        assert abs(v["cum_edge"][-1] - v["edge"]) < 1e-9
        assert abs(v["cum_pnl"][-1] - v["pnl"]) < 1e-9
        assert abs(sum(v["per_edge"]) - v["edge"]) < 1e-9
        assert abs(v["pnl"] - v["edge"] - v["luck"]) < 1e-9
        if r < api.params.rounds:
            s = api.next_round(sid)
            assert s["review"] is None and s["served"] == 0
    assert s["session"]["over"] and len(s["session"]["results"]) == api.params.rounds
    with pytest.raises(ApiError):
        api.next_round(sid)
    assert api.log(sid).strip()


def test_session_cap():
    api = GameApi()
    ids = [api.start("challenge")["sid"] for _ in range(550)]
    assert len(api._sessions) <= 500
    with pytest.raises(ApiError):
        api.state(ids[0])


@pytest.fixture(scope="module")
def base():
    srv = server.make_server("127.0.0.1", 0)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def post(base, path, body=b"{}"):
    req = urllib.request.Request(base + path, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_http_pages_and_headers(base):
    with urllib.request.urlopen(base + "/") as r:
        assert r.status == 200 and b"Market Maker" in r.read()
        assert "no-store" in r.headers["Cache-Control"]
        assert "default-src 'self'" in r.headers["Content-Security-Policy"]
    for p in ("/app.js", "/style.css", "/favicon.svg"):
        with urllib.request.urlopen(base + p) as r:
            assert r.status == 200


@pytest.mark.parametrize("p", ["/../server.py", "/%2e%2e/server.py", "/..%2fapi.py", "/nope.html", "/api.py"])
def test_http_traversal_and_missing_are_404(base, p):
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(base + p)
    assert e.value.code == 404


def test_http_api_flow_and_errors(base):
    code, s = post(base, "/api/start", b'{"mode":"challenge"}')
    assert code == 200 and s["reference"] is None
    code, s2 = post(base, "/api/lock", json.dumps({"sid": s["sid"], "bid": 45, "ask": 55}).encode())
    assert code == 200 and s2["served"] == 1 and s2["review"] is None
    assert post(base, "/api/start", b"not json")[0] == 400
    assert post(base, "/api/start", b"[1]")[0] == 400
    assert post(base, "/api/start", b'{"mode":"x"}')[0] == 400
    assert post(base, "/api/settle", json.dumps({"sid": s["sid"]}).encode())[0] == 400
    assert post(base, "/api/unknown")[0] == 404
    assert post(base, "/api/config", b" " * 20000)[0] == 413
    with urllib.request.urlopen(base + "/api/log?sid=" + s["sid"]) as r:
        assert r.status == 200 and "attachment" in r.headers["Content-Disposition"]
