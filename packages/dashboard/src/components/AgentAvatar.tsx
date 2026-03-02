'use client';

import { useState } from 'react';
import { Bot, User } from 'lucide-react';
import { getAvatarUrl } from '@/lib/avatar';

interface AgentAvatarProps {
  name: string;
  size?: number;
  className?: string;
  isCeo?: boolean;
}

export function AgentAvatar({ name, size = 40, className = '', isCeo }: AgentAvatarProps) {
  const [errored, setErrored] = useState(false);

  if (isCeo) {
    return (
      <div
        className={`rounded-full bg-sky-600 flex items-center justify-center flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <User size={size * 0.55} className="text-white" />
      </div>
    );
  }

  if (errored) {
    return (
      <div
        className={`rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <Bot size={size * 0.55} className="text-slate-400" />
      </div>
    );
  }

  return (
    <img
      src={getAvatarUrl(name, size * 2)}
      alt={`${name} avatar`}
      width={size}
      height={size}
      className={`rounded-full flex-shrink-0 ${className}`}
      onError={() => setErrored(true)}
    />
  );
}
