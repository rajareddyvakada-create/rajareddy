import React from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';

export default function ScoreProjectionChart({ projection, summary }) {
  return (
    <div className="card">
      <h3 className="text-lg font-bold text-gray-900 mb-1">Score Projection</h3>
      <p className="text-sm text-gray-400 mb-6">
        Estimated trajectory over 24 months with optimistic and pessimistic bounds
      </p>

      <div className="h-[360px] -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={projection} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="boundGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.08} />
                <stop offset="100%" stopColor="#94a3b8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="label"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#e2e8f0' }}
              interval={3}
            />
            <YAxis
              domain={[
                Math.max(250, summary.currentScore - 50),
                Math.min(900, summary.targetScore + 50),
              ]}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={45}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine
              y={summary.targetScore}
              stroke="#16a34a"
              strokeDasharray="6 4"
              label={{ value: `Target: ${summary.targetScore}`, position: 'right', fill: '#16a34a', fontSize: 11 }}
            />
            <ReferenceLine
              y={summary.currentScore}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              label={{ value: `Current: ${summary.currentScore}`, position: 'left', fill: '#94a3b8', fontSize: 11 }}
            />
            <Area
              type="monotone"
              dataKey="optimistic"
              stroke="none"
              fill="url(#boundGrad)"
            />
            <Area
              type="monotone"
              dataKey="pessimistic"
              stroke="#cbd5e1"
              strokeWidth={1}
              strokeDasharray="4 4"
              fill="none"
            />
            <Area
              type="monotone"
              dataKey="projected"
              stroke="#22c55e"
              strokeWidth={2.5}
              fill="url(#projGrad)"
              dot={false}
              activeDot={{ r: 5, fill: '#22c55e', stroke: '#fff', strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey="optimistic"
              stroke="#86efac"
              strokeWidth={1}
              strokeDasharray="4 4"
              fill="none"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-center gap-6 mt-4 text-xs text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-green-500 rounded-full inline-block"></span>
          Projected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-green-300 rounded-full inline-block" style={{ borderBottom: '1px dashed' }}></span>
          Optimistic
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-gray-300 rounded-full inline-block" style={{ borderBottom: '1px dashed' }}></span>
          Pessimistic
        </span>
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-100 px-4 py-3 text-sm">
      <div className="font-semibold text-gray-900 mb-1">{label}</div>
      <div className="space-y-0.5 text-xs">
        <div className="text-green-600">Projected: <strong>{d.projected}</strong></div>
        <div className="text-green-400">Optimistic: {d.optimistic}</div>
        <div className="text-gray-400">Pessimistic: {d.pessimistic}</div>
      </div>
    </div>
  );
}
