// lib/client/AppContext.tsx — session and cart state, server-backed.
//
// The important difference from v1: the cart lives in the DATABASE, not in a
// reducer, and the session comes from /api/auth/me rather than
// `window.__sellerSession`. So the cart survives a refresh and follows the
// customer across devices, and the client cannot invent a role for itself.
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import api, { ApiClientError, type CartGroup, type CartTotals, type SessionUser } from './api';

interface AppState {
  user: SessionUser | null;
  authLoading: boolean;
  unreadNotifications: number;

  cartGroups: CartGroup[];
  cartTotals: CartTotals | null;
  cartIssues: Array<{ cartItemId: string; productName: string; problem: string }>;
  cartLoading: boolean;
  cartItemCount: number;
}

interface AppActions {
  refreshUser: () => Promise<SessionUser | null>;
  login: (email: string, password: string) => Promise<{ user: SessionUser; redirectTo: string }>;
  logout: () => Promise<void>;
  refreshCart: () => Promise<void>;
  addToCart: (productId: string, quantity?: number, variantId?: string | null) => Promise<void>;
  setCartQuantity: (cartItemId: string, quantity: number) => Promise<void>;
  removeFromCart: (cartItemId: string) => Promise<void>;
  clearCart: () => Promise<void>;
  /** Cart lines in the shape checkout accepts: ids and quantities only. */
  checkoutItems: () => Array<{ productId: string; variantId?: string | null; quantity: number }>;
}

type AppContextValue = AppState & AppActions;

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [unreadNotifications, setUnread] = useState(0);

  const [cartGroups, setCartGroups] = useState<CartGroup[]>([]);
  const [cartTotals, setCartTotals] = useState<CartTotals | null>(null);
  const [cartIssues, setCartIssues] = useState<AppState['cartIssues']>([]);
  const [cartLoading, setCartLoading] = useState(false);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.auth.me();
      setUser(data.user);
      setUnread(data.unreadNotifications ?? 0);
      return data.user;
    } catch {
      // A failed /me simply means "not signed in" — never a hard error.
      setUser(null);
      return null;
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const refreshCart = useCallback(async () => {
    // Only customers have a cart; don't poll it for sellers or admins.
    if (!user || user.role !== 'CUSTOMER') {
      setCartGroups([]);
      setCartTotals(null);
      setCartIssues([]);
      return;
    }
    setCartLoading(true);
    try {
      const data = await api.cart.get();
      setCartGroups(data.groups ?? []);
      setCartTotals(data.totals ?? null);
      setCartIssues(data.issues ?? []);
    } catch {
      setCartGroups([]);
      setCartTotals(null);
    } finally {
      setCartLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    void refreshCart();
  }, [refreshCart]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api.auth.login(email, password);
      setUser(result.user);
      return result;
    },
    [],
  );

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    setUser(null);
    setCartGroups([]);
    setCartTotals(null);
    setUnread(0);
  }, []);

  const addToCart = useCallback(
    async (productId: string, quantity = 1, variantId?: string | null) => {
      await api.cart.add(productId, quantity, variantId);
      await refreshCart();
    },
    [refreshCart],
  );

  const setCartQuantity = useCallback(
    async (cartItemId: string, quantity: number) => {
      await api.cart.setQuantity(cartItemId, quantity);
      await refreshCart();
    },
    [refreshCart],
  );

  const removeFromCart = useCallback(
    async (cartItemId: string) => {
      await api.cart.remove(cartItemId);
      await refreshCart();
    },
    [refreshCart],
  );

  const clearCart = useCallback(async () => {
    await api.cart.clear();
    await refreshCart();
  }, [refreshCart]);

  const checkoutItems = useCallback(
    () =>
      cartGroups.flatMap((g) =>
        g.lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          quantity: l.quantity,
        })),
      ),
    [cartGroups],
  );

  const cartItemCount = cartTotals?.itemCount ?? 0;

  const value = useMemo<AppContextValue>(
    () => ({
      user,
      authLoading,
      unreadNotifications,
      cartGroups,
      cartTotals,
      cartIssues,
      cartLoading,
      cartItemCount,
      refreshUser,
      login,
      logout,
      refreshCart,
      addToCart,
      setCartQuantity,
      removeFromCart,
      clearCart,
      checkoutItems,
    }),
    [
      user, authLoading, unreadNotifications, cartGroups, cartTotals, cartIssues,
      cartLoading, cartItemCount, refreshUser, login, logout, refreshCart,
      addToCart, setCartQuantity, removeFromCart, clearCart, checkoutItems,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

/** Turns any thrown value into a message safe to show a person. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

export { ApiClientError };
