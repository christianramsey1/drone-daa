/* eslint-disable no-console */
/**
 * Database Client
 *
 * Provides database access for entitlements and purchases.
 * Uses Vercel Postgres (@vercel/postgres) for serverless PostgreSQL.
 *
 * Environment variables required:
 * - POSTGRES_URL: Connection string (set automatically by Vercel Postgres)
 *
 * For local development, set POSTGRES_URL to a local PostgreSQL instance
 * or use a cloud database like Supabase/Neon.
 */

const { sql } = require("@vercel/postgres");

/**
 * Find or create a user by Apple Sign In subject.
 *
 * @param {Object} params
 * @param {string} params.appleSub - Apple user subject (unique ID)
 * @param {string} [params.email] - User's email
 * @param {string} [params.displayName] - User's display name
 * @returns {Promise<Object>} User object with id, appleSub, email, displayName
 */
async function findOrCreateUser({ appleSub, email, displayName }) {
  // Try to find existing user
  const existing = await sql`
    SELECT id, apple_sub, email, display_name
    FROM users
    WHERE apple_sub = ${appleSub}
  `;

  if (existing.rows.length > 0) {
    const user = existing.rows[0];
    // Update email/name if provided and different
    if ((email && email !== user.email) || (displayName && displayName !== user.display_name)) {
      await sql`
        UPDATE users
        SET email = COALESCE(${email}, email),
            display_name = COALESCE(${displayName}, display_name)
        WHERE id = ${user.id}
      `;
    }
    return {
      id: user.id,
      appleSub: user.apple_sub,
      email: email || user.email,
      displayName: displayName || user.display_name,
    };
  }

  // Create new user
  const result = await sql`
    INSERT INTO users (apple_sub, email, display_name)
    VALUES (${appleSub}, ${email}, ${displayName})
    RETURNING id, apple_sub, email, display_name
  `;

  const user = result.rows[0];
  return {
    id: user.id,
    appleSub: user.apple_sub,
    email: user.email,
    displayName: user.display_name,
  };
}

/**
 * Get a user by their internal ID.
 *
 * @param {string} userId - User UUID
 * @returns {Promise<Object|null>} User object or null
 */
async function getUserById(userId) {
  const result = await sql`
    SELECT id, apple_sub, email, display_name
    FROM users
    WHERE id = ${userId}
  `;

  if (result.rows.length === 0) return null;

  const user = result.rows[0];
  return {
    id: user.id,
    appleSub: user.apple_sub,
    email: user.email,
    displayName: user.display_name,
  };
}

/**
 * Get active entitlements for a user.
 *
 * @param {string} userId - User UUID
 * @returns {Promise<Array>} List of entitlements
 */
async function getUserEntitlements(userId) {
  const result = await sql`
    SELECT key, expires_at, source
    FROM entitlements
    WHERE user_id = ${userId}
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY key
  `;

  return result.rows.map((row) => ({
    key: row.key,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    source: row.source,
  }));
}

/**
 * Upsert an entitlement for a user.
 * If entitlement exists, updates expires_at to extend it.
 *
 * @param {Object} params
 * @param {string} params.userId - User UUID
 * @param {string} params.key - Entitlement key (e.g., "lake:lanier")
 * @param {Date} params.expiresAt - When the entitlement expires
 * @param {string} params.source - Source ("appstore", "stripe", "admin")
 * @returns {Promise<Object>} The upserted entitlement
 */
async function upsertEntitlement({ userId, key, expiresAt, source }) {
  const result = await sql`
    INSERT INTO entitlements (user_id, key, expires_at, source)
    VALUES (${userId}, ${key}, ${expiresAt}, ${source})
    ON CONFLICT (user_id, key)
    DO UPDATE SET
      expires_at = GREATEST(entitlements.expires_at, ${expiresAt}),
      source = ${source},
      updated_at = NOW()
    RETURNING id, key, expires_at, source
  `;

  const row = result.rows[0];
  return {
    id: row.id,
    key: row.key,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    source: row.source,
  };
}

/**
 * Check if a purchase transaction already exists.
 *
 * @param {string} platform - "ios" or "web"
 * @param {string} transactionId - Transaction ID
 * @returns {Promise<boolean>} True if transaction exists
 */
async function purchaseExists(platform, transactionId) {
  const result = await sql`
    SELECT 1 FROM purchases
    WHERE platform = ${platform} AND transaction_id = ${transactionId}
  `;
  return result.rows.length > 0;
}

/**
 * Record a new purchase.
 *
 * @param {Object} params
 * @param {string} params.userId - User UUID
 * @param {string} params.platform - "ios" or "web"
 * @param {string} params.productId - Product SKU
 * @param {string} params.transactionId - Transaction ID
 * @param {string} [params.originalTransactionId] - Original transaction ID
 * @param {Date} params.purchaseDate - When purchased
 * @param {Date} params.expiresAt - When entitlement expires
 * @param {string} params.environment - "production" or "sandbox"
 * @param {Object} [params.rawPayload] - Full transaction data
 * @returns {Promise<Object>} The created purchase
 */
