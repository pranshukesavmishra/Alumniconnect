import { ArrowLeft, Mail } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { Button } from '../../components/ui/Button'
import { Notice } from '../../components/ui/Display'
import { LinkedInIcon } from '../../components/ui/Icons'
import { Field, Input } from '../../components/ui/Form'
import { friendlyError } from '../../lib/errors'
import { safeNext } from '../../lib/safeNext'
import { supabase } from '../../lib/supabase'
import { useAuth } from './AuthProvider'
import { useT } from '../../i18n'
import { LanguageSwitch } from '../../i18n/LanguageSwitch'


function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  )
}

export function SignInPage() {
  const tx = useT()
  const { session, loading } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [step, setStep] = useState<'choose' | 'email' | 'code'>('choose')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  if (!loading && session) return <Navigate to={next} replace />

  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

  async function oauth(provider: 'google' | 'linkedin_oidc') {
    setError(null)
    setBusy(provider)
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })
    if (error) {
      setError(friendlyError(error))
      setBusy(null)
    }
  }

  async function sendCode(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    const clean = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setError(tx('auth.badEmail'))
      return
    }
    setBusy('email')
    const { error } = await supabase.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: true, emailRedirectTo: redirectTo } })
    setBusy(null)
    if (error) return setError(friendlyError(error))
    setEmail(clean)
    setCode('')
    setStep('code')
    setResendIn(60)
  }

  async function verify(e?: FormEvent, value = code) {
    e?.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(value)) return setError(tx('auth.enterCode'))
    setBusy('verify')
    const { error } = await supabase.auth.verifyOtp({ email, token: value, type: 'email' })
    setBusy(null)
    if (error) setError(/expired|invalid/i.test(error.message) ? tx('auth.wrongCode') : friendlyError(error))
    // on success, the auth listener updates the session and <Navigate> takes over
  }

  return (
    <div className="min-h-dvh bg-bg md:grid md:grid-cols-[1.1fr_1fr]">
      {/* brand panel */}
      <section className="relative overflow-hidden bg-hero px-6 pb-12 pt-[calc(env(safe-area-inset-top)+2.5rem)] text-white max-md:rounded-b-[2.5rem] md:flex md:flex-col md:justify-center md:px-16">
        <div aria-hidden className="absolute -right-24 -top-28 size-80 rounded-full bg-hero-2" />
        <div aria-hidden className="absolute -bottom-16 -left-10 size-48 rounded-full bg-accent/15" />
        <div className="relative mx-auto w-full max-w-md md:mx-0">
          <div className="flex items-center gap-3">
            <img src="/pwa-192.png" alt="" className="size-12 rounded-2xl shadow-pop" />
            <div>
              <p className="text-lg font-bold leading-tight">JEC Alumni Connect</p>
              <p className="text-sm text-hero-text">{tx('brand.college')}</p>
            </div>
          </div>
          <h2 className="mt-8 text-[32px] font-extrabold leading-[1.1] tracking-tight md:text-5xl">{tx('auth.tagline1')}<br />{tx('auth.tagline2')}</h2>
          <p className="mt-3 max-w-sm text-hero-text">{tx('auth.sub')}</p>
          <ul className="mt-6 flex flex-wrap gap-2 text-sm font-semibold">
            {(['auth.chip1', 'auth.chip2', 'auth.chip3'] as const).map((k) => (
              <li key={k} className="rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/15">{tx(k)}</li>
            ))}
          </ul>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-md flex-col px-5 pb-safe md:justify-center md:px-10">
      <div className="flex-1 pt-8 md:flex-none md:pt-0">
        <div className="mb-5 flex justify-end">
          <LanguageSwitch compact />
        </div>
        {step === 'choose' && (
          <>
            <h1 className="text-[26px] font-bold leading-tight tracking-tight">{tx('auth.welcome')}</h1>
            <p className="mt-2 text-muted">{tx('auth.welcomeBody')}</p>
            <div className="mt-8 space-y-3">
              <Button variant="secondary" size="lg" block icon={<GoogleLogo />} loading={busy === 'google'} onClick={() => oauth('google')}>
                {tx('auth.google')}
              </Button>
              <Button variant="secondary" size="lg" block icon={<LinkedInIcon />} loading={busy === 'linkedin_oidc'} onClick={() => oauth('linkedin_oidc')}>
                {tx('auth.linkedin')}
              </Button>
              <Button variant="ghost" size="lg" block icon={<Mail className="size-5" />} onClick={() => setStep('email')}>
                {tx('auth.useEmail')}
              </Button>
            </div>
          </>
        )}

        {step === 'email' && (
          <form onSubmit={sendCode} noValidate>
            <button type="button" className="-ml-2 mb-4 inline-flex min-h-11 items-center gap-1 px-2 text-primary" onClick={() => setStep('choose')}>
              <ArrowLeft className="size-4" /> {tx('common.back')}
            </button>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight">{tx('auth.emailTitle')}</h1>
            <p className="mt-2 text-muted">{tx('auth.emailBody')}</p>
            <div className="mt-6 space-y-4">
              <Field label={tx('auth.emailLabel')}>
                {(p) => (
                  <Input
                    {...p}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoFocus
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                )}
              </Field>
              <Button type="submit" size="lg" block loading={busy === 'email'}>
                {tx('auth.sendCode')}
              </Button>
            </div>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={verify} noValidate>
            <button type="button" className="-ml-2 mb-4 inline-flex min-h-11 items-center gap-1 px-2 text-primary" onClick={() => setStep('email')}>
              <ArrowLeft className="size-4" /> {tx('auth.changeEmail')}
            </button>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight">{tx('auth.checkEmail')}</h1>
            <p className="mt-2 text-muted">
              {tx('auth.codeSentTo')} <strong className="text-text">{email}</strong>{tx('auth.codeSentTail')}
            </p>
            <div className="mt-6 space-y-4">
              <Field label={tx('auth.codeLabel')}>
                {(p) => (
                  <Input
                    {...p}
                    ref={codeRef}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="123456"
                    className="text-center text-2xl font-semibold tracking-[0.4em]"
                    value={code}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                      setCode(v)
                      if (v.length === 6) void verify(undefined, v)
                    }}
                  />
                )}
              </Field>
              <Button type="submit" size="lg" block loading={busy === 'verify'}>
                {tx('auth.signIn')}
              </Button>
              <Button variant="ghost" block disabled={resendIn > 0 || busy !== null} onClick={() => sendCode()}>
                {resendIn > 0 ? tx('auth.resendIn', { n: resendIn }) : tx('auth.resend')}
              </Button>
            </div>
          </form>
        )}

        {error && <Notice tone="danger" className="mt-5" title={error} />}
      </div>
      <p className="py-6 text-center text-sm text-muted">
        {tx('auth.agree')} <a className="inline-flex min-h-11 items-center text-primary underline" href="/privacy">{tx('reg.privacyNotice')}</a>.
      </p>
      </div>
    </div>
  )
}

export function AuthCallbackPage() {
  const tx = useT()
  const { session, loading } = useAuth()
  const [params] = useSearchParams()
  const [timedOut, setTimedOut] = useState(false)
  const errorDescription = params.get('error_description')

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 12000)
    return () => clearTimeout(t)
  }, [])

  if (session) return <Navigate to={safeNext(params.get('next'))} replace />
  if (errorDescription || (timedOut && !loading)) {
    return (
      <div className="mx-auto max-w-md p-6 pt-20">
        <Notice tone="danger" title={tx('auth.cbFail')}>
          {errorDescription ?? tx('auth.tryAgain')}
        </Notice>
        <a href="/signin" className="mt-6 inline-block font-semibold text-primary">
          {tx('auth.backToSignIn')}
        </a>
      </div>
    )
  }
  return (
    <div className="grid min-h-dvh place-items-center text-muted" role="status">
      {tx('auth.signingIn')}
    </div>
  )
}
