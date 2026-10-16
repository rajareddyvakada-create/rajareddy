import React from 'react';
import { getScoreColor, getScoreLabel } from '../utils/scoreHelpers.js';

export default function ProgressTracker({ summary }) {
  const { currentScore, targetScore, gap, estimatedMonths, difficulty, urgentCount, totalSteps } = summary;
  const progress = Math.max(0, Math.min(100, ((currentScore - 300) / (targetScore - 300)) * 100));
  const color = getScoreColor(currentScore);

  return (
    <div className="card mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-6">
        {/* Score circle */}
        <div className="flex-shrink-0 mx-auto sm:mx-0">
          <div className="relative w-28 h-28">
            <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#f3f4f6" strokeWidth="8" />
              <circle
                cx="50" cy="50" r="42" fill="none"
                stroke={color} strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${progress * 2.64} 264`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold" style={{ color }}>{currentScore}</span>
              <span className="text-[10px] text-gray-400">{getScoreLabel(currentScore)}</span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Target" value={targetScore} sub="score" color="text-brand-600" />
          <Stat label="Gap" value={`+${gap}`} sub="points needed" color="text-orange-500" />
          <Stat label="Timeline" value={`~${estimatedMonths}`} sub="months" color="text-blue-600" />
          <Stat label="Urgent" value={urgentCount} sub={`of ${totalSteps} steps`} color="text-red-500" />
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-5">
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>{difficulty}</span>
          <span>{Math.round(progress)}% to target</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${progress}%`, backgroundColor: color }}
          />
        </div>
      </div>

      {/* Motivation */}
      <p className="mt-4 text-center text-sm text-gray-500 italic">
        {currentScore < 500
          ? "Every journey starts with a single step. Your score CAN recover."
          : currentScore < 650
          ? "You're on the road to recovery. Stay consistent and watch it climb."
          : "Great progress! A few more steps and you'll unlock the best loan rates."}
      </p>
    </div>
  );
}

function Stat({ label, value, sub, color }) {
  return (
    <div className="text-center sm:text-left">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-[10px] text-gray-300">{sub}</div>
    </div>
  );
}
