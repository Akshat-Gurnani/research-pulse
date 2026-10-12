export default function NotFound() {
  return (
    <div className="page">
      <header className="hero">
        <div className="eyebrow">404</div>
        <h1>No brief here</h1>
        <div className="sub">There is no published brief for that address. Weeks are written like 2026-W42, and a week only exists after it has been published.</div>
      </header>
      <section className="card glass"><p><a href="/">Read the latest brief</a></p></section>
    </div>
  );
}
