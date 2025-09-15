'use strict';

require('dotenv').config();
const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const { VertexAI } = require('@google-cloud/vertexai');
const Database = require('better-sqlite3');
const path = require('path');

const PORT = 3001;
const DB_PATH = path.join(__dirname, 'db', 'chat_history.db');
const GCP_PROJECT = process.env.GCP_PROJECT_ID;
const GCP_LOCATION = process.env.GCP_LOCATION;

const startServer = async () => {
  if (!GCP_PROJECT || !GCP_LOCATION) throw new Error("GCP_PROJECT_ID and GCP_LOCATION must be set in the .env file.");
  const vertexAI = new VertexAI({ project: GCP_PROJECT, location: GCP_LOCATION });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const getConversationHistoryStmt = db.prepare("SELECT id, role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC");
  const insertMessageStmt = db.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)");
  const createConversationStmt = db.prepare("INSERT INTO conversations (title, model, system_prompt) VALUES (?, ?, ?)");
  // --- NEW: Statement for deleting all messages in a conversation ---
  const deleteAllMessagesStmt = db.prepare("DELETE FROM messages WHERE conversation_id = ?");


  await fastify.register(cors, { origin: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] });

  // --- CONVERSATION ROUTES ---
  fastify.get('/api/conversations', (request, reply) => {
    try {
      const conversations = db.prepare("SELECT id, title, model, created_at FROM conversations WHERE id IN (SELECT DISTINCT conversation_id FROM messages) ORDER BY created_at DESC").all();
      reply.send(conversations);
    } catch (e) { fastify.log.error(e); reply.status(500).send({e:'Failed to list convos'})}
  });
  fastify.post('/api/conversations', async (request, reply) => {
    const { title, model, systemPrompt } = request.body;
    try {
      const info = createConversationStmt.run(title, model, systemPrompt || null);
      reply.send({ id: info.lastInsertRowid, title, model, systemPrompt });
    } catch (e) { fastify.log.error(e); reply.status(500).send({e:'Failed to create convo'})}
  });
  fastify.get('/api/conversations/:id', (request, reply) => {
    const conversationId = parseInt(request.params.id, 10);
    try {
        const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
        if (!conversation) return reply.status(404).send({ error: 'Convo not found' });
        const messages = getConversationHistoryStmt.all(conversationId);
        reply.send({ ...conversation, messages });
    } catch (e) { fastify.log.error(e); reply.status(500).send({e:'Failed to get convo'})}
  });
  fastify.delete('/api/conversations/:id', (request, reply) => {
    try {
        db.prepare("DELETE FROM conversations WHERE id = ?").run(parseInt(request.params.id, 10));
        reply.status(204).send();
    } catch (e) { fastify.log.error(e); reply.status(500).send({e:'Failed to delete convo'})}
  });

  fastify.patch('/api/conversations/:id', (request, reply) => {
    const conversationId = parseInt(request.params.id, 10);
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
    
    try {
        const stmt = db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`);
        stmt.run(values);
        reply.send({ message: 'Conversation updated successfully.' });
    } catch (e) {
        fastify.log.error(e);
        reply.status(500).send({ error: 'Failed to update conversation.' });
    }
  });
  
  fastify.post('/api/conversations/:id/generate-title', async (request, reply) => {
    const conversationId = parseInt(request.params.id, 10);
    try {
      const messages = db.prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 2").all(conversationId);
      if (messages.length < 1) return reply.status(400).send({ error: 'Not enough messages' });
      const titleGenPrompt = `Based on the following conversation, create a short, descriptive title (5 words maximum) for a chat history list. The title should be from the perspective of the "user". Do not use quotes. Conversation:\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}\n\nTitle:`;
      const generativeModel = vertexAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await generativeModel.generateContent(titleGenPrompt);
      const title = result.response.candidates[0].content.parts[0].text.trim().replace(/"/g, '');
      db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, conversationId);
      reply.send({ title });
    } catch (e) { fastify.log.error(e); reply.status(500).send({e:'Failed to generate title'}); }
  });

  fastify.post('/api/conversations/branch', (request, reply) => {
    const { sourceConversationId, sourceMessageId } = request.body;
    if (!sourceConversationId || !sourceMessageId) {
        return reply.status(400).send({ error: 'sourceConversationId and sourceMessageId are required.' });
    }

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

    try {
        const result = branch();
        reply.send(result);
    } catch (e) {
        fastify.log.error(e);
        reply.status(500).send({ error: 'Failed to create branch.' });
    }
  });
  
  fastify.post('/api/conversations/:id/count-tokens', async (request, reply) => {
      const { messages, model } = request.body;
      if (!messages || !model) return reply.status(400).send({ error: 'Messages and model are required.' });
      
      const contents = messages.map((msg) => ({
          role: msg.role,
          parts: [{ text: msg.content }],
      }));

      try {
          const generativeModel = vertexAI.getGenerativeModel({ model: model });
          const count = await generativeModel.countTokens({ contents });
          reply.send(count);
      } catch (e) {
          fastify.log.error(e);
          reply.status(500).send({ error: 'Failed to count tokens.' });
      }
  });

  // --- MESSAGE ROUTES ---
  fastify.delete('/api/messages/:id', (request, reply) => {
    try {
      db.prepare("DELETE FROM messages WHERE id = ?").run(parseInt(request.params.id, 10));
      reply.status(204).send();
    } catch (e) { fastify.log.error(e); reply.status(500).send({e:'Failed to delete message'})}
  });
  
  // NOTE: This PATCH endpoint is now less critical due to the reconciliation logic, but still useful.
  fastify.patch('/api/messages/:id', (request, reply) => {
      const { content } = request.body;
      if (content === undefined) return reply.status(400).send({ error: 'Content field is required.' });
      try {
          db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, parseInt(request.params.id, 10));
          reply.send({ message: 'Message updated successfully.' });
      } catch (e) { fastify.log.error(e); reply.status(500).send({ error: 'Failed to update message.' }); }
  });

  // --- NEW: A non-streaming endpoint just for state reconciliation without AI generation ---
  fastify.post('/api/chat/:id/reconcile', (request, reply) => {
      const conversationId = parseInt(request.params.id, 10);
      const { messages: clientMessages } = request.body;
      if (!clientMessages) return reply.status(400).send({ error: '`messages` array is required.' });

      try {
        const reconcile = db.transaction(() => {
          deleteAllMessagesStmt.run(conversationId);
          for (const msg of clientMessages) {
            insertMessageStmt.run(conversationId, msg.role, msg.content);
          }
        });
        reconcile();
        reply.status(200).send({ message: 'State reconciled successfully.' });
      } catch (e) {
        fastify.log.error(`Reconciliation error: ${e.message}`);
        reply.status(500).send({ e: 'Failed to reconcile database state.' });
      }
  });

  // --- START: REWORKED CHAT LOGIC ---
  fastify.post('/api/chat/:id', async (request, reply) => {
    const conversationId = parseInt(request.params.id, 10);
    const { messages: clientMessages } = request.body;

    if (!clientMessages) {
        return reply.status(400).send({ error: 'Request body must include a `messages` array.' });
    }
    
    try {
      const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
      if (!conversation) return reply.status(404).send({ error: 'Conversation not found.' });
      
      // Use the client-provided history as the source of truth for the AI.
      const contents = clientMessages.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] }));
      
      const modelConfig = { model: conversation.model };
      if (conversation.system_prompt) modelConfig.systemInstruction = { role: 'system', parts: [{ text: conversation.system_prompt }] };
      
      const generativeModel = vertexAI.getGenerativeModel(modelConfig);
      const stream = await generativeModel.generateContentStream({ contents });
      
      reply.raw.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE, PATCH' });
      
      let fullModelResponse = "";
      for await (const item of stream.stream) {
        if (item.candidates?.[0]?.content?.parts?.[0]?.text) {
          const chunk = item.candidates[0].content.parts[0].text;
          fullModelResponse += chunk;
          reply.raw.write(chunk);
        }
      }

      // After a successful stream, reconcile the database with the "delete-and-replace" strategy.
      const reconcileDB = db.transaction(() => {
          // 1. Delete all old messages for this conversation.
          deleteAllMessagesStmt.run(conversationId);
          // 2. Insert the history that the AI just used.
          for (const msg of clientMessages) {
              insertMessageStmt.run(conversationId, msg.role, msg.content);
          }
          // 3. Insert the new model response.
          insertMessageStmt.run(conversationId, 'model', fullModelResponse);
      });
      
      reconcileDB();

      reply.raw.end();
    } catch (e) {
      fastify.log.error(`Chat error: ${e.message}`);
      if (!reply.sent) reply.status(500).send({ e: 'AI model fail' });
      else reply.raw.end();
    }
  });
  // --- END: REWORKED CHAT LOGIC ---

  try { await fastify.listen({ port: PORT }); } catch (err) { fastify.log.error(err); process.exit(1); }
};
startServer();