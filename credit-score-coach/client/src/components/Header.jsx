import React from 'react';

export default function Header() {
  return (
    <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 leading-tight">CreditScore Recovery Coach</h1>
            <p className="text-xs text-gray-400">Your CIBIL rebuilding companion</p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-gray-400">
          <span className="inline-block w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
          Educational Tool
        </div>
      </div>
    </header>
  );
}
