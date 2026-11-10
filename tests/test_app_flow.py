"""
App flow test with a stand-in for Streamlit (no browser needed).

Plays whole sessions through app.py's callbacks and re-renders the page after
every step. It checks that nothing hidden (true value, trader types) is drawn
before settlement (spec L3, L5), that bad quotes show an error, and that the
quote boxes reset after each lock. It is not a visual test: how the page
looks must still be checked by eye.
"""
import pathlib
import runpy
import sys
import types

APP = str(pathlib.Path(__file__).parent.parent / "app.py")
ROOT = str(pathlib.Path(__file__).parent.parent)


class _Dummy:
    def __init__(self, rec): self._rec = rec
    def markdown(self, s, *a, **k): self._rec.append(s); return _Dummy(self._rec)
    def __call__(self, *a, **k): return _Dummy(self._rec)
    def __getattr__(self, n): return _Dummy(self._rec)
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def __iter__(self): return iter([_Dummy(self._rec)] * 4)


class _SS(dict):
    __getattr__ = dict.get
    def __setattr__(self, k, v): self[k] = v


def _fake_streamlit():
    rec = []
    st = types.ModuleType("streamlit")
    st.session_state = _SS()
    st.sidebar = _Dummy(rec)
    st.columns = lambda spec, *a, **k: [_Dummy(rec) for _ in range(spec if isinstance(spec, int) else len(spec))]
    st.markdown = lambda s, *a, **k: rec.append(s)
    st.__getattr__ = lambda n: _Dummy(rec)
    return st, rec


def test_app_plays_full_sessions_and_hides_secrets_until_settlement(monkeypatch):
    st, rec = _fake_streamlit()
    monkeypatch.setitem(sys.modules, "streamlit", st)
    monkeypatch.syspath_prepend(ROOT)

    def render():
        rec.clear()
        return runpy.run_path(APP)

    ss = st.session_state
    g = render()
    assert ss.page == "home"
    g["go"]("how"); render(); assert ss.page == "how"
    g["go"]("home")
    for mode in ("practice", "challenge"):
        g["start"](mode); render()

    for rnd in range(10):
        for _ in range(10):
            ss.bid_input, ss.ask_input = 39.0, 61.0
            g["on_lock"]()
            assert ss.error is None
            assert (ss.bid_input, ss.ask_input) == (30.0, 70.0)    # boxes reset
            render()
            page = " ".join(rec).lower()
            assert "true value revealed" not in page and "uninformed" not in page
        g["on_settle"](); render()
        assert "true value revealed" in " ".join(rec).lower()
        if rnd < 9:
            g["on_next"](); render()
    assert ss.game.over

    g["on_restart"](); render()
    ss.bid_input, ss.ask_input = 70.0, 30.0                         # bid above ask
    g["on_lock"]()
    assert ss.error
