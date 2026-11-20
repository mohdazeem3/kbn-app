import { useState } from 'react';
import { Eye, EyeOff, Leaf, Loader2, LogIn, Mail } from 'lucide-react';
import { useAuth } from '@/lib/auth';

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function LoginPage() {
  const { signIn, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!isEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setBusy(true);
    const { error: err } = await signIn(email, password);
    setBusy(false);
    if (err) setError(err);
  };

  const forgot = async () => {
    setError(null);
    setNotice(null);
    if (!isEmail(email)) {
      setError('Enter your email address first, then tap Forgot password.');
      return;
    }
    setBusy(true);
    const { error: err } = await resetPassword(email);
    setBusy(false);
    if (err) {
      setError(err);
    } else {
      setNotice(`Reset instructions sent to ${email.trim()}. Please check your inbox.`);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-leaf-600 text-white shadow-card">
            <Leaf className="h-9 w-9" strokeWidth={2.25} aria-hidden />
          </span>
          <h1 className="font-display mt-5 text-3xl font-semibold text-leaf-950">
            KBN MART
          </h1>
          <p className="mt-2 text-lg text-leaf-700">
            Sign in to manage your stock, sales and customers.
          </p>
        </div>

        <div className="rounded-2xl border border-leaf-100 bg-white p-8 shadow-card">
          <form onSubmit={submit} className="space-y-5" noValidate>
            {error && (
              <div
                role="alert"
                className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-base font-semibold text-red-800"
              >
                {error}
              </div>
            )}
            {notice && (
              <div
                role="status"
                className="rounded-xl border-2 border-leaf-300 bg-leaf-50 px-4 py-3 text-base font-semibold text-leaf-900"
              >
                {notice}
              </div>
            )}

            <label className="block">
              <span className="mb-1.5 block text-sm font-bold text-leaf-900">Email address</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-leaf-500" aria-hidden />
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border-2 border-leaf-200 bg-white py-3 pl-12 pr-4 text-base text-leaf-950 placeholder:text-stone-400 transition-colors focus:border-leaf-500 focus:outline-none"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-bold text-leaf-900">Password</span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border-2 border-leaf-200 bg-white px-4 py-3 pr-24 text-base text-leaf-950 placeholder:text-stone-400 transition-colors focus:border-leaf-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-bold text-leaf-700 hover:bg-leaf-50"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" aria-hidden />
                  ) : (
                    <Eye className="h-5 w-5" aria-hidden />
                  )}
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={forgot}
                className="text-base font-bold text-mango-700 hover:text-mango-800 hover:underline"
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-leaf-600 px-6 py-4 text-lg font-extrabold text-white shadow-sm transition-colors hover:bg-leaf-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Signing in…
                </>
              ) : (
                <>
                  <LogIn className="h-5 w-5" strokeWidth={2.5} aria-hidden /> Sign In
                </>
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-leaf-600">
          Trouble signing in? Contact the shop owner who manages this account.
        </p>
      </div>
    </div>
  );
}
