import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { isValidPkMobile, PK_MOBILE_HINT } from '../lib/phone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { auth } from '../services/api';
import nieteLogo from '@/assets/niete-logo.png';
import { ArrowLeft } from 'lucide-react';

const PortalPasswordReset = () => {
  const location = useLocation();
  // bd-2512: seeded from the login screen when the user came via "Forgot
  // password?". Editable — a pre-fill is a default, not a lock — and empty
  // when this page is opened directly.
  const [phoneNumber, setPhoneNumber] = useState(location.state?.phoneNumber ?? '');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!phoneNumber.trim()) {
      toast({
        title: "Phone Number Required",
        description: "Please enter your phone number",
        variant: "destructive"
      });
      return;
    }

    // bd-2511: catch a dropped digit here rather than letting the lookup miss
    // and report the account as non-existent.
    if (!isValidPkMobile(phoneNumber)) {
      toast({
        title: "Check the phone number",
        description: PK_MOBILE_HINT,
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      await auth.requestReset(phoneNumber);
      toast({
        title: "Code Sent",
        description: "A 6-digit code has been sent to your WhatsApp"
      });
      navigate('/portal/reset-password/verify', { state: { phoneNumber } });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.error || "Failed to send reset code",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-secondary flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="mb-6 text-center">
            <img 
              src={nieteLogo} 
              alt="NIETE logo" 
              className="h-12 mx-auto mb-4"
            />
            <h1 className="text-2xl font-bold text-foreground mb-2">
              Reset Password
            </h1>
            <p className="text-sm text-muted-foreground">
              Enter your phone number to receive a reset code via WhatsApp
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="phoneNumber">Phone Number</Label>
              <Input
                id="phoneNumber"
                type="tel"
                placeholder="03XX XXXXXXX"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                disabled={loading}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                e.g. 0336 1234567
              </p>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? "Sending..." : "Send Reset Code"}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => navigate('/portal/login')}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Login
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default PortalPasswordReset;
