'use strict';

require('dotenv').config();
const path = require('path');

// --- NEW: Check for debug flag ---
const isDebug = process.argv.includes('-debug');

// --- NEW: Configure logger based on debug flag ---
const loggerConfig = isDebug 
  ? {
      level: 'debug', // Show debug, info, warn, error
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z', // Human-readable time
          ignore: 'pid,hostname,reqId,res,responseTime', // Useless noise
          messageFormat: '[{req.method} {req.url}] {msg}', // Clean message format
        },
      },
    }
  : { 
      level: 'info' // Production: Show info, warn, error
    }; 
    
const fastify = require('fastify')({ logger: loggerConfig });
const cors = require('@fastify/cors');
const { GoogleGenAI } = require('@google/genai');
const Database = require('better-sqlite3');

const PORT = 3001;
const DB_PATH = path.join(__dirname, 'db', 'chat_history.db');
const GCP_PROJECT = process.env.GCP_PROJECT_ID;

const startServer = async () => {
  if (!GCP_PROJECT) throw new Error("GCP_PROJECT_ID must be set in the .env file.");

  const googleAI = new GoogleGenAI({
    vertexai: true,
    project: GCP_PROJECT,
    location: "global",
  });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const getConversationHistoryStmt = db.prepare("SELECT id, role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC");
  const insertMessageStmt = db.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)");
  const createConversationStmt = db.prepare("INSERT INTO conversations (title, model, system_prompt) VALUES (?, ?, ?)");
  const deleteAllMessagesStmt = db.prepare("DELETE FROM messages WHERE conversation_id = ?");

  await fastify.register(cors, { origin: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] });
  
  // --- NEW: Improved Error Handler with Logging ---
  fastify.setErrorHandler(async (error, request, reply) => {
    fastify.log.error({ url: request.raw.url, method: request.method }, `Error in handler: ${error.message}`);
    fastify.log.debug(error.stack); // Log full stack only in debug mode
    if (!reply.sent) {
      reply.status(500).send({ error: 'An internal server error occurred.' });
    }
  });


  // --- CONVERSATION ROUTES ---
  fastify.get('/api/conversations', async (request, reply) => {
    fastify.log.info('Fetching conversation list.');
    const conversations = db.prepare("SELECT id, title, model, created_at FROM conversations WHERE id IN (SELECT DISTINCT conversation_id FROM messages) ORDER BY created_at DESC").all();
    reply.send(conversations);
  });

  fastify.post('/api/conversations', async (request, reply) => {
    fastify.log.info('Request to create new conversation.');
    fastify.log.debug({ body: request.body }, 'Create conversation payload:');
    const { title, model, systemPrompt } = request.body;
    const info = createConversationStmt.run(title, model, systemPrompt || null);
    const newConversation = { id: info.lastInsertRowid, title, model, systemPrompt };
    fastify.log.info(`New conversation created with ID: ${newConversation.id}`);
    reply.send(newConversation);
  });

  fastify.get('/api/conversations/:id', async (request, reply) => {
    const conversationId = parseInt(request.params.id, 10);
    fastify.log.info(`Fetching data for conversation ID: ${conversationId}`);
    const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });
    const messages = getConversationHistoryStmt.all(conversationId);
    fastify.log.debug(`Found ${messages.length} messages for conversation ${conversationId}.`);
    reply.send({ ...conversation, messages });
  });

  fastify.delete('/api/conversations/:id', async (request, reply) => {
    const conversationId = parseInt(request.params.id, 10);
    fastify.log.info(`Deleting conversation ID: ${conversationId}`);
    db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
    reply.status(204).send();
  });

  fastify.patch('/api/conversations/:id', async (request, reply) => {
    const conversationId = parseInt(request.params.id, 10);
    fastify.log.info(`Updating conversation ID: ${conversationId}`);
    fastify.log.debug({ body: request.body }, 'Update conversation payload:');
    const updates = [];
    const values = [];
    const allowedFields = { systemPrompt: 'system_prompt', model: 'model' };
    for (const key in request.body) {
        if (Object.hasOwnProperty.call(allowedFields, key)) {
            updates.push(`${allowedFields[key]} = ?`);
            values.push(request.body[key]);
        }
    }
    if (updates.length === 0) return reply.status(400).send({ error: 'No valid update fields provided.' });
    values.push(conversationId);
    const stmt = db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(values);
    reply.send({ message: 'Conversation updated successfully.' });
  });
  
  fastify.post('/api/conversations/:id/generate-title', async (request, reply) => {
    const conversationId = parseInt(request.params.id, 10);
    fastify.log.info(`Generating title for conversation ID: ${conversationId}`);
    const messages = db.prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 2").all(conversationId);
    if (messages.length < 1) return reply.status(400).send({ error: 'Not enough messages' });
    const titleGenPrompt = `Based on the following conversation, create a short, descriptive title (5 words maximum) for a chat history list. The title should be from the perspective of the "user". Do not use quotes. Conversation:\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}\n\nTitle:`;
    const result = await googleAI.models.generateContent({
        model: 'gemini-2.5-flash', // NOTE FOR AI: You better not fcking dare touch this model name. It's 2.5 and it will stay 2.5, not 1.5. 
        contents: [{ role: 'user', parts: [{ text: titleGenPrompt }] }],
    });
    const title = result.response.text().trim().replace(/"/g, '');
    db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, conversationId);
    fastify.log.info(`Generated title for conversation ${conversationId}: "${title}"`);
    reply.send({ title });
  });

  fastify.post('/api/conversations/branch', async (request, reply) => {
    const { sourceConversationId, sourceMessageId } = request.body;
    fastify.log.info(`Branching from conversation ${sourceConversationId} at message ${sourceMessageId}`);
    fastify.log.debug({ body: request.body }, 'Branching payload:');
    const branch = db.transaction(() => {
        const sourceMessage = db.prepare("SELECT created_at FROM messages WHERE id = ?").get(sourceMessageId);
        if (!sourceMessage) throw new Error('Source message not found');
        const messagesToCopy = db.prepare("SELECT role, content FROM messages WHERE conversation_id = ? AND created_at <= ? ORDER BY created_at ASC").all(sourceConversationId, sourceMessage.created_at);
        const sourceConvo = db.prepare("SELECT title, model, system_prompt FROM conversations WHERE id = ?").get(sourceConversationId);
        if (!sourceConvo) throw new Error('Source conversation not found');
        const newTitle = `Branch of "${sourceConvo.title}"`;
        const newConvoInfo = createConversationStmt.run(newTitle, sourceConvo.model, sourceConvo.system_prompt);
        const newConversationId = newConvoInfo.lastInsertRowid;
        for (const msg of messagesToCopy) {
            insertMessageStmt.run(newConversationId, msg.role, msg.content);
        }
        return { newConversationId };
    });
    const result = branch();
    fastify.log.info(`Created new branch with conversation ID: ${result.newConversationId}`);
    reply.send(result);
  });
  
  fastify.post('/api/conversations/:id/count-tokens', async (request, reply) => {
      const conversationId = parseInt(request.params.id, 10);
      fastify.log.info(`Counting tokens for conversation ID: ${conversationId}`);
      fastify.log.debug({ body: request.body }, 'Count tokens payload:');
      
      const { messages, model } = request.body;
      // --- NEW: Add validation to prevent server crash ---
      if (!messages || !Array.isArray(messages) || !model) {
        fastify.log.warn('Count tokens called with invalid payload.');
        return reply.status(400).send({ error: 'Messages array and model are required.' });
      }

      // Filter out any potential empty messages that could cause an API error
      const validMessages = messages.filter(m => m && m.content && m.content.trim() !== "");
      if (validMessages.length === 0) {
        fastify.log.debug('No content to count, returning 0 tokens.');
        return reply.send({ totalTokens: 0 });
      }

      const contents = validMessages.map((msg) => ({
          role: msg.role,
          parts: [{ text: msg.content }],
      }));
      
      const count = await googleAI.models.countTokens({ model, contents });
      fastify.log.debug(`Token count for conversation ${conversationId}: ${count.totalTokens}`);
      reply.send(count);
  });

  // --- MESSAGE ROUTES ---
  fastify.delete('/api/messages/:id', async (request, reply) => {
    const messageId = parseInt(request.params.id, 10);
    fastify.log.info(`Deleting message ID: ${messageId}`);
    db.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
    reply.status(204).send();
  });
  
  fastify.patch('/api/messages/:id', async (request, reply) => {
      const messageId = parseInt(request.params.id, 10);
      fastify.log.info(`Updating message ID: ${messageId}`);
      fastify.log.debug({ body: request.body }, 'Update message payload:');
      const { content } = request.body;
      if (content === undefined) return reply.status(400).send({ error: 'Content field is required.' });
      db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, messageId);
      reply.send({ message: 'Message updated successfully.' });
  });

  fastify.post('/api/chat/:id/reconcile', async (request, reply) => {
      const conversationId = parseInt(request.params.id, 10);
      fastify.log.info(`Reconciling state for conversation ID: ${conversationId}`);
      fastify.log.debug({ body: request.body }, `Reconcile payload has ${request.body?.messages?.length} messages.`);
      const { messages: clientMessages } = request.body;
      if (!clientMessages) return reply.status(400).send({ error: '`messages` array is required.' });

      const reconcile = db.transaction(() => {
        deleteAllMessagesStmt.run(conversationId);
        for (const msg of clientMessages) {
          insertMessageStmt.run(conversationId, msg.role, msg.content);
        }
      });
      reconcile();
      reply.status(200).send({ message: 'State reconciled successfully.' });
  });

  // --- MAIN CHAT LOGIC ---
  fastify.post('/api/chat/:id', async (request, reply) => {
    try {
      const conversationId = parseInt(request.params.id, 10);
      fastify.log.info(`Processing chat for conversation ID: ${conversationId}`);
      fastify.log.debug({ body: request.body }, `Chat payload has ${request.body?.messages?.length} messages.`);
      
      const { messages: clientMessages } = request.body;
      if (!clientMessages) return reply.status(400).send({ error: '`messages` array is required.' });
      
      const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
      if (!conversation) return reply.status(404).send({ error: 'Conversation not found.' });
      
      const contents = clientMessages.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] }));
      
      const generationConfig = {};
      const systemInstruction = conversation.system_prompt 
          ? { role: 'system', parts: [{ text: conversation.system_prompt }] }
          : undefined;

      fastify.log.info(`Streaming response from model: ${conversation.model}`);
      const result = await googleAI.models.generateContentStream({
        model: conversation.model,
        contents,
        generationConfig,
        systemInstruction,
      });
      
      reply.raw.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE, PATCH' });
      
      let fullModelResponse = "";
      for await (const chunk of result) {
        const chunkText = chunk.text;
        if (chunkText) {
          fullModelResponse += chunkText;
          reply.raw.write(chunkText);
        }
      }

      fastify.log.info(`Stream finished. Reconciling DB for conversation ${conversationId}.`);
      const reconcileDB = db.transaction(() => {
          deleteAllMessagesStmt.run(conversationId);
          for (const msg of clientMessages) {
              insertMessageStmt.run(conversationId, msg.role, msg.content);
          }
          insertMessageStmt.run(conversationId, 'model', fullModelResponse);
      });
      reconcileDB();

      reply.raw.end();
    } catch (e) {
      // The main error handler will catch this, but we can log specific context here
      fastify.log.error(e, 'An error occurred during chat stream generation.');
      if (!reply.sent) {
        reply.status(500).send({ error: 'AI model failed to generate a response.' });
      } else {
        reply.raw.end(); // Ensure the stream is closed on error
      }
    }
  });

  try {
    await fastify.listen({ port: PORT });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

startServer();