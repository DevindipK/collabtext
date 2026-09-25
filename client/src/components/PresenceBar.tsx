import type { PresenceUser } from '../protocol';
import type { ConnectionState } from '../hooks/useCollabDoc';

interface PresenceBarProps {
  users: PresenceUser[];
  mySiteId: string | null;
  connection: ConnectionState;
}

export function PresenceBar({ users, mySiteId, connection }: PresenceBarProps) {
  return (
    <div className="presence">
      <span className={`presence__status presence__status--${connection}`}>
        <span className="presence__status-dot" />
        {connection === 'open' ? 'Live' : connection === 'connecting' ? 'Connecting…' : 'Disconnected'}
      </span>
      {users.map((u) => (
        <span key={u.siteId} className="presence__chip" style={{ borderColor: u.color }}>
          <span className="presence__dot" style={{ background: u.color }} />
          {u.name}
          {u.siteId === mySiteId ? ' (you)' : ''}
        </span>
      ))}
    </div>
  );
}
