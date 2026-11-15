#!/usr/bin/env python3
"""Trims the recorded demo: tighter narration, and every silent stretch sped up.

Usage: trim.py <work-dir containing timeline.txt, script.srt, script.md> <out-dir>

Each narration line keeps the moment it starts (so it still sits over the action it describes), but its text is
replaced by a shorter one. While a line is spoken the picture plays at normal speed; every stretch between lines
(page loads, waiting for a model, idle holds) is shortened. Writes timeline-trimmed.txt, script-trimmed.md and
script-trimmed.srt; then run the encoder on the timeline.
"""
import re, sys, os

WORK, OUT = sys.argv[1], sys.argv[2]
WPS, PAD, BREATH = 2.3, 0.4, 0.3  # words per second, as in scenes.mjs; breath after a line

# New text for each original line, in order (21 lines). Same moments, fewer words.
# The texts the VIDEO is timed with. Do not edit: changing them re-times (and so changes) the video.
TIMING = [
    "AI answers use water, and nobody can see how much. Dropwise sits in front of the Bifrost gateway, estimates the water per request, and cuts the waste.",
    "Apps just point at Dropwise instead of Bifrost.",
    "I'll send real requests through the gateway.",
    "An easy prompt asked of Opus is routed to the small Haiku model.",
    "Asked again, it comes from cache: no model call, no new water.",
    "A time-sensitive question skips the cache on purpose.",
    "A hard prompt stays on Opus.",
    "Every request gets a receipt: measured tokens, estimated water.",
    "It names the exact registry version behind each factor, so every number traces to a source.",
    "Overview: measured numbers are labelled measured. Water is always an estimated range.",
    "Teams get daily water budgets, with an alert at eighty percent. The limit is soft.",
    "Same two hundred requests: about twenty-two percent fewer model calls, twenty-four percent fewer tokens.",
    "The answers are replayed recordings, so cost is a what-if, and the page says so.",
    "The classifier is plain rules, no model call. A hard prompt like this stays on the large model.",
    "A request can be deferred. I'll send one with a six hour deadline.",
    "This hour is already the quietest, so it runs now and says why. At a busier hour it would wait.",
    "The profile is illustrative, and the water estimate doesn't change with the hour, so we claim no saving.",
    "The claim checker splits a claim and checks each part against the registry. This is a saved example.",
    "Every factor has a source, a date and a signed version.",
    "Tavily finds newer sources, Haiku reads the figure, and code checks the quote before flagging an old figure stale. A person accepts changes.",
    "Dropwise: measured where it can be, estimated where it must be, and honest about which is which. Open source. Thank you.",
]

# What the voice-over says. Edit freely: the video does not change. Each line must fit before the next one starts.
SCRIPT = [
    "AI answers use water, and nobody can see how much. Dropwise sits in front of the Bifrost AI gateway, and uses Tavily search to keep each water figure sourced.",
    "Bifrost carries each request to the model; Tavily finds the evidence.",
    "Real requests: Dropwise, then Bifrost, then Claude.",
    "An easy prompt asked of Opus goes to Haiku, and Bifrost forwards it.",
    "Asked again, it comes from cache: no call to Bifrost at all.",
    "A time-sensitive question skips the cache on purpose.",
    "A hard prompt stays on Opus, through Bifrost.",
    "Every request gets a receipt: measured tokens, estimated water.",
    "Each receipt cites registry versions; the water factors were found with Tavily, so numbers trace to sources.",
    "Measured numbers are labelled measured. Water is always an estimated range, from Tavily-found factors.",
    "Budgets are per team key, including Bifrost virtual keys. Alert at eighty percent; the limit is soft.",
    "Same two hundred requests, Bifrost alone versus Dropwise: about twenty-two percent fewer calls, twenty-four percent fewer tokens.",
    "The answers are replayed recordings, so cost is a what-if, and the page says so.",
    "The classifier is plain rules: no model call, no Tavily search. A hard prompt like this stays on the large model.",
    "A request can be deferred. I'll send one with a six hour deadline.",
    "This hour is already the quietest, so it runs now through the same Bifrost path, and says why.",
    "The profile is illustrative, and the water estimate doesn't change with the hour, so we claim no saving.",
    "Claim checker: each part is checked against the registry. This saved example uses the registry only; a Tavily key adds live sources.",
    "Each factor has a source and a date. Tavily found two of the eight.",
    "Tavily finds newer sources, Haiku reads the figure through Bifrost, and code flags the old one stale. This replays a captured Tavily result; a person accepts changes.",
    "Dropwise: Bifrost carries the requests, Tavily keeps the numbers sourced, and all is labelled measured or estimated. Open source. Thank you.",
]

def srt_secs(s):
    h, m, rest = s.split(":"); sec, ms = rest.split(",")
    return int(h) * 3600 + int(m) * 60 + int(sec) + int(ms) / 1000

