"""The pure rules of scripts/sandbox-pii-purge.py: find real phones in any text, map each person to ONE fake number
in Pakistan's unallocated 0399 block, rewrite every spelling in place, and make marked dummy names.

Why consistent and shape-preserving: the sandbox joins people by phone in many places (users.phone_number,
leader_teachers.teacher_phone_e164 / teacher_ext_id, observation_schedules.teacher_ext_id, chat_starts,
lesson_plan_requests, R2 object keys inside URLs). A value that was equal to another before the purge must still
be equal after it, in whatever spelling it was stored, or pickers and dashboards break.

  pk class   92 / +92 / 0 + 3xx xxxxxxx      -> same spelling, national number 3998 + a 6-digit code
  m99 class  99 + 3xx xxxxxxx (an older 92->99 re-prefix on sandbox; still the real number)
                                             -> 92 + 3999 + the same 6-digit code
0399 is no Pakistani operator's code (scripts/lib/gb_migration.py uses 0399-7 for its fakes), so a rewritten
number reaches no phone and still passes every 92-3-nine-digits validator in the repo.

Tests: scripts/tests/test_sandbox_scrub.py
"""
import hashlib
import re
from dataclasses import dataclass
from urllib.parse import urlparse

SANDBOX_REF = "olvritwoqujtjvwfulbh"
OTHER_REFS = ("ihzciabopbttygxxgrkm", "rpqkekcfvumypldbejhp")  # production, staging
SANDBOX_BUCKET = "rumi-sandbox"
FAKE_BLOCK = {"pk": "3998", "m99": "3999"}

PHONE_RE = re.compile(
    r"(?<![0-9A-Za-z\-])"
    r"(?P<cc>\+92[ -]?|92[ -]?|99|0)"
    r"(?P<n>3\d{2}[ -]?\d{7})"
    r"(?![0-9A-Za-z])"
)
# The same thing for Postgres ~ (no look-behind there): used to pick candidate rows, never to rewrite.
PG_PHONE_RE = r"(^|[^0-9A-Za-z-])(\+92[ -]?|92[ -]?|99|0)3[0-9]{2}[ -]?[0-9]{7}([^0-9A-Za-z]|$)"


@dataclass(frozen=True)
class Found:
    start: int
    end: int
    cc: str
    national: str
    cls: str


def find_phones(text):
    out = []
    for m in PHONE_RE.finditer(text or ""):
        cc = m.group("cc")
        out.append(Found(m.start(), m.end(), cc, re.sub(r"\D", "", m.group("n")), "m99" if cc == "99" else "pk"))
    return out


def is_real_national(n):
    return bool(re.fullmatch(r"3\d{9}", n or "")) and not n.startswith("399")


def build_code_map(nationals, salt, taken):
    """{national: 6-digit code}, unique, the same whatever order the nationals come in, avoiding `taken`."""
    used = set(taken)
    out = {}
    for n in sorted(set(nationals)):
        attempt = 0
        while True:
            h = hashlib.sha256(f"{salt}:{n}:{attempt}".encode()).hexdigest()
            code = str(int(h, 16) % 10 ** 6).zfill(6)
            if code not in used:
                break
            attempt += 1
            if attempt > 10 ** 6:
                raise RuntimeError("fake code space exhausted")
        used.add(code)
        out[n] = code
    return out


def _render(m, codes):
    cc, raw_n = m.group("cc"), m.group("n")
    cls = "m99" if cc == "99" else "pk"
    new_nat = FAKE_BLOCK[cls] + codes[re.sub(r"\D", "", raw_n)]
    it = iter(new_nat)
    new_n = "".join(next(it) if ch.isdigit() else ch for ch in raw_n)
    return ("92" if cls == "m99" else cc) + new_n


def scrub_phones(text, codes, keep):
    """(text with every real phone rewritten, how many). `keep`: national numbers of keep-list people, left as they
    are in the pk spelling (a masked 99 copy of them is still rewritten). A real number missing from `codes` raises:
    the caller collects every number first, so a miss is a bug, never a silent leak."""
    if not text:
        return text, 0
    count = 0

    def sub(m):
        nonlocal count
        cls = "m99" if m.group("cc") == "99" else "pk"
        n = re.sub(r"\D", "", m.group("n"))
        if not is_real_national(n) or (cls == "pk" and n in keep):
            return m.group(0)
        count += 1
        return _render(m, codes)

    return PHONE_RE.sub(sub, text), count


def fake_e164(national, codes, cls="pk"):
    return "92" + FAKE_BLOCK[cls] + codes[national]


