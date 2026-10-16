import React, { useState } from 'react';
import Header from './components/Header.jsx';
import UserInputForm from './components/UserInputForm.jsx';
import RecoveryPlan from './components/RecoveryPlan.jsx';
import ScoreProjectionChart from './components/ScoreProjectionChart.jsx';
import DosAndDonts from './components/DosAndDonts.jsx';
import ScoreSimulator from './components/ScoreSimulator.jsx';
import DisputeHelper from './components/DisputeHelper.jsx';
import ProgressTracker from './components/ProgressTracker.jsx';
import Disclaimer from './components/Disclaimer.jsx';
import { generatePlan } from './services/api.js';

export default function App() {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('plan');
  const [currentScore, setCurrentScore] = useState(500);

  async function handleSubmit(formData) {
    setLoading(true);
    try {
      const result = await generatePlan(formData);
      setPlan(result.plan);
      setCurrentScore(formData.current_score);
      setActiveTab('plan');
    } catch (err) {
      alert('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setPlan(null);
    setActiveTab('plan');
  }

  const tabs = [
    { id: 'plan', label: 'Recovery Plan', icon: '📋' },
    { id: 'chart', label: 'Projection', icon: '📈' },
    { id: 'simulator', label: 'Simulator', icon: '🎛' },
    { id: 'checklist', label: 'Checklist', icon: '✅' },
    { id: 'dispute', label: 'Dispute', icon: '📄' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-8">
        {!plan ? (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Let's Rebuild Your Credit Score
              </h2>
              <p className="text-gray-500">
                Tell us about your current situation and we'll create a personalized recovery plan.
              </p>
            </div>
            <UserInputForm onSubmit={handleSubmit} loading={loading} />
          </div>
        ) : (
          <>
            <ProgressTracker summary={plan.summary} />

            <div className="flex flex-wrap gap-2 mb-6 bg-white rounded-2xl p-2 shadow-sm border border-gray-100">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 min-w-[120px] px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className="mr-1.5">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'plan' && <RecoveryPlan plan={plan} />}
            {activeTab === 'chart' && <ScoreProjectionChart projection={plan.projection} summary={plan.summary} />}
            {activeTab === 'simulator' && <ScoreSimulator currentScore={currentScore} />}
            {activeTab === 'checklist' && <DosAndDonts />}
            {activeTab === 'dispute' && <DisputeHelper />}

            <div className="mt-8 text-center">
              <button onClick={handleReset} className="btn-secondary text-sm">
                Start Over with New Data
              </button>
            </div>
          </>
        )}
        <Disclaimer />
      </main>
    </div>
  );
}
