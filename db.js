// db.js - PostgreSQL Database Layer for v3.0
const { Pool, types } = require('pg');

// Parse DECIMAL and NUMERIC as float instead of string
types.setTypeParser(1700, function(val) {
  return parseFloat(val);
});

// Parse BIGINT as integer (for SUM(), COUNT(), etc.)
types.setTypeParser(20, function(val) {
  return parseInt(val, 10);
});

class Database {
  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST || 'postgres',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'vereinskasse',
      user: process.env.DB_USER || 'vereinskasse',
      password: process.env.DB_PASSWORD || 'vereinskasse',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    console.log(`📊 PostgreSQL: ${process.env.DB_HOST || 'postgres'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'vereinskasse'}`);
  }

  async query(text, params = []) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async queryOne(text, params = []) {
    const rows = await this.query(text, params);
    return rows[0] || null;
  }

  async execute(text, params = []) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return {
        rowCount: result.rowCount,
        rows: result.rows
      };
    } finally {
      client.release();
    }
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await callback(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = Database;
