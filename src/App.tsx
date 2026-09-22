import { Navigate, Route, Routes } from 'react-router-dom';
import Home from './auth/Home';
import SignInLanding from './auth/SignInLanding';
import PhoneSignIn from './auth/PhoneSignIn';
import EmailSignInAdmin from './auth/EmailSignInAdmin';
import CompleteProfile from './auth/CompleteProfile';
import RequireAuth from './auth/RequireAuth';
import CreateChama from './onboarding/CreateChama';
import ClaimInvite from './onboarding/ClaimInvite';
import { ChamaProvider } from './app/ChamaProvider';
import AppShell from './app/AppShell';
import Dashboard from './app/Dashboard';
import Members from './features/members/Members';
import LoanProducts from './features/loans/LoanProducts';
import Loans from './features/loans/Loans';
import Contributions from './features/contributions/Contributions';
import MgrPots from './features/mgr/MgrPots';
import MgrPotDetail from './features/mgr/MgrPotDetail';
import Minutes from './features/minutes/Minutes';
import Payments from './features/payments/Payments';
import Communication from './features/communication/Communication';
import Billing from './features/billing/Billing';
import Reports from './features/reports/Reports';
import Settings from './features/settings/Settings';
import Messages from './features/messages/Messages';
import Hero from './marketing/Hero';
import { useAuth } from './auth/AuthProvider';

function Root() {
  const { user, authReady } = useAuth();
  if (!authReady) return null;
  return user ? <Home /> : <Hero />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/signin" element={<SignInLanding />} />
      <Route path="/signin/phone" element={<PhoneSignIn />} />
      <Route path="/signin/admin" element={<EmailSignInAdmin />} />
      <Route path="/claim/:chamaId/:inviteId" element={<ClaimInvite />} />

      <Route
        path="/complete-profile"
        element={
          <RequireAuth>
            <CompleteProfile />
          </RequireAuth>
        }
      />
      <Route
        path="/create-chama"
        element={
          <RequireAuth>
            <CreateChama />
          </RequireAuth>
        }
      />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <ChamaProvider>
              <AppShell />
            </ChamaProvider>
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="members" element={<Members />} />
        <Route path="loan-products" element={<LoanProducts />} />
        <Route path="loans" element={<Loans />} />
        <Route path="contributions" element={<Contributions />} />
        <Route path="mgr" element={<MgrPots />} />
        <Route path="mgr/:potId" element={<MgrPotDetail />} />
        <Route path="minutes" element={<Minutes />} />
        <Route path="payments" element={<Payments />} />
        <Route path="communication" element={<Communication />} />
        <Route path="reports" element={<Reports />} />
        <Route path="billing" element={<Billing />} />
        <Route path="settings" element={<Settings />} />
        <Route path="messages" element={<Messages />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
