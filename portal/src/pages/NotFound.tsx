import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import nieteLogo from "@/assets/niete-logo.png";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary p-6">
      <div className="text-center max-w-md">
        <img src={nieteLogo} alt="NIETE" className="mx-auto mb-6 h-16 w-16 rounded" />
        <h1 className="mb-2 text-5xl font-semibold text-primary-foreground">404</h1>
        <p className="mb-6 text-lg text-primary-foreground/80">
          We couldn't find that page in the NIETE Teacher Portal.
        </p>
        <a
          href="/portal/login"
          className="inline-block rounded-md bg-accent px-5 py-2.5 text-accent-foreground hover:opacity-90 transition"
        >
          Go to portal login
        </a>
      </div>
    </div>
  );
};

export default NotFound;
