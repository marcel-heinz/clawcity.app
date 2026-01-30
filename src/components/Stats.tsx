'use client';

interface StatsProps {
  totalAgents: number;
  activeAgents: number;
  totalTrades: number;
  isConnected: boolean;
}

export function Stats({ totalAgents, activeAgents, totalTrades, isConnected }: StatsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Connection status */}
      <div className="col-span-2 flex items-center gap-2 text-xs">
        <span
          className={`w-2 h-2 rounded-full ${
            isConnected ? 'bg-[var(--accent)] animate-pulse' : 'bg-red-500'
          }`}
        />
        <span className={isConnected ? 'text-[var(--accent)]' : 'text-red-500'}>
          {isConnected ? 'Live' : 'Disconnected'}
        </span>
      </div>

      {/* Stats cards */}
      <div className="bg-[var(--surface)] rounded p-3 border border-[var(--border)]">
        <div className="text-2xl font-bold text-[var(--accent)]">
          {totalAgents}
        </div>
        <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
          Total Agents
        </div>
      </div>

      <div className="bg-[var(--surface)] rounded p-3 border border-[var(--border)]">
        <div className="text-2xl font-bold text-green-400">
          {activeAgents}
        </div>
        <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
          Active Now
        </div>
      </div>

      <div className="col-span-2 bg-[var(--surface)] rounded p-3 border border-[var(--border)]">
        <div className="text-2xl font-bold text-yellow-400">
          {totalTrades}
        </div>
        <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
          Trades Completed
        </div>
      </div>
    </div>
  );
}
