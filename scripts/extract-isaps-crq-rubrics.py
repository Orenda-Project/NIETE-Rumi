"""Extract the I-SAPS Level 1 CRQ rubrics from the partner .docx files.

Parses the WordprocessingML table structure rather than regexing flattened
text. The first attempt did the latter and silently captured ZERO band
descriptions for 71 of 107 criteria — a rubric with no marking standard, which
would have looked fine in a row count.
"""
import zipfile, re, json, glob
from xml.etree import ElementTree as ET

NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
BAND_MARKS = [4, 3, 2, 1]   # column order: Exemplary, Proficient, Developing, Beginning

def cell_text(tc):
    out = []
    for p in tc.findall('.//w:p', NS):
        t = "".join(n.text or "" for n in p.findall('.//w:t', NS))
        if t.strip():
            out.append(t.strip())
    return "\n".join(out)

def rows_of(tbl):
    return [[cell_text(tc) for tc in tr.findall('./w:tc', NS)] for tr in tbl.findall('./w:tr', NS)]

def parse_file(path):
    mod = int(re.search(r"Module (\d+)", path).group(1))
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    tables = [rows_of(t) for t in root.findall('.//w:tbl', NS)]

    items, cur = [], None
    for rows in tables:
        for row in rows:
            joined = " ".join(row)
            m = re.search(r"Item No\.\s*(\d+)", joined)
            if m and len(row) >= 2:
                cur = {"module": mod, "item": int(m.group(1)), "concept": None,
                       "reference": None, "total_marks": 10, "criteria": []}
                items.append(cur)
                continue
            if cur is None:
                continue
            if row and row[0].startswith("Concept:"):
                cur["concept"] = row[0].split(":", 1)[1].strip()
                continue
            if row and row[0].startswith("Reference:"):
                cur["reference"] = row[0].split(":", 1)[1].strip()
                continue
            # a criterion row: 5 cells, first names the criterion + its marks
            if len(row) == 5 and re.search(r"\(\d+\s*marks?\)", row[0]) and "Criteria" not in row[0]:
                name = re.sub(r"\s*\(\d+\s*marks?\)", "", row[0]).replace("\n", " ").strip()
                marks = int(re.search(r"\((\d+)\s*marks?\)", row[0]).group(1))
                bands = {}
                for col, val in enumerate(row[1:5]):
                    v = val.strip()
                    # "-" marks a band this criterion cannot reach
                    if v and v != "-":
                        bands[str(BAND_MARKS[col])] = v
                cur["criteria"].append({"name": name, "marks": marks, "bands": bands})
    return items

def main():
    files = sorted(glob.glob("Level 1 Module * CRQs Done.docx"),
                   key=lambda p: int(re.search(r"Module (\d+)", p).group(1)))
    items = []
    for f in files:
        items += parse_file(f)
    for it in items:
        it["criteria_sum"] = sum(c["marks"] for c in it["criteria"])
        it["max_achievable"] = sum(max((int(k) for k in c["bands"]), default=0) for c in it["criteria"])
        it["min_achievable"] = sum(min((int(k) for k in c["bands"]), default=0) for c in it["criteria"])
    json.dump(items, open("/tmp/crq/out/rubrics_level1.json", "w"), indent=1, ensure_ascii=False)
    return items

if __name__ == "__main__":
    items = main()
    print("CRQs extracted:", len(items))
    empty = [(i["module"], i["item"], c["name"])
             for i in items for c in i["criteria"] if not c["bands"]]
    print("criteria with NO band text:", len(empty))
    from collections import Counter
    print("bands captured per criterion:",
          dict(Counter(len(c["bands"]) for i in items for c in i["criteria"])))
    print("criteria per CRQ:", dict(Counter(len(i["criteria"]) for i in items)))
    print("\nmark-model check (min..max achievable):",
          dict(Counter(f'{i["min_achievable"]}..{i["max_achievable"]}' for i in items)))
    print("\ndefects:")
    for i in items:
        if i["criteria_sum"] != 10 or i["max_achievable"] != 10:
            print(f'  M{i["module"]} item {i["item"]}: weights sum {i["criteria_sum"]}, '
                  f'max achievable {i["max_achievable"]} — {i["concept"]}')
