/**
 * Human-friendly formatting utilities for dashboard display.
 * Converts technical identifiers into readable labels.
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Convert a cron expression to a human-readable description. */
export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every N minutes: */N * * * *
  const everyMinMatch = minute!.match(/^\*\/(\d+)$/);
  if (everyMinMatch && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = Number(everyMinMatch[1]);
    return n === 1 ? 'Every minute' : `Every ${n} minutes`;
  }

  // Every N hours: 0 */N * * *
  const everyHourMatch = hour!.match(/^\*\/(\d+)$/);
  if (minute === '0' && everyHourMatch && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = Number(everyHourMatch[1]);
    return n === 1 ? 'Every hour' : `Every ${n} hours`;
  }

  // Daily at specific time: M H * * *
  if (/^\d+$/.test(minute!) && /^\d+$/.test(hour!) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const h = Number(hour);
    const m = Number(minute);
    const time = formatTime(h, m);
    return h === 0 && m === 0 ? 'Daily at midnight' : `Daily at ${time}`;
  }

  // Weekdays at time: M H * * 1-5
  if (/^\d+$/.test(minute!) && /^\d+$/.test(hour!) && dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
    return `Weekdays at ${formatTime(Number(hour), Number(minute))}`;
  }

  // Specific day of week: M H * * N
  if (/^\d+$/.test(minute!) && /^\d+$/.test(hour!) && dayOfMonth === '*' && month === '*' && /^\d$/.test(dayOfWeek!)) {
    const day = DAY_NAMES[Number(dayOfWeek)] ?? dayOfWeek;
    return `${day}s at ${formatTime(Number(hour), Number(minute))}`;
  }

  // Weekday range: M H * * N-N
  if (/^\d+$/.test(minute!) && /^\d+$/.test(hour!) && dayOfMonth === '*' && month === '*' && /^\d-\d$/.test(dayOfWeek!)) {
    const [start, end] = dayOfWeek!.split('-').map(Number);
    const startDay = SHORT_DAYS[start!] ?? start;
    const endDay = SHORT_DAYS[end!] ?? end;
    return `${startDay}–${endDay} at ${formatTime(Number(hour), Number(minute))}`;
  }

  return expr;
}

function formatTime(h: number, m: number): string {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${hour12}:00 ${suffix}` : `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Convert snake_case to Title Case. */
export function snakeToTitle(s: string): string {
  return s
    .split(/[_-]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  ollama: 'Ollama (Local)',
  google: 'Google (Gemini)',
  'abf-cloud': 'ABF Cloud',
};

/** Provider slug to branded display label. */
export function providerLabel(slug: string): string {
  return PROVIDER_LABELS[slug] ?? snakeToTitle(slug);
}

const MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-4-6': 'Claude Sonnet',
  'claude-sonnet-4-5': 'Claude Sonnet',
  'claude-sonnet-4-5-20250514': 'Claude Sonnet',
  'claude-haiku-4-5': 'Claude Haiku',
  'claude-opus-4-6': 'Claude Opus',
  'claude-3-5-sonnet-20241022': 'Claude Sonnet 3.5',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4-turbo': 'GPT-4 Turbo',
  'gpt-5.2': 'GPT-5',
  'o1': 'o1',
  'o1-mini': 'o1 Mini',
  'llama3.2': 'Llama 3.2',
  'llama3.1': 'Llama 3.1',
  'mistral': 'Mistral',
  'mixtral': 'Mixtral',
};

/** Model ID to friendly display name. */
export function modelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model;
}

/** Format milliseconds as a human-readable duration. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return remainSec > 0 ? `${minutes}m ${remainSec}s` : `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours} hour${hours !== 1 ? 's' : ''}`;
}

/** Format a timestamp as relative time (e.g., "2 minutes ago"). */
export function timeAgo(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
