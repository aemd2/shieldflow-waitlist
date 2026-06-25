import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

// Protected route: the recovery link signs the user in via /api/auth/confirm
// before redirecting here; without a session the middleware bounces to /login.
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
