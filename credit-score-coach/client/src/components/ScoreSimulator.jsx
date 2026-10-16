import React, { useState, useEffect } from 'react';
import { simulateAction } from '../services/api.js';
import { getScoreColor } from '../utils/scoreHelpers.js';

const ACTIONS = [
  { id: 'pay_overdue', label: 'Pay Off Overdue Amount', hasAmount: true, unit: 'INR', icon: '💰' },
  { id: 'reduce_utilization', label: 'Reduce Credit Utilization', hasAmount: true, unit: '%', icon: '📉' },
  { id: 'dispute_error', label: 'Successfully Dispute a Report Error', hasAmount: false, icon: '📝' },
  { id: 'secured_card_6mo', label: 'Use Secured Card for 6 Months', hasAmount: false, icon: '💳' },
  { id: 'stop_inquiries_6mo', label: 'Stop New Credit Applications (6 Months)', hasAmount: false, icon: '🛑' },
  { id: 'on_time_payments_6mo', label: 'Perfect On-Time Payments (6 Months)', hasAmount: false, icon: '✅' },
  { id: 'close_settled_to_closed', label: 'Convert "Settled" to "Closed" Status', hasAmount: false, icon: '🔄' },
];

export default function ScoreSimulator({ currentScore }) {
  const [selectedAction, setSelectedAction] = useState('pay_overdue');
  const [amount, setAmount] = useState(100000);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const action = ACTIONS.find((a) => a.id === selectedAction);

  useEffect(() => {
    runSimulation();
  }, [selectedAction, amount, currentScore]);

  async function runSimulation() {
    setLoading(true);
    try {
      const res = await simulateAction(currentScore, selectedAction, amount);
      setResult(res);
    } catch {
      setResult(null);
    }
    setLoading(false);
  }

  return (
    <div className="card">
      <h3 className="text-lg font-bold text-gray-900 mb-1">Score Impact Simulator</h3>
      <p className="text-sm text-gray-400 mb-6">
        See how different actions could affect your credit score
      </p>

      <div className="space-y-4">
        {/* Action selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedAction(a.id)}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left text-sm transition-all ${
                selectedAction === a.id
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-gray-100 bg-white hover:border-gray-200'
              }`}
            >
              <span className="text-lg">{a.icon}</span>
              <span className={selectedAction === a.id ? 'font-semibold text-brand-700' : 'text-gray-700'}>
                {a.label}
              </span>
            </button>
          ))}
        </div>

        {/* Amount slider */}
        {action?.hasAmount && (
          <div className="bg-gray-50 rounded-xl p-4">
            <label className="label">
              {action.unit === 'INR' ? 'Amount' : 'Reduction'}: {' '}
              <strong>
                {action.unit === 'INR'
                  ? `₹${amount.toLocaleString('en-IN')}`
                  : `${amount}%`
                }
              </strong>
            </label>
            <input
              type="range"
              min={action.unit === 'INR' ? 10000 : 5}
              max={action.unit === 'INR' ? 1000000 : 80}
              step={action.unit === 'INR' ? 10000 : 5}
              value={amount}
              onChange={(e) => setAmount(+e.target.value)}
              className="w-full h-2 rounded-full appearance-none cursor-pointer bg-gray-200 accent-brand-600"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>{action.unit === 'INR' ? '₹10K' : '5%'}</span>
              <span>{action.unit === 'INR' ? '₹10L' : '80%'}</span>
            </div>
          </div>
        )}

        {/* Result */}
        {result && !loading && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl p-6 border border-green-100">
            <div className="text-center mb-4">
              <div className="text-sm text-gray-500 mb-1">Estimated Score Impact</div>
              <div className="text-4xl font-bold text-green-600">
                +{result.min} to +{result.max}
              </div>
              <div className="text-sm text-gray-400">points</div>
            </div>
            <div className="flex items-center justify-center gap-8">
              <div className="text-center">
                <div className="text-xs text-gray-400">Conservative</div>
                <div className="text-xl font-bold" style={{ color: getScoreColor(result.newScoreMin) }}>
                  {result.newScoreMin}
                </div>
              </div>
              <div className="text-gray-300">→</div>
              <div className="text-center">
                <div className="text-xs text-gray-400">Optimistic</div>
                <div className="text-xl font-bold" style={{ color: getScoreColor(result.newScoreMax) }}>
                  {result.newScoreMax}
                </div>
              </div>
            </div>

            {/* Visual bar */}
            <div className="mt-4 h-3 bg-gray-200 rounded-full overflow-hidden relative">
              <div
                className="h-full bg-gray-400 rounded-full absolute"
                style={{ width: `${((currentScore - 300) / 600) * 100}%` }}
              />
              <div
                className="h-full bg-green-400 rounded-full absolute opacity-50"
                style={{
                  left: `${((currentScore - 300) / 600) * 100}%`,
                  width: `${((result.max) / 600) * 100}%`,
                }}
              />
              <div
                className="h-full bg-green-500 rounded-full absolute"
                style={{
                  left: `${((currentScore - 300) / 600) * 100}%`,
                  width: `${((result.min) / 600) * 100}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>300</span>
              <span>Current: {currentScore}</span>
              <span>900</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
