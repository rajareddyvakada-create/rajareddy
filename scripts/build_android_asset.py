#!/usr/bin/env python3
"""Build the Android app's index.html from cot-sentiment-widget.html.

The widget file is a page fragment (the artifact host adds the document shell).
The app needs a real document: a doctype for standards mode, and a marker so the
page knows it runs inside the app.
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "cot-sentiment-widget.html"
DEST = ROOT / "cot-widget-android/app/src/main/assets/index.html"


def main():
    body = SRC.read_text()
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text('<!doctype html>\n<html lang="en" data-app="android">\n' + body + "</html>\n")
    print(f"wrote {DEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
