<script lang="ts">
  import { tick, onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import type { PageData } from './$types';
  import { conversationStore } from '$lib/store';
  import CodeBlock from '$lib/components/CodeBlock.svelte';

  export let data: PageData;
  interface Message { id: number; role: 'user' | 'model'; content: string; }
  
  interface MessagePart { type: 'text' | 'code'; value: string; language?: string; }
  
  let messages: Message[] = data.messages || [];
  let conversationId: number = data.conversationId;
  
  $: if (data && !data.error) {
    conversationStore.set({ id: data.conversationId, title: data.title, model: data.model, systemPrompt: data.systemPrompt });
  }

  let prompt: string = '';
  let isLoading: boolean = false;
  let textareaElement: HTMLTextAreaElement;
  let chatLogElement: HTMLDivElement;
  
  let editingMessageId: number | null = null;
  let editingContent: string = '';
  let typewriterQueue: string[] = [];
  let typewriterInterval: number;
  let totalTokens: number = 0;
  
  onMount(() => {
    scrollToBottom();
    startTypewriter();
    updateTokenCount();
    return () => clearInterval(typewriterInterval);
  });
  
  beforeNavigate(async ({ to }) => {
    if (messages.length === 0 && to?.route.id !== `/chat/${conversationId}`) {
        await fetch(`http://localhost:3001/api/conversations/${conversationId}`, { method: 'DELETE' });
    }
    if (to?.route.id !== `/chat/${conversationId}`) {
        conversationStore.set({ id: null, title: null, model: null, systemPrompt: null });
    }
  });
  
  function parseMessageContent(content: string): MessagePart[] {
    const parts: MessagePart[] = [];
    // This regex specifically looks for Markdown-style code blocks:
    // ```language
    // ... code ...
    // ```
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)\n```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
        // Add any text that appeared before this code block
        if (match.index > lastIndex) {
            parts.push({ type: 'text', value: content.substring(lastIndex, match.index) });
        }
        
        // Add the code block itself
        // match[1] is the captured language identifier (e.g., 'javascript')
        // match[2] is the captured code content
        parts.push({ type: 'code', language: match[1] || 'plaintext', value: match[2] });
        
        // Update the index to the end of the matched code block
        lastIndex = match.index + match[0].length;
    }

    // Add any remaining text after the last code block
    if (lastIndex < content.length) {
        parts.push({ type: 'text', value: content.substring(lastIndex) });
    }

    // If no code blocks were found, return the entire content as a single text part
    if (parts.length === 0) {
      return [{ type: 'text', value: content }];
    }

    return parts.filter(part => part.value.length > 0);
  }
  
  async function updateTokenCount() {
      if (!$conversationStore.model || !conversationId) return;
      const messagesToCount = [...messages, ...(prompt.trim() ? [{ id: 0, role: 'user' as const, content: prompt }] : [])];
      try {
          const response = await fetch(`http://localhost:3001/api/conversations/${conversationId}/count-tokens`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ messages: messagesToCount, model: $conversationStore.model })
          });
          if (!response.ok) return;
          const data = await response.json();
          totalTokens = data.totalTokens;
      } catch (error) { console.error("Token count failed:", error); }
  }

  function startTypewriter() {
    typewriterInterval = window.setInterval(() => {
      if (typewriterQueue.length > 0 && !isLoading) {
        const chunk = typewriterQueue.splice(0, 10).join('');
        messages[messages.length - 1].content += chunk;
        if (chatLogElement.scrollHeight - chatLogElement.clientHeight <= chatLogElement.scrollTop + 5) {
          scrollToBottom();
        }
      }
    }, 1);
  }

  // --- START: REWORKED LOGIC ---
  async function generateResponse(userPrompt?: string) {
    isLoading = true;

    // The current `messages` array is the source of truth.
    // If there's a new prompt, add it to the history we'll send.
    let messagesForApi = [...messages];
    if (userPrompt) {
      const newUserMessage = { id: Date.now(), role: 'user' as const, content: userPrompt };
      messages = [...messages, newUserMessage]; // Update UI immediately
      messagesForApi.push(newUserMessage); // Add to payload for the API
    }

    // Generate a title for the first exchange
    if (userPrompt && messages.length === 1) { 
      // Note: We check for length 1 now, because model response isn't back yet.
      fetch(`http://localhost:3001/api/conversations/${conversationId}/generate-title`, { method: 'POST' })
        .then(res => res.json()).then(data => { if (data.title) conversationStore.update(s => ({ ...s, title: data.title })); });
    }
    
    // Add a placeholder for the model's response to the UI
    messages = [...messages, { id: Date.now() + 1, role: 'model', content: '' }];
    
    // Clear the input if a prompt was submitted
    if (userPrompt) {
      prompt = ''; 
      setTimeout(() => adjustTextareaHeight(textareaElement), 0);
    }
    
    await tick();
    updateTokenCount();

    try {
      // Send the client's "source of truth" history to the server.
      const response = await fetch(`http://localhost:3001/api/chat/${conversationId}`, { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ messages: messagesForApi }) // Send the curated message list
      });

      if (!response.ok || !response.body) throw new Error(`API request failed`);
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        typewriterQueue.push(...decoder.decode(value, { stream: true }).split(''));
      }
    } catch (error) { 
      console.error(error); 
      messages[messages.length - 1].content = 'Sorry, something went wrong.'; 
    } finally { 
      isLoading = false; 
      updateTokenCount(); 
    }
  }

  async function handleSubmit() {
    if (!prompt.trim() || isLoading || !conversationId) return;
    generateResponse(prompt);
  }
  
  async function startEditing(message: Message) { 
    editingMessageId = message.id; 
    editingContent = message.content; 
    await tick();
    const activeTextarea = chatLogElement.querySelector('.edit-textarea') as HTMLTextAreaElement;
    if (activeTextarea) {
      adjustTextareaHeight(activeTextarea);
      activeTextarea.focus();
    }
  }

  function cancelEditing() { editingMessageId = null; editingContent = ''; }

  async function saveEdit() {
    if (editingMessageId === null) return;
    const messageIdToUpdate = editingMessageId;
    const newContent = editingContent;
    const messageIndex = messages.findIndex(m => m.id === messageIdToUpdate);
    
    if (messageIndex === -1) return;

    // Create the new, truncated history in the local state.
    const isFollowedByModel = (messageIndex < messages.length - 1) && messages[messageIndex + 1].role === 'model';
    const updatedMessage = { ...messages[messageIndex], content: newContent };
    
    // The new history is everything up to the edited message, plus the edited message itself.
    messages = [...messages.slice(0, messageIndex), updatedMessage];

    cancelEditing();
    
    // Only regenerate if there was a model response to replace.
    // Otherwise, the user is just editing the last message and we give control back.
    if (isFollowedByModel) {
      // Calling generateResponse() will send the new, correct, truncated history to the server.
      // The server's reconciliation logic will handle the rest.
      generateResponse(); 
    } else {
        // If we only edited the last message, we still need to inform the server.
        // We can do this by calling the chat endpoint, which will reconcile the state.
        // Or, for a simpler approach, we could patch the single message.
        // Let's use the reconciliation for consistency.
        try {
            isLoading = true;
            await fetch(`http://localhost:3001/api/chat/${conversationId}/reconcile`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: messages })
            });
        } catch (error) {
            console.error("Failed to reconcile state after edit:", error);
        } finally {
            isLoading = false;
            updateTokenCount();
        }
    }
  }
  // --- END: REWORKED LOGIC ---

  async function handleDelete(messageId: number) {
    const originalMessages = messages;
    messages = messages.filter(m => m.id !== messageId);
    try { 
        await fetch(`http://localhost:3001/api/messages/${messageId}`, { method: 'DELETE' }); 
        updateTokenCount(); 
    } catch (error) { 
        console.error("Failed to delete:", error); 
        messages = originalMessages; // Revert on failure
    } 
  }

  async function handleBranch(messageId: number) {
    try {
      const response = await fetch('http://localhost:3001/api/conversations/branch', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ sourceConversationId: conversationId, sourceMessageId: messageId }) 
      });
      if (!response.ok) throw new Error('Branching failed');
      const { newConversationId } = await response.json();
      window.open(`/chat/${newConversationId}`, '_blank');
    } catch (error) { console.error("Branching failed:", error); alert("Could not create branch."); }
  }
  
  function handleMainKeydown(event: KeyboardEvent) {
    // User requirement: Submit on Ctrl+Enter.
    // The default behavior for Enter alone in a textarea is to create a newline,
    // which is the desired behavior here, so we don't need to handle it.
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault(); // Prevent adding a newline on submit
      handleSubmit();
    }
  }

  function handleEditKeydown(event: KeyboardEvent) {
    // User requirement: Submit edit on Ctrl+Enter.
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault(); // Prevent adding a newline on save
      saveEdit();
    }
    // Standard UX: Cancel edit on Escape key.
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
    }
  }

  async function scrollToBottom() { await tick(); if (chatLogElement) chatLogElement.scrollTop = chatLogElement.scrollHeight; }
  function adjustTextareaHeight(el: HTMLElement) { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }
