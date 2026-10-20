import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const TOKEN_KEY = "session.token";

type SessionState = {
  token: string | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export const useSessionStore = create<SessionState>((set) => ({
  token: null,
  hydrated: false,
  hydrate: async () => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    set({ token, hydrated: true });
  },
  signIn: async (token) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    set({ token });
  },
  signOut: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    set({ token: null });
  },
}));
