function generateRecoveryPlan(profile) {
  const {
    current_score,
    damage_reason,
    overdue_accounts,
    outstanding_amount,
    monthly_income,
    existing_emi,
    credit_utilization,
    oldest_account_years,
  } = profile;

  const targetScore = 750;
  const dti = monthly_income > 0 ? ((existing_emi / monthly_income) * 100) : 0;
  const disposableIncome = monthly_income - existing_emi;
  const steps = [];
  let priority = 1;

  // Rule 1: Overdue accounts — immediate payoff plan
  if (overdue_accounts > 0) {
    const monthlyPayoff = disposableIncome > 0
      ? Math.min(disposableIncome * 0.5, outstanding_amount)
      : outstanding_amount;
    const monthsToPayoff = monthlyPayoff > 0
      ? Math.ceil(outstanding_amount / monthlyPayoff)
      : 24;

    steps.push({
      priority: priority++,
      category: 'overdue',
      title: 'Clear All Overdue Accounts',
      description: `You have ${overdue_accounts} overdue account(s) with ₹${outstanding_amount.toLocaleString('en-IN')} outstanding. This is the single biggest drag on your score.`,
      actions: [
        `Allocate ₹${Math.round(monthlyPayoff).toLocaleString('en-IN')}/month toward overdue payments`,
        'Contact each lender and negotiate a payment plan',
        'Prioritize the newest overdue account first (it damages your score the most)',
        'Get a "No Dues Certificate" after each payoff',
        'Request removal of "Written Off" or "Settled" status if paying in full',
      ],
      impact: '+50 to +100 points over 3-6 months',
      timelineMonths: Math.min(monthsToPayoff, 12),
    });
  }

  // Rule 2: Settlement history
  if (damage_reason === 'loan_settlement') {
    steps.push({
      priority: priority++,
      category: 'settlement',
      title: 'Address Settlement Marks',
      description: '"Settled" status stays on your report for 7 years and tells lenders you didn\'t pay in full.',
      actions: [
        'Contact the lender and offer to pay the remaining amount for a "Closed" status',
        'Get a written agreement BEFORE paying that they will update CIBIL to "Closed"',
        'If already settled, write to the lender requesting goodwill removal',
        'Keep all payment receipts and correspondence',
        'Verify the update on your CIBIL report within 45 days',
      ],
      impact: '+30 to +60 points once updated to "Closed"',
      timelineMonths: 3,
    });
  }

  // Rule 3: High credit utilization
  if (credit_utilization > 30) {
    const targetUtil = 25;
    const currentCreditLimit = outstanding_amount > 0
      ? (outstanding_amount / (credit_utilization / 100))
      : monthly_income * 3;
    const targetOutstanding = currentCreditLimit * (targetUtil / 100);
    const reductionNeeded = Math.max(0, outstanding_amount - targetOutstanding);

    steps.push({
      priority: priority++,
      category: 'utilization',
      title: `Reduce Credit Utilization from ${credit_utilization}% to Below 30%`,
      description: `High utilization (${credit_utilization}%) signals credit hunger. Lenders want to see below 30%, ideally below 10%.`,
      actions: [
        reductionNeeded > 0
          ? `Pay down ₹${Math.round(reductionNeeded).toLocaleString('en-IN')} across your credit cards`
          : 'Make multiple smaller payments within a billing cycle',
        'Request a credit limit increase on your oldest card (don\'t increase spending)',
        'Spread purchases across multiple cards instead of maxing one',
        'Pay the balance BEFORE the statement date, not just the due date',
        'Set up billing alerts at 25% and 50% of limit',
      ],
      impact: '+20 to +50 points within 1-2 billing cycles',
      timelineMonths: 2,
    });
  }

  // Rule 4: Very low score — secured credit card
  if (current_score < 550) {
    steps.push({
      priority: priority++,
      category: 'rebuild',
      title: 'Get a Secured Credit Card Against a Fixed Deposit',
      description: 'With a score below 550, unsecured credit is nearly impossible. A secured card is your best rebuilding tool.',
      actions: [
        'Open a Fixed Deposit of ₹10,000-25,000 at your bank',
        'Apply for a secured credit card against this FD',
        'Use ONLY 10-20% of the card limit each month',
        'Pay the FULL balance before the due date every single month',
        'After 12 months of perfect payments, request conversion to an unsecured card',
        'Banks offering secured cards: SBI, ICICI, Axis, Kotak, HDFC',
      ],
      impact: '+40 to +80 points over 6-12 months of consistent use',
      timelineMonths: 12,
    });
  }

  // Rule 5: No credit history
  if (damage_reason === 'no_credit_history' || oldest_account_years === 0) {
    steps.push({
      priority: priority++,
      category: 'build',
      title: 'Build Credit History from Scratch',
      description: 'No credit history means lenders can\'t assess your risk. You need to start building a track record.',
      actions: [
        'Apply for a secured credit card (against FD)',
        'Become an authorized user on a family member\'s old credit card',
        'Take a small credit-builder personal loan (₹25,000-50,000)',
        'Ensure your rent payments are reported to CIBIL via rent-reporting services',
        'Keep your first credit card for life — account age matters',
      ],
      impact: 'Score will start appearing in 6 months; reach 650+ in 12-18 months',
      timelineMonths: 18,
    });
  }

  // Rule 6: Too many hard inquiries
  if (damage_reason === 'too_many_inquiries') {
    steps.push({
      priority: priority++,
      category: 'inquiries',
      title: 'Stop Applying for New Credit',
      description: 'Each hard inquiry drops your score by 5-10 points. Multiple applications signal desperation.',
      actions: [
        'Do NOT apply for any new credit for at least 6 months',
        'Check if any inquiries are unauthorized and dispute them',
        'Use pre-approval check tools that do soft pulls only',
        'When you do apply again, submit all loan applications within a 14-day window (counted as one inquiry)',
        'Monitor your report for unauthorized inquiries quarterly',
      ],
      impact: '+15 to +30 points as inquiries age past 6 months',
      timelineMonths: 6,
    });
  }

  // Rule 7: Credit card default
  if (damage_reason === 'credit_card_default') {
    steps.push({
      priority: priority++,
      category: 'default',
      title: 'Resolve Credit Card Defaults',
      description: 'Defaults are the most severe negative marks. They must be resolved before any recovery.',
      actions: [
        'Contact the bank\'s recovery/collections department',
        'Negotiate a one-time settlement or payment plan',
        'INSIST on "Closed" status, not "Settled" — pay more if needed',
        'Get everything in writing before making any payment',
        'After payment, follow up every 30 days until CIBIL is updated',
        'If the debt is with a collection agency, negotiate directly with the bank',
      ],
      impact: '+60 to +120 points over 3-6 months after resolution',
      timelineMonths: 6,
    });
  }

  // Rule 8: DTI-based advice
  if (dti > 50) {
    steps.push({
      priority: priority++,
      category: 'dti',
      title: `Reduce Debt-to-Income Ratio (Currently ${Math.round(dti)}%)`,
      description: `Your EMIs consume ${Math.round(dti)}% of income. Lenders reject applications above 50% DTI.`,
      actions: [
        'Focus on paying off the smallest loan first (debt snowball) for quick wins',
        'Or pay the highest-interest debt first (debt avalanche) to save money',
        `Target DTI below 40%: reduce monthly EMIs by ₹${Math.round(existing_emi - monthly_income * 0.4).toLocaleString('en-IN')}`,
        'Consider debt consolidation if you have 3+ active loans',
        'Do NOT take new loans to pay old ones',
      ],
      impact: 'Improves loan eligibility; indirect score benefit from lower utilization',
      timelineMonths: 12,
    });
  }

  // Always-applicable steps
  steps.push({
    priority: priority++,
    category: 'habits',
    title: 'Build Perfect Payment Habits',
    description: 'Payment history is 35% of your CIBIL score — the single largest factor.',
    actions: [
      'Set up auto-debit for ALL loan EMIs and credit card minimum dues',
      'Pay credit card bills in FULL before the due date, not just the minimum',
      'Set phone reminders 5 days before each due date as backup',
      'If you can\'t pay in full, always pay at least the minimum on time',
      'One missed payment can drop your score 50-100 points',
    ],
    impact: 'Prevents further damage; builds positive history',
    timelineMonths: 1,
  });

  steps.push({
    priority: priority++,
    category: 'monitoring',
    title: 'Monitor and Dispute Errors on Your Report',
    description: 'Up to 25% of credit reports contain errors. Free annual check at cibil.com.',
    actions: [
      'Download your free CIBIL report annually from cibil.com',
      'Check for wrong accounts, incorrect balances, duplicate entries',
      'Dispute any errors immediately through CIBIL\'s online portal',
      'Keep copies of all dispute correspondence',
      'Verify corrections within 45 days of filing',
    ],
    impact: '+10 to +50 points if errors are corrected',
    timelineMonths: 2,
  });

  // Generate month-by-month projection
  const projection = generateProjection(current_score, targetScore, steps);

  // Confidence assessment
  const gapToTarget = targetScore - current_score;
  let estimatedMonths;
  if (gapToTarget <= 50) estimatedMonths = 3;
  else if (gapToTarget <= 100) estimatedMonths = 6;
  else if (gapToTarget <= 200) estimatedMonths = 12;
  else if (gapToTarget <= 300) estimatedMonths = 18;
  else estimatedMonths = 24;

  return {
    profile: {
      currentScore: current_score,
      targetScore,
      dti: Math.round(dti),
      disposableIncome: Math.round(disposableIncome),
      damageReason: damage_reason,
    },
    steps,
    projection,
    estimatedMonths,
    summary: buildSummary(current_score, targetScore, estimatedMonths, steps),
  };
}

