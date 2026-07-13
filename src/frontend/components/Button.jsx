export function Button({ children, variant = "primary", className = "", ...props }) {
  return (
    <button className={`btn btn--${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
