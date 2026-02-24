# 🍺 Club Cash Register v4.0

**PostgreSQL with Inventory Management** - Complete stock tracking system.

## What's New in v4.0

### 🎯 Major New Feature: Inventory Management

- **📦 Stock Tracking** - Real-time inventory for all drinks
- **📋 Inventory Counts** - Manual count entry with history
- **🔧 Stock Adjustments** - Add/remove stock with notes
- **🤖 Automatic Updates** - Sales reduce stock, stornos increase it
- **📊 Stock Status** - Visual indicators (OK, Low, Out)
- **📜 Audit Trail** - Complete history of all stock changes
- **⚠️ Alerts** - Low stock and out-of-stock warnings

### Database Triggers:
- **Auto-deduct** stock on sales
- **Auto-add** stock on stornos
- **Auto-create** inventory when adding drinks
- **Full logging** of all changes

---

## Quick Start

```bash
# 1. Extract
tar -xzf club-cash-register-v4.0.tar.gz
cd club-cash-register-v4

# 2. Edit passwords
nano docker-compose.yml
# Change: ADMIN_PASSWORD, DB_PASSWORD, POSTGRES_PASSWORD

# 3. Start
docker compose up -d

# 4. Wait 30 seconds

# 5. Open
http://localhost:3000
http://localhost:3000/inventory.html  ← NEW!
```

---

## Features

### All v3.0 Features:
- Multi-room tracking
- Reduced prices
- Event management
- Statistics with filters
- CSV export by events
- Cancellation system
- Tip tracking
- Admin panel

### NEW in v4.0:
- **Inventory page** (`/inventory.html`)
- **Stock management** (count, adjust)
- **Automatic stock updates** (triggers)
- **Inventory history** (audit trail)
- **Stock alerts** (low/out of stock)
- **Summary dashboard** (total stock, alerts)

---

## Inventory Management

### How It Works:

#### 1. Initial Setup
When you start v4.0:
- All 12 drinks are created
- Inventory entries auto-created (all at quantity 0)
- Ready for first inventory count

#### 2. Inventory Count
```
1. Go to Lager (Inventory) page
2. Click "📋 Zählen" (Count) for each drink
3. Enter physical count
4. Save
→ Inventory updated, history logged
```

#### 3. Stock Adjustments
```
1. Click "🔧 Anpassen" (Adjust)
2. Enter +24 (delivery) or -3 (breakage)
3. Add note: "Lieferung Brauerei"
4. Save
→ Stock adjusted, history logged
```

#### 4. Automatic Updates
```
Sale: Bier x 5
→ Inventory: -5 automatically
→ History: "sale" logged

Storno: Bier x 2
→ Inventory: +2 automatically
→ History: "storno" logged
```

---

## Database Schema Changes

### New Tables:

#### inventory
```sql
id, drink_id, quantity, last_count_date, last_updated
```

#### inventory_history
```sql
id, drink_id, change_type, quantity_before, quantity_after,
quantity_change, reference_id, notes, created_at
```

### Triggers:

1. **transaction_inventory_update**
   - Fires on INSERT to transactions
   - Reduces stock for sales
   - Increases stock for stornos
   - Logs to history

2. **drink_inventory_create**
   - Fires on INSERT to drinks
   - Creates inventory entry (quantity = 0)

---

## API Endpoints

### New in v4.0:

```
GET  /api/inventory                    - Get all inventory with drink details
PUT  /api/inventory/:id                - Update inventory count
POST /api/inventory/adjust             - Adjust stock (+/-)
GET  /api/inventory/history/:drink_id  - Get change history
GET  /api/inventory/summary            - Get stock summary
```

---

## Usage Examples

### Scenario 1: Monthly Inventory
```
1. Open /inventory.html
2. Count physical stock
3. For each drink:
   - Click "Zählen"
   - Enter count
   - Notes: "Inventur Ende Januar"
   - Save
4. Done! Summary updates automatically
```

### Scenario 2: Delivery
```
1. Delivery arrives: 24x Bier, 12x Mate
2. Open /inventory.html
3. Bier: Click "Anpassen" → +24 → Note: "Lieferung Brauerei"
4. Mate: Click "Anpassen" → +12 → Note: "Lieferung Brauerei"
5. Stock updated, history logged
```