async function createPurchase({
  userId,
  platform,
  productId,
  transactionId,
  originalTransactionId,
  purchaseDate,
  expiresAt,
  environment,
  rawPayload,
}) {
  const result = await sql`
    INSERT INTO purchases (
      user_id, platform, product_id, transaction_id, original_transaction_id,
      purchase_date, expires_at, environment, raw_payload
    )
    VALUES (
      ${userId}, ${platform}, ${productId}, ${transactionId}, ${originalTransactionId},
      ${purchaseDate}, ${expiresAt}, ${environment}, ${JSON.stringify(rawPayload)}
    )
    RETURNING id, product_id, transaction_id, purchase_date, expires_at
  `;

  const row = result.rows[0];
  return {
    id: row.id,
    productId: row.product_id,
    transactionId: row.transaction_id,
    purchaseDate: row.purchase_date.toISOString(),
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
  };
}

// ─── User Custom POIs ───

/**
 * Get all custom POIs for a user on a specific lake.
 */
async function getUserPois(userId, lakeId) {
  const result = await sql`
    SELECT id, lake_id, name, category, lat, lon, is_home, sort_order, created_at, updated_at
    FROM user_pois
    WHERE user_id = ${userId} AND lake_id = ${lakeId}
    ORDER BY sort_order
  `;
  return result.rows.map((row) => ({
    id: row.id,
    lakeId: row.lake_id,
    name: row.name,
    category: row.category,
    lat: parseFloat(row.lat),
    lon: parseFloat(row.lon),
    isHome: row.is_home,
    sortOrder: row.sort_order,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

/**
 * Count custom POIs for a user on a specific lake.
 */
async function countUserPois(userId, lakeId) {
  const result = await sql`
    SELECT COUNT(*)::int AS count FROM user_pois
    WHERE user_id = ${userId} AND lake_id = ${lakeId}
  `;
  return result.rows[0].count;
}

/**
 * Create a custom POI. If isHome, clears any existing home for that lake.
 */
async function createUserPoi({ userId, lakeId, name, category, lat, lon, isHome, sortOrder }) {
  if (isHome) {
    await sql`
      UPDATE user_pois SET is_home = false, updated_at = NOW()
      WHERE user_id = ${userId} AND lake_id = ${lakeId} AND is_home = true
    `;
  }
  const result = await sql`
    INSERT INTO user_pois (user_id, lake_id, name, category, lat, lon, is_home, sort_order)
    VALUES (${userId}, ${lakeId}, ${name}, ${category}, ${lat}, ${lon}, ${isHome}, ${sortOrder})
    RETURNING id, lake_id, name, category, lat, lon, is_home, sort_order, created_at, updated_at
  `;
  const row = result.rows[0];
  return {
    id: row.id,
    lakeId: row.lake_id,
    name: row.name,
    category: row.category,
    lat: parseFloat(row.lat),
    lon: parseFloat(row.lon),
    isHome: row.is_home,
    sortOrder: row.sort_order,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Update a custom POI (only fields provided in updates).
 * Verifies ownership via userId.
 */
async function updateUserPoi(poiId, userId, { name, category, isHome }) {
  if (isHome === true) {
    const existing = await sql`
      SELECT lake_id FROM user_pois WHERE id = ${poiId} AND user_id = ${userId}
    `;
    if (existing.rows.length === 0) return null;
    const lakeId = existing.rows[0].lake_id;
    await sql`
      UPDATE user_pois SET is_home = false, updated_at = NOW()
      WHERE user_id = ${userId} AND lake_id = ${lakeId} AND is_home = true
    `;
  }

  const result = await sql`
    UPDATE user_pois
    SET name = COALESCE(${name ?? null}, name),
        category = COALESCE(${category ?? null}, category),
        is_home = COALESCE(${isHome ?? null}, is_home),
        updated_at = NOW()
    WHERE id = ${poiId} AND user_id = ${userId}
    RETURNING id, lake_id, name, category, lat, lon, is_home, sort_order, created_at, updated_at
  `;
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    lakeId: row.lake_id,
    name: row.name,
    category: row.category,
    lat: parseFloat(row.lat),
    lon: parseFloat(row.lon),
    isHome: row.is_home,
    sortOrder: row.sort_order,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Delete a custom POI. Verifies ownership via userId.
 */
async function deleteUserPoi(poiId, userId) {
  const result = await sql`
    DELETE FROM user_pois WHERE id = ${poiId} AND user_id = ${userId}
  `;
  return result.rowCount > 0;
}

module.exports = {
  findOrCreateUser,
  getUserById,
  getUserEntitlements,
  upsertEntitlement,
  purchaseExists,
  createPurchase,
  getUserPois,
  countUserPois,
  createUserPoi,
  updateUserPoi,
  deleteUserPoi,
};
