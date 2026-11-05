"""
Red-first tests for the corpus reader's R2 source and its error text (contract 3,
corpus-import.md §2, T11). Split from test_corpus_reader.py (300-line rule).

    python3 -m pytest scripts/lib/test_corpus_reader_r2.py -q
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import corpus_reader as cr  # noqa: E402
from test_corpus_reader import MINI, R  # noqa: E402,F401


# ── T11: R2 ──────────────────────────────────────────────────────────────────

class FakeR2:
    def __init__(self, objects, page_size=1000):
        self.objects = objects
        self.calls = []
        self.page_size = page_size

    def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None):
        self.calls.append(("list", Prefix))
        keys = sorted(k for k in self.objects if k.startswith(Prefix))
        start = int(ContinuationToken or 0)
        chunk = keys[start:start + self.page_size]
        more = start + self.page_size < len(keys)
        out = {"Contents": [{"Key": k} for k in chunk], "IsTruncated": more}
        if more:
            out["NextContinuationToken"] = str(start + self.page_size)
        return out

    def get_object(self, Bucket, Key):
        self.calls.append(("get", Key))
        body = json.dumps(self.objects[Key]).encode()

        class B:
            def read(self_inner):
                return body
        return {"Body": B()}


def _r2_objects(stem, recs):
    pre = f"lp612/page-truth/{stem}/"
    objs = {pre + "_book.json": {"book_stem": stem}, pre + "_toc.json": [],
            pre + "figures/f1.jpg": {}}
    for r in recs:
        objs[pre + "pg_%03d.json" % r["printed_page_number"]] = r
    return objs


def test_r2_reads_page_objects_only():
    recs = [R(1, 1), R(2, 2), R(3, 3)]
    fake = FakeR2(_r2_objects("grade_7_x", recs), page_size=2)
    got = cr.read_r2("grade_7_x", client=fake, bucket="b")
    assert [r["printed_page_number"] for r in got["records"]] == [1, 2, 3]
    assert got["book"] == {"book_stem": "grade_7_x"}
    gets = [k for kind, k in fake.calls if kind == "get"]
    assert not any("figures" in k or "_toc" in k for k in gets)


def test_r2_missing_keys_fail_loudly():
    bad = R(1, 1)
    del bad["pdf_page_index"]
    with pytest.raises(cr.CorpusError, match="pdf_page_index"):
        cr.read_r2("grade_7_x", client=FakeR2(_r2_objects("grade_7_x", [bad])), bucket="b")


def test_r2_empty_stem_fails_loudly():
    with pytest.raises(cr.CorpusError, match="grade_7_x"):
        cr.read_r2("grade_7_x", client=FakeR2({}), bucket="b")


def test_r2_shortfall_fails_loudly():
    fake = FakeR2(_r2_objects("grade_7_x", [R(1, 1), R(2, 2)]))
    with pytest.raises(cr.CorpusError, match="grade_7_x"):
        cr.read_r2("grade_7_x", client=fake, bucket="b", local_count=3)
    assert len(cr.read_r2("grade_7_x", client=fake, bucket="b", local_count=2)["records"]) == 2


def test_local_only_stems_never_use_r2():
    fake = FakeR2({})
    with pytest.raises(cr.CorpusError, match="--corpus-local"):
        cr.read_r2("grade_12_urdu", client=fake, bucket="b")
    assert fake.calls == []
    assert {"grade_10_urdu", "grade_12_urdu"} <= cr.LOCAL_ONLY_STEMS


def test_no_secret_in_error_text(monkeypatch):
    secret = "sk-very-secret-value-123"

    def fake_env(key, default=None):
        if key == "R2_SECRET_ACCESS_KEY":
            raise KeyError(f"{key} not in .env")
        return secret
    monkeypatch.setattr(cr, "env", fake_env)
    with pytest.raises(cr.CorpusError) as e:
        cr.make_r2_client()
    assert "R2_SECRET_ACCESS_KEY" in str(e.value)
    assert secret not in str(e.value)
    assert "--corpus-local" in str(e.value)


def test_load_book_prefers_local_and_never_touches_r2():
    calls = []
    got = cr.load_book("grade_7_example", corpus_local=MINI,
                       client_factory=lambda: calls.append(1))
    assert calls == [] and len(got["records"]) == 3


def test_load_book_local_missing_stem_raises():
    with pytest.raises(cr.CorpusError, match="grade_8_none"):
        cr.load_book("grade_8_none", corpus_local=MINI)


def test_make_r2_client_builds_s3_client(monkeypatch):
    seen = {}

    class FakeBoto:
        @staticmethod
        def client(service, **kw):
            seen["service"], seen["kw"] = service, kw
            return "CLIENT"
    monkeypatch.setitem(sys.modules, "boto3", FakeBoto)
    monkeypatch.setattr(cr, "env", lambda key, default=None: f"v-{key}")
    assert cr.make_r2_client() == ("CLIENT", "v-R2_BUCKET_NAME")
    assert seen == {"service": "s3", "kw": {
        "endpoint_url": "v-R2_ENDPOINT", "aws_access_key_id": "v-R2_ACCESS_KEY_ID",
        "aws_secret_access_key": "v-R2_SECRET_ACCESS_KEY", "region_name": "auto"}}

def test_make_r2_client_names_every_missing_key(monkeypatch):
    def none(key, default=None):
        raise KeyError(key)
    monkeypatch.setattr(cr, "env", none)
    with pytest.raises(cr.CorpusError) as e:
        cr.make_r2_client()
    assert "R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME" in str(e.value)

def test_make_r2_client_without_boto3(monkeypatch):
    monkeypatch.setattr(cr, "env", lambda key, default=None: "v")
    monkeypatch.setitem(sys.modules, "boto3", None)
    with pytest.raises(cr.CorpusError, match="boto3 is not installed; pass --corpus-local"):
        cr.make_r2_client()

def test_r2_transport_error_names_stem_and_type_not_text():
    class Boom:
        def list_objects_v2(self, **kw):
            raise ConnectionError("https://secret-endpoint/?sig=abc")
    with pytest.raises(cr.CorpusError) as e:
        cr.read_r2("grade_7_x", client=Boom(), bucket="b")
    msg = str(e.value)
    assert msg == "R2 read failed for grade_7_x (ConnectionError); pass --corpus-local <dir>"

def test_r2_messages_are_exact():
    with pytest.raises(cr.CorpusError) as e:
        cr.read_r2("grade_7_x", client=FakeR2({}), bucket="b")
    assert str(e.value) == ("R2 lists no page objects under lp612/page-truth/grade_7_x/; "
                            "pass --corpus-local <dir>")
    with pytest.raises(cr.CorpusError) as e:
        cr.read_r2("grade_7_x", client=FakeR2(_r2_objects("grade_7_x", [R(1, 1)])), bucket="b",
                   local_count=2)
    assert str(e.value) == "grade_7_x: R2 holds 1 pages, local corpus 2"
    bad = {k: v for k, v in R(1, 1).items() if k not in ("text", "chapter")}
    with pytest.raises(cr.CorpusError) as e:
        cr.read_r2("grade_7_x", client=FakeR2(_r2_objects("grade_7_x", [bad])), bucket="b")
    assert str(e.value) == "lp612/page-truth/grade_7_x/pg_001.json lacks text, chapter"
    with pytest.raises(cr.CorpusError, match="grade_9_10_chemistry_experiment is never imported"):
        cr.read_r2("grade_9_10_chemistry_experiment", client=None, bucket="b")

def test_r2_book_json_optional():
    objs = _r2_objects("grade_7_x", [R(1, 1)])
    del objs["lp612/page-truth/grade_7_x/_book.json"]
    assert cr.read_r2("grade_7_x", client=FakeR2(objs), bucket="b")["book"] == {}
