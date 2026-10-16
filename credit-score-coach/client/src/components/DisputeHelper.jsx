import React, { useState, useEffect } from 'react';
import { getErrorTypes, generateDisputeLetter } from '../services/api.js';

export default function DisputeHelper() {
  const [errorTypes, setErrorTypes] = useState([]);
  const [selectedType, setSelectedType] = useState('');
  const [details, setDetails] = useState({
    fullName: '',
    dob: '',
    pan: '',
    phone: '',
    email: '',
    address: '',
    lenderName: '',
    accountNumber: '',
    reportedAmount: '',
    actualAmount: '',
    closureDate: '',
    disputedMonth: '',
    paymentDate: '',
    inquiryDate: '',
    cibilScore: '',
  });
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    getErrorTypes().then(setErrorTypes).catch(() => {});
  }, []);

  function set(field, value) {
    setDetails((prev) => ({ ...prev, [field]: value }));
  }

  async function handleGenerate() {
    if (!selectedType) return alert('Please select an error type');
    setGenerating(true);
    try {
      const blob = await generateDisputeLetter(selectedType, details);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CIBIL_Dispute_${selectedType}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to generate letter. Please try again.');
    }
    setGenerating(false);
  }

  const FIELDS_BY_TYPE = {
    wrong_account: ['lenderName', 'accountNumber'],
    incorrect_balance: ['lenderName', 'accountNumber', 'reportedAmount', 'actualAmount'],
    duplicate_account: ['lenderName', 'accountNumber'],
    closed_showing_open: ['lenderName', 'accountNumber', 'closureDate'],
    wrong_payment_status: ['lenderName', 'accountNumber', 'disputedMonth'],
    settled_but_paid: ['lenderName', 'accountNumber', 'paymentDate'],
    unauthorized_inquiry: ['lenderName', 'inquiryDate'],
  };

  const FIELD_LABELS = {
    lenderName: 'Lender / Bank Name',
    accountNumber: 'Account / Loan Number',
    reportedAmount: 'Reported Amount (INR)',
    actualAmount: 'Actual Amount (INR)',
    closureDate: 'Account Closure Date',
    disputedMonth: 'Disputed Month/Year',
    paymentDate: 'Payment Date',
    inquiryDate: 'Inquiry Date',
  };

  const extraFields = selectedType ? (FIELDS_BY_TYPE[selectedType] || []) : [];

  return (
    <div className="card">
      <h3 className="text-lg font-bold text-gray-900 mb-1">CIBIL Dispute Letter Generator</h3>
      <p className="text-sm text-gray-400 mb-6">
        Auto-generate a ready-to-send dispute letter as a printable PDF
      </p>

      <div className="space-y-4">
        {/* Error type */}
        <div>
          <label className="label">Type of Error on Your Report</label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="input-field"
          >
            <option value="">Select error type...</option>
            {errorTypes.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Personal details */}
        <div className="bg-gray-50 rounded-xl p-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Your Details (for the letter)</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Full Name</label>
              <input value={details.fullName} onChange={(e) => set('fullName', e.target.value)} className="input-field" placeholder="As on PAN card" />
            </div>
            <div>
              <label className="label">Date of Birth</label>
              <input value={details.dob} onChange={(e) => set('dob', e.target.value)} className="input-field" placeholder="DD/MM/YYYY" />
            </div>
            <div>
              <label className="label">PAN Number</label>
              <input value={details.pan} onChange={(e) => set('pan', e.target.value)} className="input-field" placeholder="ABCDE1234F" />
            </div>
            <div>
              <label className="label">CIBIL Score</label>
              <input value={details.cibilScore} onChange={(e) => set('cibilScore', e.target.value)} className="input-field" placeholder="Your current score" />
            </div>
            <div>
              <label className="label">Phone Number</label>
              <input value={details.phone} onChange={(e) => set('phone', e.target.value)} className="input-field" placeholder="+91 98765 43210" />
            </div>
            <div>
              <label className="label">Email</label>
              <input value={details.email} onChange={(e) => set('email', e.target.value)} className="input-field" placeholder="you@example.com" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Address</label>
              <input value={details.address} onChange={(e) => set('address', e.target.value)} className="input-field" placeholder="Your full address" />
            </div>
          </div>
        </div>

        {/* Type-specific fields */}
        {extraFields.length > 0 && (
          <div className="bg-blue-50 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-blue-700 mb-3">Dispute-Specific Details</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {extraFields.map((field) => (
                <div key={field}>
                  <label className="label">{FIELD_LABELS[field]}</label>
                  <input
                    value={details[field]}
                    onChange={(e) => set(field, e.target.value)}
                    className="input-field"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!selectedType || generating}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {generating ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              Generating PDF...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Generate & Download Dispute Letter (PDF)
            </>
          )}
        </button>

        <p className="text-xs text-gray-400 text-center">
          Review all details in the downloaded PDF before printing and sending to CIBIL.
        </p>
      </div>
    </div>
  );
}
