type Props = {
  size?: number;
  className?: string;
  title?: string;
};

/**
 * Logo B mark (octagon + open book).
 * Uses the high-DPI PNG so HiDPI stays sharp and matches the shipped icon set.
 */
export function OctavoLogo({ size = 48, className, title }: Props) {
  return (
    <img
      src="/octavo-icon.png"
      width={size}
      height={size}
      className={className}
      alt={title ?? ""}
      draggable={false}
      decoding="async"
    />
  );
}
