const Database = require('better-sqlite3');
const path = require('path');

let db;

function getDb() {
  if (!db) {
    db = new Database(path.join(__dirname, '../data/coach.db'));
    db.pragma('journal_mode = WAL');
  }
  return db;
}

function initDb() {
  const conn = getDb();

  conn.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      current_score INTEGER NOT NULL,
      damage_reason TEXT NOT NULL,
      overdue_accounts INTEGER DEFAULT 0,
      outstanding_amount REAL DEFAULT 0,
      monthly_income REAL DEFAULT 0,
      existing_emi REAL DEFAULT 0,
      credit_utilization REAL DEFAULT 0,
      oldest_account_years REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recovery_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      plan_json TEXT NOT NULL,
      target_score INTEGER DEFAULT 750,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (profile_id) REFERENCES user_profiles(id)
    );

    CREATE TABLE IF NOT EXISTS dispute_letters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER,
      error_type TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const count = conn.prepare('SELECT COUNT(*) as c FROM user_profiles').get();
  if (count.c === 0) seedData(conn);
}

function seedData(conn) {
  const insert = conn.prepare(`
    INSERT INTO user_profiles (current_score, damage_reason, overdue_accounts, outstanding_amount, monthly_income, existing_emi, credit_utilization, oldest_account_years)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const samples = [
    [480, 'missed_payments', 3, 250000, 45000, 12000, 78, 2],
    [520, 'loan_settlement', 1, 180000, 60000, 15000, 55, 4],
    [610, 'high_utilization', 0, 50000, 75000, 20000, 82, 6],
    [350, 'credit_card_default', 4, 500000, 35000, 8000, 95, 1],
    [550, 'too_many_inquiries', 0, 30000, 50000, 10000, 45, 3],
    [300, 'no_credit_history', 0, 0, 30000, 0, 0, 0],
  ];

  const insertMany = conn.transaction((rows) => {
    for (const row of rows) insert.run(...row);
  });
  insertMany(samples);
}

module.exports = { getDb, initDb };
