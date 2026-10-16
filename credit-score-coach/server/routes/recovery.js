const express = require('express');
const router = express.Router();
const { getDb } = require('../services/database');
const { generateRecoveryPlan, simulateAction } = require('../services/rulesEngine');

router.post('/plan', (req, res) => {
  try {
    const {
      current_score,
      damage_reason,
      overdue_accounts,
      outstanding_amount,
      monthly_income,
      existing_emi,
      credit_utilization,
      oldest_account_years,
    } = req.body;

    if (!current_score || current_score < 300 || current_score > 900) {
      return res.status(400).json({ error: 'Score must be between 300 and 900' });
    }

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO user_profiles (current_score, damage_reason, overdue_accounts, outstanding_amount, monthly_income, existing_emi, credit_utilization, oldest_account_years)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      current_score,
      damage_reason || 'missed_payments',
      overdue_accounts || 0,
      outstanding_amount || 0,
      monthly_income || 0,
      existing_emi || 0,
      credit_utilization || 0,
      oldest_account_years || 0,
    );

    const profile = {
      current_score,
      damage_reason: damage_reason || 'missed_payments',
      overdue_accounts: overdue_accounts || 0,
      outstanding_amount: outstanding_amount || 0,
      monthly_income: monthly_income || 0,
      existing_emi: existing_emi || 0,
      credit_utilization: credit_utilization || 0,
      oldest_account_years: oldest_account_years || 0,
    };

    const plan = generateRecoveryPlan(profile);

    db.prepare(`
      INSERT INTO recovery_plans (profile_id, plan_json, target_score)
      VALUES (?, ?, ?)
    `).run(result.lastInsertRowid, JSON.stringify(plan), 750);

    res.json({ profileId: result.lastInsertRowid, plan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate plan' });
  }
});

router.post('/simulate', (req, res) => {
  try {
    const { current_score, action, amount } = req.body;
    const result = simulateAction(current_score || 500, action, amount || 0);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Simulation failed' });
  }
});

router.get('/samples', (req, res) => {
  try {
    const db = getDb();
    const profiles = db.prepare('SELECT * FROM user_profiles ORDER BY created_at DESC LIMIT 10').all();
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch samples' });
  }
});

module.exports = router;