def sec(s):
    m, x = s.split(":"); return int(m) * 60 + float(x)

starts = []
for block in open(os.path.join(WORK, "script.srt")).read().strip().split("\n\n"):
    lines = block.split("\n")
    starts.append(srt_secs(lines[1].split(" --> ")[0]))
assert len(starts) == len(TIMING) == len(SCRIPT), (len(starts), len(TIMING), len(SCRIPT))

scenes = []
for row in open(os.path.join(WORK, "script.md")):
    m = re.match(r"\| \*\*(\d+:\d+\.\d)\*\* \| \*\*(.*)\*\* \|", row)
    if m: scenes.append((sec(m[1]), m[2]))

frames = []
for row in open(os.path.join(WORK, "timeline.txt")):
    if "\t" in row:
        t, f = row.rstrip("\n").split("\t", 1); frames.append((float(t), f))
total = frames[-1][0]

dur = [len(t.split()) / WPS + PAD for t in TIMING]          # what the video is timed with
sdur = [len(t.split()) / WPS + PAD for t in SCRIPT]         # what the voice-over takes to say

def gap_len(g):
    """How long a silent stretch of g seconds lasts after trimming."""
    return g if g <= 0.8 else max(0.8, min(g, 0.2 * g + 0.4))

# Breakpoints: (original time, trimmed time). While a line is spoken the picture plays at normal speed; a line longer
# than the footage before the next line slows that footage down a little (never more than 1.5x slower) instead.
bp = [(0.0, 0.0)]
new_t = 0.0
if starts[0] > 0:
    new_t += min(gap_len(starts[0]), 0.3); bp.append((starts[0], new_t))
stretched = []
for i, a in enumerate(starts):
    nxt = starts[i + 1] if i + 1 < len(starts) else total
    span = nxt - a
    need = dur[i] + BREATH
    if need >= span:
        if need / span > 1.5: raise SystemExit(f"line {i} needs {need:.1f}s but its footage is only {span:.1f}s; shorten it")
        if need > span + 0.01: stretched.append((i, round(need / span, 2)))
        new_t += need; bp.append((nxt, new_t))
    else:
        new_t += need; bp.append((a + need, new_t))
        new_t += gap_len(nxt - (a + need)) if i + 1 < len(starts) else min(gap_len(nxt - (a + need)), 0.4)
        bp.append((nxt, new_t))
if stretched: print("slowed footage:", stretched)

def remap(t):
    for (a0, n0), (a1, n1) in zip(bp, bp[1:]):
        if a0 <= t <= a1:
            return n0 if a1 == a0 else n0 + (t - a0) * (n1 - n0) / (a1 - a0)
    return bp[-1][1]

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "timeline-trimmed.txt"), "w") as f:
    for t, file in frames:
        f.write(f"{remap(t):.3f}\t{file}\n")

hhmm = lambda s: f"{int(s // 60)}:{s % 60:04.1f}"
def srt_t(s):
    ms = round(s * 1000)
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"

md = f"# Dropwise demo (trimmed): voice-over script with timings\n\nThe silent video runs **{hhmm(new_t)}**. Read each line at its time, at about 2.3 words a second: the line ends before the next begins. Scene times are exact; line times are targets.\n\n| Time | Scene | You say |\n|---|---|---|\n"
srt = ""
scene_iter = list(scenes)
ln = 0
events = [(remap(t), 0, ("scene", name)) for t, name in scenes] + [(remap(s), 1, ("line", i)) for i, s in enumerate(starts)]
for t, _, (kind, v) in sorted(events, key=lambda e: (e[0], e[1])):
    if kind == "scene":
        md += f"| **{hhmm(t)}** | **{v}** | |\n"
    else:
        md += f"| {hhmm(t)} to {hhmm(t + sdur[v])} | | {SCRIPT[v]} |\n"
        srt += f"{v + 1}\n{srt_t(t)} --> {srt_t(t + sdur[v])}\n{SCRIPT[v]}\n\n"
open(os.path.join(OUT, "script-trimmed.md"), "w").write(md)
open(os.path.join(OUT, "script-trimmed.srt"), "w").write(srt)
print(f"original {hhmm(total)} -> trimmed {hhmm(new_t)}; frames {len(frames)}")
# Does each spoken line end before the next begins?
new_starts = [remap(a) for a in starts]
bad = 0
for i, t in enumerate(new_starts):
    nxt = new_starts[i + 1] if i + 1 < len(new_starts) else new_t
    room = nxt - t - 0.15
    flag = "" if sdur[i] <= room else f"  <-- too long by {sdur[i] - room:.1f}s"
    if flag: bad += 1
    print(f"line {i:2}: needs {sdur[i]:5.1f}s, room {room:5.1f}s{flag}")
print("all lines fit" if not bad else f"{bad} line(s) too long")
