import React, { useState, useEffect } from 'react';

const ITEMS = [
  { id: 'autopay', text: 'Set up auto-debit for all EMIs and credit cards', type: 'do' },
  { id: 'utilization', text: 'Keep credit utilization below 30% on every card', type: 'do' },
  { id: 'fullpay', text: 'Pay credit card bills in full, not just minimum', type: 'do' },
  { id: 'report', text: 'Check your CIBIL report at least once a year (free)', type: 'do' },
  { id: 'oldcard', text: 'Keep your oldest credit card active — it helps account age', type: 'do' },
  { id: 'mix', text: 'Maintain a healthy mix of credit types (card + loan)', type: 'do' },
  { id: 'dispute', text: 'Dispute any errors on your report immediately', type: 'do' },
  { id: 'emergency', text: 'Build a 3-month emergency fund before taking new credit', type: 'do' },
  { id: 'nodues', text: 'Get "No Dues" certificates after every loan closure', type: 'do' },
  { id: 'noclose', text: "DON'T close old credit card accounts", type: 'dont' },
  { id: 'nomulti', text: "DON'T apply for multiple loans/cards within 6 months", type: 'dont' },
  { id: 'nominpay', text: "DON'T pay only the minimum due month after month", type: 'dont' },
  { id: 'nosettle', text: "DON'T settle a loan for less — it marks 'Settled' on report", type: 'dont' },
  { id: 'noguarantor', text: "DON'T be a loan guarantor unless you can afford the full EMI", type: 'dont' },
  { id: 'nomax', text: "DON'T max out any single credit card", type: 'dont' },
  { id: 'noignore', text: "DON'T ignore collection calls — negotiate instead", type: 'dont' },
  { id: 'noloan4loan', text: "DON'T take a new loan to pay off an old loan", type: 'dont' },
];

function loadChecked() {
  try {
    return JSON.parse(localStorage.getItem('csc_checklist') || '{}');
  } catch {
    return {};
  }
}

export default function DosAndDonts() {
  const [checked, setChecked] = useState(loadChecked);

  useEffect(() => {
    try {
      localStorage.setItem('csc_checklist', JSON.stringify(checked));
    } catch {}
  }, [checked]);

  function toggle(id) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const dos = ITEMS.filter((i) => i.type === 'do');
  const donts = ITEMS.filter((i) => i.type === 'dont');
  const totalChecked = Object.values(checked).filter(Boolean).length;
  const progress = Math.round((totalChecked / ITEMS.length) * 100);

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold text-gray-900">Your Checklist Progress</h3>
          <span className="text-sm font-semibold text-brand-600">{totalChecked}/{ITEMS.length}</span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-2">
          {progress === 100
            ? "You've committed to all the right habits!"
            : `${progress}% complete — keep checking off items as you implement them`}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* DOs */}
        <div className="card border-2 border-green-100">
          <h4 className="font-bold text-green-700 mb-4 flex items-center gap-2">
            <span className="w-7 h-7 bg-green-100 rounded-lg flex items-center justify-center text-sm">✓</span>
            Things to DO
          </h4>
          <ul className="space-y-2">
            {dos.map((item) => (
              <li key={item.id}>
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={!!checked[item.id]}
                    onChange={() => toggle(item.id)}
                    className="mt-1 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                  />
                  <span className={`text-sm transition-all ${
                    checked[item.id]
                      ? 'line-through text-gray-400'
                      : 'text-gray-700 group-hover:text-gray-900'
                  }`}>
                    {item.text}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        {/* DON'Ts */}
        <div className="card border-2 border-red-100">
          <h4 className="font-bold text-red-700 mb-4 flex items-center gap-2">
            <span className="w-7 h-7 bg-red-100 rounded-lg flex items-center justify-center text-sm">✗</span>
            Things to AVOID
          </h4>
          <ul className="space-y-2">
            {donts.map((item) => (
              <li key={item.id}>
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={!!checked[item.id]}
                    onChange={() => toggle(item.id)}
                    className="mt-1 w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 cursor-pointer"
                  />
                  <span className={`text-sm transition-all ${
                    checked[item.id]
                      ? 'line-through text-gray-400'
                      : 'text-gray-700 group-hover:text-gray-900'
                  }`}>
                    {item.text}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
