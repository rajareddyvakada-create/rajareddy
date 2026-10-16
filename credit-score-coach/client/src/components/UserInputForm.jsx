import React, { useState } from 'react';
import { DAMAGE_REASONS, getScoreColor, getScoreLabel } from '../utils/scoreHelpers.js';

const INITIAL = {
  current_score: 500,
  damage_reason: 'missed_payments',
  overdue_accounts: 0,
  outstanding_amount: 0,
  monthly_income: 0,
  existing_emi: 0,
  credit_utilization: 0,
  oldest_account_years: 0,
};

export default function UserInputForm({ onSubmit, loading }) {
  const [form, setForm] = useState(INITIAL);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  const scoreColor = getScoreColor(form.current_score);
  const scoreLabel = getScoreLabel(form.current_score);

  return (
    <form onSubmit={handleSubmit} className="card space-y-6">
      {/* Score Slider */}
      <div>
        <label className="label">Current CIBIL Score</label>
        <div className="flex items-center gap-4 mb-2">
          <input
            type="range"
            min={300}
            max={900}
            value={form.current_score}
            onChange={(e) => set('current_score', +e.target.value)}
            className="flex-1 h-2 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #ef4444 0%, #f97316 25%, #eab308 50%, #22c55e 75%, #059669 100%)`,
            }}
          />
          <div
            className="text-2xl font-bold min-w-[72px] text-center rounded-xl px-3 py-1"
            style={{ color: scoreColor, backgroundColor: `${scoreColor}15` }}
          >
            {form.current_score}
          </div>
        </div>
        <p className="text-xs text-gray-400 text-right" style={{ color: scoreColor }}>
          {scoreLabel}
        </p>
      </div>

      {/* Reason */}
      <div>
        <label className="label">Primary Reason for Score Damage</label>
        <select
          value={form.damage_reason}
          onChange={(e) => set('damage_reason', e.target.value)}
          className="input-field"
        >
          {DAMAGE_REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Overdue Accounts</label>
          <input
            type="number"
            min={0}
            max={20}
            value={form.overdue_accounts}
            onChange={(e) => set('overdue_accounts', +e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label className="label">Total Outstanding (INR)</label>
          <input
            type="number"
            min={0}
            step={1000}
            value={form.outstanding_amount}
            onChange={(e) => set('outstanding_amount', +e.target.value)}
            className="input-field"
            placeholder="e.g. 250000"
          />
        </div>
        <div>
          <label className="label">Monthly Income (INR)</label>
          <input
            type="number"
            min={0}
            step={1000}
            value={form.monthly_income}
            onChange={(e) => set('monthly_income', +e.target.value)}
            className="input-field"
            placeholder="e.g. 50000"
          />
        </div>
        <div>
          <label className="label">Existing EMI per Month (INR)</label>
          <input
            type="number"
            min={0}
            step={500}
            value={form.existing_emi}
            onChange={(e) => set('existing_emi', +e.target.value)}
            className="input-field"
            placeholder="e.g. 15000"
          />
        </div>
        <div>
          <label className="label">Credit Utilization (%)</label>
          <div className="relative">
            <input
              type="number"
              min={0}
              max={100}
              value={form.credit_utilization}
              onChange={(e) => set('credit_utilization', +e.target.value)}
              className="input-field pr-10"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
          </div>
        </div>
        <div>
          <label className="label">Age of Oldest Account (Years)</label>
          <input
            type="number"
            min={0}
            max={50}
            step={0.5}
            value={form.oldest_account_years}
            onChange={(e) => set('oldest_account_years', +e.target.value)}
            className="input-field"
            placeholder="e.g. 3"
          />
        </div>
      </div>

      <button type="submit" disabled={loading} className="btn-primary w-full text-center flex items-center justify-center gap-2">
        {loading ? (
          <>
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            Analyzing...
          </>
        ) : (
          'Generate My Recovery Plan'
        )}
      </button>
    </form>
  );
}
