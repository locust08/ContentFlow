export function MetricCard({ icon: Icon, label, value, caption }) {
  return (
    <article className="metric-card">
      <div className="metric-card__label">{Icon && <Icon aria-hidden="true" size={17} />}<span>{label}</span></div>
      <strong>{value}</strong>
      <p>{caption}</p>
    </article>
  );
}
