const BASE = '/api';

export async function generatePlan(formData) {
  const res = await fetch(`${BASE}/recovery/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData),
  });
  if (!res.ok) throw new Error('Failed to generate plan');
  return res.json();
}

export async function simulateAction(currentScore, action, amount) {
  const res = await fetch(`${BASE}/recovery/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_score: currentScore, action, amount }),
  });
  if (!res.ok) throw new Error('Simulation failed');
  return res.json();
}

export async function getErrorTypes() {
  const res = await fetch(`${BASE}/dispute/error-types`);
  if (!res.ok) throw new Error('Failed to fetch error types');
  return res.json();
}

export async function generateDisputeLetter(errorType, details) {
  const res = await fetch(`${BASE}/dispute/generate-letter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ errorType, details }),
  });
  if (!res.ok) throw new Error('Failed to generate letter');
  return res.blob();
}
