"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  EyeOff,
  Globe2,
  Moon,
  Server,
  Smartphone,
  X,
} from "lucide-react";
import { api } from "@/services/emps-api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .ensureSession()
      .then(() => {
        if (active) router.replace("/dashboard");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await api.login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nao foi possivel entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <header className="login-head">
        <Image
          alt="GoodWe"
          className="login-goodwe-logo"
          height={24}
          priority
          src="/goodwe_logo.eb050bb6.png"
          width={160}
        />

        <nav className="login-tools" aria-label="Preferencias de acesso">
          <button type="button">
            <Server size={17} aria-hidden="true" />
            Servidor Americas
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          <button type="button">
            <Globe2 size={17} aria-hidden="true" />
            Portugues
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          <button type="button">
            <Smartphone size={17} aria-hidden="true" />
            App
          </button>
          <button className="login-theme-switch" type="button" aria-label="Alternar tema">
            <Moon size={15} aria-hidden="true" />
          </button>
        </nav>
      </header>

      <section className="login-panel" aria-label="Login SEMS+">
        <form className="login-card" onSubmit={submit}>
          <h1>Bem-vindo ao SEMS+</h1>
          <p>We, the Smart Energy Innovator</p>

          <div className="login-fields">
            <label>
              <span>E-mail</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="E-mail"
                required
                type="email"
                autoComplete="email"
                aria-label="E-mail"
              />
              <X size={13} aria-hidden="true" />
            </label>

            <label>
              <span>Senha</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                placeholder="Senha"
                required
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                aria-label="Senha"
              />
              <button type="button" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)} style={{position:"absolute",right:12,top:34,border:0,background:"transparent",color:"inherit",padding:0}}><EyeOff size={15} aria-hidden="true" /></button>
            </label>
          </div>

          <div className="login-options">
            <label className="login-check">
              <input type="checkbox" />
              <span>Lembrar senha</span>
            </label>
            <button type="button">Esqueci a senha</button>
          </div>

          <label className="login-check login-terms">
            <input type="checkbox" defaultChecked />
            <span>
              Li e concordo com o "Contrato de Servico"
              <strong>Termos de servico</strong>
            </span>
          </label>

          {error && <b className="form-error">{error}</b>}

          <button className="login-submit" disabled={loading}>
            {loading ? "Validando..." : "Login"}
          </button>
          <button className="login-create" type="button">
            Criar conta
          </button>

          <footer className="login-footer">
            <div>
              <a href="#">Termos de Uso</a>
              <a href="#">Politica de privacidade</a>
              <a href="#">Politica de Cookies</a>
            </div>
            <small>Copyright (c) 2025 GoodWe Technologies Co., Ltd. All Rights Reserved.</small>
          </footer>
        </form>
      </section>
    </main>
  );
}

