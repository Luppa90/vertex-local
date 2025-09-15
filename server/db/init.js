// db/init.js
const Database = require('better-sqlite3');
const path = require('path');

// Use path.join to ensure the path is correct regardless of OS
const dbPath = path.join(__dirname, 'chat_history.db');
const db = new Database(dbPath, { verbose: console.log });

function initialize() {
    console.log('Initializing database...');

    // Create conversations table with the new system_prompt column
    const createConversationsTable = `
    CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        model TEXT NOT NULL,
        system_prompt TEXT, 
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        parameters TEXT
    );`;
    db.exec(createConversationsTable);

    // Create messages table (no changes here)
    const createMessagesTable = `
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'model')),
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
    );`;
    db.exec(createMessagesTable);
    
    // FTS setup (no changes here)
    const createFtsTable = `
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content_rowid=id,
        content='messages'
    );`;
    db.exec(createFtsTable);

    const createFtsTriggers = `
    CREATE TRIGGER IF NOT EXISTS messages_after_insert AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_after_delete AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_after_update AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
    `;
    db.exec(createFtsTriggers);


    console.log('Database initialized successfully with system_prompt support.');
    db.close();
}

initialize();
