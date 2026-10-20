import { describeSignInError } from '@ambarci/shared';
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';

interface AuthState {
  session: Session | null;
  /** Güvenli depodaki oturum okunana kadar true. */
  isLoading: boolean;
  /** Başarılıysa null, değilse kullanıcıya gösterilecek hata mesajı döner. */
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  return error ? describeSignInError(error) : null;
}

async function signOut(): Promise<void> {
  // Yalnızca bu cihazdaki oturum kapanır; web paneldeki oturum açık kalır.
  await supabase.auth.signOut({ scope: 'local' });
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setIsLoading(false);
      }
    });
    // Giriş, çıkış ve token yenilemesinde oturum güncellenir.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    // Uygulama ön plandayken token süresi dolmadan yenilenir; arka plandayken yenileme durur.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void supabase.auth.startAutoRefresh();
      } else {
        void supabase.auth.stopAutoRefresh();
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
      appState.remove();
    };
  }, []);

  const value = useMemo<AuthState>(() => ({ session, isLoading, signIn, signOut }), [session, isLoading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth yalnızca AuthProvider içinde kullanılabilir.');
  }
  return context;
}
