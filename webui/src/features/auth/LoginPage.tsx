import { FormEvent, useState } from "react";
import { Icon } from "../../components/ui/Icon";
import { useAuth } from "./useAuth";
import "./auth.css";

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "falha no login";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-card__brand">
          <img src="/mah_logo_bg.png" alt="MAH" height={34} />
          <h1>MAH WebUI</h1>
        </div>
        <p className="auth-card__subtitle">Autentique-se para acessar o console operacional</p>
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            <span>Usuário</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            <span>Senha</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <div className="auth-form__error">
              <Icon name="error" size={14} />
              <span>{error}</span>
            </div>
          )}
          <button type="submit" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
        <p className="auth-card__hint">
          Configure `MAH_WEBUI_USER` e `MAH_WEBUI_PASSWORD` no ambiente do servidor para alterar as credenciais.
        </p>
      </section>
    </main>
  );
}
