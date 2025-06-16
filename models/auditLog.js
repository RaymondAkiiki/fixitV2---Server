const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: { type: String, required: true }, // e.g., "CREATED_REQUEST", "UPDATED_STATUS", "ASSIGNED_VENDOR", "USER_LOGIN"
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' , default: null }, // User who performed the action (can be null for system actions)
  targetModel: { type: String, required: true }, // e.g., "MaintenanceRequest", "User", "Property"
  targetId: { type: String, required: true }, // ID of the affected document   
  details: { type: mongoose.Schema.Types.Mixed }, // e.g., { oldStatus: 'New', newStatus: 'In Progress', changedFields: ['status', 'assignedToVendor'] }
  ipAddress: {
    type: String,
    validate: {
      validator: function(v) {
        // Simplified IPv4 validation
        return !v || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(v);
      },
      message: props => `${props.value} is not a valid IP address!`
    }
  },
}, { timestamps: true });

// Indexes for common queries
auditLogSchema.index({ targetModel: 1, targetId: 1 });
auditLogSchema.index({ user: 1 });
auditLogSchema.index({ action: 1 });


module.exports = mongoose.model('AuditLog', auditLogSchema);



// Great question! If you’re switching `targetId` from `ObjectId` to `String` (Option 1), here’s what you need to consider:

// ---

// ### 1. **Schema Change**

// Change this line in your schema:
// ```js
// targetId: { type: mongoose.Schema.Types.ObjectId, required: true }
// ```
// **to:**
// ```js
// targetId: { type: String, required: true }
// ```

// ---

// ### 2. **Saving Data**

// **When creating new audit logs:**
// - Always save the ID as a string.  
// - If you have an ObjectId (e.g., from a Mongoose document), convert it to a string:  
//   ```js
//   targetId: someDocument._id.toString()
//   ```

// **Example:**
// ```js
// const log = new AuditLog({
//   action: "UPDATED_STATUS",
//   user: userId,
//   targetModel: "MaintenanceRequest",
//   targetId: maintenanceRequest._id.toString(), // always string!
//   details: { oldStatus: "New", newStatus: "In Progress" }
// });
// ```

// ---

// ### 3. **Querying Data**

// - When querying, always ensure the value you use for `targetId` is a string.
// - If you have an ObjectId, use `.toString()` before querying.

// **Example:**
// ```js
// const logs = await AuditLog.find({ targetId: someId.toString() });
// ```

// ---

// ### 4. **Migration (for Existing Data)**
// - If you already have audit logs with `ObjectId` in `targetId`, consider writing a migration script to convert all existing `targetId` values to strings.  
//   (Otherwise, you risk type mismatches in future queries.)

// **Example Migration Snippet:**
// ```js
// await AuditLog.updateMany(
//   { }, // all docs
//   [{ $set: { targetId: { $toString: "$targetId" } } }]
// );
// ```

// ---

// ### 5. **Indexing**

// - If you had an index on `targetId`, drop and recreate it as a string index for optimal query performance:
//   ```js
//   auditLogSchema.index({ targetModel: 1, targetId: 1 });
//   ```

// ---

// ### 6. **Documentation & Code Review**
// - Update any documentation or comments to reflect the type change.
// - Review all usages of `targetId` in codebase to avoid mixing strings and ObjectIds (especially if you work with both types elsewhere).

// ---

// ## **Summary Table**

// | Step          | What to Do                                                                 |
// |---------------|---------------------------------------------------------------------------|
// | Schema        | Change `targetId` to `{ type: String, required: true }`                   |
// | Saving        | Always save string, use `.toString()` if needed                            |
// | Querying      | Always query with string, convert if necessary                             |
// | Migration     | Migrate existing `ObjectId` values to strings                              |
// | Indexing      | Recreate index on `targetId` as string                                    |
// | Documentation | Update docs and review codebase for consistent usage                       |

// ---

// If you want a code block for your updated file, let me know!



// Great question! After changing `targetId` to a `String` in your audit log schema, you’ll need to review and possibly update code in several places across your codebase to ensure all reads and writes treat `targetId` as a string (using `.toString()` if the source is an ObjectId).

// Here’s a practical checklist of files and locations to consider:

// ---

// ## 1. **Model Files**
// - **`models/auditlog.js`** (or wherever your AuditLog schema lives):  
//   - You already updated the schema.

// ---

// ## 2. **Controller Files**
// - Likely location: `controllers/` or `routes/`
// - These files contain logic for creating, updating, and querying audit logs.
// - **Examples:**  
//   - `controllers/auditLogController.js`
//   - `controllers/maintenanceRequestController.js` (if logging actions here)
//   - `routes/auditLogs.js`
// - **Action:**  
//   - Whenever you pass or query `targetId`, ensure it’s a string:
//     ```js
//     targetId: someDoc._id.toString()
//     // or
//     AuditLog.find({ targetId: someDoc._id.toString() })
//     ```

// ---

// ## 3. **Service/Utility Files**
// - Likely location: `services/` or `utils/`
// - Files that have shared logging functions.
// - **Examples:**
//   - `services/auditLogger.js`
//   - `utils/logging.js`
// - **Action:**  
//   - If a function receives a document or ObjectId, convert to string before saving/logging/querying.

// ---

// ## 4. **Tests**
// - Likely location: `tests/` or `__tests__/`
// - **Examples:**
//   - `tests/auditLog.test.js`
//   - `tests/maintenanceRequest.test.js`
// - **Action:**  
//   - When creating mock data or querying, use string IDs:
//     ```js
//     targetId: mockDoc._id.toString()
//     ```

// ---

// ## 5. **Migration Scripts**
// - If you’re migrating existing audit logs, scripts may live in:
//   - `scripts/`
//   - `migrations/`
// - **Examples:**
//   - `scripts/migrate-auditlog-ids.js`
// - **Action:**  
//   - Ensure the migration converts all old `ObjectId` values to strings.

// ---

// ## 6. **Frontend (If Applicable)**
// - If your frontend references or displays `targetId`, ensure it expects a string.  
// - **Examples:**
//   - `src/components/AuditLogTable.jsx`
//   - `src/api/auditLogApi.js`
// - **Action:**  
//   - If IDs are passed as props or in API requests, stringify as needed.

// ---

// ## 7. **Documentation**
// - Update any developer docs, API docs, or comments to indicate that `targetId` is now a string.

// ---

// ## **Summary Table**

// | File/Folder Location         | Example Files                          | Key Action                                |
// |-----------------------------|----------------------------------------|-------------------------------------------|
// | models/                     | auditlog.js                            | Schema change                             |
// | controllers/                | auditLogController.js, ...             | Ensure `.toString()` on all targetIds     |
// | services/ or utils/         | auditLogger.js, logging.js             | Ensure `.toString()` on all targetIds     |
// | tests/ or __tests__/        | auditLog.test.js, ...                  | Use string IDs in test data and queries   |
// | scripts/ or migrations/     | migrate-auditlog-ids.js                | Convert existing IDs to string            |
// | frontend/ (if applicable)   | AuditLogTable.jsx, auditLogApi.js      | Ensure string targetIds in UI/API         |
// | docs/                       | README.md, API docs                    | Indicate targetId is string               |

// ---

// **Tip:**  
// Whenever you use or handle `targetId`, ask yourself:  
// - Is it being saved/queried as a string?
// - If it comes from a Mongoose document, am I calling `.toString()`?

// If you want, I can show example code snippets for any of these locations—just let me know which ones!