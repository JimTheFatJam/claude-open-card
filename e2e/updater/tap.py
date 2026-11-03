"""Finds a node in a `uiautomator dump` by its text (regex) and prints the centre "x y"."""
import re
import sys
import xml.etree.ElementTree as ET

data = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
data = data[data.find("<?xml"):data.rfind(">") + 1]
pattern = re.compile(sys.argv[2], re.I)
root = ET.fromstring(data)
for node in root.iter("node"):
    if pattern.fullmatch((node.get("text") or "").strip()) and node.get("enabled") == "true":
        x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds")))
        print((x1 + x2) // 2, (y1 + y2) // 2)
        sys.exit(0)
sys.exit(1)
