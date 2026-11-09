"""
First-time setup. Finds the MT5 terminal, asks for the account details, and writes ../.env.

Nothing typed here leaves the PC: it goes straight into the .env file next to this project.
Run it on its own with:  python setup.py
"""

from __future__ import annotations

import getpass
import os
import pathlib
import re
import secrets
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"


def find_terminals() -> list[pathlib.Path]:
    """Look for terminal64.exe where MT5 installers normally put it."""
    roots = [
        os.environ.get("ProgramFiles", r"C:\Program Files"),
        os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        os.path.expandvars(r"%APPDATA%\MetaQuotes\Terminal"),
    ]
    hits: list[pathlib.Path] = []
    for root in roots:
        base = pathlib.Path(root) if root else None
        if not base or not base.is_dir():
            continue
        try:
            for folder in base.iterdir():
                exe = folder / "terminal64.exe"
                if folder.is_dir() and exe.is_file() and exe not in hits:
                    hits.append(exe)
        except OSError:
            continue
    # XM first: that is almost always the one wanted here
    hits.sort(key=lambda p: (0 if "xm" in str(p).lower() else 1, str(p).lower()))
    return hits


def ask(prompt: str, default: str = "") -> str:
    shown = f"{prompt} [{default}]: " if default else f"{prompt}: "
    answer = input(shown).strip()
    return answer or default


def choose_terminal() -> str:
    """The path is optional: with none, MT5 connects to whichever terminal is already running."""
    found = find_terminals()
    if found:
        print("\nMT5 terminals found on this PC:")
        for i, exe in enumerate(found, 1):
            print(f"  {i}. {exe}")
        print(f"  {len(found) + 1}. Type a different path")
        print(f"  {len(found) + 2}. Use whichever terminal is already running")
        while True:
            pick = ask("Which one is your XM terminal", "1")
            if pick.isdigit() and 1 <= int(pick) <= len(found):
                return str(found[int(pick) - 1])
            if pick.isdigit() and int(pick) == len(found) + 1:
                break
            if pick.isdigit() and int(pick) == len(found) + 2:
                return ""
            print("  Enter one of the numbers above.")
    else:
        print("\nNo MT5 terminal found in the usual places.")
    print("  Right-click your MT5 shortcut -> Properties -> copy what is in 'Target'")
    print("  (without any quotes), for example C:\\Program Files\\XM Global MT5\\terminal64.exe")
    print("  Or just press Enter to use the terminal that is already open.")
    misses = 0
    while True:
        path = ask("Full path to terminal64.exe (Enter to skip)").strip('"')
        if not path:
            print("  Skipping: the bridge will attach to the running terminal.")
            return ""
        if pathlib.Path(path).is_file():
            return path
        misses += 1
        print("  That file does not exist on this PC.")
        if misses >= 2:
            print("  Press Enter on the next prompt to skip it and use the running terminal.")


def main() -> int:
    print("=" * 62)
    print(" XM bridge setup")
    print("=" * 62)
    print("\nYour password is typed here and saved only in the .env file on this")
    print("PC. It is not sent anywhere.\n")

    if ENV.exists():
        print(f"{ENV} already exists.")
        if ask("Replace it? (y/n)", "n").lower() not in ("y", "yes"):
            print("Keeping the existing file. Nothing changed.")
            return 0
        print()

    path = choose_terminal()

    print("\nOpen MT5 and read these from it:")
    print("  Account number - at the top of the Navigator panel")
    print("  Server         - File -> Login to Trade Account, or the bottom-right status bar")
    print()

    while True:
        login = ask("MT5 account number").replace(" ", "")
        if login.isdigit():
            break
        print("  That should be digits only, for example 70154922.")

    while True:
        password = getpass.getpass("MT5 password (not shown as you type): ")
        if password:
            break
        print("  The password cannot be empty.")

    while True:
        server = ask("MT5 server, exactly as MT5 shows it")
        if server:
            break
        print("  The server name cannot be empty, for example XMGlobal-Demo.")

    max_lot = ask("Biggest lot the app may ever send (safety cap)", "0.10")
    if not re.fullmatch(r"\d+(\.\d+)?", max_lot) or float(max_lot) <= 0:
        max_lot = "0.10"

    api_key = secrets.token_urlsafe(32)

    path_line = f"MT5_PATH={path}\n" if path else "# MT5_PATH left blank: attaches to the running terminal\nMT5_PATH=\n"
    ENV.write_text(
        "# Written by setup.py. Keep this file private: it holds your trading password.\n"
        + path_line +
        f"MT5_LOGIN={login}\n"
        f"MT5_PASSWORD={password}\n"
        f"MT5_SERVER={server}\n"
        f"API_KEY={api_key}\n"
        "\n"
        "MAGIC=770077\n"
        "DEVIATION=20\n"
        f"MAX_LOT={max_lot}\n"
        "TICK_INTERVAL=0.2\n"
        "PORT=8000\n",
        encoding="utf-8",
    )

    print("\n" + "=" * 62)
    print(f" Saved to {ENV}")
    print("=" * 62)
    print("\nThe web page will ask for this key once on each device:\n")
    print(f"    {api_key}\n")
    print("It is also in the .env file if you need it again.")
    print("\nNext: close this window and double-click start.bat.")
    print("Make sure MT5 is running with Algo Trading switched on (green).\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nCancelled. Nothing was written.")
        sys.exit(1)