### Scenario 3: Breakage
```
1. 3 bottles broken
2. Click "Anpassen" → -3
3. Note: "Bruch beim Transport"
4. Stock reduced, history logged
```

### Scenario 4: Sale Impact
```
Customer buys 5x Bier
→ Transaction created
→ Trigger fires automatically
→ Inventory reduced by 5
→ History logged as "sale"
→ No manual action needed!
```

---

## Stock Status Indicators

| Status | Condition | Color | Action |
|--------|-----------|-------|--------|
| ✅ Ausreichend | quantity ≥ 10 | Green | None |
| ⚠️ Niedriger Bestand | 1 ≤ quantity < 10 | Orange | Order soon |
| ❌ Nicht vorrätig | quantity = 0 | Red | Order now |

---

## Inventory History Types

| Type | Trigger | Quantity Change |
|------|---------|----------------|
| `sale` | Customer purchase | Negative |
| `storno` | Cancellation | Positive |
| `manual_count` | Inventory count | Any |
| `adjustment` | Manual adjust | Positive/Negative |

---

## Migration from v3.0

**No automatic migration!**

v4.0 adds new tables but doesn't migrate existing transactions.

### Fresh Install (Recommended):
```bash
docker compose down -v
docker compose up -d
# Fresh database with inventory
```

### Keep v3.0 Data:
Run v3.0 and v4.0 side-by-side on different ports.

---

## Configuration

Same as v3.0:
- `ADMIN_PASSWORD` - Admin panel access
- `DB_*` - PostgreSQL connection
- All in `docker-compose.yml`

---

## Monitoring

### Check Inventory:
```bash
# Connect to database
docker exec -it club-cash-register-db psql -U vereinskasse

# Check inventory
SELECT d.name, i.quantity 
FROM inventory i 
JOIN drinks d ON i.drink_id = d.id 
ORDER BY i.quantity ASC;

# Check history
SELECT * FROM inventory_history 
ORDER BY created_at DESC 
LIMIT 10;
```

---

## Troubleshooting

### Inventory not updating on sales:
```bash
# Check triggers exist
docker exec -it club-cash-register-db psql -U vereinskasse -c "\df"

# Should see:
# - update_inventory_on_transaction
# - create_inventory_on_drink
```

### Stock went negative:
```
This shouldn't happen (trigger prevents it)
If it does: manually adjust back to 0
```

### Missing inventory entries:
```
Each drink should have one inventory entry
If missing: trigger failed during drink creation
Manual fix: INSERT INTO inventory (drink_id, quantity) VALUES (X, 0);
```

---

## Best Practices

### 1. Regular Counts
- Weekly or monthly physical inventory
- Compare system vs. physical
- Investigate discrepancies

### 2. Document Adjustments
- Always add notes for adjustments
- Track deliveries, breakage, theft
- Helps with auditing

### 3. Monitor Low Stock
- Check summary dashboard daily
- Set reorder points (e.g., < 10)
- Order before stock-out

### 4. Review History
- Periodic history review
- Identify patterns (shrinkage, waste)
- Improve processes

---

## Performance

### Database Impact:
- +2 tables (inventory, inventory_history)
- +2 triggers (auto-update stock)
- Minimal overhead (< 1ms per transaction)

### Recommended:
- Archive old history quarterly
- Keep last 3-6 months active

---

## Backup

### Inventory Data:
```bash
# Backup everything
docker exec club-cash-register-db pg_dump -U vereinskasse > backup.sql

# Inventory only
docker exec club-cash-register-db pg_dump -U vereinskasse -t inventory -t inventory_history > inventory_backup.sql
```

---

## Changelog

### v4.0.0 (2024-02-23)
- **New:** Inventory management system
- **New:** Stock tracking page
- **New:** Automatic stock updates
- **New:** Inventory history/audit trail
- **New:** Stock status indicators
- **New:** Low stock alerts
- **Improved:** Database triggers for automation
- **Improved:** Admin workflow

### v3.0.0
- PostgreSQL only
- Fully async API
- Type parsing fixes

### v2.4.0
- Event tracking
- Reduced prices
- Storno function

---

## Support

See inline documentation and code comments.

Common issues:
- Trigger not firing → Check PostgreSQL logs
- Stock mismatch → Use manual count to correct
- History missing → Check trigger exists

---

## License

MIT License - Free for personal and commercial use

---

**Club Cash Register v4.0** - Complete Inventory Management! 📦
