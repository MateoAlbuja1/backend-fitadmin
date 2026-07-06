const databaseName = process.env.MONGO_INITDB_DATABASE || 'fitadmin_mongo';
const dbx = db.getSiblingDB(databaseName);

dbx.createCollection('reports');
dbx.createCollection('alerts');
dbx.createCollection('logs');
dbx.createCollection('inventory_history');
dbx.createCollection('audit_changes');
dbx.createCollection('system_events');

dbx.reports.createIndex({ type: 1, createdAt: -1 });
dbx.alerts.createIndex({ key: 1 }, { unique: true, sparse: true });
dbx.alerts.createIndex({ read: 1, createdAt: -1 });
dbx.logs.createIndex({ level: 1, createdAt: -1 });
dbx.inventory_history.createIndex({ itemType: 1, itemId: 1, createdAt: -1 });
dbx.audit_changes.createIndex({ entity: 1, entityId: 1, createdAt: -1 });
dbx.system_events.createIndex({ event: 1, createdAt: -1 });

dbx.system_events.updateOne(
  { event: 'mongo_initialized' },
  {
    $setOnInsert: {
      event: 'mongo_initialized',
      service: 'mongo-init',
      message: 'Base collections created for Fit Admin / GX GYM',
      createdAt: new Date()
    }
  },
  { upsert: true }
);
