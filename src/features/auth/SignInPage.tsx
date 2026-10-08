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
      setError('Please enter a valid email address.')
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
    if (!/^\d{6}$/.test(value)) return setError('Enter the 6-digit code from the email.')
    setBusy('verify')
    const { error } = await supabase.auth.verifyOtp({ email, token: value, type: 'email' })
    setBusy(null)
    if (error) setError(/expired|invalid/i.test(error.message) ? 'That code is wrong or has expired. Check the latest email or send a new code.' : friendlyError(error))
    // on success, the auth listener updates the session and <Navigate> takes over
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-safe pb-safe">
      <div className="flex-1 pt-14">
        <div className="mb-8 flex items-center gap-3">
          <img src="/pwa-192.png" alt="" className="size-12 rounded-2xl" />
          <div>
            <p className="text-lg font-bold leading-tight">JEC Alumni Connect</p>
            <p className="text-sm text-muted">Jabalpur Engineering College</p>
          </div>
        </div>

        {step === 'choose' && (
          <>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight">Welcome, JECian</h1>
            <p className="mt-2 text-muted">Sign in to register for the Alumni Meet and reconnect with your batch. No password needed.</p>
            <div className="mt-8 space-y-3">
              <Button variant="secondary" size="lg" block icon={<GoogleLogo />} loading={busy === 'google'} onClick={() => oauth('google')}>
                Continue with Google
              </Button>
              <Button variant="secondary" size="lg" block icon={<LinkedInIcon />} loading={busy === 'linkedin_oidc'} onClick={() => oauth('linkedin_oidc')}>
                Continue with LinkedIn
              </Button>
              <Button variant="ghost" size="lg" block icon={<Mail className="size-5" />} onClick={() => setStep('email')}>
                Use my email instead
              </Button>
            </div>
          </>
        )}

        {step === 'email' && (
          <form onSubmit={sendCode} noValidate>
            <button type="button" className="-ml-2 mb-4 inline-flex min-h-11 items-center gap-1 px-2 text-primary" onClick={() => setStep('choose')}>
              <ArrowLeft className="size-4" /> Back
            </button>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight">Sign in with email</h1>
            <p className="mt-2 text-muted">We’ll email you a 6-digit code.</p>
            <div className="mt-6 space-y-4">
              <Field label="Email address">
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
                Send code
              </Button>
            </div>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={verify} noValidate>
            <button type="button" className="-ml-2 mb-4 inline-flex min-h-11 items-center gap-1 px-2 text-primary" onClick={() => setStep('email')}>
              <ArrowLeft className="size-4" /> Change email
            </button>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight">Check your email</h1>
            <p className="mt-2 text-muted">
              Enter the 6-digit code we sent to <strong className="text-text">{email}</strong>. It may take a minute; check Spam too.
            </p>
            <div className="mt-6 space-y-4">
              <Field label="6-digit code">
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
                Sign in
              </Button>
              <Button variant="ghost" block disabled={resendIn > 0 || busy !== null} onClick={() => sendCode()}>
                {resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
              </Button>
            </div>
          </form>
        )}

        {error && <Notice tone="danger" className="mt-5" title={error} />}
      </div>
      <p className="py-6 text-center text-sm text-muted">
        By continuing you agree to our <a className="text-primary underline" href="/privacy">privacy notice</a>.
      </p>
    </div>
  )
}

export function AuthCallbackPage() {
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
        <Notice tone="danger" title="Sign-in didn’t complete">
          {errorDescription ?? 'Please try again.'}
        </Notice>
        <a href="/signin" className="mt-6 inline-block font-semibold text-primary">
          Back to sign in
        </a>
      </div>
    )
  }
  return (
    <div className="grid min-h-dvh place-items-center text-muted" role="status">
      Signing you in…
    </div>
  )
}
