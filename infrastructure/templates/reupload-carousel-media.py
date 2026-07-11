#!/usr/bin/env python3
"""
Re-upload the 4 feature-menu carousel videos to the NIETE WABA and resubmit
feature_menu_carousel_v3.

Reason we need this: video/image `header_handle` values are WABA-scoped. The
harvested JSON references PK-WABA handles that mean nothing to NIETE's WABA,
so Meta rejects the submission with error_subcode 2388215.

Flow:
  1. For each video: POST /{APP_ID}/uploads?file_length&file_type -> session id
  2. POST /{session_id} with binary body + file_offset:0 header -> {"h": "<handle>"}
  3. Rewrite the template JSON's 4 header_handle arrays with the new handles
  4. POST /{WABA_ID}/message_templates with the new JSON
"""
import json, os, subprocess, sys, urllib.request, urllib.error

APP_ID = "2052724122329740"
WABA_ID = "1551576156552661"
TOKEN = open("/tmp/waba-token.txt").read().strip()
API = "https://graph.facebook.com/v20.0"

REPO = "/Users/mashhoodr/dev/rumi/Rumi 10 April 2026"
VIDEO_ROOT = f"{REPO}/06_Logs & Misc/Reports/Production/Onboarding Flow 18 Dec 2025/Feature_Videos"

# Card order from create-menu-carousel-v3.js: lesson_plan, video_generation, coaching, reading
CARDS = [
    ("lesson_plan",      f"{VIDEO_ROOT}/01_Lesson_Plan_Feature/v6/lesson_plan_feature_v6_2.5x.mp4"),
    ("video_generation", f"{VIDEO_ROOT}/04_Video_Generation_Feature/v1/output/video_generation_feature.mp4"),
    ("coaching",         f"{VIDEO_ROOT}/02_Coaching_Feature/v3/coaching_feature_video.mp4"),
    ("reading",          f"{VIDEO_ROOT}/03_Reading_Feature/v1/videos/reading_feature_video_2.5x.mp4"),
]

def start_upload_session(size, ftype="video/mp4"):
    url = f"{API}/{APP_ID}/uploads?file_length={size}&file_type={ftype}&access_token={TOKEN}"
    r = subprocess.run(["curl", "-sS", "-X", "POST", url], capture_output=True, text=True)
    resp = json.loads(r.stdout)
    if "id" not in resp:
        raise RuntimeError(f"session create failed: {r.stdout}")
    return resp["id"]

def upload_bytes(session_id, path):
    url = f"https://graph.facebook.com/v20.0/{session_id}"
    r = subprocess.run(
        ["curl", "-sS", "-X", "POST", url,
         "-H", f"Authorization: OAuth {TOKEN}",
         "-H", "file_offset: 0",
         "--data-binary", f"@{path}"],
        capture_output=True, text=True,
    )
    resp = json.loads(r.stdout)
    if "h" not in resp:
        raise RuntimeError(f"upload failed for {path}: {r.stdout}")
    return resp["h"]

def upload_card(name, path):
    size = os.path.getsize(path)
    print(f"  {name}: {size:,} bytes ({size/1024/1024:.1f} MB) — {os.path.basename(path)}")
    sid = start_upload_session(size)
    print(f"    session={sid[:40]}...")
    handle = upload_bytes(sid, path)
    print(f"    handle={handle[:60]}...")
    return handle

# 1. Upload all 4 videos
print("=== Uploading 4 carousel videos to NIETE WABA ===")
handles = {}
for name, path in CARDS:
    handles[name] = upload_card(name, path)

print("\n=== Rewriting feature_menu_carousel_v3.json with new handles ===")
tpl_path = f"{REPO}/NIETE-Rumi/infrastructure/templates/feature_menu_carousel_v3.json"
tpl = json.load(open(tpl_path))

card_idx_to_key = ["lesson_plan", "video_generation", "coaching", "reading"]
for c in tpl["components"]:
    if c.get("type") == "CAROUSEL":
        for i, card in enumerate(c["cards"]):
            for comp in card["components"]:
                if comp.get("type") == "HEADER" and comp.get("format") == "VIDEO":
                    old = comp["example"]["header_handle"][0][:60] + "..."
                    new_handle = handles[card_idx_to_key[i]]
                    comp["example"]["header_handle"] = [new_handle]
                    print(f"  card{i} ({card_idx_to_key[i]}): {old} -> {new_handle[:60]}...")

# Save the rewritten JSON for audit
new_tpl_path = "/tmp/feature_menu_carousel_v3_niete.json"
open(new_tpl_path, "w").write(json.dumps(tpl, indent=2))
print(f"\nRewritten template saved to {new_tpl_path}")

# 2. Submit to NIETE WABA
print("\n=== Submitting to NIETE WABA ===")
submit_body = json.dumps(tpl)
r = subprocess.run(
    ["curl", "-sS", "-X", "POST", f"{API}/{WABA_ID}/message_templates",
     "-H", f"Authorization: Bearer {TOKEN}",
     "-H", "Content-Type: application/json",
     "-d", submit_body],
    capture_output=True, text=True,
)
resp = json.loads(r.stdout)
if "id" in resp:
    print(f"  ✅ SUCCESS  id={resp['id']}  status={resp.get('status')}")
    print(f"  Poll: curl '{API}/{resp['id']}?access_token=$TOKEN' after ~1-24h")
else:
    print(f"  ❌ FAILED")
    print(f"     {json.dumps(resp, indent=2)[:2000]}")
    sys.exit(1)
