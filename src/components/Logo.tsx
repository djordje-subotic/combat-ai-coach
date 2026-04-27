"use client";

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Background */}
      <rect width="64" height="64" rx="14" fill="url(#bg)" />

      {/* Fighter silhouette — fist forward */}
      <g transform="translate(12, 8)">
        {/* Head */}
        <circle cx="20" cy="10" r="6" fill="url(#fg)" opacity="0.95" />
        {/* Torso */}
        <path
          d="M14 16 L20 16 L26 16 L28 32 L12 32 Z"
          fill="url(#fg)"
          opacity="0.85"
        />
        {/* Lead arm — jab extended */}
        <path
          d="M26 18 L38 14 L40 13"
          stroke="url(#fg)"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
        {/* Fist (lead) */}
        <circle cx="40" cy="13" r="3.5" fill="#00d4ff" />
        {/* Rear arm — guard position */}
        <path
          d="M14 18 L10 14"
          stroke="url(#fg)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Fist (rear) */}
        <circle cx="10" cy="13" r="3" fill="url(#fg)" opacity="0.7" />
        {/* Lead leg */}
        <path
          d="M22 32 L26 46"
          stroke="url(#fg)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Rear leg */}
        <path
          d="M18 32 L12 46"
          stroke="url(#fg)"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>

      {/* AI scan lines */}
      <line x1="8" y1="22" x2="56" y2="22" stroke="#00d4ff" strokeWidth="0.5" opacity="0.3" />
      <line x1="8" y1="34" x2="56" y2="34" stroke="#00d4ff" strokeWidth="0.5" opacity="0.2" />
      <line x1="8" y1="46" x2="56" y2="46" stroke="#00d4ff" strokeWidth="0.5" opacity="0.15" />

      {/* Corner bracket — top-left */}
      <path d="M6 16 L6 6 L16 6" stroke="#00d4ff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      {/* Corner bracket — bottom-right */}
      <path d="M58 48 L58 58 L48 58" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />

      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0a0a1a" />
          <stop offset="1" stopColor="#0f0a20" />
        </linearGradient>
        <linearGradient id="fg" x1="10" y1="8" x2="42" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00d4ff" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="64" height="64" rx="14" fill="url(#bg2)" />
      <g transform="translate(12, 8)">
        <circle cx="20" cy="10" r="6" fill="url(#fg2)" opacity="0.95" />
        <path d="M14 16 L20 16 L26 16 L28 32 L12 32 Z" fill="url(#fg2)" opacity="0.85" />
        <path d="M26 18 L38 14 L40 13" stroke="url(#fg2)" strokeWidth="4.5" strokeLinecap="round" />
        <circle cx="40" cy="13" r="3.5" fill="#00d4ff" />
        <path d="M14 18 L10 14" stroke="url(#fg2)" strokeWidth="4" strokeLinecap="round" />
        <circle cx="10" cy="13" r="3" fill="url(#fg2)" opacity="0.7" />
        <path d="M22 32 L26 46" stroke="url(#fg2)" strokeWidth="4" strokeLinecap="round" />
        <path d="M18 32 L12 46" stroke="url(#fg2)" strokeWidth="4" strokeLinecap="round" />
      </g>
      <path d="M6 16 L6 6 L16 6" stroke="#00d4ff" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <path d="M58 48 L58 58 L48 58" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <defs>
        <linearGradient id="bg2" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0a0a1a" /><stop offset="1" stopColor="#0f0a20" />
        </linearGradient>
        <linearGradient id="fg2" x1="10" y1="8" x2="42" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00d4ff" /><stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
    </svg>
  );
}
