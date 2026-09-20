# -*- coding: utf-8 -*-
"""Send a Stage C write and prove it landed. I/O only.

Every decision this module could get wrong is made in stagec_write and tested
there. What is left here is the round trip: push the ranges, read the same
ranges back, and compare cell for cell. A write is not reported as done until
the sheet has been asked what it holds.

USER_ENTERED is deliberate. Moves cells contain a middot and pipes, and
RAW would leave a teacher-primary figure stored as text in a numeric column.
"""


def send(svc, sheet_id, payload):
    """Push ValueRanges. Returns the number of cells the API says it updated."""
    if not payload:
        return 0
    resp = svc.spreadsheets().values().batchUpdate(
        spreadsheetId=sheet_id,
        body={"valueInputOption": "USER_ENTERED", "data": payload},
    ).execute()
    return resp.get("totalUpdatedCells", 0)


def fetch(svc, sheet_id, ranges):
    """Read ranges back. Sheets may return them short, or omit them."""
    if not ranges:
        return []
    resp = svc.spreadsheets().values().batchGet(
        spreadsheetId=sheet_id, ranges=ranges,
    ).execute()
    return resp.get("valueRanges", [])


def write_tab(svc, sheet_id, tab_doc, new_values, columns, writer=None):
    """Build, send, read back, diff. Returns (cells_updated, findings).

    Findings are cells the sheet does not hold as sent. A non-empty list
    means the write must not be reported as complete, whatever the API
    said it updated.
    """
    import stagec_write

    payload = stagec_write.build_payload(
        tab_doc["tab"], tab_doc["header"], tab_doc["rows"], new_values, columns)
    updated = (writer or send)(svc, sheet_id, payload)
    got = stagec_write.readback_cells(
        payload, tab_doc["header"],
        fetch(svc, sheet_id, [v["range"] for v in payload]))
    return updated, stagec_write.diff_readback(new_values, got)
