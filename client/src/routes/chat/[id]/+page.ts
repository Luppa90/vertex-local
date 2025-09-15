// src/routes/chat/[id]/+page.ts
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch, depends }) => {
  const conversationId = parseInt(params.id, 10);

  depends(`conversation:${params.id}`);

  try {
    const response = await fetch(`http://localhost:3001/api/conversations/${conversationId}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch conversation: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      messages: data.messages,
      conversationId: data.id,
      title: data.title,
      model: data.model,
      systemPrompt: data.system_prompt
    };
  } catch (error) {
    console.error("Error loading conversation:", error);
    return { error: 'Could not load conversation history.' };
  }
};