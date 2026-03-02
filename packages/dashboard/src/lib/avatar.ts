const DICEBEAR_BASE = 'https://api.dicebear.com/9.x/bottts-neutral/svg';

export function getAvatarUrl(seed: string, size = 64): string {
  return `${DICEBEAR_BASE}?seed=${encodeURIComponent(seed)}&size=${size}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}