function generateProjection(currentScore, targetScore, steps) {
  const months = [];
  const totalGap = targetScore - currentScore;
  const totalMonths = 24;

  for (let m = 0; m <= totalMonths; m++) {
    // Logistic growth curve — fast initial gains, slowing as score rises
    const t = m / totalMonths;
    const logistic = 1 / (1 + Math.exp(-8 * (t - 0.35)));
    const projected = Math.min(
      Math.round(currentScore + totalGap * logistic),
      targetScore
    );

    // Pessimistic and optimistic bounds
    const optimistic = Math.min(Math.round(projected + totalGap * 0.08), 900);
    const pessimistic = Math.max(Math.round(projected - totalGap * 0.12), currentScore);

    months.push({
      month: m,
      projected,
      optimistic,
      pessimistic,
      label: m === 0 ? 'Now' : `Month ${m}`,
    });
  }

  return months;
}

function buildSummary(currentScore, targetScore, estimatedMonths, steps) {
  const urgentSteps = steps.filter(s =>
    ['overdue', 'default', 'settlement'].includes(s.category)
  );
  const gap = targetScore - currentScore;
  let difficulty;
  if (gap <= 50) difficulty = 'Light tune-up';
  else if (gap <= 150) difficulty = 'Moderate rebuild';
  else if (gap <= 300) difficulty = 'Significant recovery';
  else difficulty = 'Major rehabilitation';

  return {
    difficulty,
    currentScore,
    targetScore,
    gap,
    estimatedMonths,
    urgentCount: urgentSteps.length,
    totalSteps: steps.length,
  };
}

