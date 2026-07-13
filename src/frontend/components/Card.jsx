export function Card({ eyebrow, title, action, children, className = "" }) {
  return (
    <section className={`card ${className}`.trim()}>
      {(eyebrow || title || action) && (
        <div className="card__head">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h3>{title}</h3>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
