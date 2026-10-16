import React, { useState } from 'react';

const CATEGORY_COLORS = {
  overdue: { bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700', icon: '🚨' },
  settlement: { bg: 'bg-orange-50', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700', icon: '⚠️' },
  utilization: { bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700', icon: '📊' },
  rebuild: { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700', icon: '🔨' },
  build: { bg: 'bg-indigo-50', border: 'border-indigo-200', badge: 'bg-indigo-100 text-indigo-700', icon: '🌱' },
  inquiries: { bg: 'bg-purple-50', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700', icon: '🔍' },
  default: { bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700', icon: '💳' },
  dti: { bg: 'bg-teal-50', border: 'border-teal-200', badge: 'bg-teal-100 text-teal-700', icon: '⚖️' },
  habits: { bg: 'bg-green-50', border: 'border-green-200', badge: 'bg-green-100 text-green-700', icon: '✅' },
  monitoring: { bg: 'bg-gray-50', border: 'border-gray-200', badge: 'bg-gray-100 text-gray-700', icon: '👁' },
};

export default function RecoveryPlan({ plan }) {
  const [expandedStep, setExpandedStep] = useState(0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold text-gray-900">Your Recovery Steps</h3>
        <span className="text-xs text-gray-400">{plan.steps.length} steps</span>
      </div>

      {plan.steps.map((step, idx) => {
        const colors = CATEGORY_COLORS[step.category] || CATEGORY_COLORS.habits;
        const isOpen = expandedStep === idx;

        return (
          <div
            key={idx}
            className={`rounded-2xl border-2 overflow-hidden transition-all duration-200 ${
              isOpen ? colors.border : 'border-gray-100'
            }`}
          >
            <button
              onClick={() => setExpandedStep(isOpen ? -1 : idx)}
              className={`w-full px-5 py-4 flex items-center gap-4 text-left transition-colors ${
                isOpen ? colors.bg : 'bg-white hover:bg-gray-50'
              }`}
            >
              <span className="text-xl flex-shrink-0">{colors.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${colors.badge}`}>
                    Step {step.priority}
                  </span>
                  {step.timelineMonths && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                      ~{step.timelineMonths} months
                    </span>
                  )}
                </div>
                <h4 className="font-semibold text-gray-900 mt-1 text-sm leading-snug">{step.title}</h4>
              </div>
              <svg
                className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isOpen && (
              <div className={`px-5 pb-5 ${colors.bg}`}>
                <p className="text-sm text-gray-600 mb-4">{step.description}</p>
                <ul className="space-y-2">
                  {step.actions.map((action, ai) => (
                    <li key={ai} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-1 w-4 h-4 rounded-full bg-white border-2 border-brand-400 flex-shrink-0 flex items-center justify-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-brand-500"></span>
                      </span>
                      <span className="text-gray-700">{action}</span>
                    </li>
                  ))}
                </ul>
                {step.impact && (
                  <div className="mt-4 px-4 py-2.5 bg-white rounded-xl border border-gray-100 flex items-center gap-2">
                    <span className="text-green-500 text-sm font-semibold">Expected Impact:</span>
                    <span className="text-sm text-gray-600">{step.impact}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
