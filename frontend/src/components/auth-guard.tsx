"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  getMe,
  logout as logoutApi,
  type UserInfo,
} from "@/lib/api";
import { AuthDialog } from "@/components/auth-dialog";

// ── Context ──

interface AuthContextValue {
  user: UserInfo | null;
  loading: boolean;
  isAuthenticated: boolean;
  requireAuth: () => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  isAuthenticated: false,
  requireAuth: async () => false,
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

// ── Provider ──

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingResolve, setPendingResolve] = useState<
    ((value: boolean) => void) | null
  >(null);

  // Check for existing session on mount (cookie is sent automatically)
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const me = await getMe();
        setUser(me);
      } catch {
        // Not authenticated — that's fine
      }
      setLoading(false);
    };
    checkAuth();
  }, []);

  const requireAuth = useCallback(async (): Promise<boolean> => {
    // Already authenticated
    if (user) return true;

    // Try checking session (cookie might exist from another tab)
    try {
      const me = await getMe();
      setUser(me);
      return true;
    } catch {
      // Not authenticated
    }

    // Open dialog and wait for result
    return new Promise<boolean>((resolve) => {
      setPendingResolve(() => resolve);
      setDialogOpen(true);
    });
  }, [user]);

  const handleAuthSuccess = useCallback(
    (loggedInUser: UserInfo) => {
      setUser(loggedInUser);
      if (pendingResolve) {
        pendingResolve(true);
        setPendingResolve(null);
      }
    },
    [pendingResolve]
  );

  const handleDialogClose = useCallback(
    (open: boolean) => {
      setDialogOpen(open);
      if (!open && pendingResolve) {
        pendingResolve(false);
        setPendingResolve(null);
      }
    },
    [pendingResolve]
  );

  const handleLogout = useCallback(async () => {
    await logoutApi();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        requireAuth,
        logout: handleLogout,
      }}
    >
      {children}
      <AuthDialog
        open={dialogOpen}
        onOpenChange={handleDialogClose}
        onSuccess={handleAuthSuccess}
      />
    </AuthContext.Provider>
  );
}
