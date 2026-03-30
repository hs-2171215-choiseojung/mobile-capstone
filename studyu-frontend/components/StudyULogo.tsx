interface StudyULogoProps {
  size?: number;
  className?: string;
}

export default function StudyULogo({ size = 32, className = "" }: StudyULogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Background */}
      <rect width="100" height="100" rx="20" fill="#1A6F7C" />

      {/* Graduation cap board (diamond/rhombus) */}
      <polygon points="50,14 80,28 50,42 20,28" fill="white" />

      {/* Left arch (U shape open at top) */}
      <path
        d="M20,50 L20,68 Q20,82 34,82 Q48,82 48,68 L48,50 Z"
        fill="white"
      />

      {/* Right arch (U shape open at top) */}
      <path
        d="M52,50 L52,68 Q52,82 66,82 Q80,82 80,68 L80,50 Z"
        fill="white"
      />

      {/* Tassel string */}
      <line x1="80" y1="28" x2="80" y2="47" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      {/* Tassel drop */}
      <circle cx="80" cy="51" r="4" fill="white" />
    </svg>
  );
}
