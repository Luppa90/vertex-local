// /client/src/routes/history/+page.ts

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
  try {
    const response = await fetch('http://localhost:3001/api/conversations');
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    const conversations = await response.json();
    return { conversations };
  } catch (error) {
    console.error('Failed to fetch conversation history:', error);
    return { conversations: [], error: 'Could not load history.' };
  }
};