import { createClient, type Session } from '@supabase/supabase-js';

const projectUrl = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (typeof projectUrl !== 'string' || projectUrl.length === 0) {
  throw new Error('VITE_SUPABASE_URL is required.');
}
if (typeof publishableKey !== 'string' || publishableKey.length === 0) {
  throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is required.');
}

const supabase = createClient(projectUrl, publishableKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export async function currentSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session;
}

export function onSessionChange(listener: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => listener(session));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string): Promise<{ session: Session | null; error: boolean }> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { session: data.session, error: error !== null };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function refreshSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) return null;
  return data.session;
}
