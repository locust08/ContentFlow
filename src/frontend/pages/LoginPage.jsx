import { useState } from "react";
import { Button } from "../components/Button.jsx";

export function LoginPage({ app }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event) {
    event.preventDefault();
    await app.login(email, password);
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <img className="login-logo" src="/assets/brand/contentflow-bee.png" alt="ContentFlow AI" />
        <p className="eyebrow">Supabase Auth</p>
        <h1>ContentFlow AI</h1>
        <p>Login with your Admin, Staff, or Client account to open the correct workspace.</p>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@digitalbee.ai" />
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" />
        <Button type="submit">Login</Button>
        {app.error && <span className="form-error">{app.error}</span>}
      </form>
    </main>
  );
}
