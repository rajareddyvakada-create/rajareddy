# Cable TV Box Activation App - Blueprint

## Business: Vaji Communications & Sreedevi Cable Network

---

## Problem Statement
Local cable TV operator manages ~1000 set-top boxes. Every month, he manually
activates each box by entering serial numbers into a slow cable provider web
portal (GTPL/Hathway). This takes hours of repetitive work.

## Solution
A fast web app that:
1. Stores all box serial numbers with customer details (enter once, never again)
2. Activates boxes with one click by automating the provider portal in the background
3. Supports bulk activation for monthly renewals

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  FRONTEND (React)                │
│  ┌───────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ Dashboard │ │ Box Mgmt │ │ Activation     │  │
│  │ - Stats   │ │ - Add    │ │ - Single       │  │
│  │ - History │ │ - Edit   │ │ - Bulk         │  │
│  │ - Alerts  │ │ - Search │ │ - Status Track │  │
│  └───────────┘ └──────────┘ └────────────────┘  │
└──────────────────────┬──────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────┐
│               BACKEND (Node.js/Express)          │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────┐  │
│  │ Auth     │ │ Box CRUD API │ │ Activation  │  │
│  │ (Login)  │ │              │ │ Engine      │  │
│  └──────────┘ └──────────────┘ └──────┬──────┘  │
│                                       │          │
│                              ┌────────▼───────┐  │
│                              │ Provider       │  │
│                              │ Integration    │  │
│                              │ (GTPL/Hathway) │  │
│                              └────────────────┘  │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│              DATABASE (SQLite → PostgreSQL)       │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────┐  │
│  │ Boxes    │ │ Customers│ │ Activation Logs │  │
│  └──────────┘ └──────────┘ └─────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Database Schema

### operators (cable business accounts)
| Column       | Type    | Description                    |
|-------------|---------|--------------------------------|
| id          | INTEGER | Primary key                    |
| name        | TEXT    | "Vaji Communications"          |
| provider    | TEXT    | "GTPL" / "Hathway"            |
| portal_url  | TEXT    | Provider portal login URL      |
| username    | TEXT    | Portal login username          |
| password    | TEXT    | Portal login password (encrypted) |
| created_at  | DATE   |                                |

### customers
| Column       | Type    | Description                    |
|-------------|---------|--------------------------------|
| id          | INTEGER | Primary key                    |
| name        | TEXT    | Customer name                  |
| phone       | TEXT    | Phone number                   |
| address     | TEXT    | Address                        |
| area        | TEXT    | Locality/area for grouping     |
| operator_id | INTEGER | FK → operators                 |
| created_at  | DATE   |                                |

### boxes
| Column        | Type    | Description                   |
|--------------|---------|-------------------------------|
| id           | INTEGER | Primary key                   |
| serial_number| TEXT    | Box serial number (unique)    |
| customer_id  | INTEGER | FK → customers                |
| operator_id  | INTEGER | FK → operators                |
| plan         | TEXT    | Subscription plan             |
| status       | TEXT    | active/inactive/expired       |
| last_activated| DATE  | Last activation date          |
| expiry_date  | DATE   | When current activation expires|
| created_at   | DATE   |                               |

### activation_logs
| Column       | Type    | Description                    |
|-------------|---------|--------------------------------|
| id          | INTEGER | Primary key                    |
| box_id      | INTEGER | FK → boxes                     |
| action      | TEXT    | activate/deactivate/renew      |
| status      | TEXT    | success/failed/pending         |
| error_msg   | TEXT    | If failed, why                 |
| activated_at| DATE   | Timestamp                      |

---

## Pages / Screens

### 1. Login Page
- Simple username/password login
- Only the operator (your friend) logs in

### 2. Dashboard
- Total boxes: 1000
- Active this month: 950
- Pending activation: 50
- Failed activations: 5
- Quick actions: "Activate All Pending", "Add New Box"

### 3. Box Management (Main Page)
- Table with search/filter:
  | Serial No | Customer | Area | Plan | Status | Last Activated | Action |
  |-----------|----------|------|------|--------|----------------|--------|
  | STB00123  | Ramesh   | Nagar| Basic| Active | 2024-01-15     | [Activate] [Edit] |
- Bulk select with checkboxes
- "Activate Selected" button
- Add new box button
- Import from CSV/Excel

### 4. Add/Edit Box
- Form: Serial Number, Customer Name, Phone, Address, Area, Plan
- Save → stored permanently in database

### 5. Activation Page
- Shows activation progress:
  - Box STB00123 → Activating... → ✅ Done
  - Box STB00124 → Activating... → ✅ Done  
  - Box STB00125 → Activating... → ❌ Failed (reason)
- Real-time progress bar for bulk activations

### 6. Operators Page
- Manage operator accounts (Vaji Communications, Sreedevi)
- Store portal credentials securely
- Add/remove operators

### 7. Reports
- Monthly activation report
- Area-wise box count
- Expiry calendar

---

## Provider Integration Strategy

Since activation happens through a slow web portal:

### Phase 1 (MVP - Manual Assist)
- App stores all box data and opens the provider portal with pre-filled data
- Reduces manual data entry but still uses the portal

### Phase 2 (Semi-Automated)
- Use browser automation (Puppeteer/Playwright) to:
  1. Login to GTPL/Hathway portal
  2. Navigate to activation page
  3. Enter box serial number
  4. Click activate
  5. Capture result (success/fail)
  6. Move to next box
- Runs in background, shows progress in the app

### Phase 3 (API Integration)
- If the provider has an API, integrate directly
- Fastest and most reliable approach
- May need provider cooperation

---

## Tech Stack

| Layer      | Technology        | Why                           |
|-----------|-------------------|-------------------------------|
| Frontend  | React + Tailwind  | Fast, modern, responsive      |
| Backend   | Node.js + Express | JavaScript everywhere         |
| Database  | SQLite (start)    | Simple, no server needed      |
| Auth      | JWT tokens        | Stateless, secure             |
| Automation| Puppeteer         | Browser automation for portal |
| Hosting   | Self-hosted / VPS | Data stays private            |

---

## Operators to Set Up First

1. **Vaji Communications** - Provider: TBD (GTPL?)
2. **Sreedevi** - Provider: TBD

(More operators will be added later by the user)

---

## Development Phases

### Phase 1: Core App (Build Now)
- [x] Database setup
- [ ] Box management (add/edit/delete/search)
- [ ] Customer management
- [ ] Operator management
- [ ] Dashboard with stats
- [ ] CSV/Excel import for bulk box entry
- [ ] Login/auth

### Phase 2: Activation Engine
- [ ] Connect to provider portal (need portal details)
- [ ] Single box activation
- [ ] Bulk activation with progress
- [ ] Activation history/logs

### Phase 3: Enhancements
- [ ] Monthly auto-renewal reminders
- [ ] SMS notifications to customers
- [ ] Mobile app (React Native)
- [ ] Area-wise reports

---

## Information Still Needed

- [ ] Which provider portal(s)? GTPL? Hathway? Others?
- [ ] Portal login URL
- [ ] What steps exactly happen on the portal when activating a box?
- [ ] What plan types exist?
- [ ] Does he want to import existing box data from Excel/CSV?