# ── names ────────────────────────────────────────────────────────────────────────────────────────────────
FIRST = ("Ayesha", "Fatima", "Sana", "Hina", "Rabia", "Saba", "Nadia", "Amna", "Maryam", "Zainab", "Kiran", "Sadia",
         "Asma", "Bushra", "Farah", "Iqra", "Mehwish", "Noor", "Rida", "Samina", "Shazia", "Uzma", "Yasmin", "Zara",
         "Ahmed", "Ali", "Bilal", "Danish", "Faisal", "Hamza", "Imran", "Junaid", "Kamran", "Usman", "Omar", "Rizwan",
         "Saad", "Tariq", "Waqas", "Yasir", "Zubair", "Adnan", "Asad", "Fahad", "Haris", "Naveed", "Salman", "Shahid")
FIRST_UR = ("عائشہ", "فاطمہ", "ثنا", "حنا", "رابعہ", "صبا", "نادیہ", "آمنہ", "مریم", "زینب", "کرن", "سعدیہ",
            "احمد", "علی", "بلال", "دانش", "فیصل", "حمزہ", "عمران", "جنید", "کامران", "عثمان", "عمر", "رضوان")
FAKE_NAME_RE = re.compile(r"(Dummy|ڈمی) \d{4}$")


def _h(seed, salt):
    return int(hashlib.sha256(f"{salt}:name:{seed}".encode()).hexdigest(), 16)


def fake_name(seed, salt, kind="person"):
    h = _h(seed, salt)
    num = (h // 97) % 10000
    if kind == "student":
        return f"Student Dummy {num:04d}"
    if kind == "parent":
        return f"Parent Dummy {num:04d}"
    return f"{FIRST[h % len(FIRST)]} Dummy {num:04d}"


def fake_name_ur(seed, salt, kind="person"):
    h = _h(seed, salt)
    num = (h // 97) % 10000
    first = {"student": "طالب علم", "parent": "سرپرست"}.get(kind) or FIRST_UR[h % len(FIRST_UR)]
    return f"{first} ڈمی {num:04d}"


def is_fake_name(name):
    return bool(name) and bool(FAKE_NAME_RE.search(str(name).strip()))


def replace_names(text, mapping):
    """Replace whole-word, case-insensitive occurrences of each real name with its fake, longest first, one pass."""
    if not text or not mapping:
        return text
    keys = sorted((k for k in mapping if k and len(k.strip()) >= 3), key=len, reverse=True)
    if not keys:
        return text
    lower = {k.lower(): mapping[k] for k in keys}
    pat = re.compile(r"(?<!\w)(" + "|".join(re.escape(k) for k in keys) + r")(?!\w)", re.IGNORECASE)
    return pat.sub(lambda m: lower[m.group(1).lower()], text)


# ── guards and storage ───────────────────────────────────────────────────────────────────────────────────
def refuse_unless_sandbox(url):
    u = url or ""
    if SANDBOX_REF not in u or any(r in u for r in OTHER_REFS):
        raise SystemExit("REFUSING: this is not the NIETE sandbox database")


def refuse_real_data_into_sandbox(url):
    """For scripts that copy REAL people (FDE / main Rumi / production) into a NIETE database: the sandbox holds
    dummy people only, because outside developers share it and copy it to their laptops."""
    if SANDBOX_REF in (url or ""):
        raise SystemExit("REFUSING: this script copies real people's data, and the target is the NIETE sandbox, which "
                         "holds dummy people only. Import into staging/production; seed the sandbox with fake data.")


def refuse_unless_sandbox_bucket(bucket):
    if bucket != SANDBOX_BUCKET:
        raise SystemExit(f"REFUSING to delete from bucket {bucket!r}: only {SANDBOX_BUCKET}")


def r2_bucket_key(value):
    """(bucket, key) for an R2 URL or a bare key. Path-style cloudflarestorage URLs name the bucket in the path,
    virtual-hosted ones in the host; a public r2.dev URL gives bucket 'pub' (its bucket is not in the URL)."""
    if not value:
        return None, None
    v = str(value).strip()
    if not re.match(r"^https?://", v):
        return None, v.lstrip("/")
    p = urlparse(v)
    host, path = p.hostname or "", p.path.lstrip("/")
    if host.endswith("r2.cloudflarestorage.com"):
        labels = host.split(".")
        if len(labels) >= 5:
            return labels[0], path
        bucket, _, key = path.partition("/")
        return bucket, key
    if host.endswith("r2.dev"):
        return "pub", path
    return host, path