function simulateAction(currentScore, action, amount) {
  const impacts = {
    pay_overdue: { min: 30, max: 80, perLakh: 15 },
    reduce_utilization: { min: 15, max: 50, perPercent: 1.5 },
    dispute_error: { min: 10, max: 50, flat: true },
    secured_card_6mo: { min: 30, max: 60, flat: true },
    stop_inquiries_6mo: { min: 10, max: 25, flat: true },
    on_time_payments_6mo: { min: 20, max: 50, flat: true },
    close_settled_to_closed: { min: 25, max: 55, flat: true },
  };

  const impact = impacts[action];
  if (!impact) return { min: 0, max: 0, newScoreMin: currentScore, newScoreMax: currentScore };

  let min, max;
  if (impact.flat) {
    min = impact.min;
    max = impact.max;
  } else if (impact.perLakh) {
    const lakhs = amount / 100000;
    min = Math.round(impact.min + lakhs * impact.perLakh * 0.5);
    max = Math.round(impact.max + lakhs * impact.perLakh);
  } else if (impact.perPercent) {
    min = Math.round(impact.min + amount * impact.perPercent * 0.5);
    max = Math.round(impact.max + amount * impact.perPercent);
  }

  return {
    min: Math.min(min, 150),
    max: Math.min(max, 200),
    newScoreMin: Math.min(currentScore + min, 900),
    newScoreMax: Math.min(currentScore + max, 900),
  };
}

module.exports = { generateRecoveryPlan, simulateAction };
