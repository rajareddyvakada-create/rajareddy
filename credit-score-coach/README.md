# CreditScore Recovery Coach

A full-stack web application that helps users rebuild a damaged CIBIL/credit score with personalized recovery plans, score projections, and dispute letter generation.

## Features

- **Personalized Recovery Plan** — Rules engine analyzes your inputs and generates priority-ordered steps
- **Score Projection Chart** — Interactive 24-month projection with optimistic/pessimistic bounds (Recharts)
- **Score Simulator** — Slider-based tool showing estimated impact of specific actions
- **Dos & Don'ts Checklist** — Interactive checklist persisted in localStorage
- **Dispute Letter Generator** — Auto-generates ready-to-send CIBIL dispute letters as downloadable PDFs
- **Motivational Progress Tracker** — Visual ring + stats showing your recovery progress

## Tech Stack

- **Frontend:** React 18, Tailwind CSS, Recharts, Vite
- **Backend:** Node.js, Express, better-sqlite3, PDFKit
- **Database:** SQLite (auto-created with seed data)

## Quick Start

```bash
# Install all dependencies
npm install
cd client && npm install && cd ..

# Run both server and client (development)
npm run dev

# Server runs on http://localhost:3001
# Client runs on http://localhost:5173
```

## Production Build

```bash
cd client && npm run build && cd ..
npm start
# Serves everything on http://localhost:3001
```

## Project Structure

```
credit-score-coach/
├── server/
│   ├── index.js              # Express server entry
│   ├── routes/
│   │   ├── recovery.js       # Recovery plan + simulation endpoints
│   │   └── dispute.js        # Dispute letter PDF generation
│   ├── services/
│   │   ├── database.js       # SQLite setup + seed data
│   │   └── rulesEngine.js    # Core rules engine + score simulator
│   └── data/                 # SQLite DB (auto-created)
├── client/
│   ├── src/
│   │   ├── App.jsx           # Main app with tab navigation
│   │   ├── components/
│   │   │   ├── Header.jsx
│   │   │   ├── UserInputForm.jsx
│   │   │   ├── ProgressTracker.jsx
│   │   │   ├── RecoveryPlan.jsx
│   │   │   ├── ScoreProjectionChart.jsx
│   │   │   ├── ScoreSimulator.jsx
│   │   │   ├── DosAndDonts.jsx
│   │   │   ├── DisputeHelper.jsx
│   │   │   └── Disclaimer.jsx
│   │   ├── services/api.js
│   │   └── utils/scoreHelpers.js
│   └── ...config files
└── package.json
```

## Rules Engine Logic

The rules engine in `server/services/rulesEngine.js` applies these rules:

| Condition | Action |
|-----------|--------|
| Overdue accounts > 0 | Immediate payoff plan with monthly allocation |
| Settlement history | "Paid in full" negotiation tips |
| Utilization > 30% | Specific reduction strategy |
| Score < 550 | Secured credit card recommendation |
| No credit history | Credit-builder product recommendations |
| Too many inquiries | 6-month moratorium plan |
| DTI > 50% | Debt reduction strategy |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/recovery/plan` | Generate recovery plan |
| POST | `/api/recovery/simulate` | Simulate score impact |
| GET | `/api/recovery/samples` | Get sample profiles |
| GET | `/api/dispute/error-types` | List dispute error types |
| POST | `/api/dispute/generate-letter` | Generate dispute PDF |

## Disclaimer

This is an educational tool. Score estimates are approximations and not guaranteed.
