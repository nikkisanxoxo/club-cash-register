-- PostgreSQL Schema for Club Cash Register v4.0 with Inventory Management

-- Drop existing tables if they exist
DROP TABLE IF EXISTS inventory_history CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS tips CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS drinks CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;

-- Rooms table
CREATE TABLE rooms (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL
);

-- Drinks table
CREATE TABLE drinks (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  price_reduced DECIMAL(10,2),
  active INTEGER DEFAULT 1,
  color VARCHAR(7) DEFAULT '#667eea',
  sort_order INTEGER DEFAULT 0
);

-- Inventory table (NEW in v4.0)
CREATE TABLE inventory (
  id SERIAL PRIMARY KEY,
  drink_id INTEGER NOT NULL REFERENCES drinks(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  last_count_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(drink_id)
);

-- Inventory history for audit trail (NEW in v4.0)
CREATE TABLE inventory_history (
  id SERIAL PRIMARY KEY,
  drink_id INTEGER NOT NULL REFERENCES drinks(id) ON DELETE CASCADE,
  change_type VARCHAR(50) NOT NULL, -- 'sale', 'storno', 'manual_count', 'adjustment'
  quantity_before INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  quantity_change INTEGER NOT NULL,
  reference_id INTEGER, -- transaction_id if from sale/storno
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table
CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  drink_id INTEGER NOT NULL REFERENCES drinks(id),
  quantity INTEGER NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  event_name VARCHAR(255) DEFAULT 'Hausintern',
  is_storno INTEGER DEFAULT 0,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tips table
CREATE TABLE tips (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  amount DECIMAL(10,2) NOT NULL,
  event_name VARCHAR(255) DEFAULT 'Hausintern',
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_inventory_drink ON inventory(drink_id);
CREATE INDEX idx_inventory_history_drink ON inventory_history(drink_id);
CREATE INDEX idx_inventory_history_created ON inventory_history(created_at);
CREATE INDEX idx_transactions_room ON transactions(room_id);
CREATE INDEX idx_transactions_drink ON transactions(drink_id);
CREATE INDEX idx_transactions_event ON transactions(event_name);
CREATE INDEX idx_transactions_timestamp ON transactions(timestamp);
CREATE INDEX idx_tips_room ON tips(room_id);
CREATE INDEX idx_tips_event ON tips(event_name);
CREATE INDEX idx_drinks_active ON drinks(active);
CREATE INDEX idx_drinks_sort ON drinks(sort_order);

-- Trigger: Auto-update inventory when transaction is created
CREATE OR REPLACE FUNCTION update_inventory_on_transaction()
RETURNS TRIGGER AS $$
BEGIN
  -- Reduce inventory for sale, increase for storno
  IF NEW.is_storno = 0 THEN
    -- Regular sale - decrease inventory
    UPDATE inventory 
    SET quantity = quantity - NEW.quantity,
        last_updated = CURRENT_TIMESTAMP
    WHERE drink_id = NEW.drink_id;
    
    -- Log history
    INSERT INTO inventory_history (drink_id, change_type, quantity_before, quantity_after, quantity_change, reference_id, notes)
    SELECT 
      NEW.drink_id,
      'sale',
      i.quantity + NEW.quantity,
      i.quantity,
      -NEW.quantity,
      NEW.id,
      'Automatic deduction from sale'
    FROM inventory i
    WHERE i.drink_id = NEW.drink_id;
  ELSE
    -- Storno - increase inventory back
    UPDATE inventory 
    SET quantity = quantity + NEW.quantity,
        last_updated = CURRENT_TIMESTAMP
    WHERE drink_id = NEW.drink_id;
    
    -- Log history
    INSERT INTO inventory_history (drink_id, change_type, quantity_before, quantity_after, quantity_change, reference_id, notes)
    SELECT 
      NEW.drink_id,
      'storno',
      i.quantity - NEW.quantity,
      i.quantity,
      NEW.quantity,
      NEW.id,
      'Automatic addition from storno'
    FROM inventory i
    WHERE i.drink_id = NEW.drink_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transaction_inventory_update
AFTER INSERT ON transactions
FOR EACH ROW
EXECUTE FUNCTION update_inventory_on_transaction();

-- Trigger: Auto-create inventory entry when drink is created
CREATE OR REPLACE FUNCTION create_inventory_on_drink()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO inventory (drink_id, quantity)
  VALUES (NEW.id, 0);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER drink_inventory_create
AFTER INSERT ON drinks
FOR EACH ROW
EXECUTE FUNCTION create_inventory_on_drink();

-- Insert initial data
INSERT INTO rooms (name) VALUES 
  ('Rolltore'),
  ('Brücke'),
  ('Eigenverbrauch');

INSERT INTO drinks (name, price, price_reduced, color, sort_order) VALUES
  ('Pils 0,33', 3.00, 2.00, '#fbbf24', 0),
  ('Bier', 3.50, 2.50, '#f59e0b', 1),
  ('Weinschorle', 3.50, 2.50, '#ec4899', 2),
  ('Radler', 3.50, 2.50, '#a3e635', 3),
  ('Alkoholfrei Bier', 3.00, 2.00, '#fbbf24', 4),
  ('Club Mate', 3.50, 2.50, '#10b981', 5),
  ('Spezi', 3.00, 2.00, '#f97316', 6),
  ('Schorle', 2.50, 1.50, '#ec4899', 7),
  ('Wasser', 1.50, 1.00, '#3b82f6', 8),
  ('Shot', 2.00, 1.50, '#dc2626', 9),
  ('Sekt', 6.00, 4.00, '#fbbf24', 10),
  ('Longdrink', 7.00, 5.00, '#8b5cf6', 11);

-- Inventory entries are created automatically by trigger
