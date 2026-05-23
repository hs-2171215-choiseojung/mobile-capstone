import Image from "next/image";

interface StudyULogoProps {
  size?: number;
  className?: string;
}

export default function StudyULogo({ size = 32, className = "" }: StudyULogoProps) {
  return (
    <Image
      src="/studyu-logo.png"
      alt="STUDY:U"
      width={size}
      height={size}
      priority
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
