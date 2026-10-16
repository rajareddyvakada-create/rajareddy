import React from 'react';

export default function Disclaimer() {
  return (
    <div className="mt-12 mb-8 text-center px-4">
      <div className="inline-block max-w-xl bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 text-xs text-amber-700">
        <strong>Disclaimer:</strong> CreditScore Recovery Coach is an educational tool only.
        Score estimates are approximations based on general CIBIL scoring patterns and are{' '}
        <strong>not guaranteed</strong>. Actual score changes depend on many factors including
        lender reporting timelines, CIBIL's proprietary algorithm, and individual credit history.
        This tool does not provide financial advice. Consult a certified financial planner for
        personalized guidance.
      </div>
    </div>
  );
}
