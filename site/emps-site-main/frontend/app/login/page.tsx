"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Moon, Sun } from "lucide-react";
import { api } from "@/services/emps-api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("emps.login.email");
      if (saved) { setEmail(saved); setRemember(true); }
      const preference = localStorage.getItem("emps.theme");
      setTheme(preference === "light" || preference === "dark" ? preference : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    } catch { /* Storage is optional. */ }
    let active = true;
    void api.ensureSession().then(() => { if (active) router.replace("/dashboard"); }).catch(() => undefined);
    return () => { active = false; };
  }, [router]);

  function togglePassword() {
    const input = passwordInput.current;
    const start = input?.selectionStart ?? password.length;
    const end = input?.selectionEnd ?? start;
    setShowPassword(value => !value);
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start, end); });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError("");
    try {
      await api.login(email.trim(), password);
      try {
        if (remember) localStorage.setItem("emps.login.email", email.trim());
        else localStorage.removeItem("emps.login.email");
      } catch { /* Remembering email is optional. */ }
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally { submitting.current = false; setLoading(false); }
  }

  return (
    <main className="login-screen" data-theme={theme}>
      <section className="login-visual" aria-label="Energia e mobilidade EMPS" />
      <section className="login-panel" aria-label="Acesso EMPS">
        <button className="login-theme-switch" type="button" aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"} onClick={() => {
          const next = theme === "dark" ? "light" : "dark";
          setTheme(next);
          try { localStorage.setItem("emps.theme", next); } catch { /* Optional preference. */ }
        }}>{theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}</button>
        <form className="login-card" onSubmit={submit} aria-busy={loading}>
          <Image src="/emps-logo-red.png" alt="EMPS" width={180} height={60} className="login-logo" priority />
          <h1>Bem-vindo à EMPS</h1>
          <p>Energia e recarga, em um só lugar.</p>
          <div className="login-fields">
            <label htmlFor="login-email">E-mail</label>
            <input id="login-email" type="email" autoComplete="username" placeholder="seu@email.com" required value={email} onChange={e => setEmail(e.target.value)} aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined} />
            <label htmlFor="login-password">Senha</label>
            <div className="login-password-field">
              <input ref={passwordInput} id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Sua senha" required value={password} onChange={e => setPassword(e.target.value)} aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined} />
              <button type="button" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword} onMouseDown={e => e.preventDefault()} onClick={togglePassword}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button>
            </div>
          </div>
          <label className="login-check"><input type="checkbox" checked={remember} onChange={e => {
            setRemember(e.target.checked);
            if (!e.target.checked) { try { localStorage.removeItem("emps.login.email"); } catch { /* Optional preference. */ } }
          }} /><span>Lembrar meu e-mail</span></label>
          {error && <p className="login-error" id="login-error" role="alert">{error}</p>}
          <button className="login-submit" type="submit" disabled={loading}>{loading ? "Entrando…" : "Entrar"}</button>
          <footer className="login-footer">Acesso restrito a usuários autorizados.</footer>
        </form>
      </section>
    </main>
  );
}
