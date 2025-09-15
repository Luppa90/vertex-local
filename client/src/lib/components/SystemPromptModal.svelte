<!-- /client/src/lib/components/SystemPromptModal.svelte -->

<script lang="ts">
  import { isSystemPromptModalOpen, conversationStore } from '$lib/store';

  let localSystemPrompt = '';
  let isLoading = false;

  $: if ($isSystemPromptModalOpen) {
    localSystemPrompt = $conversationStore.systemPrompt || '';
  }

  function handleClose() {
    isSystemPromptModalOpen.set(false);
  }

  // --- THE FIX: Added keyboard handler for backdrop ---
  function handleBackdropKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      handleClose();
    }
  }

  async function handleSave() {
    if (!$conversationStore.id) return;
    isLoading = true;
    try {
      const response = await fetch(`http://localhost:3001/api/conversations/${$conversationStore.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt: localSystemPrompt })
      });
      if (!response.ok) throw new Error('Failed to save system prompt');
      conversationStore.update(store => ({ ...store, systemPrompt: localSystemPrompt }));
      handleClose();
    } catch (error) {
      console.error(error);
      alert('Error saving system prompt. Please check the console.');
    } finally {
      isLoading = false;
    }
  }
</script>

{#if $isSystemPromptModalOpen}
  <!-- THE FIX: Added role, tabindex, and on:keydown for accessibility -->
  <div 
    class="backdrop" 
    on:click={handleClose} 
    on:keydown={handleBackdropKeydown}
    role="button"
    tabindex="0"
    aria-label="Close modal"
  ></div>

  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <h2 id="modal-title">System Prompt</h2>
    <p>Provide a system prompt to guide the model's behavior for this conversation.</p>
    
    <textarea
      bind:value={localSystemPrompt}
      rows="8"
      placeholder="e.g., You are a helpful assistant that speaks like a pirate."
      disabled={isLoading}
    ></textarea>

    <div class="actions">
      <button class="secondary" on:click={handleClose} disabled={isLoading}>Cancel</button>
      <button class="primary" on:click={handleSave} disabled={isLoading}>
        {isLoading ? 'Saving...' : 'Save'}
      </button>
    </div>
  </div>
{/if}

<style>
  .backdrop{position:fixed;top:0;left:0;width:100%;height:100%;background-color:rgba(0,0,0,.7);z-index:10}.modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:20;background-color:var(--background-secondary);border-radius:12px;padding:2rem;width:90%;max-width:600px;box-shadow:0 5px 15px rgba(0,0,0,.5)}h2{margin-top:0;color:var(--text-primary)}p{color:var(--text-secondary)}textarea{width:100%;background-color:var(--background-primary);border:1px solid var(--border-color);border-radius:8px;padding:.75rem;color:var(--text-primary);font-family:inherit;font-size:1rem;resize:vertical;margin-top:1rem}.actions{margin-top:1.5rem;display:flex;justify-content:flex-end;gap:1rem}.actions button{padding:.6rem 1.2rem;border:none;border-radius:8px;font-weight:500;cursor:pointer;transition:opacity .2s}.actions button:disabled{opacity:.5;cursor:not-allowed}.primary{background-color:var(--accent-color);color:var(--background-primary)}.secondary{background-color:var(--background-tertiary);color:var(--text-primary)}
</style>