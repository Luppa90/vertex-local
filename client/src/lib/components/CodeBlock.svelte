<!-- /client/src/lib/components/CodeBlock.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import hljs from 'highlight.js/lib/core';
  // Import a default style. You can change this to any theme from highlight.js/styles
  import 'highlight.js/styles/github-dark.css';

  // Import specific languages to keep the bundle size down
  import javascript from 'highlight.js/lib/languages/javascript';
  import python from 'highlight.js/lib/languages/python';
  import bash from 'highlight.js/lib/languages/bash';
  import css from 'highlight.js/lib/languages/css';
  import html from 'highlight.js/lib/languages/xml'; // xml includes html
  import typescript from 'highlight.js/lib/languages/typescript';
  import json from 'highlight.js/lib/languages/json';
  import shell from 'highlight.js/lib/languages/shell';
  
  // Register the languages
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('js', javascript);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('py', python);
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('html', html);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('ts', typescript);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('shell', shell);
  hljs.registerLanguage('sh', shell);

  export let code: string;
  export let language: string | undefined;

  let codeElement: HTMLElement;
  let copyText = 'Copy';

  // Use a Svelte action to apply highlighting
  function highlight(node: HTMLElement) {
    // Trim leading/trailing newlines that the model often adds
    const codeToHighlight = node.textContent?.trim() || '';
    node.textContent = codeToHighlight;
    hljs.highlightElement(node);
  }

  async function copyToClipboard() {
    if (!navigator.clipboard) {
      copyText = 'Error';
      return;
    }
    try {
      await navigator.clipboard.writeText(code.trim());
      copyText = 'Copied!';
      setTimeout(() => (copyText = 'Copy'), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      copyText = 'Failed';
      setTimeout(() => (copyText = 'Copy'), 2000);
    }
  }
</script>

<div class="code-block-wrapper">
  <div class="header">
    <span class="language-name">{language || 'code'}</span>
    <button on:click={copyToClipboard} class="copy-button">
      {copyText}
    </button>
  </div>
  <pre><code class="language-{language || 'plaintext'}" use:highlight>{code}</code></pre>
</div>

<style>
  .code-block-wrapper {
    background-color: #0d1117; /* A common dark code background */
    border-radius: 8px;
    margin: 1rem 0;
    overflow: hidden;
    border: 1px solid var(--border-color);
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: #161b22;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--border-color);
  }

  .language-name {
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  .copy-button {
    background: none;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    padding: 0.25rem 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.2s ease;
  }
  .copy-button:hover {
    background-color: var(--background-tertiary);
    color: var(--text-primary);
  }

  pre {
    margin: 0;
    padding: 1rem;
    overflow-x: auto;
  }

  /*
    The `code` tag gets styling from the imported highlight.js CSS theme.
    We just set a default font-family here.
  */
  code {
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 0.9em;
  }
</style>