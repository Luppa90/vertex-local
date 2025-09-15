// src/lib/store.ts

import { writable } from 'svelte/store';

// --- Types ---
interface ConversationState {
  id: number | null;
  title: string | null;
  model: string | null;
  systemPrompt: string | null;
}

// --- Stores ---

/**
 * Holds the state of the currently active conversation.
 * Components can subscribe to this to get updates.
 */
export const conversationStore = writable<ConversationState>({
  id: null,
  title: null,
  model: null,
  systemPrompt: null
});

/**
 * A simple boolean store to control the visibility of the system prompt modal.
 */
export const isSystemPromptModalOpen = writable<boolean>(false);