// /client/src/routes/+page.server.ts

import { redirect, error as svelteKitError } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
  console.log("Root page server load executing...");

  try {
    // This `try` block is now ONLY for the network request.
    const response = await fetch('http://localhost:3001/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'New Chat',
        model: 'gemini-2.5-pro'
      })
    });

    if (!response.ok) {
      // This is a REAL error. We'll throw a proper SvelteKit error.
      throw svelteKitError(response.status, 'Backend failed to create a new conversation.');
    }

    const newConversation = await response.json();
    
    // --- THE FIX ---
    // If the fetch was successful, we get the ID and throw the redirect
    // OUTSIDE of the try...catch block's direct scope. The `catch` below
    // will now only catch true network failures (like the server being down).
    throw redirect(307, `/chat/${newConversation.id}`);

  } catch (err) {
    // This `catch` will now only handle actual errors, like the `fetch` failing
    // or the `svelteKitError` we threw above. It will NOT catch the `redirect`.
    
    // If the error is a `Redirect` object that somehow slipped through, re-throw it.
    if (err && typeof err === 'object' && 'status' in err && 'location' in err) {
      throw err;
    }
    
    console.error("A critical error occurred while creating a new chat:", err);
    throw svelteKitError(500, 'Could not start a new chat session due to a server error.');
  }
};