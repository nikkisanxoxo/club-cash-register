const express = require('express');
const Database = require('./db');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize database
const db = new Database();

// Admin password check middleware
const authMiddleware = (req, res, next) => {
  const password = req.headers['x-admin-password'];
  const correctPassword = process.env.ADMIN_PASSWORD || 'meinPasswort123';
  
  if (password !== correctPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Initialize database schema
async function initializeDatabase() {
  try {
    console.log('🔧 Initializing PostgreSQL schema...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    
    // Smart split: preserve $$ blocks
    const statements = splitSQLStatements(schema);
    
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await db.execute(statement);
        } catch (err) {
          // Ignore "already exists" errors during re-initialization
          if (!err.message.includes('already exists')) {
            throw err;
          }
        }
      }
    }
    
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
}

// Split SQL preserving $$ dollar-quoted strings
function splitSQLStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = null;
  
  const lines = sql.split('\n');
  
  for (const line of lines) {
    // Check for dollar quote start/end
    const dollarMatch = line.match(/\$(\w*)\$/);
    
    if (dollarMatch) {
      const tag = dollarMatch[1];
      if (!inDollarQuote) {
        // Starting dollar quote
        inDollarQuote = true;
        dollarTag = tag;
      } else if (tag === dollarTag) {
        // Ending dollar quote
        inDollarQuote = false;
        dollarTag = null;
      }
    }
    
    current += line + '\n';
    
    // Only split on ; if not inside dollar quote
    if (!inDollarQuote && line.trim().endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }
  
  if (current.trim()) {
    statements.push(current.trim());
  }
  
  return statements.filter(s => s.length > 0);
}

// API ENDPOINTS

// Get all rooms
app.get('/api/rooms', async (req, res) => {
  try {
    const rooms = await db.query('SELECT * FROM rooms ORDER BY id');
    res.json(rooms);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// Get active drinks
app.get('/api/drinks', async (req, res) => {
  try {
    const drinks = await db.query(
      'SELECT * FROM drinks WHERE active = 1 ORDER BY sort_order ASC, name ASC'
    );
    res.json(drinks);
  } catch (error) {
    console.error('Error fetching drinks:', error);
    res.status(500).json({ error: 'Failed to fetch drinks' });
  }
});

// Get all drinks (including inactive) - for Admin
app.get('/api/drinks/all', async (req, res) => {
  try {
    const drinks = await db.query(
      'SELECT * FROM drinks ORDER BY sort_order ASC, name ASC'
    );
    res.json(drinks);
  } catch (error) {
    console.error('Error fetching all drinks:', error);
    res.status(500).json({ error: 'Failed to fetch drinks' });
  }
});

// Create transaction
app.post('/api/transactions', async (req, res) => {
  const { room_id, items, event_name } = req.body;
  
  if (!room_id || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Room ID and items required' });
  }
  
  try {
    await db.transaction(async (client) => {
      for (const item of items) {
        await client.query(
          'INSERT INTO transactions (room_id, drink_id, quantity, total_price, event_name, is_storno) VALUES ($1, $2, $3, $4, $5, $6)',
          [
            room_id,
            item.drink_id,
            item.quantity,
            item.total_price,
            event_name || 'Hausintern',
            item.is_storno || 0
          ]
        );
      }
    });
    
    res.json({ success: true, message: 'Transaction successful' });
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

// Get statistics
app.get('/api/statistics', async (req, res) => {
  const { start_date, end_date, room_id, event_name } = req.query;
  
  try {
    // Build WHERE conditions
    let conditions = ['1=1'];
    let params = [];
    let paramIndex = 1;
    
    if (start_date) {
      conditions.push(`DATE(t.timestamp) >= $${paramIndex++}`);
      params.push(start_date);
    }
    
    if (end_date) {
      conditions.push(`DATE(t.timestamp) <= $${paramIndex++}`);
      params.push(end_date);
    }
    
    if (room_id) {
      conditions.push(`t.room_id = $${paramIndex++}`);
      params.push(room_id);
    }
    
    if (event_name) {
      conditions.push(`t.event_name = $${paramIndex++}`);
      params.push(event_name);
    }
    
    const whereClause = conditions.join(' AND ');
    
    // Get statistics
    const statsQuery = `
      SELECT 
        r.name as room_name,
        d.name as drink_name,
        t.event_name,
        SUM(CASE WHEN t.is_storno = 0 THEN t.quantity ELSE 0 END) as total_quantity,
        SUM(CASE WHEN t.is_storno = 1 THEN t.quantity ELSE 0 END) as storno_quantity,
        SUM(CASE WHEN t.is_storno = 0 THEN t.total_price ELSE 0 END) as total_revenue,
        SUM(CASE WHEN t.is_storno = 1 THEN t.total_price ELSE 0 END) as storno_revenue
      FROM transactions t
      JOIN rooms r ON t.room_id = r.id
      JOIN drinks d ON t.drink_id = d.id
      WHERE ${whereClause}
      GROUP BY r.name, d.name, t.event_name
      ORDER BY t.event_name, r.name, total_quantity DESC
    `;
    
    const stats = await db.query(statsQuery, params);
    
    // Get summary
    const summaryQuery = `
      SELECT 
        SUM(CASE WHEN t.is_storno = 0 THEN t.quantity ELSE 0 END) as total_items,
        SUM(CASE WHEN t.is_storno = 1 THEN t.quantity ELSE 0 END) as storno_items,
        SUM(CASE WHEN t.is_storno = 0 THEN t.total_price ELSE 0 END) as total_revenue,
        SUM(CASE WHEN t.is_storno = 1 THEN t.total_price ELSE 0 END) as storno_revenue,
        COUNT(DISTINCT t.id) as transaction_count
      FROM transactions t
      WHERE ${whereClause}
    `;
    
    const summary = await db.queryOne(summaryQuery, params);
    
    // Get tips summary
    const tipsQuery = `
      SELECT 
        SUM(amount) as total_tips,
        COUNT(*) as tip_count
      FROM tips
      WHERE ${whereClause.replace(/t\./g, '')}
    `;
    
    const tips = await db.queryOne(tipsQuery, params);
    
    // Get tips per room
    const tipsPerRoomQuery = `
      SELECT 
        r.name as room_name,
        r.id as room_id,
        ti.event_name,
        SUM(ti.amount) as total_tips
      FROM tips ti
      JOIN rooms r ON ti.room_id = r.id
      WHERE ${whereClause.replace(/t\./g, 'ti.')}
      GROUP BY r.name, r.id, ti.event_name
    `;
    
    const tipsPerRoom = await db.query(tipsPerRoomQuery, params);
    
    // Get event list
    const eventsConditions = [];
    const eventsParams = [];
    let eventsParamIndex = 1;
    
    if (start_date) {
      eventsConditions.push(`DATE(timestamp) >= $${eventsParamIndex++}`);
      eventsParams.push(start_date);
    }
    
    if (end_date) {
      eventsConditions.push(`DATE(timestamp) <= $${eventsParamIndex++}`);
      eventsParams.push(end_date);
    }
    
    const eventsWhere = eventsConditions.length > 0 
      ? 'WHERE ' + eventsConditions.join(' AND ')
      : '';
    
    const eventsQuery = `
      SELECT DISTINCT event_name
      FROM transactions
      ${eventsWhere}
      ORDER BY event_name
    `;
    
    const events = await db.query(eventsQuery, eventsParams);
    
    res.json({
      statistics: stats,
      summary: {
        ...summary,
        total_tips: tips?.total_tips || 0,
        tip_count: tips?.tip_count || 0
      },
      tips_per_room: tipsPerRoom,
      events: events.map(e => e.event_name)
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Add tip
app.post('/api/tips', async (req, res) => {
  const { room_id, amount, event_name } = req.body;
  
  if (!room_id || !amount) {
    return res.status(400).json({ error: 'Room ID and amount required' });
  }
  
  try {
    await db.execute(
      'INSERT INTO tips (room_id, amount, event_name) VALUES ($1, $2, $3)',
      [room_id, amount, event_name || 'Hausintern']
    );
    
    res.json({ success: true, message: 'Tip added successfully' });
  } catch (error) {
    console.error('Error adding tip:', error);
    res.status(500).json({ error: 'Failed to add tip' });
  }
});

// Add drink (Admin)
app.post('/api/drinks', authMiddleware, async (req, res) => {
  const { name, price, price_reduced, color } = req.body;
  
  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price required' });
  }
  
  try {
    // Get max sort_order
    const maxSort = await db.queryOne('SELECT MAX(sort_order) as max FROM drinks');
    const sortOrder = (maxSort?.max || 0) + 1;
    
    await db.execute(
      'INSERT INTO drinks (name, price, price_reduced, color, sort_order) VALUES ($1, $2, $3, $4, $5)',
      [name, price, price_reduced || null, color || '#667eea', sortOrder]
    );
    
    res.json({ success: true, message: 'Drink added successfully' });
  } catch (error) {
    console.error('Error adding drink:', error);
    if (error.code === '23505') { // Unique constraint violation
      res.status(400).json({ error: 'Drink with this name already exists' });
    } else {
      res.status(500).json({ error: 'Failed to add drink' });
    }
  }
});

// Update drink (Admin)
app.put('/api/drinks/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, price, price_reduced, active, color, sort_order } = req.body;
  
  try {
    await db.execute(
      'UPDATE drinks SET name = $1, price = $2, price_reduced = $3, active = $4, color = $5, sort_order = $6 WHERE id = $7',
      [name, price, price_reduced || null, active, color, sort_order, id]
    );
    
    res.json({ success: true, message: 'Drink updated successfully' });
  } catch (error) {
    console.error('Error updating drink:', error);
    res.status(500).json({ error: 'Failed to update drink' });
  }
});

// Validate admin password
app.post('/api/auth/validate', (req, res) => {
  const { password } = req.body;
  const correctPassword = process.env.ADMIN_PASSWORD || 'meinPasswort123';
  
  if (password === correctPassword) {
    res.json({ valid: true });
  } else {
    res.json({ valid: false });
  }
});

// Get recent transactions (for storno/cancellation)
app.get('/api/transactions', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  
  try {
    const transactions = await db.query(`
      SELECT 
        t.id,
        t.quantity,
        t.total_price,
        t.event_name,
        t.is_storno,
        t.timestamp,
        r.name as room_name,
        d.name as drink_name
      FROM transactions t
      JOIN rooms r ON t.room_id = r.id
      JOIN drinks d ON t.drink_id = d.id
      ORDER BY t.timestamp DESC
      LIMIT $1
    `, [limit]);
    
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ============ INVENTORY ENDPOINTS (NEW in v4.0) ============

// Get all inventory with drink details
app.get('/api/inventory', async (req, res) => {
  try {
    const inventory = await db.query(`
      SELECT 
        i.id,
        i.drink_id,
        i.quantity,
        i.last_count_date,
        i.last_updated,
        d.name as drink_name,
        d.price,
        d.price_reduced,
        d.color,
        d.active
      FROM inventory i
      JOIN drinks d ON i.drink_id = d.id
      ORDER BY d.sort_order ASC, d.name ASC
    `);
    
    res.json(inventory);
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// Update inventory count (manual inventory count)
app.put('/api/inventory/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { quantity, notes } = req.body;
  
  if (quantity === undefined || quantity < 0) {
    return res.status(400).json({ error: 'Valid quantity required' });
  }
  
  try {
    // Get current inventory
    const current = await db.queryOne('SELECT * FROM inventory WHERE id = $1', [id]);
    
    if (!current) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }
    
    // Update inventory
    await db.execute(
      'UPDATE inventory SET quantity = $1, last_count_date = CURRENT_TIMESTAMP, last_updated = CURRENT_TIMESTAMP WHERE id = $2',
      [quantity, id]
    );
    
    // Log history
    await db.execute(
      `INSERT INTO inventory_history 
       (drink_id, change_type, quantity_before, quantity_after, quantity_change, notes) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        current.drink_id,
        'manual_count',
        current.quantity,
        quantity,
        quantity - current.quantity,
        notes || 'Manual inventory count'
      ]
    );
    
    res.json({ success: true, message: 'Inventory updated' });
  } catch (error) {
    console.error('Error updating inventory:', error);
    res.status(500).json({ error: 'Failed to update inventory' });
  }
});

// Adjust inventory (add/remove stock)
app.post('/api/inventory/adjust', authMiddleware, async (req, res) => {
  const { drink_id, adjustment, notes } = req.body;
  
  if (!drink_id || adjustment === undefined) {
    return res.status(400).json({ error: 'Drink ID and adjustment required' });
  }
  
  try {
    // Get current inventory
    const current = await db.queryOne('SELECT * FROM inventory WHERE drink_id = $1', [drink_id]);
    
    if (!current) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }
    
    const newQuantity = current.quantity + adjustment;
    
    if (newQuantity < 0) {
      return res.status(400).json({ error: 'Adjustment would result in negative inventory' });
    }
    
    // Update inventory
    await db.execute(
      'UPDATE inventory SET quantity = $1, last_updated = CURRENT_TIMESTAMP WHERE drink_id = $2',
      [newQuantity, drink_id]
    );
    
    // Log history
    await db.execute(
      `INSERT INTO inventory_history 
       (drink_id, change_type, quantity_before, quantity_after, quantity_change, notes) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        drink_id,
        'adjustment',
        current.quantity,
        newQuantity,
        adjustment,
        notes || 'Manual adjustment'
      ]
    );
    
    res.json({ success: true, message: 'Inventory adjusted', new_quantity: newQuantity });
  } catch (error) {
    console.error('Error adjusting inventory:', error);
    res.status(500).json({ error: 'Failed to adjust inventory' });
  }
});

// Get inventory history
app.get('/api/inventory/history/:drink_id', async (req, res) => {
  const { drink_id } = req.params;
  const limit = parseInt(req.query.limit) || 100;
  
  try {
    const history = await db.query(`
      SELECT 
        h.*,
        d.name as drink_name
      FROM inventory_history h
      JOIN drinks d ON h.drink_id = d.id
      WHERE h.drink_id = $1
      ORDER BY h.created_at DESC
      LIMIT $2
    `, [drink_id, limit]);
    
    res.json(history);
  } catch (error) {
    console.error('Error fetching inventory history:', error);
    res.status(500).json({ error: 'Failed to fetch inventory history' });
  }
});

// Get inventory summary
app.get('/api/inventory/summary', async (req, res) => {
  try {
    const summary = await db.queryOne(`
      SELECT 
        COUNT(*) as total_drinks,
        SUM(quantity) as total_stock,
        COUNT(CASE WHEN quantity = 0 THEN 1 END) as out_of_stock,
        COUNT(CASE WHEN quantity < 10 THEN 1 END) as low_stock
      FROM inventory
    `);
    
    res.json(summary);
  } catch (error) {
    console.error('Error fetching inventory summary:', error);
    res.status(500).json({ error: 'Failed to fetch inventory summary' });
  }
});

// Start server
async function startServer() {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`🍺 Club Cash Register v4.0 running on http://localhost:${PORT}`);
      console.log(`📊 Statistics: http://localhost:${PORT}/statistics.html`);
      console.log(`⚙️  Admin: http://localhost:${PORT}/admin.html`);
      console.log(`📦 Inventory: http://localhost:${PORT}/inventory.html`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await db.close();
  console.log('✅ Database closed');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down...');
  await db.close();
  console.log('✅ Database closed');
  process.exit(0);
});
