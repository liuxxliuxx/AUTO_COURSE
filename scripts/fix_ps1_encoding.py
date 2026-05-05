"""
Fix PowerShell script encoding: convert .ps1 file to UTF-8 with BOM.

PowerShell 5.x requires BOM (Byte Order Mark) at the start of UTF-8 .ps1 files
to correctly interpret non-ASCII characters. Without BOM, Chinese text becomes garbled.

Usage:
    python scripts/fix_ps1_encoding.py scripts/build_win.ps1
"""

import sys


def add_bom(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    with open(filepath, "w", encoding="utf-8-sig") as f:
        f.write(content)

    print(f"OK: {filepath} -> UTF-8 with BOM")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/fix_ps1_encoding.py <path/to/script.ps1>")
        sys.exit(1)
    add_bom(sys.argv[1])
