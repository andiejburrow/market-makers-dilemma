"""Static checks on the web page: every file it loads exists, and the scripts parse."""
import pathlib
import re
import shutil
import subprocess

import pytest

WEB = pathlib.Path(__file__).resolve().parent.parent / "web"


def test_every_local_file_referenced_by_index_exists():
    html = (WEB / "index.html").read_text()
    refs = re.findall(r'(?:src|href)="(/[^"]+)"', html)
    assert refs, "index.html should load scripts and styles"
    for r in refs:
        assert (WEB / r.lstrip("/")).is_file(), f"missing {r}"


def test_scripts_load_in_dependency_order():
    html = (WEB / "index.html").read_text()
    order = re.findall(r'<script src="/([^"]+)"', html)
    for early, late in [("sfx.js", "flap.js"), ("flap.js", "app.js"), ("market.js", "app.js"), ("arena.js", "app.js")]:
        assert order.index(early) < order.index(late)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
@pytest.mark.parametrize("name", ["sfx.js", "flap.js", "market.js", "arena.js", "app.js"])
def test_scripts_parse(name):
    r = subprocess.run(["node", "--check", str(WEB / name)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_front_end_never_asks_for_hidden_fields():
    """The page code must not contain the hidden-scenario field names the API only sends after settlement
    outside the review code path (a cheap guard against accidental early use)."""
    src = (WEB / "app.js").read_text()
    assert "_scenario" not in src and "strategy_view" not in src
