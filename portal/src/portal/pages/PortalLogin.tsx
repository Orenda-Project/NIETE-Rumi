import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { isLeader } from '../lib/leaderRole';
import { isValidPkMobile, PK_MOBILE_HINT } from '../lib/phone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import nieteLogo from '@/assets/niete-logo.png';

const PortalLogin = () => {
  const navigate = useNavigate();
  // `sessionLoading` is deliberately distinct from the `loading` state below,
  // which tracks the submit button. One is "is there already a session?", the
  // other is "is this form mid-submit".
  const { login, user, loading: sessionLoading } = useAuth();
  const { toast } = useToast();

  // bd-2569: never show a login form to someone who is already signed in.
  //
  // The OTA app boots straight to /portal/login — that path is compiled into
  // the APK — which bypasses "/" (PortalRoot), the route that reads the
  // session and forwards an authenticated user onward. So a teacher whose
  // session was perfectly valid got the login form on every cold start and
  // reasonably concluded the app had logged them out.
  //
  // The session cookie is httpOnly, so this page cannot inspect a token
  // itself; useAuth already asks the server on mount, and this waits for that
  // answer. Same rule as PortalRoot: leaders go to My Patch, teachers to the
  // dashboard.
  useEffect(() => {
    if (sessionLoading || !user) return;
    navigate(isLeader(user) ? '/portal/leader' : '/portal/dashboard', { replace: true });
  }, [user, sessionLoading, navigate]);
  
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!phoneNumber || !password) {
      toast({ title: "Missing Fields", description: "Please enter both phone number and password.", variant: "destructive" });
      return;
    }

    // bd-2511: a wrong-length number otherwise reaches the server, misses the
    // lookup, and comes back as "No portal account found" — which reads as
    // "you have no account" when the teacher just dropped a digit.
    if (!isValidPkMobile(phoneNumber)) {
      toast({ title: "Check the phone number", description: PK_MOBILE_HINT, variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const result = await login(phoneNumber, password);
      if (result.success) {
        // bd-2434: school leaders go straight to My Patch, not the teacher dashboard.
        const dest = isLeader(result.user) ? '/portal/leader' : '/portal/dashboard';
        toast({ title: "Welcome back!", description: "Redirecting…" });
        setTimeout(() => navigate(dest), 1000);
      } else {
        toast({ title: "Login Failed", description: result.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Render nothing until the session is known, then either the redirect above
  // fires or there is genuinely no session and the form is the right answer.
  // Flashing the form and yanking it away looks worse than the bug it fixes.
  if (sessionLoading || user) return null;

  return (
    <div className="min-h-screen bg-primary niete-lattice flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <img src={nieteLogo} alt="NIETE logo" className="w-10 h-10 object-contain" />
            <h1 className="text-3xl sm:text-4xl font-light text-primary-foreground">NIETE Portal</h1>
          </div>
          <p className="text-primary-foreground/80">For teachers and coaches — sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg p-8 shadow-[var(--shadow-medium)]">
          <div className="space-y-6">
            <div>
              <label htmlFor="phoneNumber" className="block text-sm font-medium text-foreground mb-2">
                Phone Number
              </label>
              <Input
                id="phoneNumber"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="03XX XXXXXXX"
                className="w-full"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">e.g. 0336 1234567</p>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-2">
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full"
                required
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-accent hover:bg-accent/90"
              size="lg"
              disabled={loading}
            >
              {loading ? 'Logging in...' : 'Log In'}
            </Button>

            <div className="text-center mt-6">
              <button
                type="button"
                className="text-sm text-accent hover:text-accent/80 transition-colors"
                // bd-2512: carry whatever they already typed, so the reset
                // screen does not ask for the same number a second time.
                onClick={() => navigate('/portal/reset-password', { state: { phoneNumber } })}
              >
                Forgot password?
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PortalLogin;
