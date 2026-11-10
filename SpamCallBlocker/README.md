# Spam Call Blocker - Native Android App

Automatically blocks spam calls from **telecom marketers**, **credit card/loan agents**, and **real estate brokers** on any Android phone.

## How It Works

The app uses Android's **CallScreeningService** (API 24+) to intercept incoming calls *before they ring* and silently reject known spam numbers. It runs in the background — no manual action needed.

### Blocking Engine

1. **Whitelist check** — saved contacts and whitelisted numbers always ring through
2. **Direct number match** — checks against a database of 20+ known Indian spam callers
3. **Prefix pattern match** — blocks all `140xxxx` (telemarketing) and `1800xxxx` (toll-free spam) prefixes
4. **Category-based rules** — toggle blocking per category (telecom, credit card, real estate)
5. **International number filter** — auto-rejects unknown international numbers (common scam vector)
6. **Whitelist-only mode** — nuclear option: only contacts get through

### Pre-loaded Spam Database

| Category | Examples |
|----------|----------|
| **Telecom** | Jio Fiber promos, Airtel DTH upsell, Vi postpaid, ACT Fibernet, Tata Play |
| **Credit Card / Loans** | HDFC cards, ICICI personal loans, Axis Bank, Bajaj Finserv EMI, Kotak Insurance, SBI Card |
| **Real Estate** | Godrej Properties, Prestige Group, property dealers, DLF investment scams, NoBroker marketing |

## Build & Install

### Prerequisites
- Android Studio Arctic Fox or newer
- JDK 17
- Android SDK 34

### Steps

```bash
# Clone the repo
cd SpamCallBlocker

# Build debug APK
./gradlew assembleDebug

# Install on connected device
adb install app/build/outputs/apk/debug/app-debug.apk
```

Or open the `SpamCallBlocker` folder in Android Studio and click Run.

### After Install

1. **Grant permissions** when prompted (Phone, Call Log, Contacts)
2. **Set as default call screening app** — the app will prompt you automatically
3. That's it — spam calls are now blocked silently

## Project Structure

```
SpamCallBlocker/
├── app/src/main/java/com/spamblocker/app/
│   ├── service/
│   │   └── SpamCallScreeningService.kt   # Core: intercepts calls before ringing
│   ├── receiver/
│   │   ├── IncomingCallReceiver.kt       # Fallback for older Android
│   │   └── BootReceiver.kt              # Ensures blocking survives reboot
│   ├── data/
│   │   └── SpamDatabase.kt              # SQLite DB with blocklist + call log
│   ├── util/
│   │   └── CallBlockHelper.kt           # Blocking logic + notification system
│   ├── ui/
│   │   └── MainActivity.kt              # Dashboard, blocklist, log, settings
│   └── SpamBlockerApp.kt
├── app/src/main/res/
│   ├── layout/                           # UI layouts
│   ├── drawable/                         # Icons, shapes
│   └── values/                           # Colors, themes, strings
└── app/src/main/AndroidManifest.xml      # Permissions + service declarations
```

## Permissions

| Permission | Why |
|-----------|-----|
| `READ_PHONE_STATE` | Detect incoming calls |
| `READ_CALL_LOG` | Show call history |
| `ANSWER_PHONE_CALLS` | End/reject spam calls (API 28+) |
| `READ_CONTACTS` | Allow saved contacts through |
| `RECEIVE_BOOT_COMPLETED` | Restart blocking after reboot |
| `POST_NOTIFICATIONS` | Show "blocked" notification |
