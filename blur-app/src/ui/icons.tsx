/** 線画アイコン（24×24、currentColor） */
import type { ReactNode } from 'react';

function Svg({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Icon = {
  photo: () => (
    <Svg>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="M21 16l-5-5-8 9" />
    </Svg>
  ),
  undo: () => (
    <Svg>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 010 12h-3" />
    </Svg>
  ),
  redo: () => (
    <Svg>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H10a6 6 0 000 12h3" />
    </Svg>
  ),
  compare: () => (
    <Svg>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 2v20" />
      <path d="M3 15l4-4 5 5" />
    </Svg>
  ),
  share: () => (
    <Svg>
      <path d="M12 15V3" />
      <path d="M7 8l5-5 5 5" />
      <path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
    </Svg>
  ),
  download: () => (
    <Svg>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </Svg>
  ),
  gaussianBlur: () => (
    <Svg>
      <circle cx="12" cy="12" r="8" strokeOpacity="0.35" />
      <circle cx="12" cy="12" r="5" strokeOpacity="0.65" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </Svg>
  ),
  pixelate: () => (
    <Svg>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <rect x="4" y="4" width="5.3" height="5.3" fill="currentColor" stroke="none" />
      <rect x="14.7" y="4" width="5.3" height="5.3" fill="currentColor" stroke="none" opacity="0.5" />
      <rect x="9.3" y="9.3" width="5.4" height="5.4" fill="currentColor" stroke="none" opacity="0.75" />
      <rect x="4" y="14.7" width="5.3" height="5.3" fill="currentColor" stroke="none" opacity="0.4" />
      <rect x="14.7" y="14.7" width="5.3" height="5.3" fill="currentColor" stroke="none" />
    </Svg>
  ),
  blackout: () => (
    <Svg>
      <rect x="3" y="7" width="18" height="10" rx="1.5" fill="currentColor" />
    </Svg>
  ),
  swirl: () => (
    <Svg>
      <path d="M12 12a1.5 1.5 0 013 0 3 3 0 01-6 0 4.5 4.5 0 019 0 6 6 0 01-12 0 7.5 7.5 0 0115 0" />
    </Svg>
  ),
  motionBlur: () => (
    <Svg>
      <circle cx="16" cy="12" r="4" />
      <path d="M3 8h7M2 12h8M3 16h7" />
    </Svg>
  ),
  brush: () => (
    <Svg>
      <path d="M18.4 3.6a2 2 0 012.9 2.9L12 15.8 8.2 12z" />
      <path d="M8 14c-2.2 0-4 1.8-4 4 0 1.1-.9 2-2 2 1.6 1.3 3 2 5 2 2.8 0 5-2.2 5-5" />
    </Svg>
  ),
  rect: () => (
    <Svg>
      <rect x="4" y="5" width="16" height="14" rx="1" strokeDasharray="3 2.5" />
    </Svg>
  ),
  ellipse: () => (
    <Svg>
      <ellipse cx="12" cy="12" rx="9" ry="7" strokeDasharray="3 2.5" />
    </Svg>
  ),
  eraser: () => (
    <Svg>
      <path d="M7 21h13" />
      <path d="M4.5 15.5l9.9-9.9a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L12 18H7z" />
      <path d="M9.5 10.5l6 6" />
    </Svg>
  ),
  move: () => (
    <Svg>
      <path d="M12 3v18M3 12h18" />
      <path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </Svg>
  ),
  fit: () => (
    <Svg>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </Svg>
  ),
  check: () => (
    <Svg>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  ),
  close: () => (
    <Svg>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  ),
  cw: () => (
    <Svg>
      <path d="M20 12a8 8 0 11-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </Svg>
  ),
  ccw: () => (
    <Svg>
      <path d="M4 12a8 8 0 102.3-5.6" />
      <path d="M4 4v5h5" />
    </Svg>
  ),
};
