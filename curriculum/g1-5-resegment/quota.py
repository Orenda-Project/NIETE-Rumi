"""Staying inside Sheets' 60-writes-per-minute-per-user quota.

A full rebuild of this workbook is about a hundred write calls — seventeen
tabs created, sixteen value updates, and roughly forty batched formatting
calls of 200 requests each. Fired as fast as the network allows, that trips
`HttpError 429 ... WriteRequestsPerMinutePerUser` partway through, and a
build that dies partway through leaves the workbook in a state no one can
review: the last run got as far as the Navigation tab and stopped, so the
index was missing from a workbook whose whole point was being navigable.

Two things fix that, and both belong at the HTTP layer rather than at the
sixteen call sites that would each have to remember them:

    PACE — never start more than LIMIT calls inside any 60-second window.
    Waiting 4 seconds on purpose is cheaper than losing a 7,000-request run.

    RETRY — googleapiclient already backs off on 429, but only when a call
    asks for retries, and the default is none. Every call now asks.

Importing this module installs both. sheetio imports it, and every module
that writes goes through sheetio, so nothing else has to know.
"""
import collections
import time

from googleapiclient import http as _http

LIMIT = 55          # of the 60 the quota allows — headroom for a stray read
WINDOW = 60.0
RETRIES = 5         # ~1+2+4+8+16s of backoff, which outlasts any one window

_starts = collections.deque()


def wait():
    """Block until starting one more call keeps us under LIMIT per minute."""
    now = time.monotonic()
    while _starts and now - _starts[0] > WINDOW:
        _starts.popleft()
    if len(_starts) >= LIMIT:
        time.sleep(WINDOW - (now - _starts[0]) + 0.1)
        return wait()
    _starts.append(time.monotonic())


_plain = _http.HttpRequest.execute


def _execute(self, http=None, num_retries=0):
    wait()
    return _plain(self, http=http, num_retries=num_retries or RETRIES)


_http.HttpRequest.execute = _execute
