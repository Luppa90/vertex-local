<!-- /client/src/routes/history/+page.svelte -->

<script lang="ts">
  import type { PageData } from './$types';

  export let data: PageData;
  
  let conversations = data.conversations || [];
  let searchQuery = '';
  let isSearching = false;
  let debounceTimer: number;

  async function performSearch() {
    isSearching = true;
    if (!searchQuery.trim()) {
      // If search is cleared, refetch all conversations
      conversations = data.conversations || [];
      isSearching = false;
      return;
    }

    try {
      const response = await fetch(`http://localhost:3001/api/search?q=${encodeURIComponent(searchQuery)}`);
      if (!response.ok) throw new Error('Search request failed');
      conversations = await response.json();
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      isSearching = false;
    }
  }

  function handleSearchInput() {
    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      performSearch();
    }, 300); // 300ms debounce
  }
</script>

<div class="history-container">
  <header class="history-header">
    <h1>Conversation History</h1>
    <a href="/" class="new-chat-button">New Chat</a>
  </header>
  
  <div class="search-wrapper">
    <input
      type="text"
      placeholder="Search inside all conversations..."
      bind:value={searchQuery}
      on:input={handleSearchInput}
    />
  </div>

  <div class="conversation-list">
    {#if conversations.length > 0}
      {#each conversations as convo (convo.id)}
        <a href={`/chat/${convo.id}`} class="convo-item">
          <span class="title">{convo.title}</span>
          <span class="date">{new Date(convo.created_at).toLocaleString()}</span>
        </a>
      {/each}
    {:else if isSearching}
      <p class="empty-state">Searching...</p>
    {:else}
      <p class="empty-state">No conversations found.</p>
    {/if}
  </div>
</div>

<style>
  .history-container {
    max-width: 900px;
    margin: 0 auto;
    padding: 1rem;
  }
  .history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }
  h1 {
    color: var(--text-primary);
    margin: 0;
  }
  .new-chat-button {
    background-color: var(--accent-color);
    color: var(--background-primary);
    padding: 0.6rem 1.2rem;
    border-radius: 8px;
    text-decoration: none;
    font-weight: 500;
  }
  .search-wrapper input {
    width: 100%;
    padding: 0.8rem 1rem;
    font-size: 1rem;
    background-color: var(--background-secondary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    color: var(--text-primary);
    margin-bottom: 2rem;
  }
  .convo-item {
    display: flex;
    justify-content: space-between;
    padding: 1rem;
    border-radius: 8px;
    background-color: var(--background-secondary);
    text-decoration: none;
    color: var(--text-primary);
    transition: background-color 0.2s;
  }
  .convo-item:hover {
    background-color: var(--background-tertiary);
  }
  .conversation-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .convo-item .title {
    font-weight: 500;
  }
  .convo-item .date {
    color: var(--text-secondary);
    font-size: 0.9em;
  }
  .empty-state {
    text-align: center;
    color: var(--text-secondary);
    padding: 2rem;
  }
</style>