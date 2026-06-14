import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { className?: string };

function Svg({ children, className = "h-5 w-5", ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* Brand mark — interlocking "G" coin / growth ring */
export function Logo({ className = "h-7 w-7" }: P) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="gally-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6c5cf6" />
          <stop offset="55%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#0fb39a" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="9" fill="url(#gally-logo)" />
      <path
        d="M21.5 12.2A6 6 0 1 0 22 17h-5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const Compass = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
  </Svg>
);
export const Layers = (p: P) => (
  <Svg {...p}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </Svg>
);
export const Shield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);
export const Scale = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v18M7 21h10M5 7l3 7H2l3-7Zm14 0 3 7h-6l3-7ZM5 7l7-2 7 2" />
  </Svg>
);
export const Briefcase = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" />
  </Svg>
);
export const Activity = (p: P) => (
  <Svg {...p}>
    <path d="M3 12h4l2 6 4-14 2 8h6" />
  </Svg>
);
export const Search = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </Svg>
);
export const Bell = (p: P) => (
  <Svg {...p}>
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </Svg>
);
export const Sun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4 12H2m20 0h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
  </Svg>
);
export const Moon = (p: P) => (
  <Svg {...p}>
    <path d="M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10Z" />
  </Svg>
);
export const Menu = (p: P) => (
  <Svg {...p}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </Svg>
);
export const Close = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const Settings = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 6.2 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 13.4H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 6.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6h0A1.7 1.7 0 0 0 11 3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0c.3.6.9 1 1.6 1H22a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </Svg>
);
export const ChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const ChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const ArrowUpRight = (p: P) => (
  <Svg {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Svg>
);
export const ArrowRight = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const Plus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const Check = (p: P) => (
  <Svg {...p}>
    <path d="m5 12 5 5L20 7" />
  </Svg>
);
export const Clock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const Alert = (p: P) => (
  <Svg {...p}>
    <path d="M10.3 4 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4m0 4h.01" />
  </Svg>
);
export const Lock = (p: P) => (
  <Svg {...p}>
    <rect x="4.5" y="10" width="15" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Svg>
);
export const Coins = (p: P) => (
  <Svg {...p}>
    <ellipse cx="9" cy="7" rx="6" ry="3" />
    <path d="M3 7v5c0 1.7 2.7 3 6 3M3 12v5c0 1.7 2.7 3 6 3" />
    <ellipse cx="16" cy="14" rx="5" ry="2.5" />
    <path d="M11 14v5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-5" />
  </Svg>
);
export const Star = (p: P) => (
  <Svg {...p}>
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.8 6.6 20l1-6.1L3.2 9.5l6.1-.9L12 3Z" />
  </Svg>
);
export const StarFilled = ({ className = "h-5 w-5", ...rest }: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" {...rest}>
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.8 6.6 20l1-6.1L3.2 9.5l6.1-.9L12 3Z" />
  </svg>
);
export const ExternalLink = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
  </Svg>
);
export const Copy = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </Svg>
);
export const TrendUp = (p: P) => (
  <Svg {...p}>
    <path d="M3 17 10 10l4 4 7-7M15 6h6v6" />
  </Svg>
);
export const TrendDown = (p: P) => (
  <Svg {...p}>
    <path d="M3 7 10 14l4-4 7 7M15 18h6v-6" />
  </Svg>
);
export const Users = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5a3.5 3.5 0 0 1 0 7M17.5 20a6.5 6.5 0 0 0-2.5-5.1" />
  </Svg>
);
export const MapPin = (p: P) => (
  <Svg {...p}>
    <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </Svg>
);
export const Wallet = (p: P) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9" />
    <circle cx="17" cy="13" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);
export const Dot = ({ className = "h-2 w-2" }: P) => (
  <svg viewBox="0 0 8 8" className={className} aria-hidden="true">
    <circle cx="4" cy="4" r="4" fill="currentColor" />
  </svg>
);
export const Filter = (p: P) => (
  <Svg {...p}>
    <path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" />
  </Svg>
);
export const Doc = (p: P) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </Svg>
);
export const Gauge = (p: P) => (
  <Svg {...p}>
    <path d="M5 18a8 8 0 1 1 14 0" />
    <path d="m12 14 4-4" />
    <circle cx="12" cy="14" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);

/* Category glyphs */
export const CatHousing = (p: P) => (
  <Svg {...p}>
    <path d="m4 11 8-6 8 6M6 10v9h12v-9M10 19v-5h4v5" />
  </Svg>
);
export const CatEnergy = (p: P) => (
  <Svg {...p}>
    <path d="M13 3 4 14h6l-1 7 9-11h-6l1-7Z" />
  </Svg>
);
export const CatTrade = (p: P) => (
  <Svg {...p}>
    <path d="M3 16V8l4-2 5 2 5-2 4 2v8l-4 2-5-2-5 2-4-2Z" />
    <path d="M7 6v10M12 8v10M17 6v10" />
  </Svg>
);
export const CatAgri = (p: P) => (
  <Svg {...p}>
    <path d="M12 21V11M12 11c0-4 3-7 8-7 0 5-3 8-8 8Zm0 0C12 8 9 5 4 5c0 4 3 6 8 6Z" />
  </Svg>
);
export const CatMachinery = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
  </Svg>
);
export const CatInfra = (p: P) => (
  <Svg {...p}>
    <path d="M4 21V8l5-3 5 3v13M14 21V11l5-2v12M4 21h16M7 11h3M7 15h3" />
  </Svg>
);
