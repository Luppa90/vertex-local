<!-- /client/src/routes/+layout.svelte -->
<script lang="ts">
  import '../app.css';
  import { isSystemPromptModalOpen, conversationStore } from '$lib/store';
  import SystemPromptModal from '$lib/components/SystemPromptModal.svelte';
  import { page } from '$app/stores';

  function openSystemPromptModal() {
    if ($conversationStore.id) {
      isSystemPromptModalOpen.set(true);
    }
  }

  // NEW: Function to handle model change
  async function handleModelChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const newModel = select.value;
    const convoId = $conversationStore.id;

    if (convoId && newModel) {
      // Update the store immediately for UI responsiveness
      conversationStore.update(s => ({ ...s, model: newModel }));
      
      // Update the backend
      try {
        await fetch(`http://localhost:3001/api/conversations/${convoId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: newModel })
        });
      } catch (error) {
        console.error("Failed to update model:", error);
        // Optionally revert the change in the store on failure
      }
    }
  }
</script>

<SystemPromptModal />

<div class="app-container">
  <header class="navbar">
    <div class="navbar-left">
      <a href="/history" class="nav-button">History</a>
      <a href="/" class="nav-button">New Chat</a>
    </div>

    <div class="navbar-right">
      <button class="nav-button" on:click={openSystemPromptModal} disabled={!$page.route.id?.startsWith('/chat/')} title={$page.route.id?.startsWith('/chat/') ? "Edit system prompt" : "Only available in a chat"}>
        System Prompt
      </button>

      <!-- UPDATED: Select is now functional -->
      <select 
        class="model-selector" 
        disabled={!$page.route.id?.startsWith('/chat/')}
        bind:value={$conversationStore.model}
        on:change={handleModelChange}
      >
        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
      </select>
    </div>
  </header>

  <main class="main-content">
    <slot />
  </main>
</div>

<style>
  .app-container{display:flex;flex-direction:column;height:100vh;width:100vw;overflow:hidden;padding:0 2rem}.navbar{display:flex;justify-content:space-between;align-items:center;padding:1rem 0;border-bottom:1px solid var(--border-color);flex-shrink:0}.navbar-left,.navbar-right{display:flex;align-items:center;gap:1rem}.nav-button,.model-selector{background-color:var(--background-secondary);color:var(--text-primary);border:none;padding:.5rem 1rem;border-radius:8px;font-family:inherit;font-size:.9rem;cursor:pointer;text-decoration:none;transition:background-color .2s,opacity .2s}.nav-button:disabled,.model-selector:disabled{opacity:.4;cursor:not-allowed}.model-selector{padding-right:2.5rem;-webkit-appearance:none;-moz-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%23909090' viewBox='0 0 16 16'%3E%3Cpath fill-rule='evenodd' d='M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right .75rem center}.nav-button:not(:disabled):hover,.model-selector:not(:disabled):hover{background-color:var(--background-tertiary)}.main-content{flex-grow:1;overflow-y:auto;padding:1.5rem 0}
</style>