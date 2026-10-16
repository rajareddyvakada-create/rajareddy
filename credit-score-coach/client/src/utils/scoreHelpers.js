export function getScoreColor(score) {
  if (score < 500) return '#ef4444';
  if (score < 600) return '#f97316';
  if (score < 700) return '#eab308';
  if (score < 750) return '#22c55e';
  return '#059669';
}

export function getScoreLabel(score) {
  if (score < 500) return 'Poor';
  if (score < 600) return 'Fair';
  if (score < 700) return 'Good';
  if (score < 750) return 'Very Good';
  return 'Excellent';
}

export function getScoreBg(score) {
  if (score < 500) return 'bg-red-50 text-red-700 border-red-200';
  if (score < 600) return 'bg-orange-50 text-orange-700 border-orange-200';
  if (score < 700) return 'bg-yellow-50 text-yellow-700 border-yellow-200';
  if (score < 750) return 'bg-green-50 text-green-700 border-green-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

export function formatINR(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export const DAMAGE_REASONS = [
  { value: 'missed_payments', label: 'Missed EMI / Credit Card Payments' },
  { value: 'loan_settlement', label: 'Loan Settlement (Paid Less Than Owed)' },
  { value: 'credit_card_default', label: 'Credit Card Default / Write-off' },
  { value: 'too_many_inquiries', label: 'Too Many Hard Inquiries' },
  { value: 'high_utilization', label: 'High Credit Utilization (>50%)' },
  { value: 'no_credit_history', label: 'No Credit History / Thin File' },
];
