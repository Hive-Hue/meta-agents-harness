type IconProps = {
  name: string;
  className?: string;
  size?: number;
  filled?: boolean;
  style?: React.CSSProperties;
};

export function Icon({ name, className = "", size, filled = false, style: extraStyle }: IconProps) {
  const style = {
    fontSize: size ? `${size}px` : undefined,
    fontVariationSettings: filled ? "'FILL' 1" : undefined,
    ...extraStyle,
  };

  return (
    <span className={`material-symbols-outlined ${className}`} style={{ ...style, display: 'flex' }} aria-hidden="true">
      {name}
    </span>
  );
}
