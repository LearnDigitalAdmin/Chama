import { Link } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import GoogleSignIn from './GoogleSignIn';

export default function SignInLanding() {
  return (
    <AuthLayout title="Sign in to MyChama">
      <Link
        to="/signin/phone"
        className="btn-primary font-semibold px-4 py-2.5 rounded-full text-center transition-colors"
      >
        Continue with phone (members)
      </Link>

      <GoogleSignIn />

      <div className="flex items-center gap-3 text-xs text-forest-900/40">
        <span className="flex-1 h-px bg-forest-100" />
        or
        <span className="flex-1 h-px bg-forest-100" />
      </div>

      <Link to="/signin/admin" className="text-sm font-semibold text-forest-700 hover:text-forest-800 text-center">
        I'm an admin — sign in with email
      </Link>
    </AuthLayout>
  );
}
