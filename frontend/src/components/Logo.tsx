export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <path
        d="M12 2.2c-.4.5-7.2 8.4-7.2 13a7.2 7.2 0 0 0 14.4 0c0-4.6-6.8-12.5-7.2-13Z"
        fill="currentColor"
      />
      <path
        d="M7.4 14.6c1.5-1.1 3-1.1 4.6 0s3.1 1.1 4.6 0"
        stroke="var(--logo-cut, #000)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M8.6 17.6c1.1-.8 2.3-.8 3.4 0s2.3.8 3.4 0"
        stroke="var(--logo-cut, #000)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`wiggle-on-hover inline-flex items-center gap-2 ${className}`}>
      <LogoMark className="logo-mark h-[22px] w-[22px] origin-[50%_80%]" />
      <span className="text-[21px] font-medium tracking-[-0.03em]">Dropwise</span>
    </span>
  );
}
