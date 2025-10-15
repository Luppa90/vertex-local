'use strict';

require('dotenv').config();
const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const { GoogleGenAI } = require('@google/genai');
const Database = require('better-sqlite3');
const path = require('path');

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
  
  fastify.setErrorHandler(async (error, request, reply) => {
    fastify.log.error(error);
    if (!reply.sent) {
      reply.status(500).send({ error: 'An internal server error occurred.' });
    }
  });


  // --- CONVERSATION ROUTES ---
  fastify.get('/api/conversations', async (request, reply) => {
    const conversations = db.prepare("SELECT id, title, model, created_at FROM conversations WHERE id IN (SELECT DISTINCT conversation_id FROM messages) ORDER BY created_at DESC").all();
    reply.send(conversations);
  });

  fastify.post('/api/conversations', async (request, reply) => {
    const { title, model, systemPrompt } = request.body;
    const info = createConversationStmt.run(title, model, systemPrompt || null);
    reply.send({ id: info.lastInsertRowid, title, model, systemPrompt });
  });

  fastify.get('/api/conversations/:id', async (request, reply) => {
    const conversationId = parseInt(request.params.id, 10);
    const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
    if (!conversation) return reply.status(4404).send({ error: 'Conversation not found' });
    const messages = getConversationHistoryStmt.all(conversationId);
    reply.send({ ...conversation, messages });
  });

  fastify.delete('/api/conversations/:id', async (request, reply) => {
    db.prepare("DELETE FROM conversations WHERE id = ?").run(parseInt(request.params.id, 10));
    reply.status(204).send();
  });

  fastify.patch('/api/conversations/:id', async (request, reply) => {
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
    const stmt = db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(values);
    reply.send({ message: 'Conversation updated successfully.' });
  });
  
  fastify.post('/api/conversations/:id/generate-title', async (request, reply) => {
    const conversationId = parseInt(request.params.id, 10);
    const messages = db.prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 2").all(conversationId);
    if (messages.length < 1) return reply.status(400).send({ error: 'Not enough messages' });
    
    const titleGenPrompt = `Based on the following conversation, create a short, descriptive title (5 words maximum) for a chat history list. The title should be from the perspective of the "user". Do not use quotes. Conversation:\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}\n\nTitle:`;
    
    // --- CORRECTED: Use googleAI.models.generateContent directly ---
    const result = await googleAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: titleGenPrompt }] }],
    });
    
    const title = result.response.text().trim().replace(/"/g, '');
    
    db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, conversationId);
    reply.send({ title });
  });

  fastify.post('/api/conversations/branch', async (request, reply) => {
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
    const result = branch();
    reply.send(result);
  });
  
  fastify.post('/api/conversations/:id/count-tokens', async (request, reply) => {
      const { messages, model } = request.body;
      if (!messages || !model) return reply.status(400).send({ error: 'Messages and model are required.' });
      
      const contents = messages.map((msg) => ({
          role: msg.role,
          parts: [{ text: msg.content }],
      }));

      // --- CORRECTED: Use googleAI.models.countTokens directly ---
      const count = await googleAI.models.countTokens({ model, contents });
      reply.send(count);
  });

  // --- MESSAGE ROUTES ---
  fastify.delete('/api/messages/:id', async (request, reply) => {
    db.prepare("DELETE FROM messages WHERE id = ?").run(parseInt(request.params.id, 10));
    reply.status(204).send();
  });
  
  fastify.patch('/api/messages/:id', async (request, reply) => {
      const { content } = request.body;
      if (content === undefined) return reply.status(400).send({ error: 'Content field is required.' });
      db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, parseInt(request.params.id, 10));
      reply.send({ message: 'Message updated successfully.' });
  });

  fastify.post('/api/chat/:id/reconcile', async (request, reply) => {
      const conversationId = parseInt(request.params.id, 10);
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
      const { messages: clientMessages } = request.body;
      if (!clientMessages) return reply.status(400).send({ error: '`messages` array is required.' });
      
      const conversation = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
      if (!conversation) return reply.status(404).send({ error: 'Conversation not found.' });
      
      const contents = clientMessages.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] }));
      
      const generationConfig = {}; // Placeholder for future config like temperature, etc.
      const systemInstruction = conversation.system_prompt 
          ? { role: 'system', parts: [{ text: conversation.system_prompt }] }
          : undefined;

      // --- CORRECTED: Use googleAI.models.generateContentStream directly ---
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
      fastify.log.error(`Chat error: ${e.message}`);
      if (!reply.sent) {
        reply.status(500).send({ error: 'AI model failed to generate a response.' });
      } else {
        reply.raw.end();
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