</script>

<svelte:head> <title>{$conversationStore.title || 'Vertex Chat'}</title> </svelte:head>

<div class="chat-page-container">
  <div class="chat-log" bind:this={chatLogElement}>
    {#if messages.length > 0}
      {#each messages as message (message.id)}
        <div class="message" class:user={message.role === 'user'} class:model={message.role === 'model'}>
          <div class="message-content">
            <div class="message-actions">
              {#if message.role === 'user'}
                <button class="action-button" aria-label="Edit message" title="Edit" on:click={() => startEditing(message)}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325"/></svg></button>
              {/if}
              <button class="action-button" aria-label="Branch from here" title="Branch" on:click={() => handleBranch(message.id)}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M11.5 3.5a.5.5 0 0 1 .5.5v1.5a.5.5 0 0 1-1 0V5.707L8.354 8.854a.5.5 0 0 1-.708 0L6 7.207V10.5a.5.5 0 0 1-1 0V7.207L3.354 8.854a.5.5 0 1 1-.708-.708l3-3a.5.5 0 0 1 .708 0L8 6.793l2.646-2.647a.5.5 0 0 1 .354-.146zM4.5 2A.5.5 0 0 0 4 2.5v10.5a.5.5 0 0 0 1 0V2.5A.5.5 0 0 0 4.5 2z"/></svg></button>
              <button class="action-button" aria-label="Delete message" title="Delete" on:click={() => handleDelete(message.id)}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg></button>
            </div>
            
            {#if editingMessageId === message.id}
              <div class="edit-wrapper">
                <textarea class="message-text edit-textarea" bind:value={editingContent} on:input={(e) => adjustTextareaHeight(e.currentTarget)} on:keydown={handleEditKeydown}></textarea>
                <div class="edit-actions">
                  <button class="edit-button" on:click={cancelEditing}>Cancel</button>
                  <button class="edit-button save" on:click={saveEdit}>Save</button>
                </div>
              </div>
            {:else if message.content}
              {#if message.role === 'model'}
                {#each parseMessageContent(message.content) as part}
                  {#if part.type === 'text'}
                    <p class="message-text">{part.value}</p>
                  {:else if part.type === 'code'}
                    <CodeBlock code={part.value} language={part.language} />
                  {/if}
                {/each}
              {:else}
                <p class="message-text">{message.content}</p>
              {/if}
            {:else}
              <div class="thinking-placeholder">...</div>
            {/if}
          </div>
        </div>
      {/each}
    {:else}
      <div class="empty-chat-prompt">Start a new conversation</div>
    {/if}
  </div>

  <form class="chat-input-area" on:submit|preventDefault={handleSubmit}>
    <div class="input-wrapper">
      <textarea bind:this={textareaElement} bind:value={prompt} on:input={(e) => adjustTextareaHeight(e.currentTarget)} on:keydown={handleMainKeydown} disabled={isLoading} rows="1" placeholder={isLoading ? "Generating..." : "Enter a prompt... (Shift+Enter for newline)"}></textarea>
      <button type="submit" class="send-button" disabled={isLoading || (prompt.trim() === '' && (messages.length === 0 || messages[messages.length - 1].role === 'model'))} aria-label="Submit" title="Submit"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></button>
    </div>
    <div class="input-footer">
        <span class="token-counter">Tokens: {totalTokens}</span>
    </div>
  </form>
</div>

<style>
  .message-text {
    margin: 0;
    padding: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
  }
  .message-text:not(:last-child) {
    margin-bottom: 1rem;
  }
  .chat-log{margin-top:1rem}.chat-page-container{display:flex;flex-direction:column;height:100%;max-width:900px;margin:0 auto}.chat-log{flex-grow:1;overflow-y:auto;padding:0 1rem;display:flex;flex-direction:column;gap:1.5rem;scroll-behavior:smooth}.message{position:relative;display:flex;max-width:95%}.message.user{align-self:flex-end;flex-direction:row-reverse}.message.model{align-self:flex-start}.message-content{padding:.75rem 1.25rem;border-radius:18px;position:relative;width:100%;line-height:1.6;}.message.user .message-content{background-color:var(--accent-color);color:#131314;border-bottom-right-radius:4px}.message.model .message-content{background-color:var(--background-secondary);border-bottom-left-radius:4px;min-height:2.5rem}.thinking-placeholder{color:var(--text-secondary);animation:blink 1.5s infinite}@keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}.message-actions{position:absolute;top:-12px;display:flex;gap:.5rem;opacity:0;visibility:hidden;transition:opacity .2s;z-index:5}.message:hover .message-actions{opacity:1;visibility:visible}.message.user .message-actions{right:10px}.message.model .message-actions{right:10px}.action-button{background-color:var(--background-tertiary);border:1px solid var(--border-color);color:var(--text-secondary);border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer}.action-button:hover{color:var(--text-primary);background-color:#3c4043}
  .edit-wrapper{display:flex;flex-direction:column;gap:.5rem}
  .edit-textarea{
    width: 100%;
    resize: vertical;
    background-color: transparent;
    color: inherit;
    border: none;
    outline: none;
    padding: 0;
  }
  .edit-textarea:focus {
    box-shadow: 0 0 0 2px var(--accent-color);
    border-radius: 4px;
    margin: -2px;
    padding: 2px;
  }
  .edit-actions{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.5rem}.edit-button{background-color:transparent;border:1px solid var(--border-color);color:var(--text-primary);padding:.25rem .75rem;border-radius:6px;cursor:pointer}.edit-button.save{background-color:var(--accent-color);color:var(--background-primary);border-color:var(--accent-color)}
  .chat-input-area{padding:1.5rem 0 1rem 0;flex-shrink:0}.input-wrapper{display:flex;align-items:flex-end;background-color:var(--background-secondary);border-radius:16px;padding:.75rem}textarea{flex-grow:1;background:transparent;border:none;outline:none;color:var(--text-primary);font-family:inherit;font-size:1rem;resize:none;max-height:250px;line-height:1.6;padding:0 .75rem}.send-button{background-color:var(--accent-color);border:none;border-radius:10px;width:38px;height:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:opacity .2s,background-color .2s}.send-button svg{color:var(--background-primary)}textarea:disabled,.send-button:disabled{opacity:.5;cursor:not-allowed}.send-button:not(:disabled):hover{background-color:#a1c4f8}.empty-chat-prompt{margin:auto;color:var(--text-secondary);font-size:1.2rem}
  .input-footer{display:flex;justify-content:flex-end;padding:.5rem 1rem 0 1rem}.token-counter{font-size:.8rem;color:var(--text-secondary)}
</style>